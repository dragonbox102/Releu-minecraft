import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  fetchLatestStableBuild,
  fetchPaperVersions,
  resolvePaperVersion,
} from "./paper.js";
import { withHiddenConsole } from "./platform.js";

const SOFTWARE_USER_AGENT =
  "localhost-minecraft-panel/1.0 (https://localhost.example/minecraft-panel)";
const versionSorter = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const FORGE_METADATA_URL =
  "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
const NEOFORGE_METADATA_URL =
  "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";

export const serverSoftwareOptions = [
  {
    id: "vanilla",
    name: "Vanilla",
    releaseChannel: "stable",
    latestHint: "Official Minecraft server",
    supportsPlugins: false,
    supportsMods: false,
  },
  {
    id: "paper",
    name: "Paper",
    releaseChannel: "stable",
    latestHint: "Latest stable Paper release",
    supportsPlugins: true,
    supportsMods: false,
  },
  {
    id: "purpur",
    name: "Purpur",
    releaseChannel: "experimental",
    latestHint: "Latest Minecraft support via Purpur experimental builds",
    supportsPlugins: true,
    supportsMods: false,
  },
  {
    id: "fabric",
    name: "Fabric",
    releaseChannel: "stable",
    latestHint: "Fabric mod loader server",
    supportsPlugins: false,
    supportsMods: true,
  },
  {
    id: "forge",
    name: "Forge",
    releaseChannel: "stable",
    latestHint: "Official Forge mod loader server",
    supportsPlugins: false,
    supportsMods: true,
  },
  {
    id: "neoforge",
    name: "NeoForge",
    releaseChannel: "stable",
    latestHint: "Official NeoForge mod loader server",
    supportsPlugins: false,
    supportsMods: true,
  },
];

function sortVersionsDescending(versions) {
  return [...new Set(versions)].sort((left, right) => versionSorter.compare(right, left));
}

async function fetchSoftwareJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": SOFTWARE_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Software metadata request failed (${response.status}).`);
  }

  return response.json();
}

async function fetchSoftwareText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/xml, text/xml, text/plain",
      "User-Agent": SOFTWARE_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Software metadata request failed (${response.status}).`);
  }

  return response.text();
}

async function fetchBinary(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": SOFTWARE_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to download server file (${response.status}).`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function writeBinary(url, destinationPath) {
  const data = await fetchBinary(url);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, data);
  return data;
}

function parseXmlVersions(xml) {
  return Array.from(String(xml ?? "").matchAll(/<version>([^<]+)<\/version>/g)).map(
    (match) => match[1].trim(),
  );
}

function parseXmlTag(xml, tagName) {
  return String(xml ?? "").match(new RegExp(`<${tagName}>([^<]+)</${tagName}>`, "i"))?.[1] ?? null;
}

function isSupportedForgeVersion(version) {
  return /^\d+(?:\.\d+){1,2}-\d+(?:\.\d+){1,3}$/i.test(String(version ?? "").trim());
}

function isSupportedNeoForgeVersion(version) {
  const normalized = String(version ?? "").trim();
  if (!/^\d+(?:\.\d+){2,3}(?:-[0-9A-Za-z.]+)?$/i.test(normalized)) {
    return false;
  }
  if (normalized.includes("+snapshot")) {
    return false;
  }
  if (/alpha/i.test(normalized)) {
    return false;
  }
  return true;
}

async function runJavaInstaller(javaPath, installerPath, destinationDir, installerArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, ["-jar", installerPath, ...installerArgs], {
      cwd: destinationDir,
      ...withHiddenConsole(),
    });

    let output = "";
    let settled = false;

    const finish = (error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve(output);
    };

    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });

    child.on("error", (error) => {
      finish(error);
    });

    child.on("exit", (code) => {
      if (code && code !== 0) {
        const lines = output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-20);
        finish(
          new Error(
            lines.length
              ? lines.join(" ")
              : `The server installer exited with code ${code}.`,
          ),
        );
        return;
      }
      finish();
    });
  });
}

