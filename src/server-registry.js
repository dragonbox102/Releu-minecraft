import fs from "node:fs/promises";
import path from "node:path";

import {
  currentTimestamp,
  deepMerge,
  fileExists,
  paths,
  readJsonFile,
  writeJsonFile,
} from "./config.js";

export const defaultServerConfig = {
  launcher: {
    javaPath: "java",
    minRam: "2G",
    maxRam: "4G",
    cpuCores: 0,
    gpuShare: 0,
  },
  install: {
    software: "purpur",
    requestedVersion: "latest",
    installedSoftware: null,
    installedVersion: null,
    installedBuild: null,
  },
  backups: {
    enabled: true,
    intervalMinutes: 60,
    lastBackupAt: null,
    lastBackupPath: null,
  },
};

function normalizeServerName(value) {
  return String(value ?? "").trim();
}

export function slugifyServerId(value) {
  const normalized = normalizeServerName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "server";
}

export function getServerDataDir(serverId) {
  return path.join(paths.serversDataDir, serverId);
}

export function getServerPaths(serverRecord) {
  const dataDir = getServerDataDir(serverRecord.id);
  return {
    serverDir: serverRecord.serverDir,
    dataDir,
    backupsDir: path.join(paths.backupsDir, serverRecord.id),
    serverJar: path.join(serverRecord.serverDir, "server.jar"),
    legacyServerJar: path.join(serverRecord.serverDir, "paper-server.jar"),
    eulaFile: path.join(serverRecord.serverDir, "eula.txt"),
    serverPropertiesFile: path.join(serverRecord.serverDir, "server.properties"),
    opsFile: path.join(serverRecord.serverDir, "ops.json"),
    whitelistFile: path.join(serverRecord.serverDir, "whitelist.json"),
    bannedPlayersFile: path.join(serverRecord.serverDir, "banned-players.json"),
    bannedIpsFile: path.join(serverRecord.serverDir, "banned-ips.json"),
    usercacheFile: path.join(serverRecord.serverDir, "usercache.json"),
    pluginsDir: path.join(serverRecord.serverDir, "plugins"),
    modsDir: path.join(serverRecord.serverDir, "mods"),
    logsDir: path.join(serverRecord.serverDir, "logs"),
    configFile: path.join(dataDir, "config.json"),
    playerIndexFile: path.join(dataDir, "player-index.json"),
    assetIndexFile: path.join(dataDir, "asset-index.json"),
  };
}

export async function ensureServerDirectories(serverRecord) {
  const serverPaths = getServerPaths(serverRecord);
  await Promise.all(
    [
      serverPaths.serverDir,
      serverPaths.dataDir,
      serverPaths.backupsDir,
      serverPaths.pluginsDir,
      serverPaths.modsDir,
      serverPaths.logsDir,
    ].map((target) => fs.mkdir(target, { recursive: true })),
  );
  return serverPaths;
}

function normalizeRegistryShape(registry) {
  const servers = Array.isArray(registry?.servers) ? registry.servers : [];
  return {
    activeServerId:
      String(registry?.activeServerId ?? "").trim() || servers[0]?.id || null,
    servers: servers
      .filter((entry) => entry?.id && entry?.serverDir)
      .map((entry) => ({
        id: String(entry.id),
        name: normalizeServerName(entry.name) || String(entry.id),
        description: String(entry.description ?? "").trim(),
        serverDir: path.resolve(String(entry.serverDir)),
        createdAt: entry.createdAt ?? currentTimestamp(),
        updatedAt: entry.updatedAt ?? currentTimestamp(),
      })),
  };
}

export async function loadServerRegistry() {
  const registry = await readJsonFile(paths.serverRegistryFile, {
    activeServerId: null,
    servers: [],
  });
  const normalized = normalizeRegistryShape(registry);
  if (normalized.servers.length) {
    await saveServerRegistry(normalized);
    return normalized;
  }
  return normalized;
}

export async function saveServerRegistry(registry) {
  const normalized = normalizeRegistryShape(registry);
  await writeJsonFile(paths.serverRegistryFile, normalized);
  return normalized;
}

export async function loadServerConfig(serverId, fallback = null) {
  const file = path.join(getServerDataDir(serverId), "config.json");
  const stored = await readJsonFile(file, fallback ?? defaultServerConfig);
  const merged = deepMerge(defaultServerConfig, stored);
  await writeJsonFile(file, merged);
  return merged;
}

export async function saveServerConfig(serverId, config) {
  const file = path.join(getServerDataDir(serverId), "config.json");
  const merged = deepMerge(defaultServerConfig, config);
  await writeJsonFile(file, merged);
  return merged;
}

export async function ensureServerRegistry({ panelConfig } = {}) {
  const existing = await loadServerRegistry();
  if (existing.servers.length) {
    return existing;
  }

  const now = currentTimestamp();
  const primaryServer = {
    id: "primary",
    name: "Primary Server",
    description: "",
    serverDir: paths.legacyServerDir,
    createdAt: now,
    updatedAt: now,
  };

  await ensureServerDirectories(primaryServer);
  await saveServerConfig(
    primaryServer.id,
    deepMerge(defaultServerConfig, {
      launcher: panelConfig?.launcher ?? {},
      install: panelConfig?.install ?? {},
    }),
  );

  const primaryPaths = getServerPaths(primaryServer);
  if (
    (await fileExists(paths.playerIndexFile)) &&
    !(await fileExists(primaryPaths.playerIndexFile))
  ) {
    const legacyIndex = await fs.readFile(paths.playerIndexFile, "utf8");
    await fs.writeFile(primaryPaths.playerIndexFile, legacyIndex, "utf8");
  }

  const registry = {
    activeServerId: primaryServer.id,
    servers: [primaryServer],
  };
  await saveServerRegistry(registry);
  return registry;
}
