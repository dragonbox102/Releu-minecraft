import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { Readable } from "node:stream";

import { currentTimestamp, fileExists, paths, readJsonFile } from "./config.js";
import {
  getDefaultUpdaterAssetName,
  isMac,
  isLinux,
  isWindows,
} from "./platform.js";

const GITHUB_API_ROOT = "https://api.github.com/repos";

function normalizeVersion(value) {
  return String(value ?? "")
    .trim()
    .replace(/^v/i, "");
}

function compareVersions(leftValue, rightValue) {
  const left = normalizeVersion(leftValue).split(/[.-]/);
  const right = normalizeVersion(rightValue).split(/[.-]/);
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftToken = left[index] ?? "0";
    const rightToken = right[index] ?? "0";
    const leftNumber = Number(leftToken);
    const rightNumber = Number(rightToken);

    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
      continue;
    }

    const result = leftToken.localeCompare(rightToken, undefined, { numeric: true });
    if (result !== 0) {
      return result;
    }
  }

  return 0;
}

async function readCurrentVersion() {
  const packageJson = await readJsonFile(path.join(paths.snapshotRootDir, "package.json"), {
    version: "0.0.0",
  });
  return normalizeVersion(packageJson.version) || "0.0.0";
}

function pickReleaseAsset(release, preferredAssetName) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const preferred = assets.find(
    (asset) => String(asset.name ?? "").toLowerCase() === String(preferredAssetName ?? "").toLowerCase(),
  );
  if (preferred) {
    return preferred;
  }

  const fallbackExtension = isWindows ? ".exe" : isLinux ? ".appimage" : isMac ? ".zip" : "";
  if (fallbackExtension) {
    return (
      assets.find((asset) =>
        String(asset.name ?? "").toLowerCase().endsWith(fallbackExtension),
      ) ?? null
    );
  }

  return null;
}

function parsePendingUpdateVersion(fileName, assetName) {
  const normalizedFileName = String(fileName ?? "").trim();
  const normalizedAssetName = path.basename(String(assetName ?? "").trim());
  if (!normalizedFileName || !normalizedAssetName) {
    return null;
  }

  const suffix = `-${normalizedAssetName}`;
  if (!normalizedFileName.toLowerCase().endsWith(suffix.toLowerCase())) {
    return null;
  }

  const version = normalizedFileName.slice(0, -suffix.length);
  return normalizeVersion(version) || null;
}

export class AppUpdater {
  constructor({ appendLog, getPanelConfig, hasRunningServers }) {
    this.appendLog = appendLog;
    this.getPanelConfig = getPanelConfig;
    this.hasRunningServers = hasRunningServers;
    this.state = {
      supported: isWindows || isLinux || isMac,
      currentVersion: "0.0.0",
      configured: false,
      enabled: false,
      autoInstall: true,
      checking: false,
      downloading: false,
      available: false,
      updateReady: false,
      applying: false,
      latestVersion: null,
      assetName: null,
      releasePageUrl: null,
      stagedFilePath: null,
      stagedVersion: null,
      downloadedBytes: 0,
      totalBytes: 0,
      speedBytesPerSecond: 0,
      lastCheckedAt: null,
      lastError: null,
      statusMessage: "GitHub updates are not configured.",
      githubOwner: "",
      githubRepo: "",
    };
  }

  async init() {
    this.state.currentVersion = await readCurrentVersion();
    this.syncConfig();
    await fs.mkdir(paths.updatesDir, { recursive: true });
    await fs.mkdir(paths.updateCacheDir, { recursive: true });
    await fs.mkdir(paths.updatePendingDir, { recursive: true });
    await this.restorePendingUpdate();
    await this.cleanupAppliedStagedUpdate();
  }

  syncConfig() {
    const config = this.getPanelConfig()?.updater ?? {};
    this.state.enabled = Boolean(config.enabled);
    this.state.autoInstall = Boolean(config.autoInstall ?? true);
    this.state.githubOwner = String(config.githubOwner ?? "").trim();
    this.state.githubRepo = String(config.githubRepo ?? "").trim();
    this.state.assetName =
      String(config.assetName ?? getDefaultUpdaterAssetName()).trim() ||
      getDefaultUpdaterAssetName();
    this.state.configured = Boolean(this.state.githubOwner && this.state.githubRepo);
    if (!this.state.configured) {
      this.state.available = false;
      this.state.updateReady = false;
      this.state.releasePageUrl = null;
      this.state.latestVersion = null;
      this.state.stagedFilePath = null;
      this.state.stagedVersion = null;
      this.state.statusMessage = "GitHub updates are not configured.";
    }
  }