function normalizeMinecraftVersion(version) {
  const baseVersion = String(version ?? "").trim().split("-")[0];
  if (/^\d+(?:\.\d+){2,3}$/i.test(baseVersion) && !baseVersion.startsWith("1.")) {
    const pieces = baseVersion.split(".");
    const first = Number(pieces[0]);
    if (first >= 26 && pieces.length >= 3) {
      return pieces.slice(0, 3).join(".");
    }
    if (pieces.length >= 2) {
      return `1.${pieces[0]}.${pieces[1]}`;
    }
  }
  return baseVersion;
}

function extractForgeMinecraftVersion(version) {
  return String(version ?? "").trim().split("-")[0];
}

export async function fetchPurpurVersions() {
  const payload = await fetchSoftwareJson("https://api.purpurmc.org/v2/purpur/");
  return sortVersionsDescending(payload.versions ?? []);
}

export async function resolvePurpurVersion(requestedVersion = "latest") {
  if (requestedVersion && requestedVersion !== "latest") {
    return requestedVersion;
  }

  const versions = await fetchPurpurVersions();
  return versions[0] ?? null;
}

export async function fetchLatestPurpurBuild(version) {
  const payload = await fetchSoftwareJson(
    `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}`,
  );

  const latestBuild = payload.builds?.latest;
  if (!latestBuild) {
    throw new Error(`No Purpur build found for version ${version}.`);
  }

  return {
    id: Number(latestBuild),
    downloadUrl: `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}/${latestBuild}/download`,
  };
}

export async function fetchVanillaVersions() {
  const payload = await fetchSoftwareJson(
    "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
  );

  return sortVersionsDescending(
    (payload.versions ?? [])
      .filter((entry) => entry.type === "release")
      .map((entry) => entry.id),
  );
}

export async function resolveVanillaVersion(requestedVersion = "latest") {
  if (requestedVersion && requestedVersion !== "latest") {
    return requestedVersion;
  }

  const payload = await fetchSoftwareJson(
    "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
  );
  return payload.latest?.release ?? null;
}

export async function fetchVanillaServerDownload(version) {
  const payload = await fetchSoftwareJson(
    "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
  );
  const match = (payload.versions ?? []).find((entry) => entry.id === version);
  if (!match?.url) {
    throw new Error(`No official Minecraft server metadata found for version ${version}.`);
  }

  const metadata = await fetchSoftwareJson(match.url);
  const serverDownload = metadata.downloads?.server;
  if (!serverDownload?.url) {
    throw new Error(`Minecraft ${version} does not expose a downloadable server jar.`);
  }

  return serverDownload;
}

export async function fetchFabricVersions() {
  const payload = await fetchSoftwareJson("https://meta.fabricmc.net/v2/versions/game");
  return sortVersionsDescending(
    (payload ?? []).filter((entry) => entry.stable).map((entry) => entry.version),
  );
}

export async function resolveFabricVersion(requestedVersion = "latest") {
  if (requestedVersion && requestedVersion !== "latest") {
    return requestedVersion;
  }

  const versions = await fetchFabricVersions();
  return versions[0] ?? null;
}

export async function fetchLatestFabricLoader(version) {
  const payload = await fetchSoftwareJson(
    `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}`,
  );

  const preferred = (payload ?? []).find((entry) => entry.loader?.stable) ?? payload?.[0];
  if (!preferred?.loader?.version) {
    throw new Error(`No Fabric loader version found for Minecraft ${version}.`);
  }

  return preferred.loader.version;
}

export async function fetchLatestFabricInstaller() {
  const payload = await fetchSoftwareJson("https://meta.fabricmc.net/v2/versions/installer");
  const preferred = (payload ?? []).find((entry) => entry.stable) ?? payload?.[0];
  if (!preferred?.version) {
    throw new Error("No Fabric installer version is available.");
  }
  return preferred.version;
}

