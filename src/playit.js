import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import https from "node:https";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Readable } from "node:stream";

import {
  currentTimestamp,
  fileExists,
  paths,
  readJsonFile,
  sanitizeLogLine,
  writeJsonFile,
} from "./config.js";
import {
  getPlayitAssetCandidates,
  isWindows,
  runtimePlatform,
  withHiddenConsole,
} from "./platform.js";

const PLAYIT_RELEASES_URL =
  "https://api.github.com/repos/playit-cloud/playit-agent/releases/latest";
const PLAYIT_API_BASE = "https://api.playit.gg";

function extractUiMessage(rawLine) {
  const cleaned = sanitizeLogLine(rawLine);
  if (!cleaned) {
    return "";
  }

  const marker = "playit_cli::ui:";
  const index = cleaned.indexOf(marker);
  if (index >= 0) {
    return cleaned.slice(index + marker.length).trim();
  }

  return cleaned;
}

function maybeExtractSecret(rawLine) {
  const message = extractUiMessage(rawLine);
  if (!message) {
    return null;
  }

  if (/^[A-Za-z0-9._-]{20,}$/.test(message)) {
    return message;
  }

  const lastToken = message.split(/\s+/).at(-1);
  return /^[A-Za-z0-9._-]{20,}$/.test(lastToken) ? lastToken : null;
}

function parseTunnelLine(rawLine) {
  const message = extractUiMessage(rawLine);
  const match = message.match(/^\[(.+?)\]\s+(\S+)\s+(\d+)\s+(.+)$/);
  if (!match) {
    return null;
  }

  return {
    id: match[1],
    protocol: match[2],
    portCount: Number(match[3]),
    publicAddress: match[4],
    raw: message,
  };
}

