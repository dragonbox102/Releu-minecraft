const POLL_INTERVAL_MS = 4000;
const COMMAND_WAIT_TIMEOUT_MS = 25000;

const SECTION_META = {
  dashboard: {
    label: "Dashboard",
    title: "Hosted Overview",
    detail: "Pick a server, inspect the host, and manage the whole install from the web shell.",
  },
  overview: {
    label: "Overview",
    title: "Server Overview",
    detail: "See the selected server status, software, and power state.",
  },
  console: {
    label: "Console",
    title: "Console",
    detail: "Follow the latest server logs and send commands when this remote link allows it.",
  },
  players: {
    label: "Players",
    title: "Players",
    detail: "Moderate players, whitelist, op, or ban them from the hosted panel.",
  },
  worlds: {
    label: "Worlds",
    title: "Worlds",
    detail: "Switch the active world or prepare a regeneration without touching the desktop app.",
  },
  addons: {
    label: "Add-ons",
    title: "Add-ons",
    detail: "Inspect installed mods/plugins and optionally install or remove them.",
  },
  backups: {
    label: "Backups",
    title: "Backups",
    detail: "Create local backups or restore one if this remote link has the dangerous permission enabled.",
  },
  software: {
    label: "Software",
    title: "Software",
    detail: "Inspect the installed server software and switch versions from the hosted panel.",
  },
  misc: {
    label: "Misc",
    title: "Misc Settings",
    detail: "Toggle common gameplay and connectivity behavior.",
  },
  settings: {
    label: "Settings",
    title: "Runtime Settings",
    detail: "Adjust launcher memory, CPU limits, MOTD, and core server.properties values.",
  },
};

const root = document.getElementById("app");
const remoteSlug = String(window.RELEU_REMOTE_SLUG ?? root?.dataset?.remoteSlug ?? "").trim();
const storageKey = `releu-remote-session:${remoteSlug}`;

