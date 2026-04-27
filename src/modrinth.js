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

function getProfiles(kind) {
  return kind === "plugin" ? pluginCatalogProfiles : modCatalogProfiles;
}

export function getDefaultCatalogProfileId(kind, serverSoftware) {
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
  void kind;
  const facets = [profile.searchLoaders.map((loader) => `categories:${loader}`)];
  const normalizedGameVersion = String(gameVersion ?? "").trim();
  if (normalizedGameVersion) {
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
  index = "relevance",
}) {
  const profile = resolveCatalogProfile(kind, profileId, serverSoftware);
  const payload = await fetchModrinthJson("/search", {
    query: String(query ?? "").trim(),
    facets: buildSearchFacets({ kind, profile, gameVersion }),
    limit: String(limit),
    index,
  });

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
  }));

  const compatibilityChecks = await Promise.all(
    rawResults.map(async (entry) => {
      try {
        const { selectedVersion } = await fetchCompatibleProjectVersion(
          entry.id,
          profile,
          gameVersion,
        );
        if (!selectedVersion) {
          return null;
        }

        return {
          ...entry,
          compatibleVersionNumber: selectedVersion.version_number ?? null,
          compatibleGameVersions: selectedVersion.game_versions ?? [],
        };
      } catch {
        return null;
      }
    }),
  );

  const results = compatibilityChecks.filter(Boolean);

  return {
    profile,
    totalHits: results.length,
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

async function fetchCompatibleProjectVersion(projectId, profile, gameVersion) {
  const versions = await fetchModrinthJson(
    `/project/${encodeURIComponent(projectId)}/version`,
    {
      loaders: JSON.stringify(profile.installLoaders),
      include_changelog: "false",
    },
  );

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
}) {
  const profile = resolveCatalogProfile(kind, profileId, serverSoftware);
  const projectInfo = await fetchProjectInfo(projectId);
  const { selectedVersion } = await fetchCompatibleProjectVersion(
    projectId,
    profile,
    gameVersion,
  );
  if (!selectedVersion) {
    const title = projectInfo.title ?? projectInfo.name ?? "This project";
    const requestedGameVersion =
      String(gameVersion ?? "").trim() || "the selected Minecraft version";
    throw new Error(
      `${title} does not have a listed ${profile.label} version for ${requestedGameVersion}. Try a different project or change the server version.`,
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
    fileName: file.filename,
    fileUrl: file.url,
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
