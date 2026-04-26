import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import extractZip from "extract-zip";

import {
  currentTimestamp,
  defaultServerProperties,
  ensureAppDirectories,
  fileExists,
  loadPanelConfig,
  paths,
  readJsonFile,
  sanitizeLogLine,
  savePanelConfig,
  slugTimestamp,
  writeJsonFile,
} from "./config.js";
import { DependencyManager } from "./dependency-manager.js";
import { PlayitManager } from "./playit.js";
import {
  ensureServerPropertyFile,
  readServerProperties,
  writeServerProperties,
} from "./properties.js";
import { AppUpdater } from "./updater.js";
import {
  downloadServerJar,
  fetchSoftwareVersions,
  getRequiredJavaMajor,
  resolveSoftwareVersion,
  serverSoftwareOptions,
} from "./server-software.js";
import {
  getDefaultCatalogProfileId,
  modCatalogProfiles,
  pluginCatalogProfiles,
  resolveCatalogInstall,
  searchCatalogProjects,
} from "./modrinth.js";
import {
  defaultServerConfig,
  ensureServerDirectories,
  ensureServerRegistry,
  getServerPaths,
  loadServerConfig,
  saveServerConfig,
  saveServerRegistry,
  slugifyServerId,
} from "./server-registry.js";
import {
  getDefaultUpdaterAssetName,
  isLinux,
  withHiddenConsole,
} from "./platform.js";

async function ensureJsonFile(targetPath, defaultValue) {
  if (await fileExists(targetPath)) {
    return;
  }
  await writeJsonFile(targetPath, defaultValue);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const minecraftVersionSorter = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function normalizeComparableMinecraftVersion(version) {
  const normalized = String(version ?? "").trim().split("-")[0];
  if (!normalized) {
    return null;
  }

  if (/^\d+(?:\.\d+){2,3}$/i.test(normalized) && !normalized.startsWith("1.")) {
    const parts = normalized.split(".");
    const first = Number(parts[0]);
    if (first >= 26 && parts.length >= 3) {
      return parts.slice(0, 3).join(".");
    }
    if (parts.length >= 2) {
      return `1.${parts[0]}.${parts[1]}`;
    }
  }

  return normalized;
}

function isPotentialMinecraftDowngrade(currentVersion, nextVersion) {
  const current = normalizeComparableMinecraftVersion(currentVersion);
  const next = normalizeComparableMinecraftVersion(nextVersion);
  if (!current || !next || current === next) {
    return false;
  }
  return minecraftVersionSorter.compare(current, next) > 0;
}

function stripMinecraftLogPrefix(value) {
  return sanitizeLogLine(value)
    .replace(/^\[[0-9:.]+\]\s+\[[^\]]+\]:\s*/i, "")
    .replace(/^\[[^\]]+\]\s+\[[^\]]+\]:\s*/i, "")
    .replace(/^\[[^\]]+\]:\s*/i, "")
    .trim();
}

function normalizePlayerName(name) {
  return stripMinecraftLogPrefix(name);
}

function normalizeGamemode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["survival", "creative", "adventure", "spectator"].includes(normalized)
    ? normalized
    : null;
}

function playerKey(name) {
  return normalizePlayerName(name).toLowerCase();
}

function pickLinePayload(payload) {
  return stripMinecraftLogPrefix(payload);
}

function kindLabel(kind) {
  return kind === "mod" ? "mod" : "plugin";
}

function emptyAssetIndex() {
  return {
    plugin: {},
    mod: {},
  };
}

function normalizeAssetIndex(index) {
  return {
    plugin: { ...(index?.plugin ?? {}) },
    mod: { ...(index?.mod ?? {}) },
  };
}

function isNoisyPlayitLog(message) {
  const normalized = String(message ?? "").toLowerCase();
  return [
    "udp channel requires auth",
    "udp session details received",
    "tunnel running,",
    "send keepalive",
    "agent registered details",
    "reload_control_addr",
  ].some((pattern) => normalized.includes(pattern));
}

function sanitizeAssetFilename(fileName) {
  const normalized = path.basename(String(fileName ?? "").trim());
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("A valid file name is required.");
  }
  return normalized;
}

function parseFilenameFromDisposition(headerValue) {
  const raw = String(headerValue ?? "").trim();
  if (!raw) {
    return null;
  }

  const utfMatch = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1]);
  }

  const simpleMatch =
    raw.match(/filename\s*=\s*"([^"]+)"/i) ?? raw.match(/filename\s*=\s*([^;]+)/i);
  return simpleMatch?.[1]?.trim() ?? null;
}

function inferFilenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const candidate = parsed.pathname.split("/").filter(Boolean).at(-1);
    return candidate ? decodeURIComponent(candidate) : null;
  } catch {
    return null;
  }
}

function formatSoftwareName(software) {
  const match = serverSoftwareOptions.find((entry) => entry.id === software);
  if (match) {
    return match.name;
  }
  return software ? software[0].toUpperCase() + software.slice(1) : null;
}

function clampNumber(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.round(numeric)));
}

function ramStringToMb(value, fallback = 4096) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) {
    return fallback;
  }

  const match = raw.match(/^(\d+(?:\.\d+)?)([MGT])?$/);
  if (!match) {
    return fallback;
  }

  const numeric = Number(match[1]);
  const unit = match[2] ?? "M";
  if (unit === "G") {
    return Math.round(numeric * 1024);
  }
  if (unit === "T") {
    return Math.round(numeric * 1024 * 1024);
  }
  return Math.round(numeric);
}

function normalizeWorldName(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");

  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("A valid world name is required.");
  }

  return normalized;
}

function ensureChildPath(parentDir, targetDir) {
  const parent = path.resolve(parentDir);
  const target = path.resolve(targetDir);
  if (target !== parent && !target.startsWith(`${parent}${path.sep}`)) {
    throw new Error("Resolved path is outside the server directory.");
  }
  return target;
}

function pathEqualsOrInside(targetPath, basePath) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(basePath);
  return (
    resolvedTarget === resolvedBase ||
    resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)
  );
}

function trimArchiveExtension(fileName) {
  return path.basename(String(fileName ?? "").trim()).replace(/\.(zip|mcworld)$/i, "");
}

