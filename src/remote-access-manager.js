import {
  REMOTE_ACCESS_BASE_URL,
  getPublicRemoteAccessConfig,
  normalizeRemoteAccessConfig,
} from "./remote-access.js";
import { currentTimestamp } from "./config.js";

const REMOTE_HEARTBEAT_MS = 8000;
const REMOTE_COMMAND_POLL_MS = 1000;

function trimBaseUrl(value) {
  return String(value ?? REMOTE_ACCESS_BASE_URL).trim().replace(/\/+$/g, "");
}

function looksLikePanelState(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray(value.servers) &&
      Object.prototype.hasOwnProperty.call(value, "activeServerId"),
  );
}

function summarizeRemoteCommandResult(result, snapshot) {
  if (!looksLikePanelState(result)) {
    return result;
  }
  return {
    remoteStateRefreshed: true,
    activeServerId:
      String(snapshot?.activeServerId ?? result?.activeServerId ?? "").trim() || null,
    generatedAt: String(snapshot?.generatedAt ?? "").trim() || null,
  };
}

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(
      String(payload?.error ?? "").trim() ||
        `Remote access request failed (${response.status}).`,
    );
  }
  return payload;
}

export class RemoteAccessManager {
  constructor({ panel, appendLog }) {
    this.panel = panel;
    this.appendLog = appendLog;
    this.config = normalizeRemoteAccessConfig();
    this.heartbeatTimer = null;
    this.commandPollTimer = null;
    this.registered = false;
    this.online = false;
    this.brokerReachable = false;
    this.lastBrokerSyncAt = "";
    this.lastError = null;
    this.lastStatusMessage = "";
    this.syncInFlight = null;
    this.pollInFlight = null;
  }

  snapshot() {
    return {
      ...getPublicRemoteAccessConfig(this.config),
      online: this.online,
      brokerReachable: this.brokerReachable,
      lastBrokerSyncAt: this.lastBrokerSyncAt,
      lastError: this.lastError,
      status: !this.config.enabled
        ? "disabled"
        : this.online
          ? "online"
          : this.brokerReachable
            ? "waiting"
            : "offline",
      statusMessage: this.statusMessage(),
    };
  }

  statusMessage() {
    if (!this.config.enabled) {
      return "Remote access is disabled.";
    }
    if (this.lastError) {
      return this.lastError;
    }
    if (this.online) {
      return "Remote panel is online while Releu stays open.";
    }
    if (this.brokerReachable) {
      return "Remote panel is waiting for the next published snapshot.";
    }
    return "Remote relay has not reached releu.lol yet.";
  }

  async syncConfig(config) {
    this.config = normalizeRemoteAccessConfig(config);
    if (!this.config.enabled || !this.config.slug || !this.config.deviceId || !this.config.deviceSecret) {
      if (this.config.slug && this.config.deviceId && this.config.deviceSecret) {
        try {
          await this.registerDevice();
        } catch {
          // Best effort: if releu.lol is offline, fall back to local stop semantics.
        }
      }
      this.stop();
      this.registered = false;
      this.online = false;
      this.brokerReachable = false;
      this.lastBrokerSyncAt = "";
      this.lastError = null;
      return this.snapshot();
    }
    this.start();
    await this.syncNow({ forceRegister: true }).catch(() => {});
    return this.snapshot();
  }

