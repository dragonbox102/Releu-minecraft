import fs from "node:fs/promises";
import path from "node:path";
import {
  fetchLatestStableBuild,
  fetchPaperVersions,
  resolvePaperVersion,
} from "./paper.js";

const PURPUR_USER_AGENT =
  "localhost-minecraft-panel/1.0 (https://localhost.example/minecraft-panel)";
const versionSorter = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

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
];

function sortVersionsDescending(versions) {
  return [...versions].sort((left, right) => versionSorter.compare(right, left));
}

async function fetchPurpurJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": PURPUR_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Purpur download request failed (${response.status}).`);
  }

  return response.json();
}

async function fetchSoftwareJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": PURPUR_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Software metadata request failed (${response.status}).`);
  }

  return response.json();
}

async function fetchBinary(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": PURPUR_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to download server file (${response.status}).`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function fetchPurpurVersions() {
  const payload = await fetchPurpurJson("https://api.purpurmc.org/v2/purpur/");
  return sortVersionsDescending(payload.versions ?? []);
}

export async function resolvePurpurVersion(requestedVersion = "latest") {
  if (requestedVersion && requestedVersion !== "latest") {
    return requestedVersion;
  }

  const versions = await fetchPurpurVersions();
  return versions[0];
}

export async function fetchLatestPurpurBuild(version) {
  const payload = await fetchPurpurJson(
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
    default:
      throw new Error(`Unsupported server software: ${software}`);
  }
}

export async function downloadServerJar({
  software = "purpur",
  requestedVersion = "latest",
  destinationPath,
}) {
  if (!destinationPath) {
    throw new Error("A destination path for the server jar is required.");
  }

  switch (software) {
    case "vanilla": {
      const version = await resolveVanillaVersion(requestedVersion);
      const download = await fetchVanillaServerDownload(version);
      const data = await fetchBinary(download.url);
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
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
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
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
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
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
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
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
    default:
      throw new Error(`Unsupported server software: ${software}`);
  }
}

export function getRequiredJavaMajor(version) {
  const value = String(version ?? "");
  if (value.startsWith("26.")) {
    return 25;
  }

  if (value.startsWith("1.20") || value.startsWith("1.21")) {
    return 21;
  }

  if (value.startsWith("1.17") || value.startsWith("1.18") || value.startsWith("1.19")) {
    return 17;
  }

  return 17;
}