const state = {
  slug: remoteSlug,
  token: "",
  bootstrap: null,
  session: null,
  activeSection: "dashboard",
  notice: "",
  error: "",
  authRequired: false,
  authPassword: "",
  authBusy: false,
  loading: true,
  offline: false,
  pendingCommand: "",
  pollTimer: null,
  lastCommandId: "",
  catalogSearch: {
    kind: "plugin",
    query: "",
    result: null,
  },
  softwareVersions: {
    software: "",
    versions: [],
  },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTimestamp(value) {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toLocaleString() : "0";
}

function currentRemote() {
  return state.session?.viewer?.remoteAccess ?? state.bootstrap ?? null;
}

function currentSnapshot() {
  return state.session?.viewer?.snapshot ?? null;
}

function currentServers() {
  return Array.isArray(currentSnapshot()?.servers) ? currentSnapshot().servers : [];
}

function currentActiveServer() {
  return currentSnapshot()?.activeServer ?? null;
}

function currentCommands() {
  return Array.isArray(state.session?.commands) ? state.session.commands : [];
}

function remoteLink() {
  return state.bootstrap?.publicUrl ?? state.session?.viewer?.remoteAccess?.url ?? "";
}

function onlineStatusClass() {
  if (state.offline) {
    return "offline";
  }
  const remote = currentRemote();
  if (remote?.status === "waiting") {
    return "waiting";
  }
  return remote?.online ? "" : "offline";
}

function sectionAllowed(sectionId) {
  return Boolean(currentRemote()?.sections?.[sectionId]);
}

function actionAllowed(actionId) {
  return Boolean(currentRemote()?.actions?.[actionId]);
}

function availableSections() {
  return Object.entries(SECTION_META).filter(([sectionId]) => sectionAllowed(sectionId));
}

function normalizeSection(sectionId) {
  if (sectionAllowed(sectionId)) {
    return sectionId;
  }
  return availableSections()[0]?.[0] ?? "dashboard";
}

function normalizeServerSelection() {
  const snapshot = currentSnapshot();
  const activeServerId = String(snapshot?.activeServerId ?? "").trim();
  if (activeServerId) {
    return activeServerId;
  }
  return currentServers()[0]?.id ?? "";
}

function clearNotice() {
  state.notice = "";
}

function setNotice(message) {
  state.notice = String(message ?? "").trim();
  state.error = "";
}

function setError(message) {
  state.error = String(message ?? "").trim();
}

function commandBadge(command) {
  const status = String(command?.status ?? "pending").trim().toLowerCase();
  const tone =
    status === "completed"
      ? "status-chip"
      : status === "error"
        ? "status-chip offline"
        : "status-chip waiting";
  return `<span class="${tone}"><span class="dot"></span>${escapeHtml(status)}</span>`;
}

async function request(path, { method = "GET", body = null, includeAuth = true } = {}) {
  const headers = {};
  let payloadBody = body;
  if (includeAuth && state.token) {
    headers.authorization = `Bearer ${state.token}`;
  }
  if (body !== null) {
    headers["content-type"] = "application/json";
    payloadBody = JSON.stringify(body);
  }
  const response = await fetch(path, {
    method,
    headers,
    body: payloadBody,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const error = new Error(
      String(payload?.error ?? "").trim() || `Request failed (${response.status}).`,
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loadBootstrap() {
  state.bootstrap = await request(`/api/remote/slug/${encodeURIComponent(state.slug)}/bootstrap`, {
    includeAuth: false,
  });
  state.activeSection = normalizeSection(state.activeSection);
  return state.bootstrap;
}

async function loadSession({ silent = false } = {}) {
  try {
    const payload = await request("/api/remote/viewer/session");
    state.session = payload;
    state.offline = false;
    state.authRequired = false;
    state.activeSection = normalizeSection(state.activeSection);
    if (!silent) {
      clearNotice();
    }
    return payload;
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem(storageKey);
      state.token = "";
      state.authRequired = true;
      state.session = null;
    } else if (error.status === 503) {
      state.offline = true;
    }
    throw error;
  }
}

function startPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }
  state.pollTimer = setInterval(async () => {
    try {
      await loadSession({ silent: true });
      render();
    } catch (error) {
      if (error.status !== 503 && error.status !== 401) {
        setError(error.message);
        render();
      }
    }
  }, POLL_INTERVAL_MS);
}

async function authenticate(password = "") {
  state.authBusy = true;
  setError("");
  render();
  try {
    const payload = await request("/api/remote/viewer/auth", {
      method: "POST",
      includeAuth: false,
      body: {
        slug: state.slug,
        password,
      },
    });
    state.token = payload.token;
    localStorage.setItem(storageKey, payload.token);
    state.authRequired = false;
    state.authPassword = "";
    await loadSession();
    startPolling();
  } finally {
    state.authBusy = false;
  }
}

async function boot() {
  state.loading = true;
  render();
  try {
    await loadBootstrap();
    const storedToken = localStorage.getItem(storageKey);
    if (storedToken) {
      state.token = storedToken;
      try {
        await loadSession();
        startPolling();
      } catch (error) {
        if (error.status !== 401 && error.status !== 503) {
          throw error;
        }
      }
    }

    if (!state.session) {
      if (state.bootstrap.passwordEnabled) {
        state.authRequired = true;
      } else {
        await authenticate("");
      }
    }
  } catch (error) {
    if (error.status === 503) {
      state.offline = true;
    }
    setError(error.message);
  } finally {
    state.loading = false;
    render();
  }
}

async function queueCommand(type, payload = {}, { label = "", wait = true } = {}) {
  state.pendingCommand = type;
  clearNotice();
  setError("");
  render();
  try {
    const queued = await request("/api/remote/viewer/command", {
      method: "POST",
      body: {
        type,
        payload,
      },
    });
    state.lastCommandId = queued.command?.id ?? "";
    if (!wait) {
      setNotice(label ? `${label} queued.` : "Remote action queued.");
      return queued.command;
    }
    const result = await waitForCommand(state.lastCommandId);
    setNotice(label ? `${label} finished.` : "Remote action finished.");
    return result;
  } finally {
    state.pendingCommand = "";
    render();
  }
}

async function waitForCommand(commandId) {
  const deadline = Date.now() + COMMAND_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(850);
    await loadSession({ silent: true });
    const command = currentCommands().find((entry) => entry.id === commandId);
    if (!command) {
      continue;
    }
    if (command.status === "completed") {
      return command.result ?? null;
    }
    if (command.status === "error") {
      throw new Error(String(command.error ?? "Remote command failed."));
    }
  }
  throw new Error("Remote command timed out before Releu replied.");
}

function renderStatusBar() {
  const remote = currentRemote();
  const snapshot = currentSnapshot();
  const activeSectionMeta = SECTION_META[state.activeSection] ?? SECTION_META.dashboard;
  const serverOptions = currentServers()
    .map((server) => {
      const selected =
        server.id === String(snapshot?.activeServerId ?? "").trim() ? "selected" : "";
      return `<option value="${escapeHtml(server.id)}" ${selected}>${escapeHtml(server.name)}</option>`;
    })
    .join("");
  return `<div class="topbar">
      <div>
        <div class="eyebrow">${escapeHtml(activeSectionMeta.label)}</div>
        <h1 class="title">${escapeHtml(activeSectionMeta.title)}</h1>
        <p class="detail">${escapeHtml(activeSectionMeta.detail)}</p>
      </div>
      <div class="stack">
        <div class="row">
          <div class="status-chip ${onlineStatusClass()}"><span class="dot"></span>${escapeHtml(
            state.offline ? "Offline" : remote?.online ? "Online" : remote?.status ?? "Waiting",
          )}</div>
          <button type="button" class="ghost" data-action="refresh-session">Refresh</button>
          <button type="button" class="ghost" data-action="copy-link">Copy Link</button>
        </div>
        <div class="row">
          <label class="meta-label" for="server-switcher">Server</label>
          <select id="server-switcher" data-action="switch-server">${serverOptions}</select>
        </div>
      </div>
    </div>`;
}

function renderRecentCommandsCard() {
  const commands = currentCommands().slice(-8).reverse();
  return `<section class="card span-12">
      <h2>Recent Remote Commands</h2>
      <p>Every command still executes locally inside Releu. This hosted panel only brokers the request.</p>
      <div class="stack" style="margin-top:16px;">
        ${
          commands.length
            ? commands
                .map(
                  (command) => `<div class="simple-list-item">
                    <div class="row" style="justify-content:space-between;">
                      <strong>${escapeHtml(command.type)}</strong>
                      ${commandBadge(command)}
                    </div>
                    <div class="muted" style="margin-top:8px;">Queued ${escapeHtml(formatTimestamp(command.createdAt))}</div>
                    ${
                      command.error
                        ? `<div class="error" style="margin-top:8px;">${escapeHtml(command.error)}</div>`
                        : ""
                    }
                  </div>`,
                )
                .join("")
            : `<div class="simple-list-item"><div class="muted">No remote commands have been sent in this viewer session yet.</div></div>`
        }
      </div>
    </section>`;
}

function renderDashboardSection() {
  const snapshot = currentSnapshot();
  const servers = currentServers();
  const playitAddress =
    snapshot?.playit?.tunnels?.find((entry) => entry.publicAddress)?.publicAddress ??
    "Not linked";
  return `<div class="layout-grid">
      <section class="card span-4">
        <h2>Host</h2>
        <div class="kv">
          <div><strong>Hostname</strong><span>${escapeHtml(snapshot?.host?.hostname ?? "Unknown")}</span></div>
          <div><strong>Platform</strong><span>${escapeHtml(snapshot?.host?.platform ?? "Unknown")}</span></div>
          <div><strong>CPU Cores</strong><span>${escapeHtml(formatNumber(snapshot?.host?.cpuCores ?? 0))}</span></div>
          <div><strong>Memory</strong><span>${escapeHtml(formatNumber(snapshot?.host?.freeMemoryMb ?? 0))} / ${escapeHtml(formatNumber(snapshot?.host?.totalMemoryMb ?? 0))} MB free</span></div>
          <div><strong>Playit</strong><span class="mono">${escapeHtml(playitAddress)}</span></div>
        </div>
      </section>
      <section class="card span-8">
        <h2>Servers</h2>
        <p>Remote Access is install-wide, so this link can switch between every local server allowed by the selected permissions.</p>
        <div class="server-list" style="margin-top:18px;">
          ${
            servers.length
              ? servers
                  .map((server) => {
                    const active = server.id === String(snapshot?.activeServerId ?? "").trim();
                    return `<article class="server-item">
                        <header>
                          <div>
                            <div class="eyebrow">${escapeHtml(server.status ?? "unknown")}</div>
                            <h3>${escapeHtml(server.name)}</h3>
                            <p>${escapeHtml(server.description ?? "No description yet.")}</p>
                          </div>
                          <div class="row">
                            <span class="chip">${escapeHtml(`${server.playerCount ?? 0} players`)}</span>
                            <span class="chip mono">${escapeHtml(`:${server.port ?? 25565}`)}</span>
                          </div>
                        </header>
                        <div class="row" style="margin-top:16px;">
                          <button type="button" class="${active ? "primary" : "ghost"}" data-action="select-server" data-server-id="${escapeHtml(server.id)}">${active ? "Selected" : "Open"}</button>
                          ${
                            actionAllowed("serverCreateDelete")
                              ? `<button type="button" class="danger" data-action="delete-server" data-server-id="${escapeHtml(server.id)}" data-server-name="${escapeHtml(server.name)}">Delete</button>`
                              : ""
                          }
                        </div>
                      </article>`;
                  })
                  .join("")
              : `<div class="simple-list-item"><div class="muted">No servers are registered on this Releu install yet.</div></div>`
          }
        </div>
      </section>
      ${
        actionAllowed("serverCreateDelete")
          ? `<section class="card span-12">
              <h2>Create Server</h2>
              <p>Create a new server from the hosted panel. The actual install still happens locally inside Releu.</p>
              <form class="stack" data-form="create-server" style="margin-top:18px;">
                <div class="layout-grid">
                  <label class="span-4"><span class="meta-label">Server Name</span><input name="name" required placeholder="New server" /></label>
                  <label class="span-4"><span class="meta-label">Software</span><select name="software">${(snapshot?.softwareOptions ?? []).map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`).join("")}</select></label>
                  <label class="span-4"><span class="meta-label">Minecraft Version</span><input name="version" value="latest" placeholder="latest" /></label>
                  <label class="span-4"><span class="meta-label">Port</span><input name="port" type="number" min="1" max="65535" placeholder="25565" /></label>
                  <label class="span-8"><span class="meta-label">Description</span><input name="description" placeholder="Optional description" /></label>
                </div>
                <div class="row"><button type="submit" class="primary">Create Server</button></div>
              </form>
            </section>`
          : ""
      }
      ${renderRecentCommandsCard()}
    </div>`;
}

function renderOverviewSection() {
  const server = currentActiveServer();
  if (!server) {
    return `<div class="layout-grid"><section class="card span-12"><h2>No server selected</h2><p>Select a server from the switcher above to open its remote panel.</p></section>${renderRecentCommandsCard()}</div>`;
  }
  const metrics = server.server?.metrics ?? server.metrics ?? {};
  const installMeta = server.install ?? {};
  const properties = server.server?.properties ?? {};
  return `<div class="layout-grid">
      <section class="card span-7">
        <h2>${escapeHtml(server.name)}</h2>
        <p>${escapeHtml(server.description ?? "No description yet.")}</p>
        <div class="kv" style="margin-top:18px;">
          <div><strong>Status</strong><span>${escapeHtml(server.server?.status ?? "unknown")}</span></div>
          <div><strong>Port</strong><span class="mono">${escapeHtml(properties["server-port"] ?? 25565)}</span></div>
          <div><strong>Players</strong><span>${escapeHtml(formatNumber(server.server?.playerCount ?? server.players?.filter?.((entry) => entry.online)?.length ?? 0))}</span></div>
          <div><strong>Software</strong><span>${escapeHtml(installMeta.installedSoftware ?? installMeta.software ?? "Not installed")}</span></div>
          <div><strong>Version</strong><span>${escapeHtml(installMeta.installedVersion ?? installMeta.requestedVersion ?? "Unknown")}</span></div>
          <div><strong>World</strong><span>${escapeHtml(properties["level-name"] ?? "world")}</span></div>
        </div>
      </section>
      <section class="card span-5">
        <h2>Runtime</h2>
        <div class="kv">
          <div><strong>CPU</strong><span>${escapeHtml(formatNumber(metrics.cpuPercent ?? 0))}%</span></div>
          <div><strong>Memory</strong><span>${escapeHtml(formatNumber(metrics.memoryMb ?? 0))} MB</span></div>
          <div><strong>Ready</strong><span>${escapeHtml(server.setupComplete ? "Yes" : "No")}</span></div>
          <div><strong>EULA</strong><span>${escapeHtml(server.server?.eulaAccepted ? "Accepted" : "Not accepted")}</span></div>
        </div>
        <div class="row" style="margin-top:18px;">
          <button type="button" class="primary" data-action="power-start" ${actionAllowed("powerControls") ? "" : "disabled"}>Start</button>
          <button type="button" class="ghost" data-action="power-stop" ${actionAllowed("powerControls") ? "" : "disabled"}>Stop</button>
          <button type="button" class="ghost" data-action="power-restart" ${actionAllowed("powerControls") ? "" : "disabled"}>Restart</button>
          <button type="button" class="danger" data-action="power-kill" ${actionAllowed("powerControls") ? "" : "disabled"}>Kill</button>
        </div>
      </section>
      <section class="card span-12">
        <h2>Warning</h2>
        <p>This remote panel only works while the local Releu app stays open. The hosted shell never edits Remote Access permissions itself.</p>
      </section>
      ${renderRecentCommandsCard()}
    </div>`;
}

function renderConsoleSection() {
  const logs = Array.isArray(currentSnapshot()?.logs) ? currentSnapshot().logs : [];
  return `<div class="layout-grid">
      <section class="card span-12">
        <h2>Live Console Snapshot</h2>
        <p>This is a recent log window published by the local Releu app during each heartbeat.</p>
        <div class="console" style="margin-top:18px;">
          ${
            logs.length
              ? logs
                  .map(
                    (entry) => `<div class="console-line"><span class="meta">${escapeHtml(
                      formatTimestamp(entry.timestamp ?? entry.createdAt ?? ""),
                    )}</span> ${escapeHtml(entry.message ?? entry.line ?? "")}</div>`,
                  )
                  .join("")
              : `<div class="console-line">No logs were published yet.</div>`
          }
        </div>
      </section>
      <section class="card span-12">
        <h2>Send Command</h2>
        <p>Console commands stay blocked unless this link explicitly allows the dangerous console permission.</p>
        <form data-form="console-command" class="row" style="margin-top:18px;">
          <input name="command" placeholder="say Hello from releu.lol" ${actionAllowed("consoleCommands") ? "" : "disabled"} />
          <button type="submit" class="primary" ${actionAllowed("consoleCommands") ? "" : "disabled"}>Send</button>
        </form>
      </section>
      ${renderRecentCommandsCard()}
    </div>`;
}

function renderPlayersSection() {
  const players = Array.isArray(currentActiveServer()?.players) ? currentActiveServer().players : [];
  return `<div class="layout-grid">
      <section class="card span-12">
        <h2>Players</h2>
        <p>The hosted shell hides dangerous moderation buttons when this link does not have the matching permission.</p>
        <table class="table" style="margin-top:18px;">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Flags</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              players.length
                ? players
                    .map(
                      (player) => `<tr>
                        <td>
                          <strong>${escapeHtml(player.name)}</strong>
                          <div class="muted mono">${escapeHtml(player.uuid ?? "No UUID yet")}</div>
                        </td>
                        <td>${escapeHtml(player.online ? "Online" : "Offline")}</td>
                        <td>
                          <div class="chips">
                            ${player.op ? `<span class="chip">Op</span>` : ""}
                            ${player.whitelisted ? `<span class="chip">Whitelisted</span>` : ""}
                            ${player.banned ? `<span class="chip">Banned</span>` : ""}
                            ${player.gamemode ? `<span class="chip">${escapeHtml(player.gamemode)}</span>` : ""}
                          </div>
                        </td>
                        <td>
                          <div class="row">
                            <button type="button" class="ghost" data-action="player-toggle-op" data-player-name="${escapeHtml(player.name)}" ${actionAllowed("playerModeration") ? "" : "disabled"}>${player.op ? "Deop" : "Op"}</button>
                            <button type="button" class="ghost" data-action="player-toggle-whitelist" data-player-name="${escapeHtml(player.name)}" ${actionAllowed("playerModeration") ? "" : "disabled"}>${player.whitelisted ? "Unwhitelist" : "Whitelist"}</button>
                            <button type="button" class="ghost" data-action="player-toggle-ban" data-player-name="${escapeHtml(player.name)}" ${actionAllowed("playerModeration") ? "" : "disabled"}>${player.banned ? "Pardon" : "Ban"}</button>
                            <button type="button" class="danger" data-action="player-kick" data-player-name="${escapeHtml(player.name)}" ${player.online && actionAllowed("playerModeration") ? "" : "disabled"}>Kick</button>
                          </div>
                        </td>
                      </tr>`,
                    )
                    .join("")
                : `<tr><td colspan="4">No players are known on this server yet.</td></tr>`
            }
          </tbody>
        </table>
      </section>
      ${renderRecentCommandsCard()}
    </div>`;
}

function renderWorldsSection() {
  const worlds = Array.isArray(currentActiveServer()?.worlds) ? currentActiveServer().worlds : [];
  return `<div class="layout-grid">
      <section class="card span-12">
        <h2>Worlds</h2>
        <p>Select the active world or regenerate one. Regeneration only prepares the reset; Minecraft will create the fresh world on next server start.</p>
        <div class="server-list" style="margin-top:18px;">
          ${
            worlds.length
              ? worlds
                  .map(
                    (world) => `<article class="server-item">
                        <header>
                          <div>
                            <div class="eyebrow">${world.isActive ? "Active world" : "Available world"}</div>
                            <h3>${escapeHtml(world.name)}</h3>
                            <p>${escapeHtml(world.lastModifiedAt ? `Last modified ${formatTimestamp(world.lastModifiedAt)}` : "Not generated yet.")}</p>
                          </div>
                          <div class="chips">
                            ${world.netherExists ? `<span class="chip">Nether</span>` : ""}
                            ${world.endExists ? `<span class="chip">End</span>` : ""}
                            ${world.exists ? `<span class="chip">Base</span>` : `<span class="chip">Missing</span>`}
                          </div>
                        </header>
                        <div class="row" style="margin-top:16px;">
                          <button type="button" class="${world.isActive ? "primary" : "ghost"}" data-action="world-select" data-world-name="${escapeHtml(world.name)}" ${actionAllowed("worldImportDelete") ? "" : "disabled"}>${world.isActive ? "Selected" : "Set Active"}</button>
                          <button type="button" class="danger" data-action="world-regenerate" data-world-name="${escapeHtml(world.name)}" ${actionAllowed("worldImportDelete") ? "" : "disabled"}>Regenerate</button>
                        </div>
                      </article>`,
                  )
                  .join("")
              : `<div class="simple-list-item"><div class="muted">No worlds were published in the remote snapshot yet.</div></div>`
          }
        </div>
      </section>
      ${renderRecentCommandsCard()}
    </div>`;
}

function renderAssetBucket(label, kind, items) {
  return `<section class="card span-6">
      <h2>${escapeHtml(label)}</h2>
      <div class="stack" style="margin-top:18px;">
        ${
          items.length
            ? items
                .map(
                  (entry) => `<div class="simple-list-item">
                      <div class="row" style="justify-content:space-between;">
                        <div>
                          <strong>${escapeHtml(entry.displayName ?? entry.name)}</strong>
                          <div class="muted mono">${escapeHtml(entry.name)}</div>
                        </div>
                        <div class="chips">
                          ${entry.versionNumber ? `<span class="chip">${escapeHtml(entry.versionNumber)}</span>` : ""}
                          ${entry.restartRequired ? `<span class="chip">Restart required</span>` : ""}
                        </div>
                      </div>
                      <div class="row" style="margin-top:14px;">
                        <button type="button" class="danger" data-action="remove-asset" data-asset-kind="${escapeHtml(kind)}" data-file-name="${escapeHtml(entry.name)}" ${actionAllowed("addonInstallRemove") ? "" : "disabled"}>Remove</button>
                      </div>
                    </div>`,
                )
                .join("")
            : `<div class="simple-list-item"><div class="muted">No ${escapeHtml(label.toLowerCase())} are installed.</div></div>`
        }
      </div>
    </section>`;
}

function renderAddonsSection() {
  const active = currentActiveServer();
  const plugins = Array.isArray(active?.plugins) ? active.plugins : [];
  const mods = Array.isArray(active?.mods) ? active.mods : [];
  const resourcePackUrl = active?.server?.properties?.["resource-pack"] ?? "";
  const catalog = state.catalogSearch.result;
  return `<div class="layout-grid">
      ${renderAssetBucket("Plugins", "plugin", plugins)}
      ${renderAssetBucket("Mods", "mod", mods)}
      <section class="card span-12">
        <h2>Resource Pack</h2>
        <div class="kv">
          <div><strong>Configured URL</strong><span class="mono">${escapeHtml(resourcePackUrl || "None")}</span></div>
          <div><strong>SHA1</strong><span class="mono">${escapeHtml(active?.server?.properties?.["resource-pack-sha1"] ?? "")}</span></div>
        </div>
      </section>
      ${
        actionAllowed("addonInstallRemove")
          ? `<section class="card span-6">
              <h2>Install From URL</h2>
              <p>Direct URL installs are best for plugin or mod jars.</p>
              <form class="stack" data-form="asset-url" style="margin-top:18px;">
                <label><span class="meta-label">Type</span><select name="kind"><option value="plugin">Plugin</option><option value="mod">Mod</option></select></label>
                <label><span class="meta-label">URL</span><input name="url" type="url" required placeholder="https://example.com/mod.jar" /></label>
                <div class="row"><button type="submit" class="primary">Install</button></div>
              </form>
            </section>`
          : ""
      }
      <section class="card ${actionAllowed("addonInstallRemove") ? "span-6" : "span-12"}">
        <h2>Catalog Search</h2>
        <p>Search Modrinth from the hosted panel and queue an install if this link is allowed to do it.</p>
        <form class="stack" data-form="catalog-search" style="margin-top:18px;">
          <label><span class="meta-label">Type</span><select name="kind"><option value="plugin">Plugin</option><option value="mod">Mod</option><option value="resourcepack">Resource pack</option></select></label>
          <label><span class="meta-label">Query</span><input name="query" required placeholder="fabric api" value="${escapeHtml(state.catalogSearch.query)}" /></label>
          <div class="row"><button type="submit" class="ghost">Search</button></div>
        </form>
        ${
          catalog
            ? `<div class="stack" style="margin-top:18px;">${
                (catalog.results ?? []).length
                  ? catalog.results
                      .map(
                        (entry) => `<div class="simple-list-item">
                            <div class="row" style="justify-content:space-between;">
                              <div>
                                <strong>${escapeHtml(entry.title ?? entry.name ?? entry.projectSlug ?? "Catalog result")}</strong>
                                <div class="muted">${escapeHtml(entry.description ?? "")}</div>
                              </div>
                              <button type="button" class="primary" data-action="catalog-install" data-project-id="${escapeHtml(entry.projectId)}" data-catalog-kind="${escapeHtml(catalog.kind)}" ${actionAllowed("addonInstallRemove") ? "" : "disabled"}>Install</button>
                            </div>
                          </div>`,
                      )
                      .join("")
                  : `<div class="simple-list-item"><div class="muted">No catalog results for this search.</div></div>`
              }</div>`
            : ""
        }
      </section>
      ${renderRecentCommandsCard()}
    </div>`;
}

function renderBackupsSection() {
  const backups = Array.isArray(currentActiveServer()?.backups?.recent)
    ? currentActiveServer().backups.recent
    : [];
  return `<div class="layout-grid">
      <section class="card span-12">
        <h2>Local Backups</h2>
        <p>Backups stay on the machine running Releu. This hosted panel only asks the local app to create or restore them.</p>
        <div class="row" style="margin-top:18px;">
          <button type="button" class="primary" data-action="backup-create" ${actionAllowed("backupCreate") ? "" : "disabled"}>Create Backup</button>
        </div>
        <table class="table" style="margin-top:18px;">
          <thead>
            <tr>
              <th>When</th>
              <th>Size</th>
              <th>Folder</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${
              backups.length
                ? backups
                    .map(
                      (backup) => `<tr>
                        <td>${escapeHtml(formatTimestamp(backup.createdAt))}</td>
                        <td>${escapeHtml(formatBytes(backup.bytes ?? 0))}</td>
                        <td class="mono">${escapeHtml(backup.name ?? backup.path ?? "")}</td>
                        <td><button type="button" class="ghost" data-action="backup-restore" data-backup-name="${escapeHtml(backup.name ?? "")}" ${actionAllowed("backupRestoreDelete") ? "" : "disabled"}>Restore</button></td>
                      </tr>`,
                    )
                    .join("")
                : `<tr><td colspan="4">No backups were published yet.</td></tr>`
            }
          </tbody>
        </table>
      </section>
      ${renderRecentCommandsCard()}
    </div>`;
}

function renderSoftwareSection() {
  const active = currentActiveServer();
  const installMeta = active?.install ?? {};
  const softwareOptions = Array.isArray(currentSnapshot()?.softwareOptions)
    ? currentSnapshot().softwareOptions
    : [];
  const versionOptions =
    state.softwareVersions.software && state.softwareVersions.versions.length
      ? `<div class="chips" style="margin-top:14px;">${state.softwareVersions.versions
          .slice(0, 24)
          .map((version) => `<button type="button" class="ghost" data-action="pick-version" data-version-value="${escapeHtml(version)}">${escapeHtml(version)}</button>`)
          .join("")}</div>`
      : "";
  return `<div class="layout-grid">
      <section class="card span-5">
        <h2>Installed Software</h2>
        <div class="kv">
          <div><strong>Software</strong><span>${escapeHtml(installMeta.installedSoftware ?? installMeta.software ?? "Unknown")}</span></div>
          <div><strong>Version</strong><span>${escapeHtml(installMeta.installedVersion ?? installMeta.requestedVersion ?? "Unknown")}</span></div>
          <div><strong>Build</strong><span>${escapeHtml(installMeta.installedBuild ?? "Unknown")}</span></div>
          <div><strong>Jar</strong><span class="mono">${escapeHtml(installMeta.downloadedTo ?? "")}</span></div>
        </div>
      </section>
      <section class="card span-7">
        <h2>Install Or Switch</h2>
        <p>The remote shell can queue a software install, but the actual download and filesystem changes still happen locally.</p>
        <form class="stack" data-form="software-install" style="margin-top:18px;">
          <div class="layout-grid">
            <label class="span-4"><span class="meta-label">Software</span><select name="software">${softwareOptions.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`).join("")}</select></label>
            <label class="span-4"><span class="meta-label">Version</span><input name="requestedVersion" value="latest" placeholder="latest" /></label>
            <div class="span-4 row" style="align-items:end;">
              <button type="button" class="ghost" data-action="load-software-versions">Load Versions</button>
            </div>
          </div>
          ${versionOptions}
          <div class="row">
            <button type="submit" class="primary" ${actionAllowed("softwareChanges") ? "" : "disabled"}>Install Software</button>
          </div>
        </form>
      </section>
      ${renderRecentCommandsCard()}
    </div>`;
}

function renderMiscSection() {
  const properties = currentActiveServer()?.server?.properties ?? {};
  const misc = currentActiveServer()?.misc ?? {};
  const allowCrackedClients = String(properties["online-mode"] ?? "true").toLowerCase() !== "true";
  return `<div class="layout-grid">
      <section class="card span-12">
        <h2>Misc Settings</h2>
        <p>This is a smaller hosted subset of the local Misc screen. Anything saved here still applies through the local panel backend.</p>
        <form class="stack" data-form="misc-settings" style="margin-top:18px;">
          <div class="layout-grid">
            <label class="span-4"><span class="meta-label">Allow cracked clients</span><select name="allowCrackedClients"><option value="false" ${!allowCrackedClients ? "selected" : ""}>No</option><option value="true" ${allowCrackedClients ? "selected" : ""}>Yes</option></select></label>
            <label class="span-4"><span class="meta-label">Whitelist</span><select name="whitelist"><option value="false" ${String(properties["white-list"] ?? "false").toLowerCase() !== "true" ? "selected" : ""}>Disabled</option><option value="true" ${String(properties["white-list"] ?? "false").toLowerCase() === "true" ? "selected" : ""}>Enabled</option></select></label>
            <label class="span-4"><span class="meta-label">PVP</span><select name="pvp"><option value="true" ${String(properties.pvp ?? "true").toLowerCase() === "true" ? "selected" : ""}>Enabled</option><option value="false" ${String(properties.pvp ?? "true").toLowerCase() !== "true" ? "selected" : ""}>Disabled</option></select></label>
            <label class="span-4"><span class="meta-label">Keep inventory</span><select name="keepInventory"><option value="false" ${!misc.keepInventory ? "selected" : ""}>Disabled</option><option value="true" ${misc.keepInventory ? "selected" : ""}>Enabled</option></select></label>
            <label class="span-4"><span class="meta-label">Shared health</span><select name="sharedHealth"><option value="false" ${!misc.sharedHealth ? "selected" : ""}>Disabled</option><option value="true" ${misc.sharedHealth ? "selected" : ""}>Enabled</option></select></label>
            <label class="span-4"><span class="meta-label">Allow End</span><select name="allowEnd"><option value="true" ${String(properties["allow-end"] ?? "true").toLowerCase() === "true" ? "selected" : ""}>Enabled</option><option value="false" ${String(properties["allow-end"] ?? "true").toLowerCase() !== "true" ? "selected" : ""}>Disabled</option></select></label>
            <label class="span-4"><span class="meta-label">Allow Nether</span><select name="allowNether"><option value="true" ${String(properties["allow-nether"] ?? "true").toLowerCase() === "true" ? "selected" : ""}>Enabled</option><option value="false" ${String(properties["allow-nether"] ?? "true").toLowerCase() !== "true" ? "selected" : ""}>Disabled</option></select></label>
            <label class="span-4"><span class="meta-label">Command Blocks</span><select name="commandBlocks"><option value="false" ${String(properties["enable-command-block"] ?? "false").toLowerCase() !== "true" ? "selected" : ""}>Disabled</option><option value="true" ${String(properties["enable-command-block"] ?? "false").toLowerCase() === "true" ? "selected" : ""}>Enabled</option></select></label>
          </div>
          <div class="row"><button type="submit" class="primary" ${actionAllowed("settingsChanges") ? "" : "disabled"}>Save Misc Settings</button></div>
        </form>
      </section>
      ${renderRecentCommandsCard()}
    </div>`;
}

function renderSettingsSection() {
  const active = currentActiveServer();
  const launcher = active?.launcher ?? {};
  const properties = active?.server?.properties ?? {};
  return `<div class="layout-grid">
      <section class="card span-6">
        <h2>Runtime Settings</h2>
        <form class="stack" data-form="runtime-settings" style="margin-top:18px;">
          <label><span class="meta-label">Java Path</span><input name="javaPath" value="${escapeHtml(launcher.javaPath ?? "java")}" /></label>
          <div class="layout-grid">
            <label class="span-6"><span class="meta-label">Min RAM</span><input name="minRam" value="${escapeHtml(launcher.minRam ?? "2G")}" /></label>
            <label class="span-6"><span class="meta-label">Max RAM</span><input name="maxRam" value="${escapeHtml(launcher.maxRam ?? "4G")}" /></label>
            <label class="span-6"><span class="meta-label">CPU Cores</span><input name="cpuCores" type="number" min="0" value="${escapeHtml(launcher.cpuCores ?? 0)}" /></label>
            <label class="span-6"><span class="meta-label">GPU Share</span><input name="gpuShare" type="number" min="0" max="100" value="${escapeHtml(launcher.gpuShare ?? 0)}" /></label>
          </div>
          <div class="row"><button type="submit" class="primary" ${actionAllowed("settingsChanges") ? "" : "disabled"}>Save Runtime</button></div>
        </form>
      </section>
      <section class="card span-6">
        <h2>Core Server Properties</h2>
        <form class="stack" data-form="server-properties" style="margin-top:18px;">
          <label><span class="meta-label">MOTD</span><input name="motd" value="${escapeHtml(properties.motd ?? "")}" /></label>
          <div class="layout-grid">
            <label class="span-6"><span class="meta-label">Server Port</span><input name="server-port" type="number" min="1" max="65535" value="${escapeHtml(properties["server-port"] ?? 25565)}" /></label>
            <label class="span-6"><span class="meta-label">Max Players</span><input name="max-players" type="number" min="1" value="${escapeHtml(properties["max-players"] ?? 20)}" /></label>
            <label class="span-6"><span class="meta-label">Difficulty</span><input name="difficulty" value="${escapeHtml(properties.difficulty ?? "normal")}" /></label>
            <label class="span-6"><span class="meta-label">Simulation Distance</span><input name="simulation-distance" type="number" min="4" max="32" value="${escapeHtml(properties["simulation-distance"] ?? 10)}" /></label>
          </div>
          <div class="row"><button type="submit" class="primary" ${actionAllowed("settingsChanges") ? "" : "disabled"}>Save Properties</button></div>
        </form>
      </section>
      ${renderRecentCommandsCard()}
    </div>`;
}

function renderBody() {
  switch (state.activeSection) {
    case "overview":
      return renderOverviewSection();
    case "console":
      return renderConsoleSection();
    case "players":
      return renderPlayersSection();
    case "worlds":
      return renderWorldsSection();
    case "addons":
      return renderAddonsSection();
    case "backups":
      return renderBackupsSection();
    case "software":
      return renderSoftwareSection();
    case "misc":
      return renderMiscSection();
    case "settings":
      return renderSettingsSection();
    default:
      return renderDashboardSection();
  }
}

function renderLogin() {
  const bootstrap = state.bootstrap ?? {};
  root.innerHTML = `<div class="login-shell">
      <section class="login-card">
        <div class="eyebrow">Remote Access</div>
        <h1 class="title" style="font-size:3rem;">Unlock Releu</h1>
        <p class="detail">This remote shell is served from releu.lol, but every action still runs on the local Releu machine while the app stays open.</p>
        <div class="kv" style="margin-top:18px;">
          <div><strong>Link</strong><span class="mono">${escapeHtml(bootstrap.publicUrl ?? "")}</span></div>
          <div><strong>Protection</strong><span>${escapeHtml(bootstrap.passwordEnabled ? "Password required" : "Secret link only")}</span></div>
        </div>
        <form data-form="viewer-login" class="stack" style="margin-top:22px;">
          ${
            bootstrap.passwordEnabled
              ? `<label><span class="meta-label">Password</span><input name="password" type="password" value="${escapeHtml(state.authPassword)}" placeholder="Enter the remote password" ${state.authBusy ? "disabled" : ""} /></label>`
              : `<div class="simple-list-item"><div class="muted">This link does not need a password. Continue to open the hosted panel.</div></div>`
          }
          ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
          <div class="row">
            <button type="submit" class="primary" ${state.authBusy ? "disabled" : ""}>${bootstrap.passwordEnabled ? "Unlock Remote Panel" : "Continue"}</button>
          </div>
        </form>
      </section>
    </div>`;
}

function renderOffline() {
  root.innerHTML = `<div class="login-shell">
      <section class="login-card">
        <div class="eyebrow">Remote Access</div>
        <h1 class="title" style="font-size:3rem;">Unavailable</h1>
        <p class="detail">Releu is not open right now, so this remote panel cannot reach the local machine.</p>
        <div class="row" style="margin-top:22px;">
          <button type="button" class="ghost" data-action="refresh-session">Retry</button>
          ${
            remoteLink()
              ? `<button type="button" class="primary" data-action="copy-link">Copy Link</button>`
              : ""
          }
        </div>
        ${state.error ? `<div class="error" style="margin-top:18px;">${escapeHtml(state.error)}</div>` : ""}
      </section>
    </div>`;
}

function renderLoading() {
  root.innerHTML = `<div class="login-shell"><section class="login-card"><div class="eyebrow">Remote Access</div><h1 class="title" style="font-size:3rem;">Connecting</h1><p class="detail">Releu is checking the hosted relay, viewer session, and latest local panel snapshot.</p></section></div>`;
}

function renderApp() {
  const remote = currentRemote();
  const snapshot = currentSnapshot();
  const sectionButtons = availableSections()
    .map(
      ([sectionId, meta]) => `<button type="button" class="${state.activeSection === sectionId ? "active" : ""}" data-action="open-section" data-section-id="${escapeHtml(sectionId)}">${escapeHtml(meta.label)}</button>`,
    )
    .join("");

  root.innerHTML = `<div class="remote-root">
      <aside class="sidebar">
        <div class="brand">Releu</div>
        <div class="brand-sub">Hosted remote access for the local-first Minecraft control panel.</div>
        <div class="nav">${sectionButtons}</div>
        <div class="nav-meta stack">
          <div>
            <div class="meta-label">Access</div>
            <div style="margin-top:8px;">${escapeHtml(remote?.mode ?? "view")}</div>
          </div>
          <div>
            <div class="meta-label">Warning</div>
            <div style="margin-top:8px;" class="muted">This only works while Releu is open.</div>
          </div>
          <div>
            <div class="meta-label">Current server</div>
            <div style="margin-top:8px;">${escapeHtml(currentActiveServer()?.name ?? snapshot?.activeServerId ?? "None")}</div>
          </div>
        </div>
      </aside>
      <main class="main">
        ${renderStatusBar()}
        ${state.notice ? `<section class="card span-12" style="margin-bottom:18px;"><div class="muted">${escapeHtml(state.notice)}</div></section>` : ""}
        ${state.error ? `<section class="card span-12" style="margin-bottom:18px;"><div class="error">${escapeHtml(state.error)}</div></section>` : ""}
        ${renderBody()}
      </main>
    </div>`;
}

function render() {
  if (state.loading) {
    renderLoading();
    return;
  }
  if (state.offline) {
    renderOffline();
    return;
  }
  if (state.authRequired || !state.session) {
    renderLogin();
    return;
  }
  renderApp();
}

async function handlePlayerAction(type, button) {
  const playerName = String(button.dataset.playerName ?? "").trim();
  if (!playerName) {
    return;
  }
  if (type === "player-kick") {
    const reason = window.prompt("Kick reason", "Removed by remote panel");
    if (reason === null) {
      return;
    }
    await queueCommand(
      "playerAction",
      {
        serverId: normalizeServerSelection(),
        playerName,
        action: "kick",
        reason,
      },
      { label: `Kick for ${playerName}` },
    );
    await loadSession({ silent: true });
    return;
  }
  if (type === "player-toggle-ban") {
    const player = currentActiveServer()?.players?.find((entry) => entry.name === playerName);
    if (player?.banned) {
      await queueCommand(
        "playerAction",
        {
          serverId: normalizeServerSelection(),
          playerName,
          action: "pardon",
        },
        { label: `Pardon for ${playerName}` },
      );
    } else {
      const reason = window.prompt("Ban reason", "Banned from remote panel");
      if (reason === null) {
        return;
      }
      await queueCommand(
        "playerAction",
        {
          serverId: normalizeServerSelection(),
          playerName,
          action: "ban",
          reason,
        },
        { label: `Ban for ${playerName}` },
      );
    }
    await loadSession({ silent: true });
    return;
  }
  if (type === "player-toggle-op") {
    const player = currentActiveServer()?.players?.find((entry) => entry.name === playerName);
    await queueCommand(
      "playerAction",
      {
        serverId: normalizeServerSelection(),
        playerName,
        action: player?.op ? "deop" : "op",
      },
      { label: `${player?.op ? "Deop" : "Op"} for ${playerName}` },
    );
    await loadSession({ silent: true });
    return;
  }
  if (type === "player-toggle-whitelist") {
    const player = currentActiveServer()?.players?.find((entry) => entry.name === playerName);
    await queueCommand(
      "playerAction",
      {
        serverId: normalizeServerSelection(),
        playerName,
        action: player?.whitelisted ? "whitelist-remove" : "whitelist-add",
      },
      { label: `${player?.whitelisted ? "Whitelist removal" : "Whitelist add"} for ${playerName}` },
    );
    await loadSession({ silent: true });
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }
  const action = String(button.dataset.action ?? "").trim();
  try {
    if (action === "open-section") {
      state.activeSection = normalizeSection(button.dataset.sectionId);
      render();
      return;
    }
    if (action === "refresh-session") {
      state.loading = true;
      render();
      await loadSession();
      state.loading = false;
      render();
      return;
    }
    if (action === "copy-link") {
      await navigator.clipboard.writeText(remoteLink());
      setNotice("Remote link copied.");
      render();
      return;
    }
    if (action === "select-server") {
      const serverId = String(button.dataset.serverId ?? "").trim();
      if (!serverId || serverId === String(currentSnapshot()?.activeServerId ?? "").trim()) {
        return;
      }
      await queueCommand("selectServer", { serverId }, { label: "Server switch" });
      await loadSession({ silent: true });
      render();
      return;
    }
    if (action === "delete-server") {
      const serverId = String(button.dataset.serverId ?? "").trim();
      const serverName = String(button.dataset.serverName ?? serverId).trim();
      if (!window.confirm(`Delete ${serverName}? This removes its local files and backups.`)) {
        return;
      }
      await queueCommand("deleteServer", { serverId }, { label: "Server delete" });
      await loadSession({ silent: true });
      render();
      return;
    }
    if (action === "power-start" || action === "power-stop" || action === "power-restart" || action === "power-kill") {
      const typeMap = {
        "power-start": "startServer",
        "power-stop": "stopServer",
        "power-restart": "restartServer",
        "power-kill": "killServer",
      };
      await queueCommand(typeMap[action], { serverId: normalizeServerSelection() }, { label: SECTION_META.overview.label });
      await loadSession({ silent: true });
      render();
      return;
    }
    if (
      action === "player-kick" ||
      action === "player-toggle-op" ||
      action === "player-toggle-whitelist" ||
      action === "player-toggle-ban"
    ) {
      await handlePlayerAction(action, button);
      render();
      return;
    }
    if (action === "world-select") {
      const worldName = String(button.dataset.worldName ?? "").trim();
      await queueCommand(
        "worldSelect",
        {
          serverId: normalizeServerSelection(),
          name: worldName,
        },
        { label: `Select world ${worldName}` },
      );
      await loadSession({ silent: true });
      render();
      return;
    }
    if (action === "world-regenerate") {
      const worldName = String(button.dataset.worldName ?? "").trim();
      const seed = window.prompt("Optional seed for the regenerated world", "");
      if (seed === null) {
        return;
      }
      if (!window.confirm(`Prepare ${worldName} for regeneration on the next server start?`)) {
        return;
      }
      await queueCommand(
        "worldRegenerate",
        {
          serverId: normalizeServerSelection(),
          name: worldName,
          seed,
        },
        { label: `Regenerate world ${worldName}` },
      );
      await loadSession({ silent: true });
      render();
      return;
    }
    if (action === "remove-asset") {
      const kind = String(button.dataset.assetKind ?? "").trim();
      const fileName = String(button.dataset.fileName ?? "").trim();
      if (!window.confirm(`Remove ${fileName}?`)) {
        return;
      }
      await queueCommand(
        "removeAsset",
        {
          serverId: normalizeServerSelection(),
          kind,
          fileName,
        },
        { label: `Remove ${fileName}` },
      );
      await loadSession({ silent: true });
      render();
      return;
    }
    if (action === "backup-create") {
      await queueCommand(
        "backupCreate",
        {
          serverId: normalizeServerSelection(),
        },
        { label: "Backup create" },
      );
      await loadSession({ silent: true });
      render();
      return;
    }
    if (action === "backup-restore") {
      const backupName = String(button.dataset.backupName ?? "").trim();
      if (!backupName || !window.confirm(`Restore backup ${backupName}?`)) {
        return;
      }
      await queueCommand(
        "backupRevert",
        {
          serverId: normalizeServerSelection(),
          backupName,
        },
        { label: `Restore ${backupName}` },
      );
      await loadSession({ silent: true });
      render();
      return;
    }
    if (action === "catalog-install") {
      await queueCommand(
        "catalogInstall",
        {
          serverId: normalizeServerSelection(),
          kind: button.dataset.catalogKind,
          projectId: button.dataset.projectId,
        },
        { label: "Catalog install" },
      );
      await loadSession({ silent: true });
      render();
      return;
    }
    if (action === "load-software-versions") {
      const form = button.closest("form");
      const software = String(form?.elements?.software?.value ?? "purpur").trim();
      const result = await queueCommand(
        "softwareVersions",
        {
          software,
          serverId: normalizeServerSelection(),
        },
        { label: `Load versions for ${software}` },
      );
      state.softwareVersions = {
        software,
        versions: Array.isArray(result) ? result : Array.isArray(result?.versions) ? result.versions : [],
      };
      render();
      return;
    }
    if (action === "pick-version") {
      const form = document.querySelector('[data-form="software-install"]');
      if (form?.elements?.requestedVersion) {
        form.elements.requestedVersion.value = button.dataset.versionValue ?? "latest";
      }
      return;
    }
  } catch (error) {
    setError(error.message);
    render();
  }
});