  start() {
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => {
        this.syncNow().catch(() => {});
      }, REMOTE_HEARTBEAT_MS);
    }
    if (!this.commandPollTimer) {
      this.commandPollTimer = setInterval(() => {
        this.pollCommands().catch(() => {});
      }, REMOTE_COMMAND_POLL_MS);
    }
  }

  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.commandPollTimer) {
      clearInterval(this.commandPollTimer);
      this.commandPollTimer = null;
    }
  }

  async shutdown() {
    this.stop();
  }

  async syncNow({ forceRegister = false } = {}) {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }
    this.syncInFlight = (async () => {
      try {
        if (forceRegister || !this.registered) {
          await this.registerDevice();
        }
        await this.publishHeartbeat();
      } finally {
        this.syncInFlight = null;
      }
      return this.snapshot();
    })();
    return this.syncInFlight;
  }

  brokerBaseUrl() {
    return trimBaseUrl(REMOTE_ACCESS_BASE_URL);
  }

  deviceHeaders(extraHeaders = {}) {
    return {
      "content-type": "application/json",
      "x-remote-device-id": this.config.deviceId,
      "x-remote-device-secret": this.config.deviceSecret,
      ...extraHeaders,
    };
  }

  async registerDevice() {
    const response = await fetch(`${this.brokerBaseUrl()}/api/remote/device/register`, {
      method: "POST",
      headers: this.deviceHeaders(),
      body: JSON.stringify({
        slug: this.config.slug,
        enabled: this.config.enabled,
        passwordEnabled: this.config.passwordEnabled,
        passwordHash: this.config.passwordHash,
        passwordSalt: this.config.passwordSalt,
        mode: this.config.mode,
        sections: this.config.sections,
        actions: this.config.actions,
      }),
    });
    const payload = await parseJsonResponse(response);
    this.brokerReachable = true;
    this.registered = true;
    this.lastBrokerSyncAt = currentTimestamp();
    this.lastError = null;
    this.lastStatusMessage = String(payload.statusMessage ?? "").trim();
    return payload;
  }

  async publishHeartbeat(snapshot = null) {
    const nextSnapshot = snapshot ?? (await this.panel.buildRemoteAccessSnapshot());
    const response = await fetch(`${this.brokerBaseUrl()}/api/remote/device/heartbeat`, {
      method: "POST",
      headers: this.deviceHeaders(),
      body: JSON.stringify({
        slug: this.config.slug,
        snapshot: nextSnapshot,
        lastPublishedAt: currentTimestamp(),
      }),
    });
    const payload = await parseJsonResponse(response);
    this.brokerReachable = true;
    this.online = true;
    this.lastBrokerSyncAt = currentTimestamp();
    this.lastError = null;
    this.lastStatusMessage = String(payload.statusMessage ?? "").trim();
    return payload;
  }

  async pollCommands() {
    if (!this.config.enabled || !this.config.deviceId || !this.config.deviceSecret) {
      return [];
    }
    if (this.pollInFlight) {
      return this.pollInFlight;
    }
    this.pollInFlight = (async () => {
      try {
        const response = await fetch(`${this.brokerBaseUrl()}/api/remote/device/commands`, {
          method: "GET",
          headers: this.deviceHeaders(),
        });
        const payload = await parseJsonResponse(response);
        this.brokerReachable = true;
        this.lastBrokerSyncAt = currentTimestamp();
        this.lastError = null;
        const commands = Array.isArray(payload.commands) ? payload.commands : [];
        for (const command of commands) {
          await this.processCommand(command);
        }
        return commands;
      } catch (error) {
        this.online = false;
        this.brokerReachable = false;
        this.lastError = error.message ?? "Remote access command poll failed.";
        return [];
      } finally {
        this.pollInFlight = null;
      }
    })();
    return this.pollInFlight;
  }

  async processCommand(command) {
    const commandId = String(command?.id ?? "").trim();
    if (!commandId) {
      return;
    }
    try {
      const result = await this.panel.executeRemoteAccessCommand(
        String(command.type ?? "").trim(),
        command.payload ?? {},
      );
      const snapshot = await this.panel.buildRemoteAccessSnapshot();
      await this.publishHeartbeat(snapshot).catch(() => {});
      await this.publishCommandResult(commandId, {
        ok: true,
        result: summarizeRemoteCommandResult(result, snapshot),
      });
    } catch (error) {
      await this.publishCommandResult(commandId, {
        ok: false,
        error: error.message ?? "Remote command failed.",
      });
      await this.publishHeartbeat().catch(() => {});
    }
  }

  async publishCommandResult(commandId, payload) {
    const response = await fetch(`${this.brokerBaseUrl()}/api/remote/device/command-result`, {
      method: "POST",
      headers: this.deviceHeaders(),
      body: JSON.stringify({
        commandId,
        ...payload,
      }),
    });
    await parseJsonResponse(response);
    this.brokerReachable = true;
    this.online = true;
    this.lastBrokerSyncAt = currentTimestamp();
    this.lastError = null;
  }
}