  snapshot() {
    this.syncConfig();
    return {
      ...this.state,
      canAutoApply: this.canAutoApply(),
    };
  }

  async cleanupAppliedStagedUpdate() {
    const stagedVersion = normalizeVersion(this.state.stagedVersion);
    if (!stagedVersion) {
      return;
    }

    if (compareVersions(this.state.currentVersion, stagedVersion) < 0) {
      return;
    }

    if (this.state.stagedFilePath && (await fileExists(this.state.stagedFilePath))) {
      await fs.rm(this.state.stagedFilePath, { force: true }).catch(() => {});
    }

    this.state.updateReady = false;
    this.state.stagedFilePath = null;
    this.state.stagedVersion = null;
    this.state.downloadedBytes = 0;
    this.state.totalBytes = 0;
    this.state.speedBytesPerSecond = 0;
  }

  async restorePendingUpdate() {
    await fs.mkdir(paths.updatePendingDir, { recursive: true });
    const entries = await fs.readdir(paths.updatePendingDir, {
      withFileTypes: true,
    }).catch(() => []);

    let bestCandidate = null;
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      if (entry.name.endsWith(".download")) {
        await fs.rm(path.join(paths.updatePendingDir, entry.name), {
          force: true,
        }).catch(() => {});
        continue;
      }

      const version = parsePendingUpdateVersion(entry.name, this.state.assetName);
      if (!version) {
        continue;
      }

      const absolutePath = path.join(paths.updatePendingDir, entry.name);
      if (compareVersions(version, this.state.currentVersion) <= 0) {
        await fs.rm(absolutePath, { force: true }).catch(() => {});
        continue;
      }

      if (!bestCandidate || compareVersions(version, bestCandidate.version) > 0) {
        bestCandidate = {
          version,
          filePath: absolutePath,
        };
      }
    }

    if (!bestCandidate) {
      return;
    }

