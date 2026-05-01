const MODRINTH_API_BASE = "https://api.modrinth.com/v3";
const MODRINTH_USER_AGENT = "localhost-minecraft-panel/1.0";

export const pluginCatalogProfiles = [
  {
    id: "auto",
    label: "Auto (Paper family)",
    searchLoaders: ["purpur", "paper", "spigot", "bukkit"],
    installLoaders: ["purpur", "paper", "spigot", "bukkit"],
  },
  {
    id: "purpur",
    label: "Purpur",
    searchLoaders: ["purpur", "paper", "spigot", "bukkit"],
    installLoaders: ["purpur", "paper", "spigot", "bukkit"],
  },
  {
    id: "paper",
    label: "Paper",
    searchLoaders: ["paper", "spigot", "bukkit"],
    installLoaders: ["paper", "spigot", "bukkit"],
  },
  {
    id: "spigot",
    label: "Spigot / Bukkit",
    searchLoaders: ["spigot", "bukkit"],
    installLoaders: ["spigot", "bukkit"],
  },
];

export const modCatalogProfiles = [
  {
    id: "fabric",
    label: "Fabric",
    searchLoaders: ["fabric"],
    installLoaders: ["fabric"],
  },
  {
    id: "forge",
    label: "Forge",
    searchLoaders: ["forge"],
    installLoaders: ["forge"],
  },
  {
    id: "neoforge",
    label: "NeoForge",
    searchLoaders: ["neoforge"],
    installLoaders: ["neoforge"],
  },
  {
    id: "quilt",
    label: "Quilt",
    searchLoaders: ["quilt"],
    installLoaders: ["quilt"],
  },
];

export const resourcePackCatalogProfiles = [
  {
    id: "resourcepack",
    label: "Resource Pack",
    searchLoaders: [],
    installLoaders: [],
  },
];

function getProfiles(kind) {
  if (kind === "plugin") {
    return pluginCatalogProfiles;
  }
  if (kind === "resourcepack") {
    return resourcePackCatalogProfiles;
  }
  return modCatalogProfiles;
}

export function getDefaultCatalogProfileId(kind, serverSoftware) {
  if (kind === "resourcepack") {
    return "resourcepack";
  }
  if (kind === "plugin") {
    if (serverSoftware === "purpur") {
      return "purpur";
    }
    if (serverSoftware === "paper") {
      return "paper";
    }
    return "auto";
  }

  if (serverSoftware === "forge") {
    return "forge";
  }

  if (serverSoftware === "neoforge") {
    return "neoforge";
  }

  if (serverSoftware === "quilt") {
    return "quilt";
  }

  return "fabric";
}

export function resolveCatalogProfile(kind, profileId, serverSoftware) {
  const profiles = getProfiles(kind);
  const preferredId = profileId || getDefaultCatalogProfileId(kind, serverSoftware);
  return (
    profiles.find((entry) => entry.id === preferredId) ??
    profiles.find((entry) => entry.id === getDefaultCatalogProfileId(kind, serverSoftware)) ??
    profiles[0]
  );
}

async function fetchModrinthJson(pathname, searchParams = null) {
  const url = new URL(`${MODRINTH_API_BASE}${pathname}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": MODRINTH_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Modrinth request failed (${response.status}).`);
  }

  return response.json();
}

async function fetchProjectInfo(projectId) {
  return fetchModrinthJson(`/project/${encodeURIComponent(projectId)}`);
}

function buildSearchFacets({ kind, profile, gameVersion }) {
  const facets = [];
  if (profile.searchLoaders?.length) {
    facets.push(profile.searchLoaders.map((loader) => `categories:${loader}`));
  }
  if (kind === "plugin" || kind === "mod") {
    facets.push(["server_side:required", "server_side:optional", "server_side:unknown"]);
  }
  const normalizedGameVersion = String(gameVersion ?? "").trim();
  const shouldUseVersionFacet =
    normalizedGameVersion &&
    normalizedGameVersion.toLowerCase() !== "latest" &&
    !(
      /^\d+(?:\.\d+){2,3}$/i.test(normalizedGameVersion) &&
      !normalizedGameVersion.startsWith("1.")
    );
  if (shouldUseVersionFacet) {
    facets.push([`versions:${normalizedGameVersion}`]);
  }
  return JSON.stringify(facets);
}

