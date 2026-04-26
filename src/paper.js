import fs from "node:fs/promises";

import { paths } from "./config.js";

const PAPER_USER_AGENT =
  "localhost-minecraft-panel/1.0 (https://localhost.example/minecraft-panel)";
const versionSorter = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const stableBuildAvailabilityCache = new Map();

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": PAPER_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Paper download request failed (${response.status}).`);
  }

  return response.json();
}

export async function fetchPaperVersions() {
  const payload = await fetchJson("https://fill.papermc.io/v3/projects/paper");
  const versions = Object.values(payload.versions ?? {})
    .flat()
    .filter((version) => !String(version).includes("-"))
    .sort((left, right) => versionSorter.compare(right, left));

  const stableChecks = await Promise.all(
    versions.map(async (version) => {
      if (stableBuildAvailabilityCache.has(version)) {
        return [version, stableBuildAvailabilityCache.get(version)];
      }

      try {
        await fetchLatestStableBuild(version);
        stableBuildAvailabilityCache.set(version, true);
        return [version, true];
      } catch {
        stableBuildAvailabilityCache.set(version, false);
        return [version, false];
      }
    }),
  );

  const stableVersions = stableChecks
    .filter(([, available]) => available)
    .map(([version]) => version);

  return stableVersions.length ? stableVersions : versions.filter((version) => version.startsWith("1."));
}

export async function resolvePaperVersion(requestedVersion = "latest") {
  if (requestedVersion && requestedVersion !== "latest") {
    return requestedVersion;
  }

  const versions = await fetchPaperVersions();
  const preferred = versions.find((version) => String(version).startsWith("1."));
  return preferred ?? versions[0];
}

export async function fetchLatestStableBuild(version) {
  const payload = await fetchJson(
    `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds`,
  );

  const builds = (Array.isArray(payload) ? payload : payload.value ?? []).sort(
    (left, right) => Number(right.id ?? 0) - Number(left.id ?? 0),
  );
  const stableBuild = builds.find(
    (build) => build.channel === "STABLE" && build.downloads?.["server:default"]?.url,
  );

  if (!stableBuild) {
    throw new Error(`No stable Paper build found for version ${version}.`);
  }

  return stableBuild;
}

export async function downloadPaperJar(requestedVersion = "latest") {
  const version = await resolvePaperVersion(requestedVersion);
  const build = await fetchLatestStableBuild(version);
  const download = build.downloads["server:default"];

  const response = await fetch(download.url, {
    headers: {
      "User-Agent": PAPER_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to download Paper jar (${response.status}).`);
  }

  const data = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(paths.serverDir, { recursive: true });
  await fs.writeFile(paths.serverJar, data);

  return {
    version,
    build: build.id,
    fileName: download.name,
    size: download.size,
    sha256: download.checksums?.sha256 ?? null,
    downloadedTo: paths.serverJar,
  };
}