function hasPath(targetPath) {
  try {
    fsSync.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

export class MinecraftPanelService {
  constructor() {
    this.panelConfig = null;
    this.registry = null;
    this.activeServerId = null;
    this.serverContexts = new Map();
    this.logs = [];
    this.nextLogId = 1;
    this.versionsCache = new Map();
    this.backupTimer = null;
    this.playitInitialized = false;
    this.playitInitPromise = null;

    this.playit = new PlayitManager({
      appendLog: (source, line, level = "info") => this.appendLog(null, source, line, level),
      getServerPort: () => this.getRecommendedTunnelPort(),
    });
    this.dependencies = new DependencyManager({
      appendLog: (source, line) => this.appendLog(null, source, line),
      playitManager: this.playit,
    });
    this.updater = new AppUpdater({
      appendLog: (source, line) => this.appendLog(null, source, line),
      getPanelConfig: () => this.panelConfig,
      hasRunningServers: () => this.hasRunningServers(),
    });
  }

  async init() {
    await ensureAppDirectories();
    this.panelConfig = await loadPanelConfig();
    this.registry = await ensureServerRegistry({
      panelConfig: this.panelConfig,
    });

    for (const record of this.registry.servers) {
      await this.registerServer(record);
    }

    this.activeServerId =
      this.registry.activeServerId && this.serverContexts.has(this.registry.activeServerId)
        ? this.registry.activeServerId
        : this.registry.servers[0]?.id ?? null;

    if (this.activeServerId && this.registry.activeServerId !== this.activeServerId) {
      this.registry.activeServerId = this.activeServerId;
      this.registry = await saveServerRegistry(this.registry);
    }

    this.startBackupScheduler();
    await this.updater.init();
    this.updater.maybeCheckForUpdates().catch((error) => {
      this.appendLog(null, "panel", error.message ?? "Releu update check failed.", "warn");
    });
    this.appendLog(
      null,
      "panel",
      `Panel initialized. Open http://${this.panelConfig.panel.host}:${this.panelConfig.panel.port}`,
    );
  }

  appendLog(serverId, source, line, level = "info") {
    const message = sanitizeLogLine(line);
    if (!message) {
      return;
    }

    if (source === "playit" && isNoisyPlayitLog(message)) {
      return;
    }

    this.logs.push({
      id: this.nextLogId++,
      serverId,
      source,
      level,
      message,
      timestamp: currentTimestamp(),
    });

    if (this.logs.length > 6000) {
      this.logs.splice(0, this.logs.length - 6000);
    }
  }

  buildContext(serverRecord, config) {
    const installMeta = config.install.installedVersion
      ? {
          software: config.install.installedSoftware,
          softwareName: formatSoftwareName(config.install.installedSoftware),
          version: config.install.installedVersion,
          build: config.install.installedBuild,
          downloadedTo: getServerPaths(serverRecord).serverJar,
        }
      : null;

    return {
      record: serverRecord,
      paths: getServerPaths(serverRecord),
      config,
      serverProcess: null,
      restartRequested: false,
      backupInProgress: false,
      onlinePlayers: new Set(),
      cachedProperties: structuredClone(defaultServerProperties),
      pendingSafeModeRecovery: false,
      pendingDowngradeWorldFailure: false,
      startingWithSafeMode: false,
      state: {
        serverStatus: "stopped",
        serverReady: false,
        serverPid: null,
        playerCount: 0,
        operation: {
          active: false,
          type: null,
          title: null,
          shortLabel: null,
          detail: null,
          startedAt: null,
        },
        resourceMetrics: {
          cpuPercent: 0,
          ramUsedMb: 0,
          ramLeftMb: ramStringToMb(config.launcher.maxRam, 4096),
          ramMaxMb: ramStringToMb(config.launcher.maxRam, 4096),
          ramMinMb: ramStringToMb(config.launcher.minRam, 2048),
          loadPercent: 0,
          sampledAt: null,
        },
        lastStartedAt: null,
        lastStoppedAt: null,
        lastExitCode: null,
        installMeta,
      },
    };
  }

  async registerServer(serverRecord) {
    const config = await loadServerConfig(serverRecord.id);
    const context = this.buildContext(serverRecord, config);
    await this.ensureServerFiles(context);
    this.serverContexts.set(serverRecord.id, context);
    return context;
  }

  async ensureServerFiles(context) {
    await ensureServerDirectories(context.record);
    context.cachedProperties = await ensureServerPropertyFile(context.paths);
    await ensureJsonFile(context.paths.opsFile, []);
    await ensureJsonFile(context.paths.whitelistFile, []);
    await ensureJsonFile(context.paths.bannedPlayersFile, []);
    await ensureJsonFile(context.paths.bannedIpsFile, []);
    await ensureJsonFile(context.paths.usercacheFile, []);
    await ensureJsonFile(context.paths.playerIndexFile, {});
    await ensureJsonFile(context.paths.assetIndexFile, emptyAssetIndex());

    if (!(await fileExists(context.paths.eulaFile))) {
      await fs.writeFile(context.paths.eulaFile, "eula=false\n", "utf8");
    }
  }

  getServerContext(serverId = this.activeServerId) {
    const context = this.serverContexts.get(serverId);
    if (!context) {
      throw new Error("The selected server does not exist.");
    }
    return context;
  }

  setServerOperation(context, operation = {}) {
    context.state.operation = {
      active: true,
      type: operation.type ?? "working",
      title: operation.title ?? "Working",
      shortLabel: operation.shortLabel ?? operation.title ?? "Working",
      detail: operation.detail ?? "Releu is working on this server.",
      startedAt: operation.startedAt ?? currentTimestamp(),
    };
  }

  clearServerOperation(context) {
    context.state.operation = {
      active: false,
      type: null,
      title: null,
      shortLabel: null,
      detail: null,
      startedAt: null,
    };
  }

  getRecommendedTunnelPort() {
    if (!this.activeServerId || !this.serverContexts.has(this.activeServerId)) {
      return 25565;
    }
    const context = this.getServerContext(this.activeServerId);
    return Number(context.cachedProperties["server-port"] ?? 25565);
  }

  hasRunningServers() {
    return Array.from(this.serverContexts.values()).some((context) => Boolean(context.serverProcess));
  }

  getHostResources() {
    const cpuCores = Math.max(1, os.cpus()?.length ?? 1);
    const totalMemoryMb = Math.max(1024, Math.floor(os.totalmem() / (1024 * 1024)));
    const recommendedMaxRamMb = Math.max(
      2048,
      Math.min(totalMemoryMb - 1024, Math.floor(totalMemoryMb * 0.75)),
    );

    return {
      cpuCores,
      totalMemoryMb,
      recommendedMaxRamMb,
      gpuSupported: false,
      gpuNote: "Minecraft Java servers do not use the GPU directly, so GPU allocation is stored only as a planning hint.",
    };
  }

  async ensurePlayitInitialized(force = false) {
    if (this.playitInitialized && !force) {
      return this.playit.snapshot();
    }

    if (this.playitInitPromise && !force) {
      return this.playitInitPromise;
    }

    this.playitInitPromise = this.playit
      .init()
      .then(() => {
        this.playitInitialized = true;
        return this.playit.snapshot();
      })
      .finally(() => {
        this.playitInitPromise = null;
      });

    return this.playitInitPromise;
  }

  getPreferredManagedJavaPath(version) {
    const requiredMajor = getRequiredJavaMajor(version);
    return this.dependencies.getManagedJavaPath(requiredMajor);
  }

  shouldAutoManageJavaPath(javaPath) {
    const normalized = String(javaPath ?? "").trim();
    if (!normalized || normalized.toLowerCase() === "java") {
      return true;
    }

    return pathEqualsOrInside(normalized, paths.toolsDir);
  }

  async applyManagedJavaDefaults() {
    const dependencyState = this.dependencies.snapshot();
    if (!dependencyState.ready) {
      return dependencyState;
    }

    for (const context of this.serverContexts.values()) {
      const preferredJavaPath = this.getPreferredManagedJavaPath(
        context.config.install.installedVersion ??
          context.config.install.requestedVersion ??
          null,
      );

      if (!preferredJavaPath) {
        continue;
      }

      if (!this.shouldAutoManageJavaPath(context.config.launcher.javaPath)) {
        continue;
      }

      if (context.config.launcher.javaPath === preferredJavaPath) {
        continue;
      }

      context.config.launcher = {
        ...context.config.launcher,
        javaPath: preferredJavaPath,
      };
      await this.saveContextConfig(context);
    }

    return dependencyState;
  }

  async getDependencyState() {
    return this.dependencies.check();
  }

  async ensureDependencies() {
    const dependencyState = await this.dependencies.ensureAll();
    await this.ensurePlayitInitialized(true);
    await this.applyManagedJavaDefaults();
    return dependencyState;
  }

  async readWindowsProcessMetrics(processId) {
    if (!processId || process.platform !== "win32") {
      return null;
    }

    const command = `
$sample = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess = ${Number(processId)}"
if (-not $sample) { exit 0 }
[pscustomobject]@{
  cpuPercent = [double]$sample.PercentProcessorTime
  ramBytes = [int64]$sample.WorkingSetPrivate
} | ConvertTo-Json -Compress
`.trim();

    return new Promise((resolve, reject) => {
      const child = spawn(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
        withHiddenConsole(),
      );

      let stdout = "";
      let stderr = "";
      let settled = false;

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });

      child.on("exit", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        if (code && code !== 0) {
          reject(new Error(sanitizeLogLine(stderr) || "Unable to read process metrics."));
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(trimmed));
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async readLinuxProcessMetrics(processId) {
    if (!processId || !isLinux) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const child = spawn(
        "ps",
        ["-p", String(Number(processId)), "-o", "%cpu=,rss="],
        withHiddenConsole(),
      );

      let stdout = "";
      let stderr = "";
      let settled = false;

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });

      child.on("exit", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        if (code && code !== 0) {
          reject(new Error(sanitizeLogLine(stderr) || "Unable to read process metrics.")); 
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve(null);
          return;
        }

        const [cpuToken, rssToken] = trimmed.split(/\s+/);
        const cpuPercent = Number(cpuToken);
        const rssKb = Number(rssToken);
        if (!Number.isFinite(cpuPercent) || !Number.isFinite(rssKb)) {
          resolve(null);
          return;
        }

        resolve({
          cpuPercent,
          ramBytes: rssKb * 1024,
        });
      });
    });
  }

  async readProcessMetrics(processId) {
    if (process.platform === "win32") {
      return this.readWindowsProcessMetrics(processId);
    }

    if (isLinux) {
      return this.readLinuxProcessMetrics(processId);
    }

    return null;
  }

  async refreshServerMetrics(context) {
    const ramMaxMb = ramStringToMb(context.config.launcher.maxRam, 4096);
    const ramMinMb = ramStringToMb(context.config.launcher.minRam, 2048);
    const offlineMetrics = {
      cpuPercent: 0,
      ramUsedMb: 0,
      ramLeftMb: ramMaxMb,
      ramMaxMb,
      ramMinMb,
      loadPercent: 0,
      sampledAt: currentTimestamp(),
    };

    if (!context.serverProcess || !context.state.serverPid) {
      context.state.resourceMetrics = offlineMetrics;
      return context.state.resourceMetrics;
    }

    try {
      const sample = await this.readProcessMetrics(context.state.serverPid);
      if (!sample) {
        context.state.resourceMetrics = offlineMetrics;
        return context.state.resourceMetrics;
      }

      const hostCpuCores = Math.max(1, this.getHostResources().cpuCores);
      const rawCpu = Math.max(0, Number(sample.cpuPercent) || 0);
      const normalizedCpu = rawCpu > 100 ? rawCpu / hostCpuCores : rawCpu;
      const ramUsedMb = Math.max(0, Math.round((Number(sample.ramBytes) || 0) / (1024 * 1024)));
      const ramLeftMb = Math.max(0, ramMaxMb - ramUsedMb);
      const memoryLoadPercent = ramMaxMb > 0 ? (ramUsedMb / ramMaxMb) * 100 : 0;

      context.state.resourceMetrics = {
        cpuPercent: Math.round(Math.min(100, normalizedCpu) * 10) / 10,
        ramUsedMb,
        ramLeftMb,
        ramMaxMb,
        ramMinMb,
        loadPercent: Math.round(Math.max(normalizedCpu, memoryLoadPercent) * 10) / 10,
        sampledAt: currentTimestamp(),
      };
    } catch {
      context.state.resourceMetrics = {
        ...offlineMetrics,
        ramLeftMb: Math.max(0, ramMaxMb - (context.state.resourceMetrics?.ramUsedMb ?? 0)),
        ramUsedMb: context.state.resourceMetrics?.ramUsedMb ?? 0,
        sampledAt: currentTimestamp(),
      };
    }

    return context.state.resourceMetrics;
  }

  reconcileRuntimeState(context) {
    if (!context.serverProcess) {
      if (context.state.serverStatus === "starting" || context.state.serverStatus === "stopping") {
        context.state.serverStatus = "stopped";
      }
      context.state.serverReady = false;
      context.state.serverPid = null;
      return;
    }

    if (context.state.serverReady && context.state.serverStatus !== "stopping") {
      context.state.serverStatus = "running";
      return;
    }

    if (context.state.serverStatus === "stopped") {
      context.state.serverStatus = "starting";
    }
  }

  getServerGameVersion(serverId) {
    const context = this.getServerContext(serverId);
    return (
      context.config.install.installedVersion ??
      context.config.install.requestedVersion ??
      context.state.installMeta?.version ??
      null
    );
  }

  getCatalogProfiles(serverId) {
    const context = this.getServerContext(serverId);
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    return {
      pluginProfiles: pluginCatalogProfiles,
      modProfiles: modCatalogProfiles,
      defaults: {
        plugin: getDefaultCatalogProfileId("plugin", effectiveSoftware),
        mod: getDefaultCatalogProfileId("mod", effectiveSoftware),
      },
    };
  }

  async getLogs(afterId = 0, serverId = this.activeServerId) {
    const threshold = Number(afterId || 0);
    return this.logs.filter((entry) => {
      if (entry.id <= threshold) {
        return false;
      }

      if (!serverId) {
        return true;
      }

      return entry.serverId === null || entry.serverId === serverId;
    });
  }

  async resolveInstallerArgFile(context, softwareId) {
    const argFileName = isLinux ? "unix_args.txt" : "win_args.txt";
    const version = String(context.config.install.installedVersion ?? "").trim();
    const candidateBases =
      softwareId === "forge"
        ? [path.join(context.paths.serverDir, "libraries", "net", "minecraftforge", "forge")]
        : [path.join(context.paths.serverDir, "libraries", "net", "neoforged", "neoforge")];

    for (const baseDir of candidateBases) {
      if (version) {
        const directPath = path.join(baseDir, version, argFileName);
        if (await fileExists(directPath)) {
          return directPath;
        }
      }

      try {
        const entries = await fs.readdir(baseDir, { withFileTypes: true });
        const matches = entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(baseDir, entry.name, argFileName));
        for (const candidate of matches) {
          if (await fileExists(candidate)) {
            return candidate;
          }
        }
      } catch {
        // Ignore missing installer directories and fall back to jar discovery.
      }
    }

    return null;
  }

  async hasInstalledJar(context) {
    return Boolean(await this.resolveLaunchTarget(context));
  }

  async resolveInstalledJar(context) {
    if (await fileExists(context.paths.serverJar)) {
      return context.paths.serverJar;
    }

    if (await fileExists(context.paths.legacyServerJar)) {
      return context.paths.legacyServerJar;
    }

    const softwareId = this.getEffectiveServerSoftwareId(context);
    const jarPattern =
      softwareId === "neoforge" ? /^neoforge-.*(?:server|universal)?\.jar$/i : /^forge-.*(?:server|universal)?\.jar$/i;

    try {
      const rootEntries = await fs.readdir(context.paths.serverDir, { withFileTypes: true });
      const rootJar = rootEntries
        .filter((entry) => entry.isFile() && jarPattern.test(entry.name) && !entry.name.includes("-installer"))
        .map((entry) => path.join(context.paths.serverDir, entry.name))
        .at(0);
      if (rootJar) {
        return rootJar;
      }
    } catch {
      // Ignore root jar lookup errors.
    }

    const libraryBase =
      softwareId === "neoforge"
        ? path.join(context.paths.serverDir, "libraries", "net", "neoforged", "neoforge")
        : path.join(context.paths.serverDir, "libraries", "net", "minecraftforge", "forge");
    try {
      const versionDirs = await fs.readdir(libraryBase, { withFileTypes: true });
      for (const entry of versionDirs.filter((value) => value.isDirectory())) {
        const candidateDir = path.join(libraryBase, entry.name);
        const files = await fs.readdir(candidateDir, { withFileTypes: true });
        const match = files
          .filter((file) => file.isFile() && jarPattern.test(file.name) && !file.name.includes("-installer"))
          .map((file) => path.join(candidateDir, file.name))
          .at(0);
        if (match) {
          return match;
        }
      }
    } catch {
      // Ignore library jar lookup errors.
    }

    return null;
  }

  async resolveLaunchTarget(context) {
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    if (effectiveSoftware === "forge" || effectiveSoftware === "neoforge") {
      const argFile = await this.resolveInstallerArgFile(context, effectiveSoftware);
      if (argFile) {
        return {
          mode: "argfile",
          argFile,
          softwareId: effectiveSoftware,
        };
      }
    }

    const jarPath = await this.resolveInstalledJar(context);
    if (jarPath) {
      return {
        mode: "jar",
        jarPath,
        softwareId: effectiveSoftware,
      };
    }

    return null;
  }

  getNextBackupAt(context) {
    const intervalMinutes = Math.max(
      5,
      Number(context.config.backups.intervalMinutes ?? 60) || 60,
    );

    if (!context.config.backups.enabled) {
      return null;
    }

    const anchor =
      Date.parse(
        context.config.backups.lastBackupAt ?? context.record.createdAt ?? currentTimestamp(),
      ) || Date.now();
    return new Date(anchor + intervalMinutes * 60_000).toISOString();
  }

  async listBackups(serverId, limit = 6) {
    const context = this.getServerContext(serverId);
    try {
    const entries = await fs.readdir(context.paths.backupsDir, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => right.name.localeCompare(left.name))
        .slice(0, limit);

      const backups = [];
      for (const entry of directories) {
        const target = path.join(context.paths.backupsDir, entry.name);
        const stats = await fs.stat(target);
        backups.push({
          name: entry.name,
          path: target,
          createdAt: stats.birthtime?.toISOString?.() ?? stats.mtime.toISOString(),
        });
      }
      return backups;
    } catch {
      return [];
    }
  }

  async serializeServerSummary(context) {
    const metrics = await this.refreshServerMetrics(context);
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    return {
      id: context.record.id,
      name: context.record.name,
      status: context.state.serverStatus,
      ready: context.state.serverReady,
      pid: context.state.serverPid,
      playerCount: context.state.playerCount,
      operation: context.state.operation,
      metrics,
      port: Number(context.cachedProperties["server-port"] ?? 25565),
      serverDir: context.paths.serverDir,
      jarInstalled: await this.hasInstalledJar(context),
      lastStartedAt: context.state.lastStartedAt,
      lastStoppedAt: context.state.lastStoppedAt,
      install: {
        ...context.config.install,
        installedSoftware: effectiveSoftware,
      },
      backups: {
        ...context.config.backups,
        nextBackupAt: this.getNextBackupAt(context),
      },
    };
  }

  async serializeActiveServer(context) {
    context.cachedProperties = await readServerProperties(context.paths);
    const jarInstalled = await this.hasInstalledJar(context);
    const metrics = await this.refreshServerMetrics(context);
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    return {
      id: context.record.id,
      name: context.record.name,
      serverDir: context.paths.serverDir,
      dataDir: context.paths.dataDir,
      setupComplete: jarInstalled,
      launcher: context.config.launcher,
      install: {
        ...context.config.install,
        installedSoftware: effectiveSoftware,
      },
      backups: {
        ...context.config.backups,
        nextBackupAt: this.getNextBackupAt(context),
        recent: await this.listBackups(context.record.id),
      },
      catalog: {
        ...this.getCatalogProfiles(context.record.id),
        gameVersion: this.getServerGameVersion(context.record.id),
      },
      server: {
        status: context.state.serverStatus,
        ready: context.state.serverReady,
        pid: context.state.serverPid,
        playerCount: context.state.playerCount,
        operation: context.state.operation,
        metrics,
        jarInstalled,
        eulaAccepted: await this.readEula(context.record.id),
        properties: context.cachedProperties,
        lastStartedAt: context.state.lastStartedAt,
        lastStoppedAt: context.state.lastStoppedAt,
        lastExitCode: context.state.lastExitCode,
        installMeta: context.state.installMeta,
      },
      players: await this.getPlayers(context.record.id),
      plugins: await this.listAssets(context.record.id, "plugin"),
      mods: await this.listAssets(context.record.id, "mod"),
      worlds: await this.listWorlds(context.record.id),
    };
  }

  async getState(serverId = this.activeServerId) {
    const context = this.getServerContext(serverId);
    this.reconcileRuntimeState(context);
    await this.syncDetectedInstalledSoftware(context);
    await this.ensurePlayitInitialized();
    const playitSnapshot = this.playit.snapshot();
    const shouldForceTunnelRefresh =
      playitSnapshot.secretConfigured &&
      !playitSnapshot.tunnels.some((entry) => entry.publicAddress) &&
      (context.state.serverStatus === "starting" || context.state.serverStatus === "running");
    const shouldRefreshTunnelStatus =
      playitSnapshot.secretConfigured &&
      (!playitSnapshot.lastRefreshAt ||
        shouldForceTunnelRefresh ||
        (Number(playitSnapshot.configuredTunnelCount ?? 0) === 0 &&
          !playitSnapshot.checkingTunnelStatus));
    if (shouldRefreshTunnelStatus) {
      this.playit.refreshTunnels({
        force: !playitSnapshot.lastRefreshAt || shouldForceTunnelRefresh,
      }).catch(() => {});
    }
    this.updater.maybeCheckForUpdates().catch(() => {});

    return {
      panel: this.panelConfig.panel,
      playitSettings: this.panelConfig.playit,
      updaterSettings: this.panelConfig.updater,
      host: this.getHostResources(),
      dependencies: this.dependencies.snapshot(),
      softwareOptions: serverSoftwareOptions,
      activeServerId: this.activeServerId,
      servers: await Promise.all(
        this.registry.servers.map((serverRecord) =>
          this.serializeServerSummary(this.getServerContext(serverRecord.id)),
        ),
      ),
      activeServer: await this.serializeActiveServer(context),
      playit: this.playit.snapshot(),
      appUpdate: this.updater.snapshot(),
    };
  }

  async readEula(serverId) {
    const context = this.getServerContext(serverId);
    try {
      const content = await fs.readFile(context.paths.eulaFile, "utf8");
      return content.includes("eula=true");
    } catch {
      return false;
    }
  }

  async setEula(serverId, accepted) {
    const context = this.getServerContext(serverId);
    const value = accepted ? "true" : "false";
    await fs.writeFile(context.paths.eulaFile, `eula=${value}\n`, "utf8");
    this.appendLog(serverId, "panel", `Minecraft EULA set to ${value}.`);
    return this.readEula(serverId);
  }

  async saveContextConfig(context) {
    context.config = await saveServerConfig(context.record.id, context.config);
    return context.config;
  }

  async assertUniquePort(port, excludingServerId = null) {
    const normalizedPort = Number(port);
    if (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535) {
      throw new Error("Server port must be a number between 1 and 65535.");
    }

    for (const [serverId, context] of this.serverContexts.entries()) {
      if (serverId === excludingServerId) {
        continue;
      }

      const currentPort = Number(context.cachedProperties["server-port"] ?? 25565);
      if (currentPort === normalizedPort) {
        throw new Error(`Port ${normalizedPort} is already assigned to "${context.record.name}".`);
      }
    }
  }

  findSuggestedPort(startPort = 25565) {
    const usedPorts = new Set(
      Array.from(this.serverContexts.values()).map((context) =>
        Number(context.cachedProperties["server-port"] ?? 25565),
      ),
    );

    let candidate = Number(startPort) || 25565;
    while (usedPorts.has(candidate)) {
      candidate += 1;
    }
    return candidate;
  }

  findAvailableServerId(baseValue) {
    const baseId = slugifyServerId(baseValue);
    let candidate = baseId;
    let suffix = 2;
    while (this.serverContexts.has(candidate)) {
      candidate = `${baseId}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  async createServer(payload = {}) {
    const name = String(payload.name ?? "").trim();
    if (!name) {
      throw new Error("Server name is required.");
    }

    const serverId = this.findAvailableServerId(name);

    const port = Number(payload.port) || this.findSuggestedPort();
    await this.assertUniquePort(port);

    const now = currentTimestamp();
    const record = {
      id: serverId,
      name,
      serverDir: path.join(paths.managedServersRootDir, serverId),
      createdAt: now,
      updatedAt: now,
    };

    const sourceConfig = this.activeServerId
      ? this.getServerContext(this.activeServerId).config
      : defaultServerConfig;

    const config = {
      ...sourceConfig,
      launcher: {
        ...sourceConfig.launcher,
        javaPath:
          String(
            payload.javaPath ??
              this.getPreferredManagedJavaPath(
                payload.version ?? sourceConfig.install.requestedVersion ?? "latest",
              ) ??
              sourceConfig.launcher.javaPath ??
              "java",
          ).trim() || "java",
        minRam: String(payload.minRam ?? sourceConfig.launcher.minRam ?? "2G").trim() || "2G",
        maxRam: String(payload.maxRam ?? sourceConfig.launcher.maxRam ?? "4G").trim() || "4G",
        cpuCores: clampNumber(
          payload.cpuCores ?? sourceConfig.launcher.cpuCores ?? 0,
          0,
          this.getHostResources().cpuCores,
          0,
        ),
        gpuShare: clampNumber(
          payload.gpuShare ?? sourceConfig.launcher.gpuShare ?? 0,
          0,
          100,
          0,
        ),
      },
      install: {
        ...sourceConfig.install,
        software: String(payload.software ?? sourceConfig.install.software ?? "purpur"),
        requestedVersion: String(
          payload.version ?? sourceConfig.install.requestedVersion ?? "latest",
        ),
        installedSoftware: null,
        installedVersion: null,
        installedBuild: null,
      },
      backups: {
        enabled: Boolean(payload.autoBackups ?? true),
        intervalMinutes: Math.max(5, Number(payload.backupIntervalMinutes ?? 60) || 60),
        lastBackupAt: null,
        lastBackupPath: null,
      },
    };

    this.registry.servers.push(record);
    this.registry.activeServerId = serverId;
    this.registry = await saveServerRegistry(this.registry);
    await saveServerConfig(serverId, config);

    const context = this.buildContext(record, config);
    await this.ensureServerFiles(context);
    this.serverContexts.set(serverId, context);
    this.activeServerId = serverId;

    await this.updateServerProperties(serverId, {
      motd: `Hosted by Local Minecraft Panel - ${name}`,
      "server-port": String(port),
      "level-name": slugifyServerId(payload.levelName || name),
    });

    if (payload.acceptEula !== false) {
      await this.setEula(serverId, true);
    }

    if (Boolean(payload.installNow ?? true)) {
      await this.installServerSoftware(serverId, {
        software: config.install.software,
        requestedVersion: config.install.requestedVersion,
        acceptEula: payload.acceptEula !== false,
      });
    }

    this.appendLog(serverId, "panel", `Created server "${name}" at ${record.serverDir}.`);
    return this.getState(serverId);
  }

  async deleteServer(serverId) {
    if (!this.serverContexts.has(serverId)) {
      throw new Error("The selected server does not exist.");
    }

    if (this.registry.servers.length <= 1) {
      throw new Error("You must keep at least one server in the panel.");
    }

    const context = this.getServerContext(serverId);
    if (context.serverProcess) {
      throw new Error("Stop the server before deleting it.");
    }

    const removableServerRoots = [
      paths.managedServersRootDir,
      paths.serversDir,
      paths.legacyServerDir,
    ];

    const resolvedServerDir = path.resolve(context.paths.serverDir);
    const canRemoveServerDir = removableServerRoots.some((basePath) =>
      pathEqualsOrInside(resolvedServerDir, basePath),
    );

    if (!canRemoveServerDir) {
      throw new Error("This server folder is outside the allowed removable locations.");
    }

    this.serverContexts.delete(serverId);
    this.registry.servers = this.registry.servers.filter((entry) => entry.id !== serverId);

    const fallbackServerId = this.registry.servers[0]?.id ?? null;
    this.activeServerId = this.activeServerId === serverId ? fallbackServerId : this.activeServerId;
    this.registry.activeServerId = this.activeServerId;
    this.registry = await saveServerRegistry(this.registry);

    await Promise.all([
      fs.rm(context.paths.serverDir, { recursive: true, force: true }),
      fs.rm(context.paths.dataDir, { recursive: true, force: true }),
      fs.rm(context.paths.backupsDir, { recursive: true, force: true }),
    ]);

    this.appendLog(
      this.activeServerId,
      "panel",
      `Deleted server "${context.record.name}" and removed its local files.`,
      "warn",
    );

    return this.getState(this.activeServerId);
  }

  async selectServer(serverId) {
    this.getServerContext(serverId);
    this.activeServerId = serverId;
    this.registry.activeServerId = serverId;
    this.registry = await saveServerRegistry(this.registry);
    return this.getState(serverId);
  }

  async updatePlayitSettings(payload) {
    this.panelConfig.playit = {
      ...this.panelConfig.playit,
      autoStart: true,
      agentName:
        String(payload.agentName ?? this.panelConfig.playit.agentName).trim() ||
        this.panelConfig.playit.agentName,
    };

    this.panelConfig = await savePanelConfig(this.panelConfig);
    this.appendLog(null, "panel", "Updated global playit settings.");
    return this.panelConfig;
  }

  async updateUpdaterSettings(payload) {
    this.panelConfig.updater = {
      ...this.panelConfig.updater,
      enabled: Boolean(payload.enabled ?? this.panelConfig.updater.enabled),
      autoInstall: Boolean(payload.autoInstall ?? this.panelConfig.updater.autoInstall),
      checkIntervalHours: Math.max(
        1,
        Number(payload.checkIntervalHours ?? this.panelConfig.updater.checkIntervalHours ?? 6) || 6,
      ),
      githubOwner:
        String(payload.githubOwner ?? this.panelConfig.updater.githubOwner ?? "").trim(),
      githubRepo:
        String(payload.githubRepo ?? this.panelConfig.updater.githubRepo ?? "").trim(),
      assetName:
        String(
          payload.assetName ??
            this.panelConfig.updater.assetName ??
            getDefaultUpdaterAssetName(),
        ).trim() || getDefaultUpdaterAssetName(),
      allowPrerelease: Boolean(
        payload.allowPrerelease ?? this.panelConfig.updater.allowPrerelease,
      ),
    };

    this.panelConfig = await savePanelConfig(this.panelConfig);
    this.updater.syncConfig();
    this.appendLog(null, "panel", "Updated Releu app update settings.");
    return this.panelConfig;
  }

  async checkForAppUpdate() {
    return this.updater.checkForUpdates();
  }

  async markAppUpdateApplying() {
    return this.updater.markApplying();
  }

  async connectPlayit() {
    await this.ensurePlayitInitialized();

    if (!this.playit.snapshot().installed) {
      await this.playit.installBinary();
    }

    if (!this.playit.snapshot().secretConfigured) {
      const playitState = await this.playit.generateClaim(this.panelConfig.playit.agentName);
      this.appendLog(null, "panel", "Generated playit claim link for one-click linking.");
      return {
        action: "claim",
        claimUrl: playitState.claimUrl,
        playit: playitState,
      };
    }

    const playitState = await this.playit.startAgent();
    this.appendLog(null, "panel", "Started playit agent from simplified connect flow.");
    return {
      action: playitState.needsWebSetup ? "dashboard" : "started",
      claimUrl: null,
      playit: playitState,
    };
  }

  async updateRuntimeSettings(serverId, payload) {
    const context = this.getServerContext(serverId);
    const hostResources = this.getHostResources();
    context.config.launcher = {
      ...context.config.launcher,
      javaPath: String(payload.javaPath ?? context.config.launcher.javaPath).trim() || "java",
      minRam: String(payload.minRam ?? context.config.launcher.minRam).trim() || "2G",
      maxRam: String(payload.maxRam ?? context.config.launcher.maxRam).trim() || "4G",
      cpuCores: clampNumber(
        payload.cpuCores ?? context.config.launcher.cpuCores ?? 0,
        0,
        hostResources.cpuCores,
        0,
      ),
      gpuShare: clampNumber(
        payload.gpuShare ?? context.config.launcher.gpuShare ?? 0,
        0,
        100,
        0,
      ),
    };

    await this.saveContextConfig(context);
    this.appendLog(serverId, "panel", "Updated server runtime settings.");
    return context.config;
  }

  async updateServerProfile(serverId, payload) {
    const context = this.getServerContext(serverId);
    const nextName = String(payload.name ?? context.record.name).trim();
    if (!nextName) {
      throw new Error("Server name cannot be empty.");
    }

    context.record.name = nextName;
    context.record.updatedAt = currentTimestamp();
    context.config.backups = {
      ...context.config.backups,
      enabled: Boolean(payload.autoBackups ?? context.config.backups.enabled),
      intervalMinutes: Math.max(
        5,
        Number(payload.backupIntervalMinutes ?? context.config.backups.intervalMinutes ?? 60) ||
          60,
      ),
    };

    await this.saveContextConfig(context);
    this.registry.servers = this.registry.servers.map((entry) =>
      entry.id === serverId ? context.record : entry,
    );
    this.registry = await saveServerRegistry(this.registry);
    this.appendLog(serverId, "panel", "Saved server profile and backup schedule.");
    return this.getState(serverId);
  }

  async installServerSoftware(
    serverId,
    { software, requestedVersion = "latest", acceptEula = true } = {},
  ) {
    const context = this.getServerContext(serverId);
    const selectedSoftware = software ?? context.config.install.software ?? "purpur";
    const selectedVersion = requestedVersion ?? "latest";
    const resolvedVersion = await resolveSoftwareVersion(selectedSoftware, selectedVersion);
    const installedVersion =
      context.config.install.installedVersion ?? context.state.installMeta?.version ?? null;
    const worldHasContent = await this.serverHasBackupContent(context);
    if (
      installedVersion &&
      worldHasContent &&
      isPotentialMinecraftDowngrade(installedVersion, resolvedVersion)
    ) {
      throw new Error(
        `This server already has world data from Minecraft ${installedVersion}. Releu will not downgrade that world to ${resolvedVersion} because Minecraft world data is not safely reversible. Create a new server, restore an older backup, or regenerate the world before switching to an older version.`,
      );
    }

    const requiredJavaMajor = getRequiredJavaMajor(resolvedVersion);

    if (this.shouldAutoManageJavaPath(context.config.launcher.javaPath)) {
      await this.dependencies.ensureJavaMajor(requiredJavaMajor).catch(() => null);
    }

    const installerJavaPath =
      this.getPreferredManagedJavaPath(resolvedVersion) ?? context.config.launcher.javaPath;
    this.setServerOperation(context, {
      type: "install",
      title: "Installing Server Software",
      shortLabel: "Installing",
      detail: `Downloading ${selectedSoftware} ${resolvedVersion}.`,
    });

    try {
      if (installedVersion && installedVersion !== resolvedVersion && worldHasContent) {
        await this.createBackup(serverId, "pre-install-version-change");
      }
      this.appendLog(serverId, "panel", `Downloading ${selectedSoftware} (${resolvedVersion})...`);
      const installMeta = await downloadServerJar({
        software: selectedSoftware,
        requestedVersion: resolvedVersion,
        destinationPath: context.paths.serverJar,
        javaPath: installerJavaPath,
      });

      this.setServerOperation(context, {
        type: "install",
        title: "Finalizing Server Install",
        shortLabel: "Finalizing",
        detail: `Saving ${installMeta.softwareName} ${installMeta.version} and updating launcher defaults.`,
      });

      context.state.installMeta = installMeta;
      context.config.install = {
        software: selectedSoftware,
        requestedVersion: resolvedVersion,
        installedSoftware: installMeta.software,
        installedVersion: installMeta.version,
        installedBuild: installMeta.build,
      };

      const preferredJavaPath = this.getPreferredManagedJavaPath(installMeta.version);
      if (preferredJavaPath && this.shouldAutoManageJavaPath(context.config.launcher.javaPath)) {
        context.config.launcher = {
          ...context.config.launcher,
          javaPath: preferredJavaPath,
        };
      }

      await this.saveContextConfig(context);
      context.cachedProperties = await ensureServerPropertyFile(context.paths);
      if (acceptEula) {
        await this.setEula(serverId, true);
      }

      this.appendLog(
        serverId,
        "panel",
        `Installed ${installMeta.softwareName} ${installMeta.version} build ${installMeta.build}.`,
      );
      return installMeta;
    } finally {
      this.clearServerOperation(context);
    }
  }

  async getSoftwareVersions(software = "purpur") {
    if (this.versionsCache.has(software)) {
      return this.versionsCache.get(software);
    }

    const versions = await fetchSoftwareVersions(software);
    this.versionsCache.set(software, versions);
    return versions;
  }

  async updateServerProperties(serverId, changes) {
    const context = this.getServerContext(serverId);
    const next = await readServerProperties(context.paths);

    const requestedPort =
      changes?.["server-port"] !== undefined && changes?.["server-port"] !== null
        ? Number(changes["server-port"])
        : Number(next["server-port"] ?? 25565);
    await this.assertUniquePort(requestedPort, serverId);

    for (const [key, value] of Object.entries(changes ?? {})) {
      if (value === undefined || value === null) {
        continue;
      }
      next[key] = String(value);
    }

    context.cachedProperties = await writeServerProperties(context.paths, next);
    this.appendLog(serverId, "panel", "Saved server.properties changes.");
    return context.cachedProperties;
  }

  async inspectJavaRuntime(javaPath) {
    return new Promise((resolve, reject) => {
      const child = spawn(javaPath, ["-version"], withHiddenConsole());

      let output = "";
      let settled = false;

      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });

      child.on("exit", () => {
        if (settled) {
          return;
        }
        settled = true;
        const versionMatch =
          output.match(/version "([^"]+)"/i) ?? output.match(/openjdk ([^\s"]+)/i);
        const version = versionMatch?.[1] ?? null;
        const major = version ? Number(version.split(/[._+-]/)[0]) : null;
        resolve({
          raw: sanitizeLogLine(output),
          version,
          major,
        });
      });
    });
  }

  async startServer(serverId, options = {}) {
    const context = this.getServerContext(serverId);
    if (context.serverProcess) {
      return this.getState(serverId);
    }

    const safeMode = Boolean(options.safeMode);

    await this.syncDetectedInstalledSoftware(context);

    const launchTarget = await this.resolveLaunchTarget(context);
    if (!launchTarget) {
      throw new Error("No server runtime is installed yet.");
    }

    if (!(await this.readEula(serverId))) {
      throw new Error("You must accept the Minecraft EULA before starting the server.");
    }

    await this.validateServerStartup(context);

    const installedVersion =
      context.config.install.installedVersion ?? context.state.installMeta?.version ?? null;
    const installedSoftwareLabel =
      context.state.installMeta?.softwareName ??
      formatSoftwareName(context.config.install.installedSoftware) ??
      "This server";
    const requiredJavaMajor = getRequiredJavaMajor(installedVersion);

    if (this.shouldAutoManageJavaPath(context.config.launcher.javaPath)) {
      await this.dependencies.ensureJavaMajor(requiredJavaMajor).catch(() => null);
      const preferredJavaPath = this.getPreferredManagedJavaPath(installedVersion);
      if (preferredJavaPath && context.config.launcher.javaPath !== preferredJavaPath) {
        context.config.launcher = {
          ...context.config.launcher,
          javaPath: preferredJavaPath,
        };
        await this.saveContextConfig(context);
      }
    }

    const javaRuntime = await this.inspectJavaRuntime(context.config.launcher.javaPath);
    if (!javaRuntime.major) {
      throw new Error(
        `Could not determine the Java version for "${context.config.launcher.javaPath}".`,
      );
    }

    if (javaRuntime.major < requiredJavaMajor) {
      throw new Error(
        `${installedSoftwareLabel} ${installedVersion ?? ""}`.trim() +
          ` requires Java ${requiredJavaMajor} or newer. Current launcher is ${javaRuntime.version}. Update the Java path in the selected server settings.`,
      );
    }

    context.cachedProperties = await readServerProperties(context.paths);
    context.pendingSafeModeRecovery = false;
    context.pendingDowngradeWorldFailure = false;
    context.startingWithSafeMode = safeMode;
    const args = [
      `-Xms${context.config.launcher.minRam}`,
      `-Xmx${context.config.launcher.maxRam}`,
    ];

    if (Number(context.config.launcher.cpuCores) > 0) {
      args.push(`-XX:ActiveProcessorCount=${Number(context.config.launcher.cpuCores)}`);
    }

    if (launchTarget.mode === "argfile") {
      const relativeArgsPath = path
        .relative(context.paths.serverDir, launchTarget.argFile)
        .replaceAll("\\", "/");
      args.push(`@${relativeArgsPath}`);
      if (safeMode) {
        args.push("--safeMode");
      }
      args.push("nogui");
    } else {
      args.push("-jar", path.basename(launchTarget.jarPath));
      if (safeMode) {
        args.push("--safeMode");
      }
      args.push("--nogui");
    }

    const child = spawn(context.config.launcher.javaPath, args, {
      cwd: context.paths.serverDir,
      ...withHiddenConsole(),
    });

    context.serverProcess = child;
    context.state.serverStatus = "starting";
    context.state.serverReady = false;
    context.state.serverPid = child.pid;
    context.state.resourceMetrics = await this.refreshServerMetrics(context);
    context.state.lastStartedAt = currentTimestamp();
    context.state.lastExitCode = null;
    this.appendLog(
      serverId,
      "panel",
      `Starting Minecraft server with ${context.config.launcher.javaPath}${safeMode ? " in safe mode" : ""}.`,
    );

    const handleOutput = (source, chunk) => {
      for (const rawLine of String(chunk).split(/\r?\n/)) {
        const cleaned = sanitizeLogLine(rawLine);
        if (!cleaned) {
          continue;
        }

        this.appendLog(serverId, source, cleaned);
        this.handleServerLine(serverId, cleaned);
      }
    };

    child.stdout.on("data", (chunk) => handleOutput("server", chunk));
    child.stderr.on("data", (chunk) => handleOutput("server", chunk));

    child.on("error", (error) => {
      this.appendLog(serverId, "panel", error.message, "error");
    });

    child.on("exit", async (code) => {
      const shouldRetryInSafeMode =
        context.pendingSafeModeRecovery && !context.startingWithSafeMode && !context.restartRequested;
      context.serverProcess = null;
      context.state.serverStatus = "stopped";
      context.state.serverReady = false;
      context.state.serverPid = null;
      context.state.lastStoppedAt = currentTimestamp();
      context.state.lastExitCode = code;
      context.onlinePlayers.clear();
      context.state.playerCount = 0;
      await this.refreshServerMetrics(context);
      this.appendLog(
        serverId,
        "panel",
        `Minecraft server exited with code ${code ?? "unknown"}.`,
      );

      if (shouldRetryInSafeMode) {
        context.pendingSafeModeRecovery = false;
        this.appendLog(
          serverId,
          "panel",
          "Detected a datapack or worldgen startup failure. Retrying once with --safeMode.",
          "warn",
        );
        await this.startServer(serverId, { safeMode: true });
        return;
      }

      if (context.pendingDowngradeWorldFailure) {
        this.appendLog(
          serverId,
          "panel",
          `This world appears to have been opened in a newer Minecraft version than ${installedVersion ?? "the currently installed server"}. Restore an older backup, switch back to a matching newer version, or regenerate the world before starting again.`,
          "error",
        );
      }

      if (context.restartRequested) {
        context.restartRequested = false;
        await this.startServer(serverId);
      }
    });

    await this.ensurePlayitInitialized();
    if (this.playit.snapshot().secretConfigured) {
      try {
        await this.playit.startAgent();
      } catch (error) {
        this.appendLog(serverId, "playit", error.message, "warn");
      }
    }

    return this.getState(serverId);
  }

  async stopServer(serverId) {
    const context = this.getServerContext(serverId);
    if (!context.serverProcess) {
      return this.getState(serverId);
    }

    context.state.serverStatus = "stopping";
    await this.sendCommand(serverId, "stop");
    return this.getState(serverId);
  }

  async restartServer(serverId) {
    const context = this.getServerContext(serverId);
    if (!context.serverProcess) {
      return this.startServer(serverId);
    }

    context.restartRequested = true;
    await this.stopServer(serverId);
    return this.getState(serverId);
  }

  async forceKillServer(serverId) {
    const context = this.getServerContext(serverId);
    if (!context.serverProcess) {
      return this.getState(serverId);
    }

    context.restartRequested = false;
    context.serverProcess.kill();
    context.serverProcess = null;
    context.state.serverStatus = "stopped";
    context.state.serverReady = false;
    context.state.serverPid = null;
    context.onlinePlayers.clear();
    context.state.playerCount = 0;
    await this.refreshServerMetrics(context);
    this.appendLog(serverId, "panel", "Force-killed the Minecraft server process.", "warn");
    return this.getState(serverId);
  }

  async sendCommand(serverId, command) {
    const context = this.getServerContext(serverId);
    const normalized = String(command ?? "").trim();
    if (!normalized) {
      throw new Error("A command is required.");
    }

    if (!context.serverProcess?.stdin) {
      throw new Error("The selected Minecraft server is not running.");
    }

    context.serverProcess.stdin.write(`${normalized}\n`);
    this.appendLog(serverId, "panel", `> ${normalized}`);
    return true;
  }

  handleServerLine(serverId, line) {
    const context = this.getServerContext(serverId);
    const payload = pickLinePayload(line);

    if (payload.includes("Done (") && payload.includes("For help")) {
      context.state.serverStatus = "running";
      context.state.serverReady = true;
      this.markInstalledAssetsLoaded(serverId).catch(() => {});
      if (this.playit.snapshot().secretConfigured) {
        this.playit.refreshTunnels({ force: true }).catch(() => {});
      }
    }

    const uuidMatch = payload.match(/^UUID of player (.+?) is ([0-9a-f-]+)$/i);
    if (uuidMatch) {
      this.rememberPlayer(serverId, uuidMatch[1], { uuid: uuidMatch[2] }).catch(() => {});
    }

    const joinedMatch = payload.match(/^(.+?) joined the game$/);
    if (joinedMatch) {
      const player = normalizePlayerName(joinedMatch[1]);
      context.onlinePlayers.add(player);
      context.state.playerCount = context.onlinePlayers.size;
      this.rememberPlayer(serverId, player, { lastSeenAt: currentTimestamp() }).catch(() => {});
    }

    const leftMatch = payload.match(/^(.+?) left the game$/);
    if (leftMatch) {
      const player = normalizePlayerName(leftMatch[1]);
      context.onlinePlayers.delete(player);
      context.state.playerCount = context.onlinePlayers.size;
      this.rememberPlayer(serverId, player, { lastSeenAt: currentTimestamp() }).catch(
        () => {},
      );
    }

    const gamemodeMatch = payload.match(/^Set (.+?)'s game mode to (.+?) Mode$/i);
    if (gamemodeMatch) {
      const player = normalizePlayerName(gamemodeMatch[1]);
      const gamemode = normalizeGamemode(gamemodeMatch[2]);
      if (gamemode) {
        this.rememberPlayer(serverId, player, {
          gamemode,
          lastSeenAt: currentTimestamp(),
        }).catch(() => {});
      }
    }

    if (
      payload.includes("Failed to load datapacks, can't proceed with server load") ||
      payload.includes("No key dimensions in MapLike[{}]; No key seed in MapLike[{}]")
    ) {
      context.pendingSafeModeRecovery = true;
    }

    if (payload.includes("Server attempted to load chunk saved with newer version of minecraft")) {
      context.pendingDowngradeWorldFailure = true;
    }
  }

  async serverHasBackupContent(context) {
    if (await this.hasInstalledJar(context)) {
      return true;
    }

    if (await fileExists(context.paths.serverPropertiesFile)) {
      return true;
    }

    const levelName = context.cachedProperties["level-name"] || "world";
    for (const worldName of [levelName, `${levelName}_nether`, `${levelName}_the_end`, "world"]) {
      if (await fileExists(path.join(context.paths.serverDir, worldName))) {
        return true;
      }
    }

    return false;
  }

  async createBackup(serverId, reason = "manual") {
    const context = this.getServerContext(serverId);
    if (context.backupInProgress) {
      throw new Error("A backup is already running for this server.");
    }

    if (!(await this.serverHasBackupContent(context))) {
      throw new Error("There is no server data to back up yet.");
    }

    context.cachedProperties = await readServerProperties(context.paths);
    const levelName = context.cachedProperties["level-name"] || "world";
    const backupName = `${slugTimestamp()}-${levelName}`;
    const targetDir = path.join(context.paths.backupsDir, backupName);
    const candidateWorlds = new Set([
      levelName,
      "world",
      `${levelName}_nether`,
      `${levelName}_the_end`,
    ]);

    context.backupInProgress = true;
    let saveDisabled = false;

    try {
      if (context.serverProcess) {
        await this.sendCommand(serverId, "save-off");
        saveDisabled = true;
        await wait(350);
        await this.sendCommand(serverId, "save-all flush");
        await wait(1400);
      }

      await fs.mkdir(targetDir, { recursive: true });

      for (const worldName of candidateWorlds) {
        const source = path.join(context.paths.serverDir, worldName);
        if (await fileExists(source)) {
          await fs.cp(source, path.join(targetDir, worldName), { recursive: true });
        }
      }

      for (const filePath of [
        context.paths.serverPropertiesFile,
        context.paths.eulaFile,
        context.paths.opsFile,
        context.paths.whitelistFile,
        context.paths.bannedPlayersFile,
        context.paths.bannedIpsFile,
        context.paths.usercacheFile,
        context.paths.configFile,
        context.paths.assetIndexFile,
      ]) {
        if (await fileExists(filePath)) {
          await fs.copyFile(filePath, path.join(targetDir, path.basename(filePath)));
        }
      }

      const installedJar = await this.resolveInstalledJar(context);
      if (installedJar) {
        await fs.copyFile(installedJar, path.join(targetDir, path.basename(installedJar)));
      }

      if (await fileExists(context.paths.pluginsDir)) {
        await fs.cp(context.paths.pluginsDir, path.join(targetDir, "plugins"), {
          recursive: true,
        });
      }

      if (await fileExists(context.paths.modsDir)) {
        await fs.cp(context.paths.modsDir, path.join(targetDir, "mods"), {
          recursive: true,
        });
      }
    } finally {
      if (saveDisabled && context.serverProcess) {
        try {
          await this.sendCommand(serverId, "save-on");
        } catch {
          // Ignore cleanup failures after the backup copy finished.
        }
      }
      context.backupInProgress = false;
    }

    context.config.backups.lastBackupAt = currentTimestamp();
    context.config.backups.lastBackupPath = targetDir;
    await this.saveContextConfig(context);
    this.appendLog(serverId, "panel", `Created ${reason} backup: ${targetDir}`);
    return targetDir;
  }

  async listWorlds(serverId) {
    const context = this.getServerContext(serverId);
    context.cachedProperties = await readServerProperties(context.paths);

    const activeWorldName = context.cachedProperties["level-name"] || "world";
    const names = new Set([activeWorldName, "world"]);
    const entries = await fs.readdir(context.paths.serverDir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const levelDatPath = path.join(context.paths.serverDir, entry.name, "level.dat");
      if (await fileExists(levelDatPath)) {
        names.add(entry.name);
      }
    }

    const worlds = [];
    for (const worldName of names) {
      const basePath = ensureChildPath(context.paths.serverDir, path.join(context.paths.serverDir, worldName));
      const netherPath = ensureChildPath(
        context.paths.serverDir,
        path.join(context.paths.serverDir, `${worldName}_nether`),
      );
      const endPath = ensureChildPath(
        context.paths.serverDir,
        path.join(context.paths.serverDir, `${worldName}_the_end`),
      );

      const exists = await fileExists(basePath);
      const netherExists = await fileExists(netherPath);
      const endExists = await fileExists(endPath);
      const stats = exists ? await fs.stat(basePath) : null;

      worlds.push({
        name: worldName,
        path: basePath,
        isActive: worldName === activeWorldName,
        exists,
        netherExists,
        endExists,
        lastModifiedAt: stats?.mtime?.toISOString?.() ?? null,
      });
    }

    worlds.sort((left, right) => {
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }
      if (left.exists !== right.exists) {
        return left.exists ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    return worlds;
  }

  async setActiveWorld(serverId, payload = {}) {
    const context = this.getServerContext(serverId);
    if (context.serverProcess) {
      throw new Error("Stop the server before switching the active world.");
    }

    const worldName = normalizeWorldName(payload.name);
    await this.updateServerProperties(serverId, {
      "level-name": worldName,
    });
    this.appendLog(serverId, "panel", `Selected world "${worldName}" as the active server world.`);
    return this.getState(serverId);
  }

  async regenerateWorld(serverId, payload = {}) {
    const context = this.getServerContext(serverId);
    if (context.serverProcess) {
      throw new Error("Stop the server before regenerating a world.");
    }

    context.cachedProperties = await readServerProperties(context.paths);
    const worldName = normalizeWorldName(
      payload.name ?? context.cachedProperties["level-name"] ?? "world",
    );

    await this.updateServerProperties(serverId, {
      "level-name": worldName,
    });

    for (const folderName of [worldName, `${worldName}_nether`, `${worldName}_the_end`]) {
      const targetDir = ensureChildPath(
        context.paths.serverDir,
        path.join(context.paths.serverDir, folderName),
      );
      if (await fileExists(targetDir)) {
        await fs.rm(targetDir, { recursive: true, force: true });
      }
    }

    this.appendLog(
      serverId,
      "panel",
      `Prepared world "${worldName}" for regeneration. It will generate on the next server start.`,
    );
    return this.getState(serverId);
  }

  async resolveWorldImportRoot(sourcePath) {
    const sourceDir = path.resolve(String(sourcePath ?? "").trim());
    if (!sourceDir) {
      throw new Error("A source world path is required.");
    }

    const stats = await fs.stat(sourceDir).catch(() => null);
    if (!stats?.isDirectory()) {
      throw new Error("The selected world source must be a folder.");
    }

    if (await fileExists(path.join(sourceDir, "level.dat"))) {
      return {
        rootDir: sourceDir,
        sourceName: path.basename(sourceDir),
        siblingBaseDir: path.dirname(sourceDir),
      };
    }

    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidateDir = path.join(sourceDir, entry.name);
      if (await fileExists(path.join(candidateDir, "level.dat"))) {
        candidates.push(candidateDir);
      }
    }

    if (candidates.length !== 1) {
      throw new Error(
        "Choose a world folder directly, or a folder that contains exactly one world folder with level.dat.",
      );
    }

    return {
      rootDir: candidates[0],
      sourceName: path.basename(candidates[0]),
      siblingBaseDir: sourceDir,
    };
  }

  async extractArchiveToDirectory(archivePath, targetDir) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(targetDir, { recursive: true });
    await extractZip(archivePath, {
      dir: targetDir,
    });
    return true;
  }

  async importResolvedWorld(serverId, sourcePath, payload = {}) {
    const context = this.getServerContext(serverId);
    if (context.serverProcess) {
      throw new Error("Stop the server before importing a world.");
    }

    const resolvedSource = path.resolve(String(sourcePath ?? "").trim());
    if (!resolvedSource) {
      throw new Error("A valid world source path is required.");
    }

    const serverDir = path.resolve(context.paths.serverDir);
    if (
      resolvedSource === serverDir ||
      resolvedSource.startsWith(`${serverDir}${path.sep}`)
    ) {
      throw new Error("Choose a world source outside this server folder.");
    }

    const { rootDir, sourceName, siblingBaseDir } = await this.resolveWorldImportRoot(
      resolvedSource,
    );
    const targetWorldName = normalizeWorldName(payload.worldName || sourceName);
    const targetPaths = [
      ensureChildPath(context.paths.serverDir, path.join(context.paths.serverDir, targetWorldName)),
      ensureChildPath(
        context.paths.serverDir,
        path.join(context.paths.serverDir, `${targetWorldName}_nether`),
      ),
      ensureChildPath(
        context.paths.serverDir,
        path.join(context.paths.serverDir, `${targetWorldName}_the_end`),
      ),
    ];

    const shouldBackup =
      (await fileExists(targetPaths[0])) ||
      (await fileExists(targetPaths[1])) ||
      (await fileExists(targetPaths[2]));
    if (shouldBackup && (await this.serverHasBackupContent(context))) {
      await this.createBackup(serverId, "pre-world-import");
    }

    for (const targetPath of targetPaths) {
      if (await fileExists(targetPath)) {
        await fs.rm(targetPath, { recursive: true, force: true });
      }
    }

    await fs.cp(rootDir, targetPaths[0], { recursive: true });

    const companionTargets = [
      ["_nether", targetPaths[1]],
      ["_the_end", targetPaths[2]],
    ];
    for (const [suffix, targetPath] of companionTargets) {
      const sourceCompanion = path.join(siblingBaseDir, `${sourceName}${suffix}`);
      if (await fileExists(sourceCompanion)) {
        await fs.cp(sourceCompanion, targetPath, { recursive: true });
      }
    }

    if (payload.activate !== false) {
      await this.updateServerProperties(serverId, {
        "level-name": targetWorldName,
      });
    }

    this.appendLog(
      serverId,
      "panel",
      `Imported world "${targetWorldName}" from ${resolvedSource}.`,
    );
    return {
      worldName: targetWorldName,
      sourcePath: resolvedSource,
      activated: payload.activate !== false,
    };
  }

  async importWorldFolder(serverId, payload = {}) {
    const sourcePath = String(payload.sourcePath ?? "").trim();
    if (!sourcePath) {
      throw new Error("A local world folder path is required.");
    }

    await this.importResolvedWorld(serverId, sourcePath, payload);
    return this.getState(serverId);
  }

  async importWorldArchive(serverId, fileName, bytes, payload = {}) {
    const safeName = sanitizeAssetFilename(fileName);
    if (!/\.(zip|mcworld)$/i.test(safeName)) {
      throw new Error("World upload must be a .zip or .mcworld archive.");
    }

    const context = this.getServerContext(serverId);
    const tempRoot = path.join(context.paths.dataDir, "imports", slugTimestamp());
    const archivePath = path.join(tempRoot, safeName);
    const extractDir = path.join(tempRoot, "extracted");

    await fs.mkdir(extractDir, { recursive: true });
    await fs.writeFile(archivePath, Buffer.from(bytes));

    try {
      await this.extractArchiveToDirectory(archivePath, extractDir);
      await this.importResolvedWorld(serverId, extractDir, {
        ...payload,
        worldName: payload.worldName || trimArchiveExtension(safeName),
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }

    return this.getState(serverId);
  }

  startBackupScheduler() {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
    }

    this.backupTimer = setInterval(() => {
      this.runScheduledBackups().catch((error) => {
        this.appendLog(null, "panel", error.message ?? "Scheduled backup failed.", "error");
      });
    }, 60_000);
  }

  async shutdown() {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
    }

    await this.playit.stopAgent().catch(() => {});
  }

  async runScheduledBackups() {
    for (const [serverId, context] of this.serverContexts.entries()) {
      if (!context.config.backups.enabled || context.backupInProgress) {
        continue;
      }

      const intervalMs =
        Math.max(5, Number(context.config.backups.intervalMinutes ?? 60) || 60) * 60_000;
      const lastBackupTime =
        Date.parse(context.config.backups.lastBackupAt ?? context.record.createdAt ?? currentTimestamp()) ||
        0;

      if (Date.now() - lastBackupTime < intervalMs) {
        continue;
      }

      if (!(await this.serverHasBackupContent(context))) {
        continue;
      }

      try {
        await this.createBackup(serverId, "scheduled");
      } catch (error) {
        this.appendLog(serverId, "panel", error.message, "error");
      }
    }
  }

  async loadPlayerIndex(serverId) {
    const context = this.getServerContext(serverId);
    return readJsonFile(context.paths.playerIndexFile, {});
  }

  async savePlayerIndex(serverId, index) {
    const context = this.getServerContext(serverId);
    await writeJsonFile(context.paths.playerIndexFile, index);
  }

  async loadAssetIndex(serverId) {
    const context = this.getServerContext(serverId);
    const index = normalizeAssetIndex(
      await readJsonFile(context.paths.assetIndexFile, emptyAssetIndex()),
    );
    await writeJsonFile(context.paths.assetIndexFile, index);
    return index;
  }

  async saveAssetIndex(serverId, index) {
    const context = this.getServerContext(serverId);
    const normalized = normalizeAssetIndex(index);
    await writeJsonFile(context.paths.assetIndexFile, normalized);
    return normalized;
  }

  getServerSoftwareOption(context) {
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    return (
      serverSoftwareOptions.find(
        (entry) =>
          entry.id === effectiveSoftware,
      ) ?? null
    );
  }

  getDetectedServerSoftwareId(context) {
    const serverDir = context.paths.serverDir;
    if (
      hasPath(path.join(serverDir, "libraries", "net", "neoforged", "neoforge")) ||
      hasPath(path.join(serverDir, "neoforge.mods.toml"))
    ) {
      return "neoforge";
    }

    if (
      hasPath(path.join(serverDir, "libraries", "net", "minecraftforge", "forge")) ||
      hasPath(path.join(serverDir, "forge-server-launcher.jar"))
    ) {
      return "forge";
    }

    if (
      hasPath(path.join(serverDir, ".fabric", "server")) ||
      hasPath(path.join(serverDir, "libraries", "net", "fabricmc", "fabric-loader"))
    ) {
      return "fabric";
    }

    if (hasPath(path.join(serverDir, "purpur.yml"))) {
      return "purpur";
    }

    if (
      hasPath(path.join(serverDir, "paper.yml")) ||
      hasPath(path.join(serverDir, "paper-global.yml")) ||
      hasPath(path.join(serverDir, "config", "paper-global.yml"))
    ) {
      return "paper";
    }

    return null;
  }

  getEffectiveServerSoftwareId(context) {
    return (
      this.getDetectedServerSoftwareId(context) ??
      context.config.install.installedSoftware ??
      context.config.install.software ??
      "vanilla"
    );
  }

  async syncDetectedInstalledSoftware(context) {
    const detectedSoftware = this.getDetectedServerSoftwareId(context);
    if (!detectedSoftware) {
      return null;
    }

    if (context.config.install.installedSoftware === detectedSoftware) {
      return detectedSoftware;
    }

    context.config.install = {
      ...context.config.install,
      installedSoftware: detectedSoftware,
    };
    await this.saveContextConfig(context);
    this.appendLog(
      context.record.id,
      "panel",
      `Releu detected ${formatSoftwareName(detectedSoftware) ?? detectedSoftware} server files and updated this server profile automatically.`,
    );
    return detectedSoftware;
  }

  assertAssetCompatibility(context, kind, options = {}) {
    const label = kindLabel(kind);
    const softwareId = this.getEffectiveServerSoftwareId(context);
    const softwareOption = this.getServerSoftwareOption(context);
    const softwareName = softwareOption?.name ?? formatSoftwareName(softwareId) ?? softwareId;

    if (label === "plugin" && !softwareOption?.supportsPlugins) {
      throw new Error(
        `${softwareName} does not load plugins. Switch this server to Paper or Purpur before installing plugin add-ons.`,
      );
    }

    if (label === "mod" && !softwareOption?.supportsMods) {
      throw new Error(
        `${softwareName} does not load mods. Switch this server to Fabric, Forge, or NeoForge before installing mod add-ons.`,
      );
    }

    const profileId = String(options.profileId ?? "").trim().toLowerCase();
    if (!profileId) {
      return;
    }

    if (label === "mod" && profileId !== softwareId) {
      throw new Error(
        `This server is using ${softwareName}. ${profileId.toUpperCase()} mods will not load here.`,
      );
    }

    if (
      label === "plugin" &&
      softwareId === "paper" &&
      !["paper", "spigot", "bukkit", "auto"].includes(profileId)
    ) {
      throw new Error("This Paper server can only install Paper, Spigot, or Bukkit plugins.");
    }

    if (
      label === "plugin" &&
      softwareId === "purpur" &&
      !["purpur", "paper", "spigot", "bukkit", "auto"].includes(profileId)
    ) {
      throw new Error("This Purpur server can only install Purpur, Paper, Spigot, or Bukkit plugins.");
    }
  }

  async rememberInstalledAsset(serverId, kind, fileName, metadata = {}) {
    const label = kindLabel(kind);
    const safeName = sanitizeAssetFilename(fileName);
    const index = await this.loadAssetIndex(serverId);
    index[label][safeName] = {
      ...(index[label][safeName] ?? {}),
      fileName: safeName,
      displayName: metadata.displayName ?? metadata.projectTitle ?? safeName,
      kind: label,
      source: metadata.source ?? index[label][safeName]?.source ?? "upload",
      iconUrl: metadata.iconUrl ?? index[label][safeName]?.iconUrl ?? null,
      projectId: metadata.projectId ?? index[label][safeName]?.projectId ?? null,
      projectSlug: metadata.projectSlug ?? index[label][safeName]?.projectSlug ?? null,
      versionId: metadata.versionId ?? index[label][safeName]?.versionId ?? null,
      versionNumber: metadata.versionNumber ?? index[label][safeName]?.versionNumber ?? null,
      versionName: metadata.versionName ?? index[label][safeName]?.versionName ?? null,
      profileId: metadata.profileId ?? index[label][safeName]?.profileId ?? null,
      gameVersions: metadata.gameVersions ?? index[label][safeName]?.gameVersions ?? [],
      loaders: metadata.loaders ?? index[label][safeName]?.loaders ?? [],
      dependencyOf: metadata.dependencyOf ?? index[label][safeName]?.dependencyOf ?? null,
      installedAt: metadata.installedAt ?? currentTimestamp(),
      restartRequired: metadata.restartRequired ?? true,
      restartReason:
        metadata.restartReason ??
        "Restart the Minecraft server before this add-on will appear in game.",
      addedFromUrl: metadata.addedFromUrl ?? index[label][safeName]?.addedFromUrl ?? null,
    };
    await this.saveAssetIndex(serverId, index);
    return index[label][safeName];
  }

  async forgetInstalledAsset(serverId, kind, fileName) {
    const label = kindLabel(kind);
    const safeName = sanitizeAssetFilename(fileName);
    const index = await this.loadAssetIndex(serverId);
    delete index[label][safeName];
    await this.saveAssetIndex(serverId, index);
  }

  async markInstalledAssetsLoaded(serverId) {
    const index = await this.loadAssetIndex(serverId);
    let changed = false;
    for (const kind of ["plugin", "mod"]) {
      for (const entry of Object.values(index[kind])) {
        if (!entry.restartRequired) {
          continue;
        }
        entry.restartRequired = false;
        entry.restartReason = null;
        entry.loadedAt = currentTimestamp();
        changed = true;
      }
    }
    if (changed) {
      await this.saveAssetIndex(serverId, index);
    }
  }

  async listAssetFileNames(context, kind) {
    try {
      const entries = await fs.readdir(this.getAssetDirectory(context, kind), {
        withFileTypes: true,
      });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  async ensureKnownModDependencies(serverId, context) {
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    if (effectiveSoftware !== "fabric") {
      return;
    }

    const modFiles = await this.listAssetFileNames(context, "mod");
    const normalizedFiles = modFiles.map((entry) => entry.toLowerCase());
    if (!normalizedFiles.some((entry) => entry.includes("geyser-fabric"))) {
      return;
    }
    if (normalizedFiles.some((entry) => entry.includes("fabric-api"))) {
      return;
    }

    const selection = await resolveCatalogInstall({
      projectId: "fabric-api",
      kind: "mod",
      profileId: "fabric",
      serverSoftware: "fabric",
      gameVersion: this.getServerGameVersion(serverId),
    });

    await this.installAssetFromUrl(serverId, "mod", selection.fileUrl, {
      displayName: selection.projectTitle ?? selection.fileName,
      source: "catalog",
      iconUrl: selection.iconUrl,
      projectId: selection.projectId,
      projectSlug: selection.projectSlug,
      versionId: selection.versionId,
      versionNumber: selection.versionNumber,
      versionName: selection.versionName,
      profileId: selection.profile?.id ?? "fabric",
      gameVersions: selection.gameVersions,
      loaders: selection.loaders,
      dependencyOf: "geyser-fabric",
    });

    this.appendLog(
      serverId,
      "panel",
      "Installed required Fabric API dependency automatically for Geyser-Fabric.",
    );
  }

  async validateServerStartup(context) {
    const serverId = context.record.id;
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    const softwareOption =
      serverSoftwareOptions.find((entry) => entry.id === effectiveSoftware) ?? null;
    const softwareName =
      softwareOption?.name ?? formatSoftwareName(effectiveSoftware) ?? effectiveSoftware;
    const modFiles = await this.listAssetFileNames(context, "mod");
    const pluginFiles = await this.listAssetFileNames(context, "plugin");

    if (modFiles.length && !softwareOption?.supportsMods) {
      throw new Error(
        `${softwareName} does not load mods, but this server folder still has ${modFiles.length} mod file(s). Switch the server to Fabric, Forge, or NeoForge, or remove those mods before starting.`,
      );
    }

    if (pluginFiles.length && !softwareOption?.supportsPlugins) {
      throw new Error(
        `${softwareName} does not load plugins, but this server folder still has ${pluginFiles.length} plugin file(s). Switch the server to Paper or Purpur before starting.`,
      );
    }

    await this.ensureKnownModDependencies(serverId, context);
  }

  async rememberPlayer(serverId, name, updates = {}) {
    const normalized = normalizePlayerName(name);
    if (!normalized) {
      return null;
    }

    const index = await this.loadPlayerIndex(serverId);
    const key = playerKey(normalized);
    index[key] = {
      name: normalized,
      uuid: updates.uuid ?? index[key]?.uuid ?? null,
      lastSeenAt: updates.lastSeenAt ?? index[key]?.lastSeenAt ?? null,
      gamemode: updates.gamemode ?? index[key]?.gamemode ?? null,
    };
    await this.savePlayerIndex(serverId, index);
    return index[key];
  }

  async registerPlayer(serverId, payload) {
    const name = normalizePlayerName(payload.name);
    const uuid = String(payload.uuid ?? "").trim() || null;
    if (!name) {
      throw new Error("Player name is required.");
    }

    return this.rememberPlayer(serverId, name, {
      uuid,
      lastSeenAt: currentTimestamp(),
    });
  }

  async readListFile(targetPath) {
    return readJsonFile(targetPath, []);
  }

  async getPlayers(serverId) {
    const context = this.getServerContext(serverId);
    const index = await this.loadPlayerIndex(serverId);
    const usercache = await this.readListFile(context.paths.usercacheFile);
    const whitelist = await this.readListFile(context.paths.whitelistFile);
    const ops = await this.readListFile(context.paths.opsFile);
    const bannedPlayers = await this.readListFile(context.paths.bannedPlayersFile);
    const players = new Map();

    const ensurePlayer = (name, extra = {}) => {
      const normalized = normalizePlayerName(name);
      if (!normalized) {
        return null;
      }

      const key = playerKey(normalized);
      if (!players.has(key)) {
        players.set(key, {
          name: normalized,
          uuid: null,
          lastSeenAt: null,
          gamemode: null,
          online: false,
          whitelisted: false,
          op: false,
          banned: false,
          banReason: null,
        });
      }

      const existing = players.get(key);
      players.set(key, {
        ...existing,
        ...extra,
        name: normalized,
      });

      return players.get(key);
    };

    for (const value of Object.values(index)) {
      ensurePlayer(value.name, value);
    }

    for (const entry of usercache) {
      ensurePlayer(entry.name, {
        uuid: entry.uuid ?? null,
      });
    }

    for (const entry of whitelist) {
      ensurePlayer(entry.name, {
        uuid: entry.uuid ?? null,
        whitelisted: true,
      });
    }

    for (const entry of ops) {
      ensurePlayer(entry.name, {
        uuid: entry.uuid ?? null,
        op: true,
      });
    }

    for (const entry of bannedPlayers) {
      ensurePlayer(entry.name, {
        uuid: entry.uuid ?? null,
        banned: true,
        banReason: entry.reason ?? "Banned",
      });
    }

    for (const name of context.onlinePlayers) {
      ensurePlayer(name, { online: true });
    }

    return Array.from(players.values()).sort((left, right) => {
      if (left.online !== right.online) {
        return left.online ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  }

  async resolvePlayerIdentity(serverId, name) {
    const normalized = normalizePlayerName(name);
    if (!normalized) {
      throw new Error("Player name is required.");
    }

    const players = await this.getPlayers(serverId);
    const match = players.find((entry) => playerKey(entry.name) === playerKey(normalized));
    if (!match) {
      return {
        name: normalized,
        uuid: null,
      };
    }

    return {
      name: match.name,
      uuid: match.uuid,
    };
  }

  async mutatePlayerList(serverId, targetPath, name, addEntry) {
    const identity = await this.resolvePlayerIdentity(serverId, name);
    if (!identity.uuid) {
      throw new Error(
        "This player has no known UUID yet. Let them join once, or add the UUID manually in the panel first.",
      );
    }

    const entries = await this.readListFile(targetPath);
    const filtered = entries.filter((entry) => playerKey(entry.name) !== playerKey(identity.name));
    if (addEntry) {
      filtered.push(addEntry(identity));
    }
    await writeJsonFile(targetPath, filtered);
  }

  async applyPlayerAction(serverId, name, action, payload = {}) {
    const context = this.getServerContext(serverId);
    const normalized = normalizePlayerName(name);
    if (!normalized) {
      throw new Error("Player name is required.");
    }

    const requiresRunningServer = new Set(["kick", "gamemode", "heal", "feed", "teleport"]);

    if (requiresRunningServer.has(action) && !context.serverProcess) {
      throw new Error(`Player action "${action}" requires the server to be running.`);
    }

    const identity = requiresRunningServer.has(action)
      ? await this.resolvePlayerIdentity(serverId, normalized)
      : { name: normalized, uuid: null };
    const liveCommandTarget = identity.uuid ?? identity.name ?? normalized;

    switch (action) {
      case "op":
        if (context.serverProcess) {
          await this.sendCommand(serverId, `op ${normalized}`);
        } else {
          await this.mutatePlayerList(serverId, context.paths.opsFile, normalized, (identity) => ({
            uuid: identity.uuid,
            name: identity.name,
            level: 4,
            bypassesPlayerLimit: false,
          }));
        }
        break;
      case "deop":
        if (context.serverProcess) {
          await this.sendCommand(serverId, `deop ${normalized}`);
        } else {
          await this.mutatePlayerList(serverId, context.paths.opsFile, normalized, null);
        }
        break;
      case "whitelist-add":
        if (context.serverProcess) {
          await this.sendCommand(serverId, `whitelist add ${normalized}`);
        } else {
          await this.mutatePlayerList(
            serverId,
            context.paths.whitelistFile,
            normalized,
            (identity) => ({
              uuid: identity.uuid,
              name: identity.name,
            }),
          );
        }
        break;
      case "whitelist-remove":
        if (context.serverProcess) {
          await this.sendCommand(serverId, `whitelist remove ${normalized}`);
        } else {
          await this.mutatePlayerList(serverId, context.paths.whitelistFile, normalized, null);
        }
        break;
      case "ban":
        if (context.serverProcess) {
          const reason = String(payload.reason ?? "Banned from panel").trim();
          await this.sendCommand(serverId, `ban ${normalized} ${reason}`);
        } else {
          await this.mutatePlayerList(
            serverId,
            context.paths.bannedPlayersFile,
            normalized,
            (identity) => ({
              uuid: identity.uuid,
              name: identity.name,
              created: new Date().toUTCString(),
              source: "Local Minecraft Panel",
              expires: "forever",
              reason: String(payload.reason ?? "Banned from panel").trim(),
            }),
          );
        }
        break;
      case "pardon":
        if (context.serverProcess) {
          await this.sendCommand(serverId, `pardon ${normalized}`);
        } else {
          await this.mutatePlayerList(serverId, context.paths.bannedPlayersFile, normalized, null);
        }
        break;
      case "kick":
        await this.sendCommand(
          serverId,
          `kick ${liveCommandTarget} ${String(payload.reason ?? "Removed by panel")}`,
        );
        break;
      case "gamemode":
        {
          const mode = normalizeGamemode(payload.mode) ?? "survival";
          await this.sendCommand(serverId, `gamemode ${mode} ${liveCommandTarget}`);
          await this.rememberPlayer(serverId, normalized, {
            gamemode: mode,
            lastSeenAt: currentTimestamp(),
          });
        }
        break;
      case "heal":
        await this.sendCommand(
          serverId,
          `effect give ${liveCommandTarget} minecraft:instant_health 1 1 true`,
        );
        break;
      case "feed":
        await this.sendCommand(
          serverId,
          `effect give ${liveCommandTarget} minecraft:saturation 1 1 true`,
        );
        break;
      case "teleport":
        if (!String(payload.destination ?? "").trim()) {
          throw new Error("Teleport destination is required.");
        }
        await this.sendCommand(
          serverId,
          `tp ${liveCommandTarget} ${String(payload.destination).trim()}`,
        );
        break;
      default:
        throw new Error(`Unsupported player action: ${action}`);
    }

    this.appendLog(serverId, "panel", `Player action "${action}" applied to ${normalized}.`);
    return this.getPlayers(serverId);
  }

  async searchCatalog(serverId, payload = {}) {
    const context = this.getServerContext(serverId);
    const kind = payload.kind === "mod" ? "mod" : "plugin";
    this.assertAssetCompatibility(context, kind, {
      profileId: String(payload.profileId ?? "").trim() || null,
    });
    const gameVersion =
      String(payload.gameVersion ?? this.getServerGameVersion(serverId) ?? "").trim() || null;

    const result = await searchCatalogProjects({
      kind,
      query: payload.query,
      profileId: String(payload.profileId ?? "").trim() || null,
      serverSoftware: this.getEffectiveServerSoftwareId(context),
      gameVersion,
      limit: Math.max(1, Math.min(24, Number(payload.limit ?? 12) || 12)),
      index: String(payload.index ?? "relevance"),
    });

    this.appendLog(
      serverId,
      "panel",
      `Catalog search returned ${result.results.length} ${kind} result(s).`,
    );
    return {
      kind,
      gameVersion,
      profile: result.profile,
      totalHits: result.totalHits,
      results: result.results,
    };
  }

  async installCatalogProject(serverId, payload = {}) {
    const context = this.getServerContext(serverId);
    const kind = payload.kind === "mod" ? "mod" : "plugin";
    const projectId = String(payload.projectId ?? "").trim();
    if (!projectId) {
      throw new Error("A catalog project ID is required.");
    }

    this.assertAssetCompatibility(context, kind, {
      profileId: String(payload.profileId ?? "").trim() || null,
    });

    const gameVersion =
      String(payload.gameVersion ?? this.getServerGameVersion(serverId) ?? "").trim() || null;
    const visited = new Set();
    const installChain = [];

    const installProject = async (targetProjectId, dependencyOf = null) => {
      const visitKey = `${kind}:${targetProjectId}`;
      if (visited.has(visitKey)) {
        return null;
      }
      visited.add(visitKey);

      const selection = await resolveCatalogInstall({
        projectId: targetProjectId,
        kind,
        profileId: String(payload.profileId ?? "").trim() || null,
        serverSoftware: this.getEffectiveServerSoftwareId(context),
        gameVersion,
      });

      this.assertAssetCompatibility(context, kind, {
        profileId: selection.profile?.id ?? payload.profileId ?? null,
      });

      for (const dependency of selection.dependencies ?? []) {
        if (dependency.type !== "required" || !dependency.projectId) {
          continue;
        }
        await installProject(dependency.projectId, selection.projectTitle ?? selection.fileName);
      }

      const installedTo = await this.installAssetFromUrl(serverId, kind, selection.fileUrl, {
        displayName: selection.projectTitle ?? selection.fileName,
        source: "catalog",
        iconUrl: selection.iconUrl,
        projectId: selection.projectId,
        projectSlug: selection.projectSlug,
        versionId: selection.versionId,
        versionNumber: selection.versionNumber,
        versionName: selection.versionName,
        profileId: selection.profile?.id ?? null,
        gameVersions: selection.gameVersions,
        loaders: selection.loaders,
        dependencyOf,
      });

      installChain.push({
        installedTo,
        selection,
      });
      return selection;
    };

    const selection = await installProject(projectId, null);
    const installedTo =
      installChain.find((entry) => entry.selection.projectId === projectId)?.installedTo ?? null;

    this.appendLog(
      serverId,
      "panel",
      `Installed ${installChain.length} ${kind} add-on file(s). Restart the server before they will appear in game.`,
    );
    return {
      installedTo,
      selection,
      installed: installChain,
    };
  }

  getAssetDirectory(context, kind) {
    if (kind === "plugin") {
      return context.paths.pluginsDir;
    }

    if (kind === "mod") {
      return context.paths.modsDir;
    }

    throw new Error("Asset kind must be either plugin or mod.");
  }

  async listAssets(serverId, kind) {
    const context = this.getServerContext(serverId);
    const label = kindLabel(kind);
    const targetDir = this.getAssetDirectory(context, label);
    const assetIndex = await this.loadAssetIndex(serverId);
    try {
      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile())
        .sort((left, right) => left.name.localeCompare(right.name));
      const output = [];
      for (const entry of files) {
        const filePath = path.join(targetDir, entry.name);
        const stats = await fs.stat(filePath);
        const meta = assetIndex[label][entry.name] ?? {};
        output.push({
          name: entry.name,
          displayName: meta.displayName ?? entry.name,
          iconUrl: meta.iconUrl ?? null,
          source: meta.source ?? "upload",
          versionNumber: meta.versionNumber ?? null,
          versionName: meta.versionName ?? null,
          projectId: meta.projectId ?? null,
          projectSlug: meta.projectSlug ?? null,
          loaders: meta.loaders ?? [],
          gameVersions: meta.gameVersions ?? [],
          dependencyOf: meta.dependencyOf ?? null,
          restartRequired: Boolean(meta.restartRequired),
          restartReason: meta.restartReason ?? null,
          installedAt: meta.installedAt ?? stats.birthtime?.toISOString?.() ?? stats.mtime.toISOString(),
          size: stats.size,
          updatedAt: stats.mtime.toISOString(),
          path: filePath,
        });
      }
      return output;
    } catch {
      return [];
    }
  }

  async installAssetUpload(serverId, kind, fileName, bytes, metadata = {}) {
    const context = this.getServerContext(serverId);
    const label = kindLabel(kind);
    this.assertAssetCompatibility(context, label, metadata);
    const safeName = sanitizeAssetFilename(fileName);
    const targetDir = this.getAssetDirectory(context, label);
    const targetPath = path.join(targetDir, safeName);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetPath, Buffer.from(bytes));
    await this.rememberInstalledAsset(serverId, label, safeName, {
      ...metadata,
      installedAt: currentTimestamp(),
      restartRequired: true,
      restartReason: "Restart the Minecraft server before this add-on will appear in game.",
    });
    this.appendLog(
      serverId,
      "panel",
      `Installed ${label} file ${safeName}. Restart the server before it will appear in game.`,
    );
    return targetPath;
  }

  async installAssetFromUrl(serverId, kind, url, metadata = {}) {
    const normalizedUrl = String(url ?? "").trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      throw new Error("Asset URL must start with http:// or https://");
    }

    const response = await fetch(normalizedUrl, {
      headers: {
        "User-Agent": "localhost-minecraft-panel/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Unable to download ${kind} file (${response.status}).`);
    }

    const fileName =
      parseFilenameFromDisposition(response.headers.get("content-disposition")) ??
      inferFilenameFromUrl(normalizedUrl) ??
      `${kind}.jar`;

    return this.installAssetUpload(serverId, kind, fileName, await response.arrayBuffer(), {
      ...metadata,
      addedFromUrl: normalizedUrl,
      source: metadata.source ?? "url",
    });
  }

  async removeAsset(serverId, kind, fileName) {
    const context = this.getServerContext(serverId);
    const label = kindLabel(kind);
    const safeName = sanitizeAssetFilename(fileName);
    const targetPath = path.join(this.getAssetDirectory(context, label), safeName);
    await fs.rm(targetPath, { force: true });
    await this.forgetInstalledAsset(serverId, label, safeName);
    this.appendLog(serverId, "panel", `Removed ${label} file ${safeName}.`);
    return this.listAssets(serverId, label);
  }
}