document.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-action='switch-server']");
  if (!select) {
    return;
  }
  try {
    const serverId = String(select.value ?? "").trim();
    if (!serverId || serverId === String(currentSnapshot()?.activeServerId ?? "").trim()) {
      return;
    }
    await queueCommand("selectServer", { serverId }, { label: "Server switch" });
    await loadSession({ silent: true });
    render();
  } catch (error) {
    setError(error.message);
    render();
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) {
    return;
  }
  event.preventDefault();
  const data = new FormData(form);
  const formId = String(form.dataset.form ?? "").trim();
  try {
    if (formId === "viewer-login") {
      await authenticate(String(data.get("password") ?? ""));
      render();
      return;
    }
    if (formId === "create-server") {
      await queueCommand(
        "createServer",
        {
          name: String(data.get("name") ?? "").trim(),
          description: String(data.get("description") ?? "").trim(),
          software: String(data.get("software") ?? "purpur").trim(),
          version: String(data.get("version") ?? "latest").trim() || "latest",
          port: String(data.get("port") ?? "").trim() || undefined,
        },
        { label: "Create server" },
      );
      await loadSession({ silent: true });
      form.reset();
      render();
      return;
    }
    if (formId === "console-command") {
      const command = String(data.get("command") ?? "").trim();
      if (!command) {
        throw new Error("A command is required.");
      }
      await queueCommand(
        "sendCommand",
        {
          serverId: normalizeServerSelection(),
          command,
        },
        { label: "Console command" },
      );
      await loadSession({ silent: true });
      form.reset();
      render();
      return;
    }
    if (formId === "asset-url") {
      await queueCommand(
        "installAssetFromUrl",
        {
          serverId: normalizeServerSelection(),
          kind: String(data.get("kind") ?? "plugin").trim(),
          url: String(data.get("url") ?? "").trim(),
        },
        { label: "Direct install" },
      );
      await loadSession({ silent: true });
      form.reset();
      render();
      return;
    }
    if (formId === "catalog-search") {
      const kind = String(data.get("kind") ?? "plugin").trim();
      const query = String(data.get("query") ?? "").trim();
      const result = await queueCommand(
        "catalogSearch",
        {
          serverId: normalizeServerSelection(),
          kind,
          query,
          limit: 12,
        },
        { label: "Catalog search" },
      );
      state.catalogSearch = {
        kind,
        query,
        result,
      };
      render();
      return;
    }
    if (formId === "software-install") {
      await queueCommand(
        "softwareInstall",
        {
          serverId: normalizeServerSelection(),
          software: String(data.get("software") ?? "purpur").trim(),
          requestedVersion: String(data.get("requestedVersion") ?? "latest").trim() || "latest",
          acceptEula: true,
        },
        { label: "Software install" },
      );
      await loadSession({ silent: true });
      render();
      return;
    }
    if (formId === "misc-settings") {
      await queueCommand(
        "updateMiscSettings",
        {
          serverId: normalizeServerSelection(),
          allowCrackedClients: String(data.get("allowCrackedClients") ?? "false") === "true",
          whitelist: String(data.get("whitelist") ?? "false") === "true",
          pvp: String(data.get("pvp") ?? "true") === "true",
          keepInventory: String(data.get("keepInventory") ?? "false") === "true",
          sharedHealth: String(data.get("sharedHealth") ?? "false") === "true",
          allowEnd: String(data.get("allowEnd") ?? "true") === "true",
          allowNether: String(data.get("allowNether") ?? "true") === "true",
          commandBlocks: String(data.get("commandBlocks") ?? "false") === "true",
        },
        { label: "Misc settings save" },
      );
      await loadSession({ silent: true });
      render();
      return;
    }
    if (formId === "runtime-settings") {
      await queueCommand(
        "updateRuntimeSettings",
        {
          serverId: normalizeServerSelection(),
          javaPath: String(data.get("javaPath") ?? "java").trim(),
          minRam: String(data.get("minRam") ?? "2G").trim(),
          maxRam: String(data.get("maxRam") ?? "4G").trim(),
          cpuCores: Number(data.get("cpuCores") ?? 0),
          gpuShare: Number(data.get("gpuShare") ?? 0),
        },
        { label: "Runtime settings save" },
      );
      await loadSession({ silent: true });
      render();
      return;
    }
    if (formId === "server-properties") {
      await queueCommand(
        "updateServerProperties",
        {
          serverId: normalizeServerSelection(),
          motd: String(data.get("motd") ?? "").trim(),
          "server-port": Number(data.get("server-port") ?? 25565),
          "max-players": Number(data.get("max-players") ?? 20),
          difficulty: String(data.get("difficulty") ?? "normal").trim(),
          "simulation-distance": Number(data.get("simulation-distance") ?? 10),
        },
        { label: "Server properties save" },
      );
      await loadSession({ silent: true });
      render();
    }
  } catch (error) {
    setError(error.message);
    render();
  }
});

boot().catch((error) => {
  setError(error.message ?? "Failed to start the hosted shell.");
  state.loading = false;
  render();
});