export async function fetchForgeVersions() {
  const payload = await fetchSoftwareText(FORGE_METADATA_URL);
  return sortVersionsDescending(parseXmlVersions(payload).filter(isSupportedForgeVersion));
}

export async function resolveForgeVersion(requestedVersion = "latest") {
  if (requestedVersion && requestedVersion !== "latest") {
    return requestedVersion;
  }

  const payload = await fetchSoftwareText(FORGE_METADATA_URL);
  const release = parseXmlTag(payload, "release");
  if (release && isSupportedForgeVersion(release)) {
    return release;
  }
  const versions = parseXmlVersions(payload).filter(isSupportedForgeVersion);
  return sortVersionsDescending(versions)[0] ?? null;
}

export async function fetchNeoForgeVersions() {
  const payload = await fetchSoftwareText(NEOFORGE_METADATA_URL);
  return sortVersionsDescending(parseXmlVersions(payload).filter(isSupportedNeoForgeVersion));
}

export async function resolveNeoForgeVersion(requestedVersion = "latest") {
  if (requestedVersion && requestedVersion !== "latest") {
    return requestedVersion;
  }

  const payload = await fetchSoftwareText(NEOFORGE_METADATA_URL);
  const release = parseXmlTag(payload, "release");
  if (release && isSupportedNeoForgeVersion(release)) {
    return release;
  }
  const versions = parseXmlVersions(payload).filter(isSupportedNeoForgeVersion);
  return sortVersionsDescending(versions)[0] ?? null;
}

export async function resolveSoftwareVersion(software = "purpur", requestedVersion = "latest") {
  switch (software) {
    case "vanilla":
      return resolveVanillaVersion(requestedVersion);
    case "paper":
      return resolvePaperVersion(requestedVersion);
    case "purpur":
      return resolvePurpurVersion(requestedVersion);
    case "fabric":
      return resolveFabricVersion(requestedVersion);
    case "forge":
      return resolveForgeVersion(requestedVersion);
    case "neoforge":
      return resolveNeoForgeVersion(requestedVersion);
    default:
      throw new Error(`Unsupported server software: ${software}`);
  }
}

export async function fetchSoftwareVersions(software = "purpur") {
  switch (software) {
    case "vanilla":
      return fetchVanillaVersions();
    case "paper":
      return fetchPaperVersions();
    case "purpur":
      return fetchPurpurVersions();
    case "fabric":
      return fetchFabricVersions();
    case "forge":
      return fetchForgeVersions();
    case "neoforge":
      return fetchNeoForgeVersions();
    default:
      throw new Error(`Unsupported server software: ${software}`);
  }
}

async function installForgeFamily({
  software,
  version,
  destinationDir,
  javaPath,
}) {
  const installerName = `${software}-${version}-installer.jar`;
  const installerPath = path.join(destinationDir, installerName);
  const downloadUrl =
    software === "forge"
      ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${encodeURIComponent(version)}/forge-${encodeURIComponent(version)}-installer.jar`
      : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${encodeURIComponent(version)}/neoforge-${encodeURIComponent(version)}-installer.jar`;

  const data = await writeBinary(downloadUrl, installerPath);
  await runJavaInstaller(
    javaPath,
    installerPath,
    destinationDir,
    software === "forge" ? ["--installServer", destinationDir] : ["--install-server", destinationDir],
  );
  await fs.rm(installerPath, { force: true }).catch(() => {});

  return {
    software,
    softwareName: software === "forge" ? "Forge" : "NeoForge",
    version,
    build: null,
    channel: String(version).includes("beta") ? "beta" : "stable",
    fileName: installerName,
    size: data.length,
    sha256: null,
    downloadedTo: destinationDir,
  };
}