export async function searchCatalogProjects({
  kind,
  query,
  profileId,
  serverSoftware,
  gameVersion,
  limit = 12,
  page = 1,
  index = "relevance",
}) {
  const profile = resolveCatalogProfile(kind, profileId, serverSoftware);
  const requestedQuery = String(query ?? "").trim();
  const effectiveQuery =
    requestedQuery || (kind === "resourcepack" ? "resource pack" : "");
  const pageSize = Math.max(1, Math.min(24, Number(limit) || 12));
  const currentPage = Math.max(1, Number(page) || 1);
  const upstreamLimit = Math.min(
    80,
    Math.max(pageSize, kind === "resourcepack" ? pageSize * 4 : pageSize * 2),
  );
  let offset = Math.max(0, (currentPage - 1) * pageSize);
  let totalHits = 0;
  let exhausted = false;
  let batches = 0;
  const compatibleResults = [];

  while (compatibleResults.length < pageSize && !exhausted && batches < 4) {
    const payload = await fetchModrinthJson("/search", {
      query: effectiveQuery,
      facets: buildSearchFacets({ kind, profile, gameVersion }),
      limit: String(upstreamLimit),
      offset: String(offset),
      index,
    });

    totalHits = Math.max(
      totalHits,
      Number(payload.total_hits ?? payload.totalHits ?? 0) || 0,
    );

    const rawResults = (payload.hits ?? []).map((entry) => ({
      id: entry.project_id,
      slug: entry.slug,
      title: entry.name ?? entry.title,
      author: entry.author,
      description: entry.summary ?? entry.description,
      iconUrl: entry.icon_url,
      downloads: entry.downloads,
      followers: entry.follows,
      latestGameVersion:
        entry.game_versions?.at?.(-1) ?? entry.latest_version ?? null,
      gameVersions: entry.game_versions ?? entry.versions ?? [],
      categories: entry.display_categories ?? entry.categories ?? entry.loaders ?? [],
      dateModified: entry.date_modified,
      clientSide: entry.client_side ?? null,
      serverSide: entry.server_side ?? null,
    }));

    if (!rawResults.length) {
      break;
    }

    const compatibilityChecks = await Promise.all(
      rawResults.map(async (entry) => {
        try {
          const projectInfo = await fetchProjectInfo(entry.id);
          const projectTypes = Array.isArray(projectInfo.project_types)
            ? projectInfo.project_types
            : [];
          if (kind === "plugin" && !projectTypes.includes("plugin")) {
            return null;
          }
          if (kind === "mod" && !projectTypes.includes("mod")) {
            return null;
          }
          if (kind === "resourcepack" && !projectTypes.includes("resourcepack")) {
            return null;
          }
          if (
            (kind === "plugin" || kind === "mod") &&
            String(projectInfo.server_side ?? entry.serverSide ?? "unknown").toLowerCase() ===
              "unsupported"
          ) {
            return null;
          }

          const { versions, selectedVersion } = await fetchCompatibleProjectVersion(
            entry.id,
            profile,
            gameVersion,
          );
          if (!selectedVersion) {
            return null;
          }

          return {
            ...entry,
            title: projectInfo.name ?? entry.title,
            description: projectInfo.summary ?? entry.description,
            iconUrl: projectInfo.icon_url ?? entry.iconUrl,
            clientSide: projectInfo.client_side ?? entry.clientSide ?? "unknown",
            serverSide: projectInfo.server_side ?? entry.serverSide ?? "unknown",
            compatibleVersionNumber: selectedVersion.version_number ?? null,
            compatibleGameVersions: selectedVersion.game_versions ?? [],
            availableVersions: listCompatibleVersions(versions, gameVersion).slice(0, 12),
          };
        } catch {
          return null;
        }
      }),
    );

    compatibleResults.push(...compatibilityChecks.filter(Boolean));
    offset += rawResults.length;
    batches += 1;
    exhausted = rawResults.length < upstreamLimit || (totalHits > 0 && offset >= totalHits);
  }

  const results = compatibleResults.slice(0, pageSize);

  return {
    profile,
    page: currentPage,
    pageSize,
    totalHits: totalHits || results.length,
    totalPages: Math.max(1, Math.ceil(Math.max(totalHits || results.length, 1) / pageSize)),
    results,
  };
}

function pickPrimaryFile(version) {
  return version.files?.find((entry) => entry.primary) ?? version.files?.[0] ?? null;
}

function sortVersionsDescending(left, right) {
  return Date.parse(right.date_published ?? 0) - Date.parse(left.date_published ?? 0);
}