function extractTunnelCount(rawLine) {
  const message = extractUiMessage(rawLine);
  const match =
    message.match(/agent has (\d+) tunnels/i) ??
    message.match(/(\d+) tunnels registered/i);
  return match ? Number(match[1]) : null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maybeExtractClaimUrl(rawLine) {
  const message = extractUiMessage(rawLine);
  const match = message.match(/https:\/\/playit\.gg\/claim\/[A-Za-z0-9._-]+/i);
  return match?.[0] ?? null;
}

function getTunnelFieldValue(fields, name) {
  return (
    fields?.find(
      (entry) => String(entry?.name ?? "").toLowerCase() === String(name).toLowerCase(),
    )?.value ?? null
  );
}

function parsePortNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function preferredConnectAddress(addresses) {
  const values = (addresses ?? [])
    .map((entry) => entry?.value?.address ?? null)
    .filter(Boolean);

  return (
    values.find((entry) => /\.joinmc\.link(?::\d+)?$/i.test(entry)) ??
    values.find((entry) => !entry.includes(":")) ??
    values[0] ??
    null
  );
}

function normalizeApiTunnel(accountTunnel, agentTunnel = null) {
  const origin =
    accountTunnel?.origin?.type === "agent" ? accountTunnel.origin.details ?? null : null;
  const originFields = origin?.config_data?.fields ?? [];
  const agentFields = agentTunnel?.agent_config?.fields ?? [];
  const localPort =
    parsePortNumber(getTunnelFieldValue(originFields, "local_port")) ??
    parsePortNumber(getTunnelFieldValue(agentFields, "local_port"));
  const localIp =
    getTunnelFieldValue(originFields, "local_ip") ??
    getTunnelFieldValue(agentFields, "local_ip") ??
    null;
  const publicAddress =
    preferredConnectAddress(accountTunnel?.connect_addresses) ??
    agentTunnel?.display_address ??
    null;

  return {
    id: String(accountTunnel?.id ?? agentTunnel?.id ?? publicAddress ?? "unknown-tunnel"),
    protocol: accountTunnel?.port_type ?? agentTunnel?.port_type ?? "tcp",
    portCount: Number(accountTunnel?.port_count ?? agentTunnel?.port_count ?? 1),
    publicAddress,
    raw: publicAddress ?? agentTunnel?.display_address ?? "",
    localIp,
    localPort,
    tunnelType: accountTunnel?.tunnel_type ?? agentTunnel?.tunnel_type ?? null,
    displayAddress: agentTunnel?.display_address ?? null,
    offlineReasons: accountTunnel?.offline_reasons ?? [],
    disabledReason: accountTunnel?.disabled_reason ?? agentTunnel?.disabled_reason ?? null,
    addresses: (accountTunnel?.connect_addresses ?? [])
      .map((entry) => entry?.value?.address ?? null)
      .filter(Boolean),
  };
}

export class PlayitManager {
  constructor({ appendLog, getServerPort }) {
    this.appendLog = appendLog;
    this.getServerPort = getServerPort;
    this.agentProcess = null;
    this.exchangeProcess = null;
    this.probeProcess = null;
    this.refreshPromise = null;
    this.probePromise = null;
    this.lastAnnouncedPublicAddress = null;
    this.lastAnnouncedTunnelState = null;
    this.state = {
      installed: false,
      version: null,
      running: false,
      status: "not-installed",
      secretConfigured: false,
      claimCode: null,
      claimUrl: null,
      claimWaiting: false,
      tunnels: [],
      configuredTunnelCount: 0,
      detectedTunnelCount: 0,
      checkingTunnelStatus: false,
      needsWebSetup: false,
      statusMessage: null,
      dashboardTunnelUrl: "https://playit.gg/account/tunnels",
      newTunnelUrl: "https://playit.gg/account/setup/new-tunnel",
      lastError: null,
      lastStartedAt: null,
      lastExitedAt: null,
      lastRefreshAt: null,
      lastProbeAt: null,
      recommendedTunnelTarget: `127.0.0.1:${this.getServerPort()}`,
    };
    this.lastRefreshAtMs = 0;
    this.lastProbeAtMs = 0;
  }

  async init() {
    this.state.installed = await fileExists(paths.playitBinary);
    this.state.secretConfigured = await fileExists(paths.playitSecretFile);
    if (this.state.installed) {
      try {
        const versionOutput = await this.runCommand(["version"]);
        this.state.version = extractUiMessage(versionOutput.stdout)
          .split(/\s+/)
          .at(-1);
      } catch {
        this.state.version = null;
      }
    }
    const claimInfo = await readJsonFile(paths.claimInfoFile, {});
    this.state.claimCode = claimInfo.claimCode ?? null;
    this.state.claimUrl = claimInfo.claimUrl ?? null;
    this.state.claimWaiting = false;
    this.state.status = this.state.installed
      ? this.state.secretConfigured
        ? "ready"
        : "needs-claim"
      : "not-installed";
    if (this.state.secretConfigured) {
      this.state.checkingTunnelStatus = true;
      this.state.statusMessage = "Checking linked playit agent and tunnel status.";
      this.refreshTunnels({ force: true }).catch((error) => {
        this.state.lastError = error.message;
        this.state.checkingTunnelStatus = false;
      });
    }
  }

  snapshot() {
    return {
      ...this.state,
      recommendedTunnelTarget: `127.0.0.1:${this.getServerPort()}`,
    };
  }

  async persistClaimInfo(claimUrl) {
    const normalizedUrl = String(claimUrl ?? "").trim();
    if (!normalizedUrl) {
      return;
    }

    const claimCode = normalizedUrl.split("/").filter(Boolean).at(-1) ?? null;
    this.state.claimCode = claimCode;
    this.state.claimUrl = normalizedUrl;
    this.state.claimWaiting = true;
    this.state.status = "waiting-for-claim";
    this.state.statusMessage =
      "Playit setup is waiting for you to finish the browser link.";
    await writeJsonFile(paths.claimInfoFile, {
      claimCode,
      claimUrl: normalizedUrl,
      createdAt: currentTimestamp(),
    });
  }

  async syncSecretStateFromDisk() {
    const secretConfigured = await fileExists(paths.playitSecretFile);
    if (!secretConfigured || this.state.secretConfigured) {
      return secretConfigured;
    }

    this.state.secretConfigured = true;
    this.state.claimWaiting = false;
    this.state.status = this.state.running ? "running" : "ready";
    this.state.lastError = null;
    this.state.statusMessage = "Playit agent linked successfully.";
    this.appendLog("playit", "Stored playit secret locally from playit setup.");
    return true;
  }

  async readSecret() {
    const secret = await fs.readFile(paths.playitSecretFile, "utf8");
    const normalized = String(secret ?? "").trim();
    if (!normalized) {
      throw new Error("No playit secret is configured yet.");
    }
    return normalized;
  }

  async requestApi(endpoint, payload = {}) {
    const secret = await this.readSecret();
    const requestBody = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const request = https.request(
        new URL(`${PLAYIT_API_BASE}${endpoint}`),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(requestBody),
            "User-Agent": "Releu/1.0",
            Authorization: `Agent-Key ${secret}`,
          },
        },
        (response) => {
          let bodyText = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            bodyText += chunk;
          });
          response.on("end", () => {
            const statusCode = Number(response.statusCode ?? 0);
            if (statusCode < 200 || statusCode >= 300) {
              reject(
                new Error(
                  `playit API request failed (${statusCode}): ${bodyText.trim() || "empty response"}`,
                ),
              );
              return;
            }

            let body = null;
            try {
              body = JSON.parse(bodyText);
            } catch {
              reject(new Error(`playit API returned invalid JSON for ${endpoint}.`));
              return;
            }

            if (body?.status !== "success") {
              reject(
                new Error(body?.error?.message ?? `playit API request failed for ${endpoint}.`),
              );
              return;
            }

            resolve(body.data ?? null);
          });
        },
      );

      request.on("error", reject);
      request.write(requestBody);
      request.end();
    });
  }

  async fetchTunnelStateFromApi() {
    const [runData, tunnelData] = await Promise.all([
      this.requestApi("/v1/agents/rundata"),
      this.requestApi("/v1/tunnels/list"),
    ]);

    const agentTunnelMap = new Map(
      (runData?.tunnels ?? []).map((entry) => [String(entry.id), entry]),
    );
    const tunnels = (tunnelData?.tunnels ?? []).map((entry) =>
      normalizeApiTunnel(entry, agentTunnelMap.get(String(entry.id)) ?? null),
    );
    const pendingCount = Number(runData?.pending?.length ?? 0);
    const configuredTunnelCount = tunnels.length + pendingCount;
    const matchedPublicTunnel =
      tunnels.find(
        (entry) =>
          entry.publicAddress &&
          Number(entry.localPort ?? 0) === Number(this.getServerPort()),
      ) ??
      tunnels.find((entry) => entry.publicAddress) ??
      null;

    let statusMessage = null;
    let needsWebSetup = false;
    if (matchedPublicTunnel?.publicAddress) {
      statusMessage = `Detected ${tunnels.length} playit tunnel(s). Public address: ${matchedPublicTunnel.publicAddress}`;
    } else if (configuredTunnelCount === 0) {
      statusMessage = this.describeMissingTunnel();
    } else {
      needsWebSetup = true;
      statusMessage = this.describeUnreadyTunnel();
    }

    return {
      tunnels,
      configuredTunnelCount,
      detectedTunnelCount: runData?.tunnels?.length ?? tunnels.length,
      needsWebSetup,
      statusMessage,
    };
  }

  describeMissingTunnel() {
    return `No playit tunnel is assigned to this agent yet. Create or assign a Minecraft Java tunnel for 127.0.0.1:${this.getServerPort()} in the playit dashboard.`;
  }

  describeUnreadyTunnel() {
    return `Playit found a tunnel for this agent, but it has not finished setup yet, so no public join address is available. Open the playit dashboard and finish assigning or configuring the tunnel for 127.0.0.1:${this.getServerPort()}.`;
  }

  announceTunnelState() {
    const publicAddress = this.state.tunnels.find((entry) => entry.publicAddress)?.publicAddress ?? null;
    if (publicAddress && publicAddress !== this.lastAnnouncedPublicAddress) {
      this.lastAnnouncedPublicAddress = publicAddress;
      this.appendLog("playit", `Minecraft public address ready: ${publicAddress}`);
    }

    const stateKey = [
      publicAddress ?? "",
      this.state.configuredTunnelCount,
      this.state.needsWebSetup ? "setup" : "ready",
      this.state.statusMessage ?? "",
    ].join("|");

    if (stateKey === this.lastAnnouncedTunnelState) {
      return;
    }
    this.lastAnnouncedTunnelState = stateKey;

    if (!publicAddress && this.state.configuredTunnelCount > 0 && this.state.needsWebSetup) {
      this.appendLog("playit", this.describeUnreadyTunnel(), "warn");
    }
  }

  observeLine(rawLine) {
    const cleaned = sanitizeLogLine(rawLine);
    if (!cleaned) {
      return;
    }

    const claimUrl = maybeExtractClaimUrl(cleaned);
    if (claimUrl) {
      void this.persistClaimInfo(claimUrl);
    }

    const tunnel = parseTunnelLine(cleaned);
    if (tunnel) {
      this.state.checkingTunnelStatus = false;
      const existingIndex = this.state.tunnels.findIndex((entry) => entry.id === tunnel.id);
      if (existingIndex >= 0) {
        this.state.tunnels.splice(existingIndex, 1, tunnel);
      } else {
        this.state.tunnels.push(tunnel);
      }
      this.state.detectedTunnelCount = Math.max(
        this.state.detectedTunnelCount,
        this.state.tunnels.length,
      );
      this.state.configuredTunnelCount = Math.max(
        this.state.configuredTunnelCount,
        this.state.tunnels.length,
      );
      this.state.needsWebSetup = false;
      this.state.statusMessage =
        tunnel.publicAddress
          ? `Detected ${this.state.tunnels.length} playit tunnel(s). Public address: ${tunnel.publicAddress}`
          : `Detected ${this.state.tunnels.length} playit tunnel(s).`;
      this.announceTunnelState();
    }

    const tunnelCount = extractTunnelCount(cleaned);
    if (tunnelCount !== null) {
      this.state.checkingTunnelStatus = false;
      this.state.configuredTunnelCount = Math.max(
        this.state.configuredTunnelCount,
        tunnelCount,
      );
      this.state.detectedTunnelCount = Math.max(
        this.state.detectedTunnelCount,
        tunnelCount,
      );
      if (tunnelCount === 0) {
        this.state.needsWebSetup = true;
        this.state.statusMessage = this.describeMissingTunnel();
        this.announceTunnelState();
      }
    }

    if (cleaned.includes("SessionNotSetup")) {
      this.state.checkingTunnelStatus = false;
      this.state.needsWebSetup = true;
      this.state.statusMessage = this.describeUnreadyTunnel();
      this.announceTunnelState();
    }

    if (cleaned.includes("secret key valid")) {
      this.state.secretConfigured = true;
      this.state.claimWaiting = false;
      this.state.status = this.state.running ? "running" : "ready";
      this.state.lastError = null;
      if (this.state.configuredTunnelCount === 0 && !this.state.tunnels.length) {
        this.state.needsWebSetup = true;
        this.state.statusMessage = this.describeMissingTunnel();
      }
    }

    if (cleaned.includes("tunnel running")) {
      this.state.checkingTunnelStatus = false;
      this.state.statusMessage =
        this.state.needsWebSetup
          ? this.describeUnreadyTunnel()
          : this.state.configuredTunnelCount > 0 && !this.state.tunnels.length
          ? this.describeUnreadyTunnel()
          : this.state.configuredTunnelCount > 0
            ? `Playit is online and reports ${this.state.configuredTunnelCount} configured tunnel(s).`
            : "Playit is online.";
      this.announceTunnelState();
    }
  }

  async installBinary(onProgress = null) {
    const release = await this.fetchLatestRelease();
    const asset = this.pickPlatformAsset(release);
    const response = await fetch(asset.browser_download_url, {
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "localhost-minecraft-panel/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Unable to download playit agent (${response.status}).`);
    }

    await fs.mkdir(path.dirname(paths.playitBinary), { recursive: true });
    const tempPath = `${paths.playitBinary}.download`;
    await fs.rm(tempPath, { force: true }).catch(() => {});
    const output = createWriteStream(tempPath);
    const totalBytes = Number(response.headers.get("content-length")) || null;
    const startedAt = Date.now();
    let downloadedBytes = 0;

    try {
      for await (const chunk of Readable.fromWeb(response.body)) {
        const buffer = Buffer.from(chunk);
        downloadedBytes += buffer.length;
        if (!output.write(buffer)) {
          await once(output, "drain");
        }
        if (onProgress) {
          const elapsedSeconds = Math.max(0.25, (Date.now() - startedAt) / 1000);
          onProgress({
            fileName: asset.name,
            downloadedBytes,
            totalBytes,
            speedBytesPerSecond: downloadedBytes / elapsedSeconds,
          });
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
      await fs.rm(paths.playitBinary, { force: true }).catch(() => {});
      await fs.rename(tempPath, paths.playitBinary);
      if (!isWindows) {
        await fs.chmod(paths.playitBinary, 0o755);
      }
    } catch (error) {
      output.destroy();
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }

    this.state.installed = true;
    this.state.version = release.tag_name ?? null;
    this.state.status = this.state.secretConfigured ? "ready" : "needs-claim";
    this.appendLog(
      "playit",
      `Installed playit agent ${this.state.version ?? "latest"} to ${paths.playitBinary}.`,
    );

    return this.snapshot();
  }

  async fetchLatestRelease() {
    const response = await fetch(PLAYIT_RELEASES_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "localhost-minecraft-panel/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Unable to fetch playit release metadata (${response.status}).`);
    }

    return response.json();
  }

  pickPlatformAsset(release) {
    const preferredAssetNames = getPlayitAssetCandidates();

    const asset = preferredAssetNames
      .map((name) => release.assets?.find((entry) => entry.name === name))
      .find(Boolean);

    if (!asset) {
      throw new Error(
        `No supported ${runtimePlatform} playit executable was found in the latest release.`,
      );
    }

    return asset;
  }

  async saveSecret(secret) {
    const normalized = String(secret ?? "").trim();
    if (!normalized) {
      throw new Error("A playit secret is required.");
    }

    await fs.mkdir(paths.playitDataDir, { recursive: true });
    await fs.writeFile(paths.playitSecretFile, `${normalized}\n`, "utf8");
    this.state.secretConfigured = true;
    this.state.claimWaiting = false;
    this.state.status = this.state.running ? "running" : "ready";
    this.state.lastError = null;
    this.state.statusMessage = "Secret saved. Start the agent to refresh tunnel status.";
    this.appendLog("playit", "Stored playit secret locally for this project.");
    return this.snapshot();
  }

  async generateClaim(_agentName) {
    await this.ensureBinary();
    await this.startAgent({ allowSetup: true });

    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (this.state.claimUrl) {
        this.appendLog("playit", `Generated playit claim URL: ${this.state.claimUrl}`);
        return this.snapshot();
      }
      await wait(250);
    }

    throw new Error("playit did not provide a claim link in time.");
  }

  startClaimExchange(claimCode) {
    if (this.exchangeProcess) {
      this.exchangeProcess.kill();
      this.exchangeProcess = null;
    }

    const child = spawn(
      paths.playitBinary,
      ["--stdout", "claim", "exchange", claimCode, "--wait", "0"],
      withHiddenConsole({
        cwd: paths.playitDataDir,
      }),
    );

    this.exchangeProcess = child;
    let settled = false;

    const handleLine = async (line) => {
      const cleaned = sanitizeLogLine(line);
      if (!cleaned) {
        return;
      }

      this.appendLog("playit", cleaned);
      const secret = maybeExtractSecret(cleaned);
      if (!secret) {
        return;
      }

      settled = true;
      await this.saveSecret(secret);
      try {
        await this.startAgent();
      } catch (error) {
        this.state.lastError = error.message;
      }
      this.state.claimWaiting = false;
      this.state.status = this.state.running ? "running" : "ready";
      if (this.exchangeProcess) {
        this.exchangeProcess.kill();
        this.exchangeProcess = null;
      }
    };

    child.stdout.on("data", async (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        await handleLine(line);
      }
    });

    child.stderr.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const cleaned = sanitizeLogLine(line);
        if (cleaned) {
          this.appendLog("playit", cleaned, "error");
        }
      }
    });

    child.on("exit", (code) => {
      this.exchangeProcess = null;
      if (!settled && this.state.claimWaiting) {
        this.appendLog(
          "playit",
          `Claim exchange stopped before a secret was returned (exit ${code ?? "unknown"}).`,
          "warn",
        );
      }
    });
  }

  async startAgent({ allowSetup = false } = {}) {
    await this.ensureBinary();
    const secretConfigured = await fileExists(paths.playitSecretFile);
    if (!secretConfigured && !allowSetup) {
      throw new Error("No playit secret is configured yet.");
    }

    if (this.agentProcess) {
      return this.snapshot();
    }

    if (this.probeProcess && !this.probeProcess.killed) {
      this.probeProcess.kill();
    }

    const child = spawn(
      paths.playitBinary,
      ["--secret_path", paths.playitSecretFile, "--stdout", "start"],
      withHiddenConsole({
        cwd: paths.playitDataDir,
      }),
    );

    this.agentProcess = child;
    this.state.running = true;
    this.state.status = secretConfigured ? "running" : "waiting-for-claim";
    this.state.checkingTunnelStatus = true;
    this.state.statusMessage = secretConfigured
      ? "Checking linked playit agent and tunnel status."
      : "Starting playit setup and waiting for the claim link.";
    this.state.lastStartedAt = currentTimestamp();
    this.state.lastError = null;

    const handleLine = (line, level = "info") => {
      const cleaned = sanitizeLogLine(line);
      if (!cleaned) {
        return;
      }

      this.observeLine(cleaned);
      this.appendLog("playit", cleaned, level);
      void this.syncSecretStateFromDisk();
    };

    child.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        handleLine(line);
      }
    });

    child.stderr.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        handleLine(line, "error");
      }
    });

    child.on("exit", (code) => {
      this.agentProcess = null;
      this.state.running = false;
      this.state.status = this.state.secretConfigured
        ? this.state.needsWebSetup
          ? "needs-tunnel-setup"
          : "ready"
        : "needs-claim";
      this.state.lastExitedAt = currentTimestamp();
      if (code && code !== 0) {
        this.state.lastError = `playit exited with code ${code}.`;
      }
    });

    await wait(1200);
    await this.syncSecretStateFromDisk();
    if (this.state.secretConfigured) {
      await this.refreshTunnels({ force: true });
      if (this.state.needsWebSetup) {
        this.state.status = "needs-tunnel-setup";
      }
    }
    return this.snapshot();
  }

  async stopAgent() {
    if (!this.agentProcess) {
      this.state.running = false;
      this.state.status = this.state.secretConfigured
        ? this.state.needsWebSetup
          ? "needs-tunnel-setup"
          : "ready"
        : "needs-claim";
      return this.snapshot();
    }

    this.agentProcess.kill();
    this.agentProcess = null;
    this.state.running = false;
    this.state.status = this.state.secretConfigured
      ? this.state.needsWebSetup
        ? "needs-tunnel-setup"
        : "ready"
      : "needs-claim";
    return this.snapshot();
  }

  async refreshTunnels({ force = false } = {}) {
    if (!(await fileExists(paths.playitSecretFile)) || !(await fileExists(paths.playitBinary))) {
      this.state.tunnels = [];
      this.state.configuredTunnelCount = 0;
      this.state.detectedTunnelCount = 0;
      this.state.checkingTunnelStatus = false;
      this.state.needsWebSetup = false;
      this.state.statusMessage = null;
      return this.snapshot();
    }

    const now = Date.now();
    if (!force && now - this.lastRefreshAtMs < 8000) {
      return this.snapshot();
    }
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.lastRefreshAtMs = now;
    this.state.lastRefreshAt = currentTimestamp();
    this.state.checkingTunnelStatus = true;
    this.refreshPromise = (async () => {
      try {
        const apiState = await this.fetchTunnelStateFromApi();
        this.state.tunnels = apiState.tunnels;
        this.state.configuredTunnelCount = apiState.configuredTunnelCount;
        this.state.detectedTunnelCount = apiState.detectedTunnelCount;
        this.state.needsWebSetup = apiState.needsWebSetup;
        this.state.statusMessage = apiState.statusMessage;
        this.state.lastError = null;
        this.announceTunnelState();
      } catch (error) {
        if (
          String(error.message).includes("NotImplemented") ||
          String(error.message).includes("invalid JSON") ||
          String(error.message).includes("playit API request failed")
        ) {
          this.state.lastError = null;
          await this.probeTunnelStatus({ force });
        } else {
          this.state.lastError = error.message;
        }
      } finally {
        this.state.checkingTunnelStatus = Boolean(
          this.state.running &&
            !this.state.tunnels.length &&
            Number(this.state.configuredTunnelCount ?? 0) === 0 &&
            !this.state.needsWebSetup,
        );
        if (!this.state.running) {
          this.state.status = this.state.secretConfigured
            ? this.state.needsWebSetup
              ? "needs-tunnel-setup"
              : "ready"
            : "needs-claim";
        }
      }

      return this.snapshot();
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  async probeTunnelStatus({ force = false } = {}) {
    if (this.agentProcess) {
      return this.snapshot();
    }

    const now = Date.now();
    if (!force && now - this.lastProbeAtMs < 30000) {
      return this.snapshot();
    }
    if (this.probePromise) {
      return this.probePromise;
    }

    this.lastProbeAtMs = now;
    this.state.lastProbeAt = currentTimestamp();
    this.state.checkingTunnelStatus = true;
    this.probePromise = new Promise((resolve) => {
      const child = spawn(
        paths.playitBinary,
        ["--secret_path", paths.playitSecretFile, "--stdout", "start"],
        withHiddenConsole({
          cwd: paths.playitDataDir,
        }),
      );
      this.probeProcess = child;

      const timer = setTimeout(() => {
        if (!child.killed) {
          child.kill();
        }
      }, 22000);

      const consume = (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          const cleaned = sanitizeLogLine(line);
          if (!cleaned) {
            continue;
          }
          this.observeLine(cleaned);
        }
      };

      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      child.on("error", (error) => {
        this.state.lastError = error.message;
      });
      child.on("exit", () => {
        clearTimeout(timer);
        this.probeProcess = null;
        if (!this.state.tunnels.length) {
          if (this.state.configuredTunnelCount > 0) {
            this.state.needsWebSetup = true;
            this.state.statusMessage =
              this.state.statusMessage ??
              this.describeUnreadyTunnel();
          } else {
            this.state.needsWebSetup = true;
            this.state.statusMessage = this.describeMissingTunnel();
          }
        }
        this.state.checkingTunnelStatus = false;
        this.announceTunnelState();
        resolve(this.snapshot());
      });
    });
    return this.probePromise.finally(() => {
      this.probePromise = null;
    });
  }

  async reset() {
    await this.stopAgent();
    if (this.exchangeProcess) {
      this.exchangeProcess.kill();
      this.exchangeProcess = null;
    }

    await Promise.all(
      [
        fs.rm(paths.playitSecretFile, { force: true }),
        fs.rm(paths.claimInfoFile, { force: true }),
      ],
    );

    this.state.secretConfigured = false;
    this.state.claimCode = null;
    this.state.claimUrl = null;
    this.state.claimWaiting = false;
    this.state.tunnels = [];
    this.state.configuredTunnelCount = 0;
    this.state.detectedTunnelCount = 0;
    this.state.checkingTunnelStatus = false;
    this.state.needsWebSetup = false;
    this.state.statusMessage = null;
    this.lastAnnouncedPublicAddress = null;
    this.lastAnnouncedTunnelState = null;
    this.state.status = this.state.installed ? "needs-claim" : "not-installed";
    return this.snapshot();
  }

  async ensureBinary() {
    if (!(await fileExists(paths.playitBinary))) {
      throw new Error("playit is not installed yet.");
    }
  }

  async runCommand(commandArgs, options = {}) {
    await this.ensureBinary();
    const args = [];
    if (options.includeSecretPath) {
      args.push("--secret_path", paths.playitSecretFile);
    }
    args.push("--stdout", ...commandArgs);

    return new Promise((resolve, reject) => {
      const child = spawn(paths.playitBinary, args, {
        cwd: paths.playitDataDir,
        ...withHiddenConsole(),
      });

      let stdout = "";
      let stderr = "";
      let finished = false;
      const timeoutMs = options.timeoutMs ?? 20000;

      const timeout = setTimeout(() => {
        if (finished) {
          return;
        }
        finished = true;
        child.kill();
        reject(new Error("playit command timed out."));
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timeout);
        reject(error);
      });

      child.on("exit", (code) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timeout);

        if (code !== 0) {
          reject(new Error(stderr.trim() || stdout.trim() || `playit exited with code ${code}.`));
          return;
        }

        resolve({ stdout: sanitizeLogLine(stdout), stderr: sanitizeLogLine(stderr) });
      });
    });
  }
}
