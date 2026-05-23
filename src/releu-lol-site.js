import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  REMOTE_ACCESS_ACTION_IDS,
  REMOTE_ACCESS_BASE_URL,
  getPublicRemoteAccessConfig,
  hashRemoteSecret,
  normalizeRemoteAccessConfig,
  remoteAccessAllowsAction,
  remoteAccessAllowsSection,
  verifyRemoteSecret,
} from "./remote-access.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..");
const defaultSiteRoot = path.join(projectRoot, "site", "releu-lol");
const defaultDataRoot = path.join(defaultSiteRoot, "data");
const defaultPelicanRoot = path.join(projectRoot, "public", "pelican-demo");
const REMOTE_BRIDGE_VERSION = "20260523c";
const OFFLINE_AFTER_MS = 25_000;
const VIEWER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const REMOTE_PAGE_SECTION_BY_NAME = new Map([
  ["servers.html", "dashboard"],
  ["create-server.html", "dashboard"],
  ["overview.html", "overview"],
  ["console.html", "console"],
  ["players.html", "players"],
  ["files.html", "misc"],
  ["cloud-backup.html", "backups"],
  ["worlds.html", "worlds"],
  ["addons-mods.html", "addons"],
  ["backups.html", "backups"],
  ["software.html", "software"],
  ["misc.html", "misc"],
  ["settings.html", "settings"],
]);

function nowIso() {
  return new Date().toISOString();
}

async function readJsonFile(targetPath, fallbackValue) {
  try {
    const content = await fs.readFile(targetPath, "utf8");
    return JSON.parse(content);
  } catch {
    return structuredClone(fallbackValue);
  }
}

async function writeJsonFile(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
    .slice(0, 40);
}

function createViewerToken() {
  return `rrv_${crypto.randomBytes(24).toString("base64url")}`;
}

function createCommandId() {
  return `rrc_${crypto.randomBytes(12).toString("hex")}`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function bearerToken(request) {
  const header = String(request.headers.authorization ?? "").trim();
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return String(request.query.token ?? "").trim();
}

function remoteShellHtml(slug) {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url=/${slug}/servers.html" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Releu Remote Access</title>
  </head>
  <body></body>
</html>`;
}

function unavailableHtml() {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Releu Remote Access Unavailable</title>
    <style>
      :root { color-scheme: dark; }
      body { margin:0; min-height:100vh; display:grid; place-items:center; background:#050505; color:#fff; font-family:Inter,system-ui,sans-serif; }
      .card { width:min(560px, calc(100vw - 48px)); border:1px solid rgba(255,255,255,.12); background:#0a0a0a; padding:32px; }
      .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.2em; color:#777; }
      h1 { margin:16px 0 12px; font-size:40px; line-height:1; }
      p { margin:0; color:#b3b3b3; line-height:1.7; }
    </style>
  </head>
  <body>
    <section class="card">
      <div class="eyebrow">Remote Access</div>
      <h1>Unavailable</h1>
      <p>Releu is not open right now, so this remote panel cannot connect.</p>
    </section>
  </body>
</html>`;
}

function isSupportedRemotePage(pageName) {
  return REMOTE_PAGE_SECTION_BY_NAME.has(String(pageName ?? "").trim().toLowerCase());
}

function remotePageSection(pageName) {
  return REMOTE_PAGE_SECTION_BY_NAME.get(String(pageName ?? "").trim().toLowerCase()) ?? null;
}

function remotePageTitle(pageName) {
  const normalized = String(pageName ?? "servers.html").trim().toLowerCase();
  const map = {
    "servers.html": "Servers",
    "create-server.html": "Create Server",
    "overview.html": "Overview",
    "console.html": "Console",
    "players.html": "Players",
    "files.html": "Files",
    "cloud-backup.html": "Cloud Backup",
    "worlds.html": "Worlds",
    "addons-mods.html": "Add-ons",
    "backups.html": "Backups",
    "software.html": "Software",
    "misc.html": "Misc",
    "settings.html": "Settings",
  };
  return map[normalized] ?? "Remote Access";
}

function rewriteRemotePelicanAssetPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw || /^(?:[a-z]+:|#|\/)/i.test(raw) || raw.startsWith("//")) {
    return raw;
  }
  return `/remote-static/${raw.replace(/^\.\//, "")}`;
}