export async function downloadServerJar({
  software = "purpur",
  requestedVersion = "latest",
  destinationPath,
  javaPath = "java",
}) {
  if (!destinationPath) {
    throw new Error("A destination path for the server jar is required.");
  }

  const destinationDir = path.dirname(destinationPath);

  switch (software) {
    case "vanilla": {
      const version = await resolveVanillaVersion(requestedVersion);
      const download = await fetchVanillaServerDownload(version);
      const data = await fetchBinary(download.url);
      await fs.mkdir(destinationDir, { recursive: true });
      await fs.writeFile(destinationPath, data);

      return {
        software,
        softwareName: "Vanilla",
        version,
        build: null,
        channel: "stable",
        fileName: path.basename(new URL(download.url).pathname),
        size: download.size ?? data.length,
        sha256: null,
        downloadedTo: destinationPath,
      };
    }
    case "paper": {
      const version = await resolvePaperVersion(requestedVersion);
      const build = await fetchLatestStableBuild(version);
      const download = build.downloads["server:default"];
      const data = await fetchBinary(download.url);
      await fs.mkdir(destinationDir, { recursive: true });
      await fs.writeFile(destinationPath, data);

      return {
        software,
        softwareName: "Paper",
        version,
        build: build.id,
        channel: "stable",
        fileName: download.name,
        size: download.size,
        sha256: download.checksums?.sha256 ?? null,
        downloadedTo: destinationPath,
      };
    }
    case "purpur": {
      const version = await resolvePurpurVersion(requestedVersion);
      const build = await fetchLatestPurpurBuild(version);
      const data = await fetchBinary(build.downloadUrl);
      await fs.mkdir(destinationDir, { recursive: true });
      await fs.writeFile(destinationPath, data);

      return {
        software,
        softwareName: "Purpur",
        version,
        build: build.id,
        channel: "experimental",
        fileName: `purpur-${version}-${build.id}.jar`,
        size: data.length,
        sha256: null,
        downloadedTo: destinationPath,
      };
    }
    case "fabric": {
      const version = await resolveFabricVersion(requestedVersion);
      const loaderVersion = await fetchLatestFabricLoader(version);
      const installerVersion = await fetchLatestFabricInstaller();
      const downloadUrl =
        `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}/` +
        `${encodeURIComponent(loaderVersion)}/${encodeURIComponent(installerVersion)}/server/jar`;
      const data = await fetchBinary(downloadUrl);
      await fs.mkdir(destinationDir, { recursive: true });
      await fs.writeFile(destinationPath, data);

      return {
        software,
        softwareName: "Fabric",
        version,
        build: loaderVersion,
        channel: "stable",
        fileName: `fabric-server-${version}-loader-${loaderVersion}.jar`,
        size: data.length,
        sha256: null,
        installerVersion,
        downloadedTo: destinationPath,
      };
    }
    case "forge": {
      const version = await resolveForgeVersion(requestedVersion);
      return installForgeFamily({
        software,
        version,
        destinationDir,
        javaPath,
      });
    }
    case "neoforge": {
      const version = await resolveNeoForgeVersion(requestedVersion);
      return installForgeFamily({
        software,
        version,
        destinationDir,
        javaPath,
      });
    }
    default:
      throw new Error(`Unsupported server software: ${software}`);
  }
}

export function getRequiredJavaMajor(version) {
  const value = normalizeMinecraftVersion(version);
  if (value.startsWith("26.")) {
    return 25;
  }

  if (value.startsWith("1.20") || value.startsWith("1.21")) {
    return 21;
  }

  if (value.startsWith("1.17") || value.startsWith("1.18") || value.startsWith("1.19")) {
    return 17;
  }

  if (/^1\.(?:[0-9]|1[0-6])(?:\.|$)/.test(value)) {
    return 8;
  }

  if (
    isSupportedForgeVersion(String(version ?? "")) &&
    /^1\.(?:[0-9]|1[0-6])(?:\.|$)/.test(extractForgeMinecraftVersion(version))
  ) {
    return 8;
  }

  return 17;
}
