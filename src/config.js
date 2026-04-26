import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getAppDataHomeDir,
  getDefaultUpdaterAssetName,
  getPlayitBinaryName,
} from "./platform.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const snapshotRootDir = path.resolve(moduleDir, "..");
const isPackagedDesktop = Boolean(process.pkg) || snapshotRootDir.includes(".asar");
const portableExecutableDir =
  process.env.PORTABLE_EXECUTABLE_DIR ||
  process.env.PORTABLE_EXECUTABLE_PATH ||
  null;
const releuLocalRootDir = getAppDataHomeDir("Releu");
const appDataHomeDir = path.dirname(releuLocalRootDir);
const runtimeRootDir = isPackagedDesktop
  ? portableExecutableDir || path.dirname(process.execPath)
  : snapshotRootDir;
const writableRootDir = isPackagedDesktop
  ? releuLocalRootDir
  : snapshotRootDir;

export const paths = {
  rootDir: runtimeRootDir,
  snapshotRootDir,
  runtimeRootDir,
  writableRootDir,
  localAppDataDir: appDataHomeDir,
  releuLocalRootDir,
  publicDir: path.join(snapshotRootDir, "public"),
  srcDir: path.join(snapshotRootDir, "src"),
  dataDir: path.join(writableRootDir, "data"),
  backupsDir: path.join(writableRootDir, "backups"),
  toolsDir: path.join(writableRootDir, "tools"),
  legacyServerDir: path.join(writableRootDir, "server"),
  managedServersRootDir: path.join(releuLocalRootDir, "servers"),
  serversDir: path.join(writableRootDir, "servers"),
  playitToolDir: path.join(writableRootDir, "tools", "playit"),
  playitDataDir: path.join(writableRootDir, "data", "playit"),
  configFile: path.join(writableRootDir, "data", "panel-config.json"),
  serverRegistryFile: path.join(writableRootDir, "data", "servers.json"),
  serversDataDir: path.join(writableRootDir, "data", "servers"),
  playerIndexFile: path.join(writableRootDir, "data", "player-index.json"),
  claimInfoFile: path.join(writableRootDir, "data", "playit", "claim-info.json"),
  playitSecretFile: path.join(writableRootDir, "data", "playit", "secret.txt"),
  playitBinary: path.join(writableRootDir, "tools", "playit", getPlayitBinaryName()),
  updatesDir: path.join(releuLocalRootDir, "updates"),
  updateCacheDir: path.join(releuLocalRootDir, "updates", "cache"),
  updatePendingDir: path.join(releuLocalRootDir, "updates", "pending"),
  portableDataMigrationMarker: path.join(
    writableRootDir,
    "data",
    "portable-data-migration.json",
  ),
};

export const defaultServerProperties = {
  "allow-flight": "false",
  "difficulty": "normal",
  "enable-command-block": "false",
  "gamemode": "survival",
  "level-name": "world",
  "max-players": "20",
  "motd": "Hosted by Local Minecraft Panel",
  "online-mode": "true",
  "pvp": "true",
  "server-ip": "",
  "server-port": "25565",
  "simulation-distance": "10",
  "spawn-protection": "0",
  "view-distance": "10",
  "white-list": "false",
};