    this.state.available = true;
    this.state.updateReady = true;
    this.state.latestVersion = bestCandidate.version;
    this.state.stagedVersion = bestCandidate.version;
    this.state.stagedFilePath = bestCandidate.filePath;
    this.state.statusMessage =
      `Update ${bestCandidate.version} is already downloaded and ready to install.`;
  }

  async maybeCheckForUpdates() {
    this.syncConfig();
    if (!this.state.supported || !this.state.enabled || !this.state.configured) {
      return this.snapshot();
    }

    const intervalHours = Math.max(
      1,
      Number(this.getPanelConfig()?.updater?.checkIntervalHours ?? 6) || 6,
    );
    const intervalMs = intervalHours * 60 * 60 * 1000;
    const lastCheckedAtMs = Date.parse(this.state.lastCheckedAt ?? "");
    if (Number.isFinite(lastCheckedAtMs) && Date.now() - lastCheckedAtMs < intervalMs) {
      return this.snapshot();
    }

    return this.checkForUpdates();
  }

  async checkForUpdates() {
    this.syncConfig();
    if (!this.state.supported) {
      this.state.statusMessage = "App self-update is not supported on this platform.";
      return this.snapshot();
    }

    if (!this.state.enabled) {
      this.state.statusMessage = "App updates are turned off.";
      return this.snapshot();
    }

    if (!this.state.configured) {
      this.state.statusMessage = "Enter a GitHub owner and repo to enable updates.";
      return this.snapshot();
    }

    if (this.state.checking || this.state.downloading) {
      return this.snapshot();
    }

    this.state.checking = true;
    this.state.lastError = null;
    this.state.statusMessage = "Checking GitHub for a newer Releu release.";

    try {
      const release = await this.fetchRelease();
      const latestVersion =
        normalizeVersion(release.tag_name) ||
        normalizeVersion(release.name) ||
        this.state.currentVersion;
      const asset = pickReleaseAsset(release, this.state.assetName);

      this.state.lastCheckedAt = currentTimestamp();
      this.state.latestVersion = latestVersion;
      this.state.releasePageUrl = String(release.html_url ?? "").trim() || null;

      if (!asset) {
        this.state.available = false;
        this.state.updateReady = false;
        this.state.stagedFilePath = null;
        this.state.stagedVersion = null;
        this.state.statusMessage =
          `GitHub release ${latestVersion} was found, but no ${this.state.assetName} asset was attached.`;
        return this.snapshot();
      }

      if (compareVersions(latestVersion, this.state.currentVersion) <= 0) {
        this.state.available = false;
        this.state.statusMessage = `Releu is already up to date on ${this.state.currentVersion}.`;
        await this.cleanupAppliedStagedUpdate();
        return this.snapshot();
      }

      this.state.available = true;
      this.state.statusMessage = `Update ${latestVersion} is available on GitHub.`;

      if (this.state.autoInstall) {
        await this.downloadAndStageUpdate(asset, latestVersion);
      }
    } catch (error) {
      this.state.lastError = error.message ?? String(error);
      this.state.statusMessage = this.state.lastError;
    } finally {
      this.state.checking = false;
    }

    return this.snapshot();
  }

  async fetchRelease() {
    const config = this.getPanelConfig()?.updater ?? {};
    const owner = encodeURIComponent(String(config.githubOwner ?? "").trim());
    const repo = encodeURIComponent(String(config.githubRepo ?? "").trim());
    const allowPrerelease = Boolean(config.allowPrerelease);
    const endpoint = allowPrerelease
      ? `${GITHUB_API_ROOT}/${owner}/${repo}/releases?per_page=10`
      : `${GITHUB_API_ROOT}/${owner}/${repo}/releases/latest`;

    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "releu-minecraft-updater",
      },
    });

    if (!response.ok) {
      throw new Error(`Unable to check GitHub releases (${response.status}).`);
    }

    if (allowPrerelease) {
      const releases = await response.json();
      const release = Array.isArray(releases)
        ? releases.find((entry) => !entry.draft)
        : null;
      if (!release) {
        throw new Error("No usable GitHub releases were found.");
      }
      return release;
    }

    return response.json();
  }

  async downloadAndStageUpdate(asset, version) {
    if (this.state.downloading) {
      return this.snapshot();
    }

    const normalizedVersion = normalizeVersion(version);
    const finalName = `${normalizedVersion}-${path.basename(asset.name)}`;
    const finalPath = path.join(paths.updatePendingDir, finalName);
    const tempPath = `${finalPath}.download`;

    if (await fileExists(finalPath)) {
      this.state.updateReady = true;
      this.state.stagedVersion = normalizedVersion;
      this.state.stagedFilePath = finalPath;
      this.state.statusMessage = `Update ${normalizedVersion} is downloaded and ready to install.`;
      return this.snapshot();
    }

    this.state.downloading = true;
    this.state.downloadedBytes = 0;
    this.state.totalBytes = 0;
    this.state.speedBytesPerSecond = 0;
    this.state.statusMessage = `Downloading Releu ${normalizedVersion} from GitHub.`;

    const response = await fetch(asset.browser_download_url, {
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "releu-minecraft-updater",
      },
    });

    if (!response.ok) {
      this.state.downloading = false;
      throw new Error(`Unable to download Releu update (${response.status}).`);
    }

    await fs.mkdir(paths.updatePendingDir, { recursive: true });
    await fs.rm(tempPath, { force: true }).catch(() => {});

    const output = createWriteStream(tempPath);
    const totalBytes = Number(response.headers.get("content-length")) || 0;
    const startedAt = Date.now();

    try {
      for await (const chunk of Readable.fromWeb(response.body)) {
        const buffer = Buffer.from(chunk);
        this.state.downloadedBytes += buffer.length;
        this.state.totalBytes = totalBytes;
        this.state.speedBytesPerSecond =
          this.state.downloadedBytes / Math.max(0.25, (Date.now() - startedAt) / 1000);
        if (!output.write(buffer)) {
          await once(output, "drain");
        }
      }

      await new Promise((resolve, reject) => {
        output.end((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      await fs.rename(tempPath, finalPath);
      if (isLinux) {
        await fs.chmod(finalPath, 0o755).catch(() => {});
      }
      this.state.updateReady = true;
      this.state.stagedVersion = normalizedVersion;
      this.state.stagedFilePath = finalPath;
      this.state.statusMessage = `Update ${normalizedVersion} is ready. Releu will restart to finish updating.`;
      this.appendLog(
        "panel",
        `Downloaded Releu update ${normalizedVersion} to ${finalPath}.`,
      );
    } catch (error) {
      output.destroy();
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      this.state.downloading = false;
    }

    return this.snapshot();
  }

  async markApplying() {
    this.state.applying = true;
    this.state.statusMessage = `Applying Releu update ${this.state.stagedVersion ?? this.state.latestVersion ?? ""}`.trim();
    return this.snapshot();
  }

  canAutoApply() {
    return Boolean(
      this.state.supported &&
      this.state.autoInstall &&
      this.state.updateReady &&
      this.state.stagedFilePath &&
      !this.hasRunningServers(),
    );
  }
}
