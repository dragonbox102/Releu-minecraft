import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getAppDataHomeDir,
  getDefaultUpdaterAssetName,
  getPlayitBinaryName,
} from "./platform.js";
import { normalizeRemoteAccessConfig } from "./remote-access.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const snapshotRootDir = path.resolve(moduleDir, "..");
const isPackagedDesktop =
  process.env.RELEU_DESKTOP_PACKAGED === "true" ||
  Boolean(process.pkg) ||
  snapshotRootDir.includes(".asar");
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
  cloudTargetFile: path.join(releuLocalRootDir, "data", "cloud-target.json"),
  portableDataMigrationMarker: path.join(
    writableRootDir,
    "data",
    "portable-data-migration.json",
  ),
};

export const defaultServerProperties = {
  "allow-end": "true",
  "allow-flight": "false",
  "allow-nether": "true",
  "difficulty": "normal",
  "enable-command-block": "false",
  "enable-status": "true",
  "force-gamemode": "false",
  "gamemode": "survival",
  "generate-structures": "true",
  "hardcore": "false",
  "hide-online-players": "false",
  "level-name": "world",
  "log-ips": "true",
  "max-players": "20",
  "motd": "Hosted by Local Minecraft Panel",
  "online-mode": "true",
  "pause-when-empty-seconds": "60",
  "player-idle-timeout": "0",
  "prevent-proxy-connections": "false",
  "pvp": "true",
  "require-resource-pack": "false",
  "resource-pack": "",
  "resource-pack-id": "",
  "resource-pack-prompt": "",
  "resource-pack-sha1": "",
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
  ui: {
    variant: "pelican-blueprint",
    hasChosenVariant: true,
  },
  playit: {
    autoStart: true,
    agentName: "Minecraft Panel Host",
    macDownloadUrl: "",
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
  desktop: {
    keepServerRunningOnClose: false,
    quickConsoleShortcut: "Ctrl+Shift+Space",
  },
  cloudBackup: {
    enabled: false,
    provider: "website",
    uploadLimitMb: 50,
    cloudApiBaseUrl: "",
    blobReadWriteToken: "",
    restoreKey: "",
    targetRestoreKey: "",
    deviceLabel: "",
    accountUsername: "",
    sessionToken: "",
  },
  remoteAccess: normalizeRemoteAccessConfig(),
};

export const lockedUpdaterSource = Object.freeze({
  githubOwner: defaultConfig.updater.githubOwner,
  githubRepo: defaultConfig.updater.githubRepo,
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeUpdaterConfig(config, storedConfig = null) {
  const merged = deepMerge(defaultConfig.updater, config ?? {});
  merged.enabled = true;
  merged.autoInstall = true;
  merged.checkIntervalHours = Math.max(1, Number(merged.checkIntervalHours ?? 6) || 6);
  merged.githubOwner = lockedUpdaterSource.githubOwner;
  merged.githubRepo = lockedUpdaterSource.githubRepo;
  merged.assetName = defaultConfig.updater.assetName;
  merged.allowPrerelease = Boolean(merged.allowPrerelease);

  return merged;
}

function normalizeCloudBackupConfig(config) {
  const merged = deepMerge(defaultConfig.cloudBackup, config ?? {});
  merged.enabled = Boolean(merged.enabled);
  merged.uploadLimitMb = Math.max(
    1,
    Number(merged.uploadLimitMb ?? defaultConfig.cloudBackup.uploadLimitMb) ||
      defaultConfig.cloudBackup.uploadLimitMb,
  );
  merged.cloudApiBaseUrl = String(merged.cloudApiBaseUrl ?? "").trim().replace(/\/+$/g, "");
  merged.blobReadWriteToken = String(merged.blobReadWriteToken ?? "").trim();
  merged.restoreKey = String(merged.restoreKey ?? "").trim();
  merged.targetRestoreKey = String(merged.targetRestoreKey ?? "").trim();
  merged.deviceLabel = String(merged.deviceLabel ?? "").trim();
  merged.provider = "website";
  merged.accountUsername = String(merged.accountUsername ?? "").trim().toLowerCase();
  merged.sessionToken = String(merged.sessionToken ?? "").trim();
  return merged;
}

function normalizeRemoteAccessPanelConfig(config) {
  return normalizeRemoteAccessConfig(config ?? {});
}

function normalizePlayitConfig(config) {
  const merged = deepMerge(defaultConfig.playit, config ?? {});
  merged.autoStart = Boolean(merged.autoStart);
  merged.agentName =
    String(merged.agentName ?? defaultConfig.playit.agentName).trim() ||
    defaultConfig.playit.agentName;
  merged.macDownloadUrl = String(merged.macDownloadUrl ?? "").trim();
  return merged;
}

function normalizeHiddenCloudTarget(config = {}) {
  return {};
}

function applyHiddenCloudTarget(cloudConfig, hiddenTarget) {
  return { ...(cloudConfig ?? {}) };
}

function hasHiddenCloudTarget(target) {
  return false;
}

function normalizeDesktopConfig(config) {
  const merged = deepMerge(defaultConfig.desktop, config ?? {});
  merged.keepServerRunningOnClose = Boolean(merged.keepServerRunningOnClose);
  const shortcut = String(
    merged.quickConsoleShortcut ?? defaultConfig.desktop.quickConsoleShortcut,
  ).trim();
  merged.quickConsoleShortcut =
    shortcut || defaultConfig.desktop.quickConsoleShortcut;
  return merged;
}

function normalizeUiConfig(config) {
  const merged = deepMerge(defaultConfig.ui, config ?? {});
  const variant = String(merged.variant ?? defaultConfig.ui.variant)
    .trim()
    .toLowerCase();
  if (Boolean(merged.hasChosenVariant)) {
    merged.variant = variant === "classic" ? "classic" : "pelican-blueprint";
    merged.hasChosenVariant = true;
    return merged;
  }
  merged.variant = "pelican-blueprint";
  merged.hasChosenVariant = true;
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

async function loadHiddenCloudTarget() {
  return normalizeHiddenCloudTarget(
    await readJsonFile(paths.cloudTargetFile, {}),
  );
}

async function saveHiddenCloudTarget(target) {
  const normalizedTarget = normalizeHiddenCloudTarget(target);
  await fs.rm(paths.cloudTargetFile, { force: true }).catch(() => {});
  return normalizedTarget;
}

export async function loadPanelConfig() {
  await ensureAppDirectories();
  const stored = await readJsonFile(paths.configFile, defaultConfig);
  const merged = deepMerge(defaultConfig, stored);
  merged.playit = normalizePlayitConfig(merged.playit);
  merged.ui = normalizeUiConfig(merged.ui);
  merged.updater = normalizeUpdaterConfig(merged.updater, stored);
  merged.desktop = normalizeDesktopConfig(merged.desktop);
  const hiddenCloudTarget = await loadHiddenCloudTarget();
  merged.cloudBackup = normalizeCloudBackupConfig(
    applyHiddenCloudTarget(merged.cloudBackup, hiddenCloudTarget),
  );
  merged.remoteAccess = normalizeRemoteAccessPanelConfig(merged.remoteAccess);
  await saveHiddenCloudTarget(merged.cloudBackup);
  await writeJsonFile(paths.configFile, merged);
  return merged;
}

export async function savePanelConfig(config) {
  const merged = deepMerge(defaultConfig, config);
  merged.playit = normalizePlayitConfig(merged.playit);
  merged.ui = normalizeUiConfig(merged.ui);
  merged.updater = normalizeUpdaterConfig(merged.updater, merged);
  merged.desktop = normalizeDesktopConfig(merged.desktop);
  const hiddenCloudTarget = await loadHiddenCloudTarget();
  merged.cloudBackup = normalizeCloudBackupConfig(
    applyHiddenCloudTarget(merged.cloudBackup, hiddenCloudTarget),
  );
  merged.remoteAccess = normalizeRemoteAccessPanelConfig(merged.remoteAccess);
  await saveHiddenCloudTarget(merged.cloudBackup);
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