export const defaultConfig = {
  panel: {
    host: "127.0.0.1",
    port: 8787,
  },
  playit: {
    autoStart: true,
    agentName: "Minecraft Panel Host",
  },
  updater: {
    enabled: true,
    autoInstall: true,
    checkIntervalHours: 6,
    githubOwner: "dragonbox102",
    githubRepo: "Releu-minecraft",
    assetName: getDefaultUpdaterAssetName(),
    allowPrerelease: false,
  },
};

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeUpdaterConfig(config, storedConfig = null) {
  const merged = deepMerge(defaultConfig.updater, config ?? {});
  const storedUpdater = isObject(storedConfig?.updater) ? storedConfig.updater : null;
  const owner = String(merged.githubOwner ?? "").trim();
  const repo = String(merged.githubRepo ?? "").trim();
  const assetName = String(merged.assetName ?? "").trim();
  const storedOwner = String(storedUpdater?.githubOwner ?? "").trim();
  const storedRepo = String(storedUpdater?.githubRepo ?? "").trim();

  // Repair legacy local configs that predate the baked-in GitHub defaults.
  if (!owner && !repo && !storedOwner && !storedRepo) {
    merged.enabled = true;
    merged.githubOwner = defaultConfig.updater.githubOwner;
    merged.githubRepo = defaultConfig.updater.githubRepo;
    merged.assetName = assetName || defaultConfig.updater.assetName;
  } else {
    merged.githubOwner = owner;
    merged.githubRepo = repo;
    merged.assetName = assetName || defaultConfig.updater.assetName;
  }

  return merged;
}

export function deepMerge(base, incoming) {
  const output = structuredClone(base);
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (isObject(value) && isObject(output[key])) {
      output[key] = deepMerge(output[key], value);
      continue;
    }
    output[key] = value;
  }
  return output;
}

export async function ensureAppDirectories() {
  await migratePortableWritableData();
  await Promise.all(
    [
      paths.dataDir,
      paths.backupsDir,
      paths.toolsDir,
      paths.playitToolDir,
      paths.playitDataDir,
      paths.managedServersRootDir,
      paths.legacyServerDir,
      paths.serversDir,
      paths.serversDataDir,
      paths.updatesDir,
      paths.updateCacheDir,
      paths.updatePendingDir,
    ].map((target) => fs.mkdir(target, { recursive: true })),
  );
}

async function migratePortableWritableData() {
  if (!isPackagedDesktop) {
    return;
  }

  const resolvedRuntimeRoot = path.resolve(runtimeRootDir);
  const resolvedWritableRoot = path.resolve(writableRootDir);
  if (resolvedRuntimeRoot === resolvedWritableRoot) {
    return;
  }

  if (await fileExists(paths.portableDataMigrationMarker)) {
    return;
  }

  const legacyMappings = [
    [path.join(runtimeRootDir, "data"), paths.dataDir],
    [path.join(runtimeRootDir, "backups"), paths.backupsDir],
    [path.join(runtimeRootDir, "tools"), paths.toolsDir],
    [path.join(runtimeRootDir, "server"), paths.legacyServerDir],
    [path.join(runtimeRootDir, "servers"), paths.serversDir],
  ];

  let migrated = false;
  for (const [legacyPath, targetPath] of legacyMappings) {
    if (!(await fileExists(legacyPath)) || (await fileExists(targetPath))) {
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.cp(legacyPath, targetPath, { recursive: true });
    migrated = true;
  }

  if (migrated) {
    await writeJsonFile(paths.portableDataMigrationMarker, {
      migratedAt: currentTimestamp(),
      from: runtimeRootDir,
      to: writableRootDir,
    });
  }
}

export async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile(targetPath, fallbackValue) {
  try {
    const content = await fs.readFile(targetPath, "utf8");
    return JSON.parse(content);
  } catch {
    return structuredClone(fallbackValue);
  }
}

export async function writeJsonFile(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadPanelConfig() {
  await ensureAppDirectories();
  const stored = await readJsonFile(paths.configFile, defaultConfig);
  const merged = deepMerge(defaultConfig, stored);
  merged.updater = normalizeUpdaterConfig(merged.updater, stored);
  await writeJsonFile(paths.configFile, merged);
  return merged;
}

export async function savePanelConfig(config) {
  const merged = deepMerge(defaultConfig, config);
  merged.updater = normalizeUpdaterConfig(merged.updater, merged);
  await writeJsonFile(paths.configFile, merged);
  return merged;
}

export function currentTimestamp() {
  return new Date().toISOString();
}

export function sanitizeLogLine(value) {
  return String(value)
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\r/g, "")
    .trimEnd();
}

export function slugTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}