function filterVersionsForGameVersion(versions, gameVersion) {
  const normalized = String(gameVersion ?? "").trim();
  if (!normalized) {
    return [...versions];
  }

  const exactMatches = versions.filter((entry) =>
    (entry.game_versions ?? []).includes(normalized),
  );
  if (exactMatches.length) {
    return exactMatches;
  }

  const relaxedPrefix =
    normalized.includes(".") ? normalized.split(".").slice(0, -1).join(".") : normalized;
  const relaxedMatches = versions.filter((entry) =>
    (entry.game_versions ?? []).some((value) => String(value).startsWith(relaxedPrefix)),
  );
  return relaxedMatches.length ? relaxedMatches : [...versions];
}

function selectCompatibleVersion(versions, gameVersion) {
  const candidates = filterVersionsForGameVersion(versions, gameVersion)
    .filter((entry) => entry.status === "listed" || entry.status === "archived" || !entry.status)
    .sort(sortVersionsDescending);

  return candidates.find((entry) => pickPrimaryFile(entry)) ?? null;
}

function listCompatibleVersions(versions, gameVersion) {
  return filterVersionsForGameVersion(versions, gameVersion)
    .filter((entry) => entry.status === "listed" || entry.status === "archived" || !entry.status)
    .sort(sortVersionsDescending)
    .filter((entry) => pickPrimaryFile(entry))
    .map((entry) => ({
      id: entry.id,
      versionNumber: entry.version_number ?? null,
      name: entry.name ?? null,
      gameVersions: entry.game_versions ?? [],
      publishedAt: entry.date_published ?? null,
      fileName: pickPrimaryFile(entry)?.filename ?? null,
    }));
}

async function fetchCompatibleProjectVersion(projectId, profile, gameVersion) {
  const searchParams = {
    include_changelog: "false",
  };
  if (profile.installLoaders?.length) {
    searchParams.loaders = JSON.stringify(profile.installLoaders);
  }
  const versions = await fetchModrinthJson(`/project/${encodeURIComponent(projectId)}/version`, searchParams);

  return {
    versions,
    selectedVersion: selectCompatibleVersion(versions, gameVersion),
  };
}

export async function resolveCatalogInstall({
  projectId,
  kind,
  profileId,
  serverSoftware,
  gameVersion,
  versionId = null,
}) {
  const profile = resolveCatalogProfile(kind, profileId, serverSoftware);
  const projectInfo = await fetchProjectInfo(projectId);
  const { versions, selectedVersion: compatibleVersion } = await fetchCompatibleProjectVersion(
    projectId,
    profile,
    gameVersion,
  );
  const selectedVersion = versionId
    ? versions.find((entry) => entry.id === versionId && pickPrimaryFile(entry))
    : compatibleVersion;
  if (!selectedVersion) {
    const title = projectInfo.title ?? projectInfo.name ?? "This project";
    const requestedGameVersion =
      String(gameVersion ?? "").trim() || "the selected Minecraft version";
    throw new Error(
      versionId
        ? `${title} does not expose that installable ${profile.label} version for ${requestedGameVersion}.`
        : `${title} does not have a listed ${profile.label} version for ${requestedGameVersion}. Try a different project or change the server version.`,
    );
  }

  const file = pickPrimaryFile(selectedVersion);
  if (!file?.url || !file?.filename) {
    throw new Error("The selected Modrinth version does not expose a downloadable file.");
  }

  return {
    profile,
    projectId,
    projectSlug: projectInfo.slug ?? null,
    projectTitle: projectInfo.title ?? projectInfo.name ?? null,
    projectDescription: projectInfo.description ?? projectInfo.summary ?? null,
    iconUrl: projectInfo.icon_url ?? null,
    versionId: selectedVersion.id,
    versionNumber: selectedVersion.version_number,
    versionName: selectedVersion.name,
    clientSide: projectInfo.client_side ?? "unknown",
    serverSide: projectInfo.server_side ?? "unknown",
    fileName: file.filename,
    fileUrl: file.url,
    fileSha1: file.hashes?.sha1 ?? null,
    gameVersions: selectedVersion.game_versions ?? [],
    loaders: selectedVersion.loaders ?? [],
    dependencies: (selectedVersion.dependencies ?? []).map((entry) => ({
      versionId: entry.version_id ?? null,
      projectId: entry.project_id ?? null,
      fileName: entry.file_name ?? null,
      type: entry.dependency_type ?? null,
    })),
    publishedAt: selectedVersion.date_published ?? null,
  };
}