function injectRemoteBridge(output, slug) {
  const bridgeMarkup = `<script>window.RELEU_REMOTE_SLUG = ${JSON.stringify(slug)}; window.RELEU_REMOTE_MODE = true;</script><script src="/remote-static/bridge.js?v=${REMOTE_BRIDGE_VERSION}"></script>`;
  if (/<\/body>/i.test(output)) {
    return output.replace(/<\/body>/i, `${bridgeMarkup}</body>`);
  }
  return `${output}\n${bridgeMarkup}`;
}

function sanitizePelicanCloneHtml(html, slug, pageName) {
  let output = String(html ?? "");
  output = output.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${remotePageTitle(pageName)} - Releu</title>`,
  );
  output = output.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  output = output.replace(
    /<link\b[^>]*rel="(?:modulepreload|preload)"[^>]*>/gi,
    (match) => {
      const lower = match.toLowerCase();
      if (
        lower.includes('as="script"') ||
        lower.includes('as="font"') ||
        lower.includes(".download") ||
        lower.includes("demo.pelican.dev")
      ) {
        return "";
      }
      return match;
    },
  );
  output = output.replace(/\s+x-load(?:-src)?(?:="[^"]*")?/gi, "");
  output = output.replace(
    /href="https:\/\/demo\.pelican\.dev\/[^"]*"/gi,
    `href="/${slug}/servers.html"`,
  );
  output = output.replace(
    /\b(href|src)="([^"]+)"/gi,
    (_match, attribute, value) => `${attribute}="${rewriteRemotePelicanAssetPath(value)}"`,
  );
  output = output.replace(
    /<footer class="flex flex-col items-center justify-center text-center space-y-2 p-4 text-gray-600 dark:text-gray-400">[\s\S]*?<\/footer>/i,
    `<footer class="flex flex-col items-center justify-center text-center space-y-2 p-4 text-gray-600 dark:text-gray-400"><div class="font-semibold">Releu Remote Access</div></footer>`,
  );
  output = output.replaceAll("ยฉ 2026 Pelican", "Releu Remote Access");
  output = output.replaceAll("โ€ข", "-");
  return injectRemoteBridge(output, slug);
}

async function renderRemotePelicanPage({ pelicanRoot, slug, pageName }) {
  const pagePath = path.join(pelicanRoot, pageName);
  const html = await fs.readFile(pagePath, "utf8");
  return sanitizePelicanCloneHtml(html, slug, pageName);
}

function commandNeedsAction(commandType) {
  switch (commandType) {
    case "startServer":
    case "stopServer":
    case "restartServer":
    case "killServer":
      return "powerControls";
    case "sendCommand":
      return "consoleCommands";
    case "playerAction":
    case "getPlayerInventory":
    case "searchInventoryCatalog":
    case "givePlayerInventoryItem":
    case "clearPlayerInventory":
      return "playerModeration";
    case "createManagedFolder":
    case "uploadManagedFile":
    case "writeManagedTextFile":
    case "deleteManagedPath":
    case "updateCloudBackupSettings":
    case "issueCloudBackupKey":
    case "rotateCloudBackupKey":
    case "registerCloudBackupAccount":
    case "loginCloudBackupAccount":
    case "logoutCloudBackupAccount":
    case "importWorldArchive":
      return "settingsChanges";
    case "createServer":
    case "deleteServer":
      return "serverCreateDelete";
    case "softwareInstall":
      return "softwareChanges";
    case "worldSelect":
    case "worldRegenerate":
      return "worldImportDelete";
    case "catalogInstall":
    case "installAssetFromUrl":
    case "removeAsset":
      return "addonInstallRemove";
    case "backupCreate":
    case "uploadCloudBackup":
      return "backupCreate";
    case "backupRevert":
    case "downloadCloudBackup":
    case "restoreCloudBackup":
      return "backupRestoreDelete";
    case "updateServerProfile":
    case "updateRuntimeSettings":
    case "updateServerProperties":
    case "updateBackupSettings":
    case "updateMiscSettings":
      return "settingsChanges";
    default:
      return null;
  }
}

function commandNeedsSection(commandType) {
  switch (commandType) {
    case "createServer":
    case "deleteServer":
      return "dashboard";
    case "startServer":
    case "stopServer":
    case "restartServer":
    case "killServer":
      return "overview";
    case "sendCommand":
      return "console";
    case "playerAction":
    case "getPlayerInventory":
    case "searchInventoryCatalog":
    case "givePlayerInventoryItem":
    case "clearPlayerInventory":
      return "players";
    case "listManagedFiles":
    case "readManagedTextFile":
    case "downloadManagedFile":
    case "createManagedFolder":
    case "uploadManagedFile":
    case "writeManagedTextFile":
    case "deleteManagedPath":
      return "misc";
    case "worldSelect":
    case "worldRegenerate":
    case "importWorldArchive":
      return "worlds";
    case "catalogSearch":
    case "catalogInstall":
    case "installAssetFromUrl":
    case "removeAsset":
      return "addons";
    case "cloudBackupStatus":
    case "backupCreate":
    case "backupRevert":
    case "updateCloudBackupSettings":
    case "issueCloudBackupKey":
    case "rotateCloudBackupKey":
    case "registerCloudBackupAccount":
    case "loginCloudBackupAccount":
    case "logoutCloudBackupAccount":
    case "uploadCloudBackup":
    case "downloadCloudBackup":
    case "restoreCloudBackup":
      return "backups";
    case "softwareVersions":
    case "softwareInstall":
      return "software";
    case "updateServerProfile":
    case "updateRuntimeSettings":
    case "updateServerProperties":
    case "updateBackupSettings":
      return "settings";
    case "updateMiscSettings":
      return "misc";
    default:
      return null;
  }
}

function setUtf8StaticHeaders(response, filePath) {
  const lower = String(filePath ?? "").toLowerCase();
  if (lower.endsWith(".html")) {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    return;
  }
  if (lower.endsWith(".css")) {
    response.setHeader("Content-Type", "text/css; charset=utf-8");
    return;
  }
  if (lower.endsWith(".js") || lower.endsWith(".js.download")) {
    response.setHeader("Content-Type", "application/javascript; charset=utf-8");
    if (lower.endsWith("bridge.js")) {
      response.setHeader("Cache-Control", "no-store");
    }
    return;
  }
  if (lower.endsWith(".woff2")) {
    response.setHeader("Content-Type", "font/woff2");
    return;
  }
  if (lower.endsWith(".json")) {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
  }
}

function requireJsonOk(response, data = {}) {
  response.json({
    ok: true,
    ...data,
  });
}

export async function startReleuLolSite({
  host = process.env.RELEU_SITE_HOST || "127.0.0.1",
  port = Number(process.env.RELEU_SITE_PORT ?? 3080) || 3080,
  siteRoot = process.env.RELEU_SITE_ROOT || defaultSiteRoot,
  dataRoot = process.env.RELEU_SITE_DATA_DIR || defaultDataRoot,
  pelicanRoot = process.env.RELEU_PELICAN_ROOT || defaultPelicanRoot,
} = {}) {
  const app = express();
  const storage = {
    devicesFile: path.join(dataRoot, "devices.json"),
    sessionsFile: path.join(dataRoot, "viewer-sessions.json"),
    commandsFile: path.join(dataRoot, "commands.json"),
  };

  async function ensureStorage() {
    await fs.mkdir(dataRoot, { recursive: true });
  }

  async function loadDevices() {
    await ensureStorage();
    return readJsonFile(storage.devicesFile, []);
  }

  async function saveDevices(devices) {
    await ensureStorage();
    await writeJsonFile(storage.devicesFile, devices);
  }

  async function loadSessions() {
    await ensureStorage();
    const sessions = await readJsonFile(storage.sessionsFile, []);
    const now = Date.now();
    return sessions.filter((entry) => now - Date.parse(entry.createdAt ?? 0) < VIEWER_SESSION_TTL_MS);
  }

  async function saveSessions(sessions) {
    await ensureStorage();
    await writeJsonFile(storage.sessionsFile, sessions);
  }

  async function loadCommands() {
    await ensureStorage();
    return readJsonFile(storage.commandsFile, []);
  }

  async function saveCommands(commands) {
    await ensureStorage();
    await writeJsonFile(storage.commandsFile, commands.slice(-500));
  }

  function isOnlineDevice(device) {
    const lastHeartbeatAt = Date.parse(device?.lastHeartbeatAt ?? 0);
    return Boolean(device?.enabled && lastHeartbeatAt && Date.now() - lastHeartbeatAt < OFFLINE_AFTER_MS);
  }

  async function findDeviceBySlug(slug) {
    const normalizedSlug = normalizeSlug(slug);
    if (!normalizedSlug) return null;
    const devices = await loadDevices();
    return devices.find((entry) => entry.slug === normalizedSlug && entry.enabled) ?? null;
  }

  async function authenticateDevice(request) {
    const deviceId = String(request.headers["x-remote-device-id"] ?? "").trim();
    const secret = String(request.headers["x-remote-device-secret"] ?? "").trim();
    if (!deviceId || !secret) {
      throw new Error("Missing remote device credentials.");
    }
    const devices = await loadDevices();
    const device = devices.find((entry) => entry.deviceId === deviceId) ?? null;
    if (!device) {
      throw new Error("Remote device is not registered.");
    }
    if (!verifyRemoteSecret(secret, device.deviceSecretSalt, device.deviceSecretHash)) {
      throw new Error("Remote device secret was rejected.");
    }
    return { device, devices };
  }

  async function authenticateViewer(request) {
    const token = bearerToken(request);
    if (!token) {
      throw new Error("Viewer session token is required.");
    }
    const sessions = await loadSessions();
    const session = sessions.find((entry) => entry.token === token) ?? null;
    if (!session) {
      throw new Error("Viewer session is invalid.");
    }
    const devices = await loadDevices();
    const device = devices.find((entry) => entry.deviceId === session.deviceId && entry.enabled) ?? null;
    if (!device) {
      throw new Error("Remote device is no longer available.");
    }
    return { token, session, sessions, device, devices };
  }

  async function queueViewerCommand(session, device, commandType, payload = {}) {
    const commands = await loadCommands();
    const queued = {
      id: createCommandId(),
      viewerToken: session.token,
      deviceId: device.deviceId,
      type: commandType,
      payload,
      status: "pending",
      createdAt: nowIso(),
      completedAt: null,
      result: null,
      error: null,
    };
    commands.push(queued);
    await saveCommands(commands);
    return queued;
  }

  async function waitForViewerCommand(commandId, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const commands = await loadCommands();
      const match = commands.find((entry) => entry.id === commandId) ?? null;
      if (!match) {
        throw new Error("Remote command disappeared before it completed.");
      }
      if (match.status === "completed") {
        return match;
      }
      if (match.status === "failed" || match.status === "error") {
        throw new Error(match.error || "Remote command failed.");
      }
      await sleep(500);
    }
    throw new Error("Remote command timed out.");
  }

  async function discardViewerCommand(commandId) {
    const commands = await loadCommands();
    await saveCommands(commands.filter((entry) => entry.id !== commandId));
  }

  function viewerPayload(device) {
    const remote = getPublicRemoteAccessConfig({ remoteAccess: device });
    return {
      slug: device.slug,
      remoteAccess: {
        ...remote,
        online: isOnlineDevice(device),
        status: isOnlineDevice(device) ? "online" : "offline",
      },
      snapshot: device.snapshot ?? null,
    };
  }

  app.disable("x-powered-by");
  app.use(express.json({ limit: "40mb" }));
  app.use("/assets", express.static(path.join(siteRoot, "assets"), { setHeaders: setUtf8StaticHeaders }));
  app.use("/remote-static", async (request, response, next) => {
    const decodedPath = decodeURIComponent(String(request.path ?? ""));
    if (!/\.css$/i.test(decodedPath)) {
      next();
      return;
    }
    const relativePath = decodedPath.replace(/^\/+/, "");
    const rootPath = path.resolve(pelicanRoot);
    const resolvedPath = path.resolve(rootPath, relativePath);
    if (resolvedPath !== rootPath && !resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
      response.status(400).send("Invalid asset path");
      return;
    }
    try {
      let css = await fs.readFile(resolvedPath, "utf8");
      css = css.replace(/@font-face\s*\{[\s\S]*?\}\s*/gi, "");
      response.setHeader("Cache-Control", "no-store");
      setUtf8StaticHeaders(response, resolvedPath);
      response.status(200).send(css);
    } catch {
      next();
    }
  });
  app.use("/remote-static", express.static(pelicanRoot, { setHeaders: setUtf8StaticHeaders }));

  app.get("/", async (_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.sendFile(path.join(siteRoot, "index.html"));
  });

  app.get("/api/remote/slug/:slug/bootstrap", async (request, response) => {
    const device = await findDeviceBySlug(request.params.slug);
    if (!device) {
      response.status(404).json({ ok: false, error: "That remote access link was not found." });
      return;
    }
    if (!isOnlineDevice(device)) {
      response.status(503).json({ ok: false, error: "Releu is not open right now." });
      return;
    }
    requireJsonOk(response, {
      slug: device.slug,
      passwordEnabled: Boolean(device.passwordEnabled),
      mode: device.mode,
      sections: device.sections,
      actions: device.actions,
      publicUrl: `${REMOTE_ACCESS_BASE_URL}/${device.slug}`,
    });
  });

  app.post("/api/remote/device/register", async (request, response) => {
    try {
      const deviceId = String(request.headers["x-remote-device-id"] ?? "").trim();
      const deviceSecret = String(request.headers["x-remote-device-secret"] ?? "").trim();
      const slug = normalizeSlug(request.body?.slug);
      if (!deviceId || !deviceSecret || !slug) {
        throw new Error("Device credentials and slug are required.");
      }
      const remote = normalizeRemoteAccessConfig({
        enabled: Boolean(request.body?.enabled),
        slug,
        passwordEnabled: Boolean(request.body?.passwordEnabled),
        passwordHash: String(request.body?.passwordHash ?? "").trim(),
        passwordSalt: String(request.body?.passwordSalt ?? "").trim(),
        mode: request.body?.mode,
        sections: request.body?.sections,
        actions: request.body?.actions,
        deviceId,
      });
      const devices = await loadDevices();
      const existingBySlug = devices.find(
        (entry) => entry.slug === slug && entry.deviceId !== deviceId,
      );
      if (existingBySlug) {
        throw new Error("That remote access slug is already in use.");
      }
      const existing = devices.find((entry) => entry.deviceId === deviceId) ?? null;
      const secretRecord = existing
        ? verifyRemoteSecret(deviceSecret, existing.deviceSecretSalt, existing.deviceSecretHash)
          ? { salt: existing.deviceSecretSalt, hash: existing.deviceSecretHash }
          : null
        : hashRemoteSecret(deviceSecret);
      if (existing && !secretRecord) {
        throw new Error("Remote device secret was rejected.");
      }
      const record = {
        ...(existing ?? {}),
        ...remote,
        deviceSecretSalt: secretRecord.salt,
        deviceSecretHash: secretRecord.hash,
        snapshot: existing?.snapshot ?? null,
        updatedAt: nowIso(),
      };
      const nextDevices = existing
        ? devices.map((entry) => (entry.deviceId === deviceId ? record : entry))
        : [...devices, record];
      await saveDevices(nextDevices);
      if (
        existing &&
        (
          existing.slug !== record.slug ||
          Boolean(existing.enabled) !== Boolean(record.enabled) ||
          Boolean(existing.passwordEnabled) !== Boolean(record.passwordEnabled) ||
          String(existing.passwordHash ?? "") !== String(record.passwordHash ?? "") ||
          String(existing.passwordSalt ?? "") !== String(record.passwordSalt ?? "")
        )
      ) {
        const sessions = await loadSessions();
        await saveSessions(sessions.filter((entry) => entry.deviceId !== deviceId));
      }
      requireJsonOk(response, {
        statusMessage: "Remote device registered.",
      });
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message ?? "Remote device registration failed." });
    }
  });

  app.post("/api/remote/device/heartbeat", async (request, response) => {
    try {
      const { device, devices } = await authenticateDevice(request);
      const nextDevice = {
        ...device,
        lastHeartbeatAt: nowIso(),
        lastPublishedAt: String(request.body?.lastPublishedAt ?? nowIso()).trim() || nowIso(),
        snapshot: request.body?.snapshot ?? device.snapshot ?? null,
        updatedAt: nowIso(),
      };
      await saveDevices(
        devices.map((entry) => (entry.deviceId === device.deviceId ? nextDevice : entry)),
      );
      requireJsonOk(response, {
        statusMessage: "Heartbeat accepted.",
      });
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message ?? "Heartbeat failed." });
    }
  });

  app.get("/api/remote/device/commands", async (request, response) => {
    try {
      const { device } = await authenticateDevice(request);
      const commands = await loadCommands();
      requireJsonOk(response, {
        commands: commands
          .filter((entry) => entry.deviceId === device.deviceId && entry.status === "pending")
          .slice(0, 20),
      });
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message ?? "Command poll failed." });
    }
  });

  app.post("/api/remote/device/command-result", async (request, response) => {
    try {
      const { device } = await authenticateDevice(request);
      const commandId = String(request.body?.commandId ?? "").trim();
      if (!commandId) {
        throw new Error("Command id is required.");
      }
      const commands = await loadCommands();
      await saveCommands(
        commands.map((entry) =>
          entry.id === commandId && entry.deviceId === device.deviceId
            ? {
                ...entry,
                status: request.body?.ok ? "completed" : "failed",
                result: request.body?.result ?? null,
                error: request.body?.error ?? null,
                completedAt: nowIso(),
              }
            : entry,
        ),
      );
      requireJsonOk(response, { accepted: true });
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message ?? "Command result publish failed." });
    }
  });

  app.post("/api/remote/viewer/auth", async (request, response) => {
    try {
      const device = await findDeviceBySlug(request.body?.slug);
      if (!device?.enabled) {
        throw new Error("That remote access link was not found.");
      }
      if (!isOnlineDevice(device)) {
        throw new Error("Releu is not open right now.");
      }
      if (
        device.passwordEnabled &&
        !verifyRemoteSecret(
          String(request.body?.password ?? ""),
          device.passwordSalt,
          device.passwordHash,
        )
      ) {
        throw new Error("Remote Access password was rejected.");
      }
      const token = createViewerToken();
      const sessions = await loadSessions();
      sessions.push({
        token,
        slug: device.slug,
        deviceId: device.deviceId,
        createdAt: nowIso(),
        lastSeenAt: nowIso(),
      });
      await saveSessions(sessions);
      requireJsonOk(response, {
        token,
        viewer: viewerPayload(device),
      });
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message ?? "Viewer authentication failed." });
    }
  });

  app.get("/api/remote/viewer/session", async (request, response) => {
    try {
      const { token, session, sessions, device } = await authenticateViewer(request);
      if (!isOnlineDevice(device)) {
        response.status(503).json({ ok: false, error: "Releu is not open right now." });
        return;
      }
      const commands = await loadCommands();
      await saveSessions(
        sessions.map((entry) =>
          entry.token === token ? { ...entry, lastSeenAt: nowIso() } : entry,
        ),
      );
      requireJsonOk(response, {
        viewer: viewerPayload(device),
        commands: commands
          .filter((entry) => entry.viewerToken === session.token)
          .slice(-40),
      });
    } catch (error) {
      response.status(401).json({ ok: false, error: error.message ?? "Viewer session lookup failed." });
    }
  });

  app.post("/api/remote/viewer/command", async (request, response) => {
    try {
      const { session, device } = await authenticateViewer(request);
      if (!isOnlineDevice(device)) {
        response.status(503).json({ ok: false, error: "Releu is not open right now." });
        return;
      }
      const commandType = String(request.body?.type ?? "").trim();
      if (!commandType) {
        throw new Error("Remote command type is required.");
      }
      const requiredSection = commandNeedsSection(commandType);
      if (requiredSection && !remoteAccessAllowsSection(device, requiredSection)) {
        throw new Error("That remote panel section is blocked for this link.");
      }
      const requiredAction = commandNeedsAction(commandType);
      if (requiredAction && !remoteAccessAllowsAction(device, requiredAction)) {
        throw new Error("That remote panel action is blocked for this link.");
      }
      const queued = await queueViewerCommand(
        session,
        device,
        commandType,
        request.body?.payload ?? {},
      );
      requireJsonOk(response, {
        command: queued,
      });
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message ?? "Remote command queue failed." });
    }
  });

  app.get("/api/remote/viewer/files/download", async (request, response) => {
    let queuedCommandId = "";
    try {
      const { session, device } = await authenticateViewer(request);
      if (!isOnlineDevice(device)) {
        response.status(503).json({ ok: false, error: "Releu is not open right now." });
        return;
      }
      const requiredSection = commandNeedsSection("downloadManagedFile");
      if (requiredSection && !remoteAccessAllowsSection(device, requiredSection)) {
        throw new Error("That remote panel section is blocked for this link.");
      }
      const queued = await queueViewerCommand(session, device, "downloadManagedFile", {
        serverId: request.query.serverId,
        path: request.query.path,
      });
      queuedCommandId = queued.id;
      const completed = await waitForViewerCommand(queued.id);
      const result = completed.result ?? {};
      const fileName =
        String(result.fileName ?? result.name ?? "download.bin").trim() || "download.bin";
      const contentBase64 = String(result.contentBase64 ?? "").trim();
      if (!contentBase64) {
        throw new Error("The remote file download returned no data.");
      }
      const bytes = Buffer.from(contentBase64, "base64");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader(
        "Content-Type",
        String(result.mimeType ?? "application/octet-stream").trim() ||
          "application/octet-stream",
      );
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${path.basename(fileName).replace(/"/g, "")}"`,
      );
      response.status(200).send(bytes);
    } catch (error) {
      response
        .status(400)
        .json({ ok: false, error: error.message ?? "Remote file download failed." });
    } finally {
      if (queuedCommandId) {
        await discardViewerCommand(queuedCommandId).catch(() => {});
      }
    }
  });

  app.get("/:slug/:page", async (request, response, next) => {
    const rawSlug = String(request.params.slug ?? "").trim();
    const pageName = String(request.params.page ?? "").trim().toLowerCase();
    if (!rawSlug || rawSlug === "api" || rawSlug === "assets" || rawSlug === "remote-static") {
      next();
      return;
    }
    if (!isSupportedRemotePage(pageName)) {
      next();
      return;
    }
    const device = await findDeviceBySlug(rawSlug);
    if (!device) {
      response.status(404).send("Not found");
      return;
    }
    if (!isOnlineDevice(device)) {
      response.status(503).send(unavailableHtml());
      return;
    }
    const requiredSection = remotePageSection(pageName);
    if (requiredSection && !remoteAccessAllowsSection(device, requiredSection)) {
      response.status(403).send("Remote section blocked");
      return;
    }
    try {
      response
        .status(200)
        .setHeader("Cache-Control", "no-store")
        .type("html")
        .send(
          await renderRemotePelicanPage({
            pelicanRoot,
            slug: device.slug,
            pageName,
          }),
        );
    } catch (error) {
      response.status(500).send("Remote page failed to load.");
    }
  });

  app.get("/:slug", async (request, response, next) => {
    const rawSlug = String(request.params.slug ?? "").trim();
    if (!rawSlug || rawSlug === "api" || rawSlug === "assets" || rawSlug === "remote-static") {
      next();
      return;
    }
    const device = await findDeviceBySlug(rawSlug);
    if (!device) {
      response.status(404).send("Not found");
      return;
    }
    if (!isOnlineDevice(device)) {
      response.status(503).send(unavailableHtml());
      return;
    }
    response
      .status(302)
      .setHeader("Cache-Control", "no-store")
      .setHeader("Location", `/${device.slug}/servers.html`)
      .end();
  });

  const server = await new Promise((resolve) => {
    const nextServer = app.listen(port, host, () => resolve(nextServer));
  });
  return {
    app,
    server,
    storage,
    siteRoot,
  };
}
