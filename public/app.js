const app = document.getElementById("app");
const STATE_POLL_MS = 12000;
const LOG_POLL_MS = 2500;
const SOFTWARE_ORDER = ["purpur", "paper", "vanilla", "fabric", "forge", "neoforge", "quilt"];
const DEPENDENCY_CHECK_MIN_MS = 3000;
const DEPENDENCY_CHECK_MAX_MS = 6000;
const INITIAL_PANEL_CONNECT_TIMEOUT_MS = 15000;
const INITIAL_PANEL_CONNECT_RETRY_MS = 350;
const UI_VARIANT_CLASSIC = "classic";
const UI_VARIANT_PELICAN_BLUEPRINT = "pelican-blueprint";
const PELICAN_ASSET_HREFS = [
  "/vendor/pelican/filament/app.css",
  "/vendor/pelican/forms/forms.css",
  "/vendor/pelican/support/support.css",
];

function detectInitialUiVariant() {
  return UI_VARIANT_PELICAN_BLUEPRINT;
}

const runtime = { latestLogId: 0, consoleText: "", data: null, versionCache: new Map() };
let playitGatePollTimer = null;
let playitGateConnectPromise = null;
let logsPollTimer = null;
let statePollTimer = null;
let miscAutosaveTimer = null;
const startup = {
  redirectReady: false,
  dependenciesReady: false,
  dependencyPromise: null,
};
const ui = {
  bootstrap: {
    active: true,
    stage: "checking",
    title: "Checking For Dependencies",
    detail: "Checking Java runtimes and playit.gg tools.",
    warning: "",
    metaLeft: "System Node_01",
    metaRight: "",
    progressWidth: 45,
    minDurationMs: 0,
  },
  screen: "manager",
  section: "server",
  managerView: "grid",
  installDraft: null,
  createDraft: null,
  catalog: { plugin: null, mod: null },
  modal: null,
  operation: null,
  appUpdateAttemptedVersion: null,
  cloudBackupStatus: null,
  cloudBackupStatusLoading: false,
  cloudBackupStatusFetchedAt: 0,
  cloudBackupDraft: {
    deviceLabel: "",
    accountUsername: "",
    accountPassword: "",
    targetRestoreKey: "",
  },
  playerDrafts: {},
  consoleDrafts: {},
  variant: detectInitialUiVariant(),
};

const sections = [
  { id: "server", label: "Overview" },
  { id: "software", label: "Software" },
  { id: "console", label: "Console" },
  { id: "players", label: "Players" },
  { id: "worlds", label: "Worlds" },
  { id: "addons", label: "Add-ons" },
  { id: "backups", label: "Backups" },
  { id: "misc", label: "Misc" },
  { id: "settings", label: "Settings" },
];

const C = {
  card: "releu-panel border border-outline bg-surface p-6",
  cardAlt: "releu-panel border border-outline bg-black p-6",
  label: "text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500",
  labelOn: "text-[11px] font-bold uppercase tracking-[0.18em] text-white",
  input:
    "border border-outline bg-black px-4 py-3 text-white outline-none transition placeholder:text-zinc-700 focus:border-white",
  btn:
    "releu-button border border-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] transition",
  btnPrimary:
    "releu-button border border-white bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-black transition hover:bg-zinc-200",
  btnGhost:
    "releu-button border border-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white transition hover:bg-zinc-900",
  chip: "border border-outline px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400",
};

function isPelicanBlueprintVariant() {
  return ui.variant === UI_VARIANT_PELICAN_BLUEPRINT;
}

function syncVariantAssets() {
  const wantsPelican = isPelicanBlueprintVariant();
  document.documentElement.classList.add("dark");
  document.body.dataset.uiVariant = ui.variant;
  document.body.classList.toggle("releu-pelican-theme", wantsPelican);
  document.body.classList.toggle("fi-body", wantsPelican);
  document.body.classList.toggle("fi-body-has-sidebar", wantsPelican);

  const existing = new Map(
    Array.from(document.head.querySelectorAll('link[data-ui-variant-asset="pelican"]')).map((node) => [
      node.getAttribute("href"),
      node,
    ]),
  );

  if (!wantsPelican) {
    for (const node of existing.values()) {
      node.remove();
    }
    return;
  }

  for (const href of PELICAN_ASSET_HREFS) {
    if (existing.has(href)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.uiVariantAsset = "pelican";
    document.head.appendChild(link);
  }
}

function currentUiSettings() {
  return runtime.data?.uiSettings ?? {
    variant: UI_VARIANT_PELICAN_BLUEPRINT,
    hasChosenVariant: true,
  };
}

function isPelicanPreferenceSelected() {
  return currentUiSettings().variant === UI_VARIANT_PELICAN_BLUEPRINT;
}

function buildPelicanShellUrl(serverId = activeServer()?.id ?? runtime.data?.activeServerId ?? null) {
  const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
  return `/pelican-demo/servers.html${query}`;
}

function maybeRedirectToPreferredUi() {
  if (!startup.redirectReady) {
    return false;
  }
  const uiSettings = currentUiSettings();
  if (!uiSettings.hasChosenVariant || uiSettings.variant !== UI_VARIANT_PELICAN_BLUEPRINT) {
    return false;
  }
  if (window.location.pathname.startsWith("/pelican-demo/")) {
    return false;
  }
  window.location.replace(buildPelicanShellUrl());
  return true;
}

function syncUiPickerPrompt() {
  if (ui.modal?.type === "ui-picker") {
    ui.modal = null;
  }
}

async function saveUiPreference(variant, { redirect = true, hasChosenVariant = true } = {}) {
  const normalizedVariant =
    String(variant ?? "").trim().toLowerCase() === UI_VARIANT_PELICAN_BLUEPRINT
      ? UI_VARIANT_PELICAN_BLUEPRINT
      : UI_VARIANT_CLASSIC;
  const payload = await api("/api/settings/ui", {
    method: "POST",
    body: {
      variant: normalizedVariant,
      hasChosenVariant,
    },
  });
  runtime.data = payload.state;
  syncUiPickerPrompt();
  if (redirect) {
    if (normalizedVariant === UI_VARIANT_PELICAN_BLUEPRINT) {
      window.location.replace(buildPelicanShellUrl());
      return true;
    }
    if (window.location.pathname.startsWith("/pelican-demo/")) {
      window.location.replace("/");
      return true;
    }
  }
  render();
  return false;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

async function apiRaw(path, body, headers = {}) {
  const response = await fetch(path, { method: "POST", headers, body });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

function showError(error) {
  window.alert(error.message ?? String(error));
}

function isTransientLaunchFetchError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("load failed")
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatBytes(value) {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
}

function formatCount(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${numeric.toFixed(numeric >= 10 ? 0 : 1)}%`;
}

function formatMemoryFromMb(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  if (numeric >= 1024) return `${(numeric / 1024).toFixed(numeric >= 10240 ? 0 : 1)} GB`;
  return `${Math.round(numeric)} MB`;
}

function formatStatus(status) {
  const normalized = String(status ?? "stopped").toLowerCase();
  if (normalized === "running") return "Online";
  if (normalized === "starting") return "Starting";
  if (normalized === "stopping") return "Stopping";
  return "Offline";
}

function playerDraftKey(name) {
  return String(name ?? "").trim().toLowerCase();
}

function syncPlayerDrafts() {
  const players = activeServer()?.players ?? [];
  const nextDrafts = {};
  for (const player of players) {
    const key = playerDraftKey(player.name);
    const existing = ui.playerDrafts[key] ?? {};
    nextDrafts[key] = {
      reason: existing.reason ?? "",
      destination: existing.destination ?? "",
      mode: existing.mode ?? player.gamemode ?? "survival",
    };
  }
  ui.playerDrafts = nextDrafts;
}

function ensurePlayerDraft(player) {
  const key = playerDraftKey(player?.name);
  if (!ui.playerDrafts[key]) {
    ui.playerDrafts[key] = {
      reason: "",
      destination: "",
      mode: player?.gamemode ?? "survival",
    };
  } else if (!ui.playerDrafts[key].mode) {
    ui.playerDrafts[key].mode = player?.gamemode ?? "survival";
  }
  return ui.playerDrafts[key];
}

function serverStatusPresentation(server) {
  const operation = server?.server?.operation ?? server?.operation ?? null;
  if (operation?.active) {
    return {
      label: operation.shortLabel ?? operation.title ?? "Working",
      detail: operation.detail ?? "Releu is working on this server.",
      tone: { dot: "bg-white", text: "text-white" },
    };
  }

  const setupComplete = Boolean(
    server?.setupComplete ?? server?.server?.jarInstalled ?? server?.jarInstalled,
  );
  if (!setupComplete) {
    return {
      label: "Setup Required",
      detail: "Install server software to finish setup.",
      tone: { dot: "border border-white", text: "text-zinc-400" },
    };
  }

  const normalized = String(server?.server?.status ?? server?.status ?? "stopped").toLowerCase();
  if (normalized === "running") {
    return {
      label: "Online",
      detail: "The Minecraft server is online and accepting connections.",
      tone: { dot: "bg-white", text: "text-white" },
    };
  }
  if (normalized === "starting") {
    return {
      label: "Starting",
      detail: "Minecraft is booting and the public address may appear shortly.",
      tone: { dot: "bg-zinc-300", text: "text-zinc-200" },
    };
  }
  if (normalized === "stopping") {
    return {
      label: "Stopping",
      detail: "Minecraft is shutting down cleanly.",
      tone: { dot: "bg-zinc-500", text: "text-zinc-300" },
    };
  }
  return {
    label: "Offline",
    detail: "The server is installed but not running.",
    tone: { dot: "border border-white", text: "text-zinc-500" },
  };
}

function ramStringToMb(value, fallback = 4096) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return fallback;
  const match = raw.match(/^(\d+(?:\.\d+)?)([MGT])?$/);
  if (!match) return fallback;
  const numeric = Number(match[1]);
  const unit = match[2] ?? "M";
  if (unit === "G") return Math.round(numeric * 1024);
  if (unit === "T") return Math.round(numeric * 1024 * 1024);
  return Math.round(numeric);
}

function mbToRamString(value) {
  const mb = Math.max(512, Math.round(Number(value) || 0));
  return mb % 1024 === 0 ? `${mb / 1024}G` : `${mb}M`;
}

function activeServer() {
  return runtime.data?.activeServer ?? null;
}

function activeServerStatus() {
  return String(activeServer()?.server?.status ?? "").toLowerCase();
}

function isUiLocked() {
  return Boolean(ui.operation?.active);
}

function isCreateServerModalOpen() {
  return ui.modal?.type === "create-server";
}

function activeServerId() {
  const serverId = activeServer()?.id ?? runtime.data?.activeServerId ?? null;
  if (!serverId) throw new Error("Create or select a server first.");
  return serverId;
}

function activeServerPath(suffix) {
  return `/api/servers/${encodeURIComponent(activeServerId())}${suffix}`;
}

function consoleDraftKey(serverId = activeServer()?.id ?? runtime.data?.activeServerId ?? "default") {
  return String(serverId ?? "default");
}

function getConsoleDraft(serverId = activeServer()?.id ?? runtime.data?.activeServerId ?? null) {
  const key = consoleDraftKey(serverId);
  if (typeof ui.consoleDrafts[key] !== "string") {
    ui.consoleDrafts[key] = "";
  }
  return ui.consoleDrafts[key];
}

function setConsoleDraft(value, serverId = activeServer()?.id ?? runtime.data?.activeServerId ?? null) {
  ui.consoleDrafts[consoleDraftKey(serverId)] = String(value ?? "");
}

function captureEditableFocus() {
  const active = document.activeElement;
  if (
    !active ||
    !(active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement)
  ) {
    return null;
  }

  if (active.dataset.modalInput) {
    return {
      selector: `[data-modal-input="${active.dataset.modalInput}"]`,
      value: active.value,
      selectionStart: active.selectionStart ?? null,
      selectionEnd: active.selectionEnd ?? null,
    };
  }

  const playerCard = active.closest?.("[data-player-card]");
  if (playerCard?.dataset.playerKey && active.name) {
    return {
      selector: `[data-player-card][data-player-key="${playerCard.dataset.playerKey}"] [name="${active.name}"]`,
      value: active.value,
      selectionStart: active.selectionStart ?? null,
      selectionEnd: active.selectionEnd ?? null,
    };
  }

  const form = active.closest?.("form[data-form]");
  if (form?.dataset.form && active.name) {
    return {
      selector: `form[data-form="${form.dataset.form}"] [name="${active.name}"]`,
      value: active.value,
      selectionStart: active.selectionStart ?? null,
      selectionEnd: active.selectionEnd ?? null,
    };
  }

  if (active.dataset.installField) {
    return {
      selector: `[data-install-field="${active.dataset.installField}"]`,
      value: active.value,
      selectionStart: active.selectionStart ?? null,
      selectionEnd: active.selectionEnd ?? null,
    };
  }

  return null;
}

function restoreEditableFocus(snapshot) {
  if (!snapshot?.selector) {
    return;
  }

  const target = document.querySelector(snapshot.selector);
  if (!(target instanceof HTMLElement)) {
    return;
  }

  target.focus();
  if ("value" in target && snapshot.value !== undefined) {
    target.value = snapshot.value;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = snapshot.selectionStart ?? target.value.length;
    const end = snapshot.selectionEnd ?? start;
    target.setSelectionRange?.(start, end);
  }
}

function getSoftwareOption(softwareId) {
  return runtime.data?.softwareOptions?.find((entry) => entry.id === softwareId) ?? null;
}

function softwareLabel(softwareId) {
  return getSoftwareOption(softwareId)?.name ?? String(softwareId ?? "Unknown").toUpperCase();
}

function isDesktopApp() {
  return Boolean(window.desktop?.isDesktop);
}

function serverPort(server = activeServer()) {
  return Number(server?.server?.properties?.["server-port"] ?? server?.port ?? 25565);
}

function serverLastStartedAt(server = activeServer()) {
  return server?.server?.lastStartedAt ?? server?.lastStartedAt ?? null;
}

function playitPrimaryTunnel(server = activeServer()) {
  const tunnels = runtime.data?.playit?.tunnels ?? [];
  const port = serverPort(server);
  const matching = tunnels.filter((entry) => Number(entry?.localPort ?? 0) === port);
  return matching.find((entry) => entry.publicAddress) ??
    matching[0] ??
    null;
}

function playitMinecraftIp(server = activeServer()) {
  return playitPrimaryTunnel(server)?.publicAddress ?? null;
}

function appUpdateState() {
  return runtime.data?.appUpdate ?? null;
}

function playitLinkRequired() {
  const playit = runtime.data?.playit;
  if (!playit) return false;
  return !playit.secretConfigured || playit.claimWaiting || !playit.running;
}

function dependencyMissingLabels(dependencies) {
  return (dependencies?.missing ?? [])
    .map((id) => dependencies?.dependencies?.[id]?.name ?? id)
    .join(", ");
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setUiOperation(operation) {
  ui.operation = {
    active: true,
    tone: "working",
    title: "Working",
    detail: "Please wait.",
    startedAt: Date.now(),
    ...operation,
  };
  render();
}

function clearUiOperation() {
  if (!ui.operation) return;
  ui.operation = null;
  render();
}

function currentStatePollMs() {
  if (ui.bootstrap.active) return 1200;
  if (isUiLocked()) return 900;
  if (isCreateServerModalOpen()) return 30000;
  if (ui.section === "misc") {
    const focused = document.activeElement;
    if (focused?.closest?.('form[data-form="misc-settings"]')) {
      return 4000;
    }
    return 1000;
  }

  const server = activeServer();
  const status = activeServerStatus();
  const playit = runtime.data?.playit;
  if (
    playit?.secretConfigured &&
    !playitMinecraftIp() &&
    (status === "starting" || status === "running" || Number(playit?.configuredTunnelCount ?? 0) > 0)
  ) {
    return 2500;
  }

  if (status === "starting" || status === "stopping") {
    return 2500;
  }

  if (server?.server?.operation?.active) {
    return 1200;
  }

  return STATE_POLL_MS;
}

function currentLogPollMs() {
  if (isCreateServerModalOpen()) {
    return 12000;
  }
  const status = activeServerStatus();
  if (status === "starting" || status === "running" || status === "stopping") {
    return 1500;
  }
  return LOG_POLL_MS;
}

function updateBootstrapFromDependencies(dependencies, fallbackStage = "checking") {
  const stage = dependencies?.running ? "downloading" : dependencies?.stage ?? fallbackStage;
  const downloadedBytes = Number(dependencies?.downloadedBytes ?? 0);
  const totalBytes = Number(dependencies?.totalBytes ?? 0);
  const speedBytesPerSecond = Number(dependencies?.speedBytesPerSecond ?? 0);
  const progressWidth = totalBytes > 0 ? Math.max(10, Math.min(100, (downloadedBytes / totalBytes) * 100)) : 45;
  let detail =
    dependencies?.currentLabel ??
    dependencies?.message ??
    (stage === "checking"
      ? "Checking Java runtimes and playit.gg tools."
      : `Installing ${dependencyMissingLabels(dependencies) || "required tools"}.`);

  let metaRight = "";
  if (speedBytesPerSecond > 0) {
    metaRight = `${formatBytes(speedBytesPerSecond)}/s`;
  } else if (downloadedBytes > 0 && totalBytes > 0) {
    metaRight = `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;
  } else if (dependencies?.currentTask === "extract") {
    metaRight = "Extracting";
  } else if (dependencies?.currentTask === "finalize") {
    metaRight = "Finalizing";
  }

  if (downloadedBytes > 0 && totalBytes > 0) {
    detail += ` (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})`;
  }

  ui.bootstrap.stage = stage;
  ui.bootstrap.title =
    stage === "downloading" ? "Installing Dependencies" : "Checking For Dependencies";
  ui.bootstrap.detail = detail;
  ui.bootstrap.warning = "";
  ui.bootstrap.metaLeft =
    dependencies?.currentDependencyId
      ? dependencies?.dependencies?.[dependencies.currentDependencyId]?.name ?? "Dependency"
      : "System Node_01";
  ui.bootstrap.metaRight = metaRight;
  ui.bootstrap.progressWidth = progressWidth;
}

function updateBootstrapFromAppUpdate(appUpdate, mode = "install") {
  const version =
    appUpdate?.stagedVersion ??
    appUpdate?.latestVersion ??
    appUpdate?.currentVersion ??
    "next";
  const downloadedBytes = Number(appUpdate?.downloadedBytes ?? 0);
  const totalBytes = Number(appUpdate?.totalBytes ?? 0);
  const speedBytesPerSecond = Number(appUpdate?.speedBytesPerSecond ?? 0);
  const progressWidth =
    mode === "download" && totalBytes > 0
      ? Math.max(10, Math.min(100, (downloadedBytes / totalBytes) * 100))
      : mode === "install"
        ? 100
        : 45;

  let detail =
    appUpdate?.statusMessage ??
    (mode === "download"
      ? `Downloading Releu update ${version}.`
      : `Installing Releu update ${version}.`);

  if (mode === "download" && downloadedBytes > 0 && totalBytes > 0) {
    detail += ` (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})`;
  }

  let metaRight = "";
  if (mode === "download" && speedBytesPerSecond > 0) {
    metaRight = `${formatBytes(speedBytesPerSecond)}/s`;
  } else if (mode === "download" && downloadedBytes > 0 && totalBytes > 0) {
    metaRight = `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;
  } else if (mode === "install") {
    metaRight = "Restarting";
  }

  ui.bootstrap.active = true;
  ui.bootstrap.stage = mode === "download" ? "app-update-download" : "app-update-install";
  ui.bootstrap.title =
    mode === "download"
      ? `Downloading Releu Update ${version}`
      : `Installing Releu Update ${version}`;
  ui.bootstrap.detail = detail;
  ui.bootstrap.warning =
    mode === "download"
      ? `Do not close Releu while update ${version} is downloading.`
      : `Releu will close and reopen automatically when update ${version} finishes installing.`;
  ui.bootstrap.metaLeft = `Releu ${version}`;
  ui.bootstrap.metaRight = metaRight;
  ui.bootstrap.progressWidth = progressWidth;
}

async function copyText(value) {
  if (isDesktopApp() && window.desktop?.copyText) {
    await window.desktop.copyText(String(value ?? ""));
    return;
  }
  await navigator.clipboard.writeText(String(value ?? ""));
}

async function openLocalPath(targetPath) {
  if (!targetPath) return;
  if (!isDesktopApp() || !window.desktop?.openPath) {
    throw new Error("Opening local folders is available only in the desktop app.");
  }
  const result = await window.desktop.openPath(targetPath);
  if (result) throw new Error(result);
}

async function pickLocalDirectory() {
  if (!isDesktopApp() || !window.desktop?.pickDirectory) {
    throw new Error("Folder picking is available only in the desktop app.");
  }
  return window.desktop.pickDirectory();
}

async function maybeAutoApplyAppUpdate() {
  const appUpdate = appUpdateState();
  if (appUpdate?.downloading) {
    updateBootstrapFromAppUpdate(appUpdate, "download");
    render();
    return false;
  }
  if (!isDesktopApp() || !window.desktop?.installAppUpdate) return false;
  if (!appUpdate?.canAutoApply || !appUpdate?.stagedFilePath || !appUpdate?.stagedVersion) return false;
  if (ui.appUpdateAttemptedVersion === appUpdate.stagedVersion) return false;

  ui.appUpdateAttemptedVersion = appUpdate.stagedVersion;
  updateBootstrapFromAppUpdate(appUpdate, "install");
  render();
  await sleep(600);
  await api("/api/app-update/applying", { method: "POST" });
  await window.desktop.installAppUpdate(appUpdate.stagedFilePath);
  return true;
}

function resetLogs() {
  runtime.latestLogId = 0;
  runtime.consoleText = "";
  setConsoleDraft("");
  updateConsoleElement();
}

function appendLogs(entries) {
  for (const entry of entries) {
    runtime.latestLogId = Math.max(runtime.latestLogId, entry.id);
    runtime.consoleText += `[${entry.timestamp}] [${entry.source}] ${entry.message}\n`;
  }
  updateConsoleElement();
}

function updateConsoleElement() {
  const output = document.querySelector('[data-role="console-output"]');
  if (!output) return;
  output.textContent = runtime.consoleText;
  const scrollTarget =
    output.parentElement?.classList.contains("overflow-y-auto") ? output.parentElement : output;
  window.requestAnimationFrame(() => {
    scrollTarget.scrollTop = scrollTarget.scrollHeight;
    output.scrollTop = output.scrollHeight;
  });
}

function playerAvatarUrl(player) {
  const target = player?.uuid || player?.name || "Steve";
  return `https://mc-heads.net/avatar/${encodeURIComponent(target)}/64`;
}

function addonSupportState(server, kind) {
  const softwareId = server?.install?.installedSoftware ?? server?.install?.software ?? "vanilla";
  const software = getSoftwareOption(softwareId);
  if (!software) {
    return {
      supported: false,
      title: "Unsupported Server Software",
      detail: "Releu could not determine which add-ons this server supports.",
    };
  }

  if (kind === "plugin" && !software.supportsPlugins) {
    return {
      supported: false,
      title: `${software.name} Does Not Support Plugins`,
      detail: "Switch this server to Paper or Purpur before installing plugin add-ons.",
    };
  }

  if (kind === "mod" && !software.supportsMods) {
    return {
      supported: false,
      title: `${software.name} Does Not Support Mods`,
      detail: "Switch this server to Fabric, Forge, or NeoForge before installing mod add-ons.",
    };
  }

  return {
    supported: true,
    title: `${software.name} ${kind === "plugin" ? "plugins" : "mods"} ready`,
    detail: "Installed add-ons still need a server restart before they appear in game.",
  };
}

function renderImageOrFallback(imageUrl, label, fallbackIcon = "archive", className = "h-12 w-12") {
  const safeLabel = escapeHtml(label);
  if (imageUrl) {
    return `<div class="${className} overflow-hidden border border-outline bg-black"><img src="${escapeHtml(imageUrl)}" alt="${safeLabel}" class="h-full w-full object-cover" loading="lazy" /></div>`;
  }
  return `<div class="${className} flex items-center justify-center border border-outline bg-black text-zinc-500">${icon(fallbackIcon, "h-5 w-5")}</div>`;
}

function busyLabelForElement(element) {
  if (!element) return "Loading...";
  return element.dataset.busyLabel || "Loading...";
}

function setElementBusy(element, busy) {
  if (!element) return;
  if (busy) {
    if (!element.dataset.originalHtml) {
      element.dataset.originalHtml = element.innerHTML;
    }
    element.disabled = true;
    element.classList.add("opacity-60", "pointer-events-none");
    element.innerHTML = escapeHtml(busyLabelForElement(element));
    return;
  }
  if (element.dataset.originalHtml) {
    element.innerHTML = element.dataset.originalHtml;
    delete element.dataset.originalHtml;
  }
  element.disabled = false;
  element.classList.remove("opacity-60", "pointer-events-none");
}

async function withBusyElement(element, task) {
  setElementBusy(element, true);
  try {
    return await task();
  } finally {
    setElementBusy(element, false);
  }
}

function syncInstallDraft() {
  const server = activeServer();
  if (!server) {
    ui.installDraft = null;
    return;
  }
  const host = runtime.data.host;
  const software = server.install.installedSoftware ?? server.install.software ?? "purpur";
  const version = server.install.requestedVersion ?? server.install.installedVersion ?? "latest";
  if (ui.installDraft?.serverId !== server.id) {
    ui.installDraft = {
      serverId: server.id,
      software,
      version,
      javaPath: server.launcher.javaPath ?? "java",
      minRamMb: ramStringToMb(server.launcher.minRam, 2048),
      maxRamMb: ramStringToMb(server.launcher.maxRam, 4096),
      cpuCores:
        Number(server.launcher.cpuCores) > 0
          ? Number(server.launcher.cpuCores)
          : Math.min(4, host.cpuCores),
      gpuShare: Math.max(0, Number(server.launcher.gpuShare) || 0),
    };
  }
  ui.installDraft.minRamMb = Math.max(512, Math.round(ui.installDraft.minRamMb));
  ui.installDraft.maxRamMb = Math.max(ui.installDraft.minRamMb, Math.round(ui.installDraft.maxRamMb));
  ui.installDraft.cpuCores = Math.max(1, Math.min(host.cpuCores, Math.round(ui.installDraft.cpuCores)));
  ui.installDraft.gpuShare = Math.max(0, Math.min(100, Math.round(ui.installDraft.gpuShare)));
}

function buildCreateDraft() {
  const host = runtime.data?.host ?? { totalMemoryMb: 4096, cpuCores: 4 };
  const source = ui.installDraft ?? {};
  return {
    name: "",
    software: source.software ?? "purpur",
    version: source.version ?? "latest",
    javaPath: source.javaPath ?? "java",
    minRamMb: Math.max(512, Math.round(source.minRamMb ?? 2048)),
    maxRamMb: Math.max(2048, Math.round(source.maxRamMb ?? 4096)),
    cpuCores: Math.max(1, Math.min(host.cpuCores, Math.round(source.cpuCores ?? Math.min(4, host.cpuCores)))),
    gpuShare: Math.max(0, Math.min(100, Math.round(source.gpuShare ?? 0))),
  };
}

function syncCreateDraftBounds() {
  if (!ui.createDraft) return;
  const host = runtime.data?.host ?? { totalMemoryMb: 4096, cpuCores: 4 };
  ui.createDraft.minRamMb = Math.max(512, Math.round(ui.createDraft.minRamMb));
  ui.createDraft.maxRamMb = Math.max(ui.createDraft.minRamMb, Math.round(ui.createDraft.maxRamMb));
  ui.createDraft.maxRamMb = Math.min(Math.max(512, host.totalMemoryMb), ui.createDraft.maxRamMb);
  ui.createDraft.cpuCores = Math.max(1, Math.min(host.cpuCores, Math.round(ui.createDraft.cpuCores)));
  ui.createDraft.gpuShare = Math.max(0, Math.min(100, Math.round(ui.createDraft.gpuShare)));
}

function openCreateServerScreen() {
  ui.createDraft = buildCreateDraft();
  syncCreateDraftBounds();
  ui.screen = "create-server";
  ui.section = "server";
  render();
}

function applyCreateDraftToInstallDraft(serverId) {
  if (!ui.createDraft) return;
  ui.installDraft = {
    serverId,
    software: ui.createDraft.software,
    version: ui.createDraft.version,
    javaPath: ui.createDraft.javaPath,
    minRamMb: ui.createDraft.minRamMb,
    maxRamMb: ui.createDraft.maxRamMb,
    cpuCores: ui.createDraft.cpuCores,
    gpuShare: ui.createDraft.gpuShare,
  };
}

async function createServerFromName(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return false;
  ui.modal = null;
  resetLogs();
  ui.catalog.plugin = null;
  ui.catalog.mod = null;
  const payload = await api("/api/servers", {
    method: "POST",
    body: {
      name: trimmed,
      installNow: false,
      acceptEula: true,
    },
  });
  runtime.data = payload.state;
  ui.screen = "setup";
  ui.section = "server";
  syncInstallDraft();
  await ensureVersions(ui.installDraft.software);
  render();
  return true;
}

function openCreateServerModal() {
  ui.modal = {
    type: "create-server",
    name: "",
    justOpened: true,
  };
  render();
}

function openDeleteServerModal(serverId, serverName) {
  if (!serverId) throw new Error("No server is selected.");
  ui.modal = {
    type: "delete-server",
    serverId,
    serverName: serverName ?? serverId,
  };
  render();
}

function openPlayitResetModal() {
  ui.modal = {
    type: "playit-reset",
  };
  render();
}

function closeModal() {
  if (!ui.modal) return;
  ui.modal = null;
  render();
}

async function ensureVersions(softwareId) {
  if (!softwareId) return;
  if (!runtime.versionCache.has(softwareId)) {
    const payload = await api(`/api/software/versions?software=${encodeURIComponent(softwareId)}`);
    runtime.versionCache.set(softwareId, ["latest", ...(payload.versions ?? [])]);
  }

  const options = runtime.versionCache.get(softwareId) ?? ["latest"];
  if (ui.installDraft?.software === softwareId) {
    const installedVersion = activeServer()?.install?.installedVersion ?? null;
    if (
      ui.installDraft.version &&
      ui.installDraft.version !== "latest" &&
      !options.includes(ui.installDraft.version)
    ) {
      ui.installDraft.version =
        installedVersion && options.includes(installedVersion) ? installedVersion : "latest";
    }
  }
}

function getVersionOptions(softwareId, selectedVersion = "latest") {
  void selectedVersion;
  return runtime.versionCache.get(softwareId) ?? ["latest"];
}

function softwareChoices() {
  const options = runtime.data?.softwareOptions ?? [];
  const byId = new Map(options.map((entry) => [entry.id, entry]));
  const ordered = SOFTWARE_ORDER.map((id) => byId.get(id)).filter(Boolean);
  return [...ordered, ...options.filter((entry) => !SOFTWARE_ORDER.includes(entry.id))];
}

function playerCapacity(server) {
  return Math.max(1, Number(server?.server?.properties?.["max-players"] ?? 20) || 20);
}

function currentWorld(server) {
  return server?.worlds?.find((entry) => entry.isActive) ?? null;
}

function initials(value) {
  const normalized = String(value ?? "").trim().replace(/[^A-Za-z0-9]+/g, " ");
  if (!normalized) return "SV";
  const parts = normalized.split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]).join("") || normalized.slice(0, 2)).toUpperCase();
}

function statusTone(status) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "running") return { dot: "bg-white", text: "text-white" };
  if (normalized === "starting") return { dot: "bg-zinc-300", text: "text-zinc-200" };
  if (normalized === "stopping") return { dot: "bg-zinc-500", text: "text-zinc-300" };
  return { dot: "border border-white", text: "text-zinc-500" };
}

function worldCount(server) {
  return (server?.worlds ?? []).filter((entry) => entry.exists).length;
}

function playitAddressState(server = activeServer()) {
  const playit = runtime.data?.playit;
  const ip = playitMinecraftIp(server);
  const running = String(server?.server?.status ?? "").toLowerCase() === "running";
  const port = serverPort(server);
  const otherTunnel = (playit?.tunnels ?? []).find(
    (entry) => entry.publicAddress && Number(entry?.localPort ?? 0) !== port,
  );
  if (ip) {
    return {
      value: ip,
      detail: "Public join address is live.",
    };
  }
  if (!playit?.secretConfigured) {
    return {
      value: "Connect Playit Agent",
      detail: "Link playit.gg once for this app. Releu will reuse it for every server you create.",
    };
  }
  if (playit.claimWaiting) {
    return {
      value: "Finish Playit Link",
      detail: "Complete the browser link. Releu will continue automatically after the agent is connected.",
    };
  }
  if (playit?.checkingTunnelStatus) {
    return {
      value: "Checking Tunnel Status",
      detail:
        playit?.statusMessage ??
        `Releu is checking the linked playit.gg agent and tunnel status for 127.0.0.1:${port}.`,
    };
  }
  if (otherTunnel) {
    return {
      value: "Tunnel Uses Different Port",
      detail: `Playit already has a live tunnel for 127.0.0.1:${otherTunnel.localPort} at ${otherTunnel.publicAddress}. This server is using 127.0.0.1:${port}. Change the tunnel target or change this server port to match.`,
    };
  }
  if (playit?.needsWebSetup && Number(playit?.configuredTunnelCount ?? 0) > 0) {
    return {
      value: "Tunnel Found, Setup Incomplete",
      detail:
        playit?.statusMessage ??
        `Playit found a tunnel for 127.0.0.1:${port}, but it still needs setup before a public join address exists.`,
    };
  }
  if (Number(playit?.configuredTunnelCount ?? 0) === 0) {
    return {
      value: "No Tunnel Created Yet",
      detail: `Create or assign a Minecraft Java tunnel for 127.0.0.1:${port} in Settings.`,
    };
  }
  if (!running) {
    return {
      value: "Run Server To Get Address",
      detail:
        playit.statusMessage ??
        `Start this server on 127.0.0.1:${port} so playit can publish the join address.`,
    };
  }
  return {
    value: "Waiting For Public Address",
    detail:
      playit.statusMessage ??
      `Releu is waiting for playit.gg to publish the public join address for 127.0.0.1:${port}.`,
  };
}

function stopPlayitGatePolling() {
  if (playitGatePollTimer) {
    window.clearTimeout(playitGatePollTimer);
    playitGatePollTimer = null;
  }
}

function startPlayitGatePolling() {
  if (playitGatePollTimer || !playitLinkRequired()) return;
  playitGatePollTimer = window.setTimeout(async () => {
    playitGatePollTimer = null;
    if (!playitLinkRequired()) return;
    try {
      await refreshState();
    } catch (error) {
      console.error(error);
    }
    if (playitLinkRequired()) {
      startPlayitGatePolling();
    }
  }, 2500);
}

function maybeKickoffPlayitGateConnection() {
  const playit = runtime.data?.playit;
  if (!playit || playitGateConnectPromise) return;
  if (playit.claimWaiting) return;
  if (playit.secretConfigured && playit.running) return;

  playitGateConnectPromise = api("/api/playit/connect", { method: "POST" })
    .then((payload) => {
      runtime.data = payload.state;
      syncInstallDraft();
      render();
    })
    .catch((error) => {
      console.error(error);
    })
    .finally(() => {
      playitGateConnectPromise = null;
    });
}

function renderTile(label, value, detail = "") {
  return `<article class="${C.card}"><p class="${C.label} mb-3">${escapeHtml(label)}</p><div class="text-2xl font-black tracking-tight text-white">${escapeHtml(value)}</div>${detail ? `<p class="mt-2 text-xs leading-6 text-zinc-400">${escapeHtml(detail)}</p>` : ""}</article>`;
}

function pelicanProgressTone(ratio) {
  if (ratio >= 0.9) return "danger";
  if (ratio >= 0.7) return "warning";
  return "success";
}

function pelicanToneColor(status) {
  if (status === "danger") {
    return {
      color: "var(--danger-500)",
      track: "color-mix(in srgb, var(--danger-500) 15%, transparent)",
      pulse: true,
    };
  }
  if (status === "warning") {
    return {
      color: "var(--warning-500)",
      track: "color-mix(in srgb, var(--warning-500) 15%, transparent)",
      pulse: false,
    };
  }
  return {
    color: "var(--success-500)",
    track: "color-mix(in srgb, var(--success-500) 15%, transparent)",
    pulse: false,
  };
}

function renderPelicanProgressBar(label, current, max, suffix = "") {
  const safeCurrent = Math.max(0, Number(current) || 0);
  const safeMax = Math.max(1, Number(max) || 1);
  const ratio = Math.max(0, Math.min(1, safeCurrent / safeMax));
  const tone = pelicanProgressTone(ratio);
  const colors = pelicanToneColor(tone);
  const width = Math.max(0, Math.min(100, ratio * 100));
  const suffixText = suffix ? ` ${suffix}` : "";
  const labelText = `${label} ${formatCount(Math.round(safeCurrent))}${suffixText} / ${formatCount(Math.round(safeMax))}${suffixText}`;
  return `<div class="fi-ta-text block w-full px-3">
      <div class="flex flex-col gap-2">
        <div class="relative w-full overflow-hidden rounded-full" style="height: 0.725rem; background-color: ${colors.track};" role="progressbar" aria-valuenow="${escapeHtml(safeCurrent)}" aria-valuemin="0" aria-valuemax="${escapeHtml(safeMax)}" aria-label="${escapeHtml(labelText)}">
          <div class="h-full rounded-full transition-all duration-300 ease-in-out ${colors.pulse ? "animate-pulse" : ""}" style="width: ${width}%; background-color: ${colors.color};"></div>
        </div>
        <span class="text-center text-sm ${tone === "danger" ? "font-bold" : "text-gray-500 dark:text-gray-400"}" ${tone === "danger" ? `style="color: ${colors.color};"` : ""}>${escapeHtml(labelText)}</span>
      </div>
    </div>`;
}

function renderPelicanPageIntro(meta) {
  return `<section class="fi-section overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
      <div class="px-6 py-6">
        <div class="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">${escapeHtml(meta.eyebrow)}</div>
        <h1 class="mt-3 text-3xl font-black tracking-tight text-gray-950 dark:text-white">${escapeHtml(meta.title)}</h1>
        <p class="mt-3 max-w-4xl text-sm leading-7 text-gray-600 dark:text-gray-300">${escapeHtml(meta.detail)}</p>
      </div>
    </section>`;
}

function pelicanServerCondition(server) {
  const presentation = serverStatusPresentation(server);
  if (presentation.label === "Online") return { color: "#10b981", icon: "server" };
  if (presentation.label === "Starting") return { color: "#f59e0b", icon: "server" };
  if (presentation.label === "Stopping") return { color: "#94a3b8", icon: "server" };
  if (presentation.label === "Setup Required") return { color: "#38bdf8", icon: "layers" };
  return { color: "#64748b", icon: "server" };
}

function pelicanServerDescription(server) {
  const joinAddress = playitMinecraftIp(server);
  if (joinAddress) return `Public join address ${joinAddress}`;
  return serverStatusPresentation(server).detail;
}

function renderPelicanCardAction(action, label, tone = "default", extra = "") {
  const classes = tone === "primary"
    ? "fi-btn inline-grid rounded-lg bg-primary-600 text-white hover:bg-primary-500 dark:bg-primary-500 dark:text-gray-950 dark:hover:bg-primary-400"
    : "fi-btn inline-grid rounded-lg bg-transparent text-gray-700 ring-1 ring-gray-950/10 hover:bg-gray-50 dark:text-gray-200 dark:ring-white/10 dark:hover:bg-white/5";
  return `<button type="button" data-action="${escapeHtml(action)}" ${extra} class="${classes}">${escapeHtml(label)}</button>`;
}

function renderPelicanServerEntryCard(server) {
  const presentation = serverStatusPresentation(server);
  const condition = pelicanServerCondition(server);
  const software = server.install.installedSoftware ?? server.install.software ?? "purpur";
  const version = server.install.installedVersion ?? server.install.requestedVersion ?? "latest";
  const cpuCurrent = Math.max(0, Number(server.metrics?.cpuPercent ?? 0));
  const cpuLimit = Math.max(100, Number(server.launcher?.cpuCores ?? runtime.data?.host?.cpuCores ?? 1) * 100);
  const ramCurrent = Math.max(0, Number(server.metrics?.ramUsedMb ?? 0));
  const ramLimit = Math.max(512, Number(server.metrics?.ramMaxMb ?? ramStringToMb(server.launcher?.maxRam, 4096)));
  const diskCurrent = Math.max(0, Number(server.metrics?.diskUsedMb ?? 0));
  const diskLimit = Math.max(diskCurrent, Number(runtime.data?.host?.diskTotalMb ?? 102400));
  const secondaryCommand = server.jarInstalled ? (server.status === "running" ? "restart" : "start") : null;
  const actionLabel = server.jarInstalled ? "Manage" : "Setup";
  const networkAddress = playitMinecraftIp(server) ?? `127.0.0.1:${serverPort(server)}`;
  return `<article class="w-full">
      <div class="relative cursor-pointer">
        <div class="absolute left-0 top-1 bottom-0 w-1 rounded-lg" style="background-color: ${condition.color};"></div>
        <div class="relative overflow-hidden rounded-lg p-3 dark:bg-gray-800 dark:text-white">
          <div class="flex items-center gap-2 mb-5">
            <span class="fi-icon-btn relative flex items-center justify-center rounded-lg outline-none transition duration-75 h-10 w-10 text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400" style="color: ${condition.color};">
              ${icon(condition.icon, "fi-icon h-5 w-5")}
            </span>
            <h2 class="text-xl font-bold">
              ${escapeHtml(server.name)}
              <span class="dark:text-gray-400">(${escapeHtml(presentation.label)})</span>
            </h2>
            <div class="ml-auto flex flex-wrap items-center gap-2">
              ${renderPelicanCardAction("select-server", actionLabel, "default", `data-server-id="${escapeHtml(server.id)}"`)}
              ${secondaryCommand ? renderPelicanCardAction("quick-server-control", secondaryCommand === "restart" ? "Restart" : "Start", "primary", `data-server-id="${escapeHtml(server.id)}" data-server-command="${escapeHtml(secondaryCommand)}"`) : ""}
              ${renderPelicanCardAction("delete-server", "Delete", "default", `data-server-id="${escapeHtml(server.id)}" data-server-name="${escapeHtml(server.name)}"`)}
            </div>
          </div>
          <div class="text-left mb-1 ml-4 pl-4">
            <p class="text-base dark:text-gray-400">${escapeHtml(pelicanServerDescription(server))}</p>
          </div>
          <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between text-center">
            <div class="w-full max-w-xs">${renderPelicanProgressBar("CPU", cpuCurrent, cpuLimit, "%")}</div>
            <div class="w-full max-w-xs">${renderPelicanProgressBar("Memory", ramCurrent, ramLimit, "MB")}</div>
            <div class="w-full max-w-xs">${renderPelicanProgressBar("Disk", diskCurrent, diskLimit, "MB")}</div>
            <div class="hidden sm:block text-left">
              <p class="text-sm dark:text-gray-400">Network</p>
              <p class="text-md font-semibold">${escapeHtml(networkAddress)}</p>
              <p class="mt-1 text-sm dark:text-gray-400">${escapeHtml(`${softwareLabel(software)} / ${version}`)}</p>
            </div>
          </div>
        </div>
      </div>
    </article>`;
}

function renderPelicanManagerScreen() {
  const servers = runtime.data?.servers ?? [];
  const cards = servers.map((server) => renderPelicanServerEntryCard(server)).join("");
  return `<div class="space-y-6">
      ${renderPelicanPageIntro({
        eyebrow: "Client Area",
        title: "Servers",
        detail: "This test build uses Pelican’s own server entry structure and Filament shell while keeping the Releu backend unchanged.",
      })}
      <section class="fi-section overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
        <div class="px-6 py-6">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div class="text-sm text-gray-600 dark:text-gray-400">Only implemented pages are exposed in this Pelican test build.</div>
            <div class="flex items-center gap-2">
              ${renderPelicanCardAction("toggle-manager-view", "Grid", "default", `data-view="grid"`)}
              ${renderPelicanCardAction("toggle-manager-view", "List", "default", `data-view="list"`)}
            </div>
          </div>
        </div>
      </section>
      <section class="grid grid-cols-1 gap-4 ${ui.managerView === "list" ? "" : "xl:grid-cols-2"}">
        ${cards}
        <button type="button" class="flex min-h-[220px] w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white px-6 py-8 text-center text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-950/5 transition hover:border-primary-400 hover:text-primary-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:ring-white/10 dark:hover:border-primary-400 dark:hover:text-primary-400" data-action="add-server-prompt">
          <span class="flex flex-col items-center gap-4">
            <span class="fi-icon-btn relative flex h-14 w-14 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400">${icon("plus", "fi-icon h-7 w-7")}</span>
            Add Server
          </span>
        </button>
      </section>
    </div>`;
}

function renderPelicanConsoleSection(server) {
  const metrics = server.server.metrics ?? {};
  const ramMaxMb = Number(metrics.ramMaxMb ?? ramStringToMb(server.launcher.maxRam, 4096));
  const ramUsedMb = Number(metrics.ramUsedMb ?? 0);
  const commandDraft = getConsoleDraft(server.id);
  return `<div class="space-y-6">
      ${renderPelicanPageIntro({
        eyebrow: "Console",
        title: server.name,
        detail: `Last start: ${formatTimestamp(serverLastStartedAt(server))}`,
      })}
      <section class="fi-section overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
        <div class="max-h-[620px] min-h-[420px] overflow-y-auto bg-[rgba(19,26,32,0.7)] p-6 font-mono text-xs leading-6 text-slate-200">
          <pre data-role="console-output" class="whitespace-pre-wrap">${escapeHtml(runtime.consoleText || "Console output will appear here once the server starts.")}</pre>
        </div>
        <form data-form="console-command" class="flex items-center w-full overflow-hidden border-t border-white/10 dark:bg-gray-900" style="border-bottom-right-radius: 10px; border-bottom-left-radius: 10px;">
          <span class="px-3 text-gray-400">${icon("terminal", "fi-icon h-5 w-5")}</span>
          <input name="command" type="text" value="${escapeHtml(commandDraft)}" autocomplete="off" spellcheck="false" placeholder="Send command to server" class="w-full focus:outline-none focus:ring-0 border-none dark:bg-gray-900 p-1 font-mono text-sm" />
        </form>
      </section>
      <section class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div class="fi-section rounded-xl bg-white px-4 py-4 shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">${renderPelicanProgressBar("CPU", Number(metrics.cpuPercent ?? 0), 100, "%")}</div>
        <div class="fi-section rounded-xl bg-white px-4 py-4 shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">${renderPelicanProgressBar("Memory", ramUsedMb, ramMaxMb, "MB")}</div>
        <div class="fi-section rounded-xl bg-white px-4 py-4 shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">${renderPelicanProgressBar("Players", Number(server.server.playerCount ?? 0), playerCapacity(server), "")}</div>
      </section>
    </div>`;
}

function renderPelicanOverviewSection(server) {
  const joinState = playitAddressState(server);
  const metrics = server.server.metrics ?? {};
  const cpuPercent = Number(metrics.cpuPercent ?? 0);
  const ramMaxMb = Number(metrics.ramMaxMb ?? ramStringToMb(server.launcher.maxRam, 4096));
  const ramUsedMb = Number(metrics.ramUsedMb ?? 0);
  const world = currentWorld(server)?.name ?? server.server.properties["level-name"] ?? "world";
  const status = serverStatusPresentation(server);
  const players = server.players?.filter((entry) => entry.online).slice(0, 5) ?? [];
  return `<div class="space-y-6">
      ${renderPelicanPageIntro({
        eyebrow: "Overview",
        title: server.name,
        detail: status.detail,
      })}
      <section class="grid grid-cols-1 gap-4 xl:grid-cols-2">
        ${renderPelicanServerEntryCard(server)}
        <section class="fi-section overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
          <div class="px-6 py-6">
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div class="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Minecraft IP</div>
                <div class="mt-3 text-2xl font-black tracking-tight text-gray-950 dark:text-white">${escapeHtml(joinState.value)}</div>
                <p class="mt-3 text-sm leading-7 text-gray-600 dark:text-gray-300">${escapeHtml(joinState.detail)}</p>
              </div>
              <div>
                <div class="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Software</div>
                <div class="mt-3 text-2xl font-black tracking-tight text-gray-950 dark:text-white">${escapeHtml(softwareLabel(server.install.installedSoftware ?? server.install.software ?? "purpur"))}</div>
                <p class="mt-3 text-sm leading-7 text-gray-600 dark:text-gray-300">${escapeHtml(server.install.installedVersion ?? server.install.requestedVersion ?? "latest")}</p>
              </div>
              <div class="md:col-span-2 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div>${renderPelicanProgressBar("CPU", cpuPercent, 100, "%")}</div>
                <div>${renderPelicanProgressBar("Memory", ramUsedMb, ramMaxMb, "MB")}</div>
                <div>${renderPelicanProgressBar("Players", Number(server.server.playerCount ?? 0), playerCapacity(server), "")}</div>
              </div>
            </div>
          </div>
        </section>
      </section>
      <section class="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <section class="fi-section overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
          <div class="border-b border-gray-200 px-6 py-4 dark:border-white/10">
            <div class="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Console</div>
          </div>
          <pre data-role="console-output" class="h-64 overflow-y-auto whitespace-pre-wrap bg-[rgba(19,26,32,0.7)] p-6 font-mono text-xs text-slate-200">${escapeHtml(runtime.consoleText || "Console output will appear here once the server starts.")}</pre>
        </section>
        <section class="fi-section overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
          <div class="border-b border-gray-200 px-6 py-4 dark:border-white/10">
            <div class="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Players</div>
          </div>
          <div class="space-y-4 px-6 py-6">
            <div class="text-3xl font-black tracking-tight text-gray-950 dark:text-white">${escapeHtml(server.server.playerCount)} / ${escapeHtml(playerCapacity(server))}</div>
            ${players.length ? players.map((player) => `<div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-3">
                    <img src="${escapeHtml(playerAvatarUrl(player))}" alt="${escapeHtml(player.name)}" class="fi-avatar fi-size-sm fi-circular" loading="lazy" />
                    <div class="text-sm font-medium text-gray-900 dark:text-white">${escapeHtml(player.name)}</div>
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">${player.op ? "OP" : player.whitelisted ? "WL" : "Player"}</div>
                </div>`).join("") : `<div class="text-sm text-gray-500 dark:text-gray-400">No players are online.</div>`}
            <div class="border-t border-gray-200 pt-4 text-sm text-gray-500 dark:border-white/10 dark:text-gray-400">Active world: ${escapeHtml(world)}</div>
          </div>
        </section>
      </section>
    </div>`;
}

function renderOperationOverlay() {
  if (!isUiLocked()) return "";
  return `<div class="releu-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/82 p-4"><section class="releu-modal-panel w-full max-w-xl border border-outline bg-surface p-7 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"><p class="${C.label} mb-4">${escapeHtml(ui.operation?.tone === "install" ? "Server Install" : "Working")}</p><div class="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white"></div><h2 class="text-3xl font-black tracking-tight text-white">${escapeHtml(ui.operation?.title ?? "Working")}</h2><p class="mx-auto mt-4 max-w-2xl text-sm leading-7 text-zinc-400">${escapeHtml(ui.operation?.detail ?? "Please wait while Releu finishes this task.")}</p><div class="mx-auto mt-6 max-w-md border border-outline bg-black px-4 py-3 text-left text-xs text-zinc-500">All other actions are temporarily disabled until this finishes.</div></section></div>`;
}

function formatLastSeen(value) {
  return value ? formatTimestamp(value) : "Unknown";
}

function renderPlayerFlags(player) {
  return [
    player.online ? "ONLINE" : "OFFLINE",
    player.gamemode ? `GM:${String(player.gamemode).toUpperCase()}` : null,
    player.op ? "OP" : null,
    player.whitelisted ? "WL" : null,
    player.banned ? "BANNED" : null,
  ].filter(Boolean).join(" / ");
}

function renderPlayerButtons(player) {
  const actions = [
    [player.op ? "deop" : "op", player.op ? "DE-OP" : "OP"],
    [player.whitelisted ? "whitelist-remove" : "whitelist-add", player.whitelisted ? "UNWHITELIST" : "WHITELIST"],
    [player.banned ? "pardon" : "ban", player.banned ? "PARDON" : "BAN"],
  ];
  if (player.online) actions.push(["kick", "KICK"], ["gamemode", "GAMEMODE"], ["heal", "HEAL"], ["feed", "FEED"], ["teleport", "TELEPORT"]);
  return actions
    .map(
      ([action, label]) =>
        `<button type="button" class="border border-outline px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-white transition hover:bg-white hover:text-black" data-action="player-action" data-player-name="${escapeHtml(player.name)}" data-player-action="${escapeHtml(action)}" data-busy-label="Loading...">${escapeHtml(label)}</button>`,
    )
    .join("");
}

function renderPlayerModeOptions(selectedMode = "survival") {
  return ["survival", "creative", "adventure", "spectator"]
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}" ${selectedMode === value ? "selected" : ""}>${escapeHtml(value[0].toUpperCase() + value.slice(1))}</option>`,
    )
    .join("");
}

function renderWorldCard(world) {
  return `<article class="${C.card}"><div class="mb-4 flex items-start justify-between gap-4"><div><div class="${world.isActive ? C.labelOn : C.label} mb-2">${world.isActive ? "Active World" : "World Slot"}</div><h3 class="text-xl font-semibold text-white">${escapeHtml(world.name)}</h3><p class="mt-2 font-mono text-xs text-zinc-500">${escapeHtml(world.path)}</p></div><div class="text-zinc-500">${icon("globe", "h-5 w-5")}</div></div><div class="mb-4 flex flex-wrap gap-2"><span class="${C.chip}">${world.exists ? "Base" : "Missing"}</span><span class="${C.chip}">${world.netherExists ? "Nether" : "No Nether"}</span><span class="${C.chip}">${world.endExists ? "End" : "No End"}</span></div><div class="flex flex-wrap gap-2"><button type="button" class="${C.btnPrimary}" data-action="use-world" data-world-name="${escapeHtml(world.name)}">Use This World</button><button type="button" class="${C.btnGhost}" data-action="regenerate-world" data-world-name="${escapeHtml(world.name)}">Regenerate</button>${isDesktopApp() ? `<button type="button" class="border border-outline px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400 transition hover:border-white hover:text-white" data-action="open-path" data-path="${escapeHtml(world.path)}">Open Folder</button>` : ""}</div></article>`;
}

function normalizeSideSupport(value) {
  const normalized = String(value ?? "unknown").trim().toLowerCase();
  return ["required", "optional", "unsupported", "unknown"].includes(normalized)
    ? normalized
    : "unknown";
}

function resourcePackNeedsClientSupport(item) {
  const summary = [
    item?.title,
    item?.displayName,
    item?.description,
    ...(item?.categories ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /(fresh animations|better animations?|connected textures|continuity|optifine|entity texture features|entity model features|custom entity model|cem|ctm|etf|emf)/i.test(
    summary,
  );
}

function addonInstallWarning(item, kind = "mod") {
  if (kind === "resourcepack" && resourcePackNeedsClientSupport(item)) {
    return {
      title: "Client-Side Features Detected",
      message:
        "This resource pack is sent by the server, but features like connected textures, custom entity models, or Fresh Animations still need compatible client support such as Continuity, OptiFine, ETF, or EMF. Continue saving it to the server?",
    };
  }
  const clientSide = normalizeSideSupport(item?.clientSide);
  if (clientSide === "required") {
    return {
      title: "Client-Side Mod Detected",
      message:
        "Players must also install this mod on their Minecraft client to use its features. Continue installing it on the server?",
    };
  }
  if (clientSide === "optional") {
    return {
      title: "Client Features Detected",
      message:
        "This mod can run on the server, but some features may still require the client mod. Continue installing it on the server?",
    };
  }
  return null;
}

function sideSupportChip(side, channel) {
  const normalized = normalizeSideSupport(side);
  if (normalized === "unknown") return "";
  const tone =
    normalized === "required"
      ? "border-white text-white"
      : normalized === "optional"
        ? "border-zinc-600 text-zinc-300"
        : "border-zinc-800 text-zinc-500";
  const label =
    normalized === "required"
      ? `${channel} required`
      : normalized === "optional"
        ? `${channel} features`
        : `${channel} unsupported`;
  return `<span class="border ${tone} px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em]">${escapeHtml(label)}</span>`;
}

function renderCatalogResults(kind, resultSet) {
  const support = addonSupportState(activeServer(), kind);
  if (!resultSet?.results?.length) return `<div class="border border-outline bg-surfaceAlt p-4 text-sm text-zinc-500">Search the catalog to install ${escapeHtml(kind)} files directly into this server.</div>`;
  return resultSet.results
    .map(
      (item) => `<article class="border border-outline bg-surfaceAlt p-4">
        <div class="mb-3 flex items-start justify-between gap-4">
          <div class="flex items-start gap-4">
            ${renderImageOrFallback(item.iconUrl, item.title, kind === "plugin" ? "plug" : "archive")}
            <div>
              <h3 class="text-sm font-semibold text-white">${escapeHtml(item.title)}</h3>
              <p class="text-xs text-zinc-500">by ${escapeHtml(item.author)} / ${escapeHtml(formatCount(item.downloads))} downloads</p>
            </div>
          </div>
          <button type="button" class="${C.btnPrimary}" data-action="install-catalog" data-kind="${escapeHtml(kind)}" data-project-id="${escapeHtml(item.id)}" data-project-title="${escapeHtml(item.title)}" data-profile-id="${escapeHtml(resultSet.profile.id)}" data-client-side="${escapeHtml(normalizeSideSupport(item.clientSide))}" data-server-side="${escapeHtml(normalizeSideSupport(item.serverSide))}" data-busy-label="Installing..." ${support.supported ? "" : "disabled"}>Install</button>
        </div>
        <p class="text-sm text-zinc-400">${escapeHtml(item.description ?? "No description provided.")}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          ${item.compatibleVersionNumber ? `<span class="${C.chip}">${escapeHtml(item.compatibleVersionNumber)}</span>` : ""}
          ${kind === "mod" ? sideSupportChip(item.clientSide, "Client") : ""}
          ${kind !== "resourcepack" ? sideSupportChip(item.serverSide, "Server") : ""}
        </div>
      </article>`,
    )
    .join("");
}

function renderInstalledAssets(kind, assets) {
  if (!assets.length) return `<tr><td colspan="3" class="px-6 py-4 text-sm text-zinc-500">No ${escapeHtml(kind)} files are installed yet.</td></tr>`;
  return assets
    .map(
      (asset) => `<tr class="border-b border-zinc-900 align-top transition hover:bg-zinc-900/30">
        <td class="px-6 py-4">
          <div class="flex items-start gap-4">
            ${renderImageOrFallback(asset.iconUrl, asset.displayName ?? asset.name, kind === "plugin" ? "plug" : "archive")}
            <div>
              <div class="text-sm font-semibold uppercase tracking-wider text-white">${escapeHtml(asset.displayName ?? asset.name)}</div>
              <div class="mt-1 font-mono text-[11px] text-zinc-500">${escapeHtml(asset.name)}</div>
              <div class="mt-2 flex flex-wrap gap-2">
                <span class="${C.chip}">${escapeHtml(asset.source ?? "upload")}</span>
                ${asset.versionNumber ? `<span class="${C.chip}">${escapeHtml(asset.versionNumber)}</span>` : ""}
                ${kind === "mod" ? sideSupportChip(asset.clientSide, "Client") : ""}
                ${kind !== "resourcepack" ? sideSupportChip(asset.serverSide, "Server") : ""}
                ${asset.restartRequired ? `<span class="border border-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">Restart Required</span>` : ""}
              </div>
              ${asset.restartReason ? `<p class="mt-2 text-xs leading-6 text-zinc-400">${escapeHtml(asset.restartReason)}</p>` : ""}
            </div>
          </div>
        </td>
        <td class="px-6 py-4 text-zinc-400">
          <div>${escapeHtml(formatBytes(asset.size))}</div>
          <div class="mt-2 text-[11px] text-zinc-500">${escapeHtml(formatTimestamp(asset.updatedAt))}</div>
        </td>
        <td class="px-6 py-4 text-right">
          <button type="button" class="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500 transition hover:text-white" data-action="remove-asset" data-kind="${escapeHtml(kind)}" data-file-name="${escapeHtml(asset.name)}" data-busy-label="Removing...">Remove</button>
        </td>
      </tr>`,
    )
    .join("");
}

function renderExtensionStatusBanner(tone, title, detail) {
  const toneClasses = tone === "danger"
    ? "bg-[linear-gradient(to_left,#1f2933_50%,#5c143b_100%)] text-pink-100"
    : tone === "warning"
      ? "bg-[linear-gradient(to_left,#1f2933_60%,#a43e006e_100%)] text-amber-100"
      : "bg-[#1f2933] text-slate-200";
  const titleClass = tone === "danger"
    ? "text-pink-300"
    : tone === "warning"
      ? "text-amber-300"
      : "text-white";
  return `<div class="mb-4 flex items-start gap-4 rounded-lg ${toneClasses} px-5 py-4">
      <div class="mt-0.5 h-3 w-3 rounded-full border border-white/40 ${tone === "danger" ? "bg-pink-400" : tone === "warning" ? "bg-amber-400" : "bg-cyan-300"}"></div>
      <div class="text-sm leading-6">
        <div class="font-bold ${titleClass}">${escapeHtml(title)}</div>
        <div class="mt-1 text-slate-200/90">${escapeHtml(detail)}</div>
      </div>
    </div>`;
}

function renderBlueprintExtensionTile(kind, asset) {
  const iconMarkup = renderImageOrFallback(asset.iconUrl, asset.title, kind === "plugin" ? "plug" : "archive");
  return `<article class="relative overflow-hidden rounded-lg border border-[#2c3743] bg-[#1f2933] p-4 transition hover:border-[#556372]">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_34%)] opacity-70"></div>
      <div class="relative">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-3">
            <div class="h-12 w-12 overflow-hidden rounded-md border border-white/10 bg-black/30">
              ${iconMarkup}
            </div>
            <div class="min-w-0">
              <h3 class="truncate text-base font-bold text-white">${escapeHtml(asset.title ?? asset.name)}</h3>
              <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                <span class="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-semibold uppercase tracking-[0.12em]">${escapeHtml(kind)}</span>
                <span>${escapeHtml(asset.version ?? "installed")}</span>
              </div>
            </div>
          </div>
          <button type="button" class="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300 transition hover:border-white hover:text-white" data-action="remove-asset" data-kind="${escapeHtml(kind)}" data-file-name="${escapeHtml(asset.name)}" data-busy-label="Removing...">Remove</button>
        </div>
        ${asset.description ? `<p class="mt-4 text-sm leading-6 text-slate-300">${escapeHtml(asset.description)}</p>` : ""}
        <div class="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-400">
          <span>${escapeHtml(formatBytes(asset.size))}</span>
          <span>•</span>
          <span>${escapeHtml(formatTimestamp(asset.updatedAt))}</span>
          ${asset.restartRequired ? `<span>•</span><span class="font-semibold uppercase tracking-[0.12em] text-amber-300">Restart Required</span>` : ""}
        </div>
      </div>
    </article>`;
}

function renderBlueprintCatalogTile(kind, item, support, profileId) {
  const iconMarkup = renderImageOrFallback(item.iconUrl, item.title, kind === "plugin" ? "plug" : "archive");
  const disabledClass = support.supported ? "" : "cursor-not-allowed opacity-50";
  return `<article class="relative overflow-hidden rounded-lg border border-[#2c3743] bg-[#1f2933] p-4 transition hover:border-[#556372]">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05),transparent_30%)]"></div>
      <div class="relative">
        <div class="flex items-start justify-between gap-4">
          <div class="flex min-w-0 items-start gap-3">
            <div class="h-12 w-12 overflow-hidden rounded-md border border-white/10 bg-black/30">
              ${iconMarkup}
            </div>
            <div class="min-w-0">
              <h3 class="truncate text-base font-bold text-white">${escapeHtml(item.title)}</h3>
              <div class="mt-1 text-[11px] text-slate-400">by ${escapeHtml(item.author)} • ${escapeHtml(formatCount(item.downloads))} downloads</div>
            </div>
          </div>
          <button type="button" class="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white transition hover:border-white hover:bg-white hover:text-black ${disabledClass}" data-action="install-catalog" data-kind="${escapeHtml(kind)}" data-project-id="${escapeHtml(item.id)}" data-profile-id="${escapeHtml(profileId)}" data-busy-label="Installing..." ${support.supported ? "" : "disabled"}>Install</button>
        </div>
        <p class="mt-4 text-sm leading-6 text-slate-300">${escapeHtml(item.description ?? "No description provided.")}</p>
      </div>
    </article>`;
}

function renderBlueprintAddonColumn(kind, profiles, assets, resultSet) {
  const support = addonSupportState(activeServer(), kind);
  const profile = resultSet?.profile ?? profiles?.[0] ?? null;
  const statusBanner = !support.supported
    ? renderExtensionStatusBanner(
        "warning",
        `${kind === "plugin" ? "Plugin" : "Mod"} install blocked`,
        support.reason,
      )
    : profile
      ? renderExtensionStatusBanner(
          "info",
          `${kind === "plugin" ? "Plugin" : "Mod"} catalog ready`,
          `Installs will target ${profile.name} for ${activeServer()?.install?.installedVersion ?? activeServer()?.install?.requestedVersion ?? "latest"}.`,
        )
      : "";
  const installedTiles = assets.length
    ? assets.map((asset) => renderBlueprintExtensionTile(kind, asset)).join("")
    : `<div class="rounded-lg border border-dashed border-[#3a4754] bg-[#1f2933]/60 px-5 py-8 text-sm text-slate-400">No ${escapeHtml(kind)} files are installed yet.</div>`;
  const searchResults = resultSet?.results?.length
    ? resultSet.results.map((item) => renderBlueprintCatalogTile(kind, item, support, resultSet.profile.id)).join("")
    : `<div class="rounded-lg border border-dashed border-[#3a4754] bg-[#1f2933]/60 px-5 py-8 text-sm text-slate-400">Search the catalog to install ${escapeHtml(kind)} files directly into this server.</div>`;
  return `<section class="space-y-5 rounded-xl border border-[#2c3743] bg-[#18212b] p-6">
      <div class="rounded-lg bg-[linear-gradient(to_right,#1f2933_50%,transparent_100%)] px-5 py-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-xl font-bold text-white">${escapeHtml(kind === "plugin" ? "Plugins" : "Mods")}</div>
            <div class="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              ${kind === "plugin"
                ? "Browse and install server-side plugin files using the current server software and version rules."
                : "Browse and install mod files that match the current loader and Minecraft version."}
            </div>
          </div>
          <a href="${escapeHtml(kind === "plugin" ? "https://modrinth.com/plugins" : "https://modrinth.com/mods")}" target="_blank" rel="noreferrer" class="text-sm font-bold text-cyan-300 hover:text-cyan-200">Learn more</a>
        </div>
      </div>
      ${statusBanner}
      <form data-form="catalog-search" data-kind="${escapeHtml(kind)}" class="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
        <input name="query" type="text" value="${escapeHtml(resultSet?.query ?? "")}" placeholder="Search ${escapeHtml(kind)} catalog" class="${C.input} w-full" />
        <select name="profileId" class="${C.input} w-full">
          ${(profiles ?? []).map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === profile?.id ? "selected" : ""}>${escapeHtml(entry.name ?? entry.label ?? entry.id)}</option>`).join("")}
        </select>
        <button type="submit" class="${C.btnPrimary}" data-busy-label="Searching...">Search</button>
      </form>
      <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">${searchResults}</div>
      <div class="space-y-4">
        <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Installed ${escapeHtml(kind === "plugin" ? "plugins" : "mods")}</div>
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">${installedTiles}</div>
      </div>
    </section>`;
}

function icon(name, className = "h-4 w-4") {
  const paths = {
    plus: `<path d="M12 5v14M5 12h14" />`,
    grid: `<path d="M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z" />`,
    list: `<path d="M8 7h11M8 12h11M8 17h11M4 7h.01M4 12h.01M4 17h.01" />`,
    server: `<path d="M5 6h14v4H5zM5 14h14v4H5z" /><path d="M8 8h.01M8 16h.01" />`,
    layers: `<path d="M12 4 4 8l8 4 8-4-8-4Z" /><path d="m4 12 8 4 8-4M4 16l8 4 8-4" />`,
    terminal: `<path d="m5 8 4 4-4 4M11 16h8" />`,
    users: `<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="3" /><path d="M20 21v-2a4 4 0 0 0-3-3.87" />`,
    globe: `<circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />`,
    plug: `<path d="M9 7v6M15 7v6M6 10h12M12 13v5a2 2 0 0 1-2 2" />`,
    archive: `<path d="M4 7h16v4H4zM6 11h12v8H6z" /><path d="M10 15h4" />`,
    sliders: `<path d="M4 21v-7M4 10V3M12 21v-3M12 14V3M20 21v-5M20 12V3" /><path d="M2 14h4M10 10h4M18 12h4" />`,
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="${escapeHtml(className)}">${paths[name] ?? `<circle cx="12" cy="12" r="9" />`}</svg>`;
}

function renderHeader() {
  const server = activeServer();
  const navButtonClass = (active) =>
    `${active ? "releu-nav-active text-white" : "text-zinc-500 hover:text-white"} pb-4 text-[11px] font-bold uppercase tracking-[0.18em] transition`;
  const nav = ui.screen === "manager"
    ? []
    : ui.screen === "setup"
    ? [
        `<button type="button" data-action="go-manager" class="${navButtonClass(true)}">Servers</button>`,
        `<span class="${navButtonClass(true)}">Setup</span>`,
      ]
    : [
        `<button type="button" data-action="go-manager" class="${navButtonClass(false)}">Servers</button>`,
        ...sections.map(
          (item) => `<button type="button" data-action="switch-section" data-section="${escapeHtml(item.id)}" class="${navButtonClass(ui.section === item.id && ui.screen !== "manager")}">${escapeHtml(item.label)}</button>`,
        ),
      ];
  return `<header class="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-outline bg-black px-6"><div class="flex min-w-0 items-center gap-8"><div class="text-xl font-black tracking-tight text-white">Releu</div>${nav.length ? `<nav class="hidden items-center gap-8 md:flex">${nav.join("")}</nav>` : ""}</div><div class="flex items-center gap-3">${server && ui.screen !== "manager" ? `<div class="hidden items-center gap-2 border border-outline px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400 lg:flex"><span class="${escapeHtml(serverStatusPresentation(server).tone.dot)} h-2 w-2 rounded-full"></span><span>${escapeHtml(server.name)}</span></div>` : ""}<button type="button" class="${C.btnPrimary}" data-action="add-server-prompt">Add Server</button></div></header>`;
}

function extractMainContent(screenHtml) {
  const match = String(screenHtml ?? "").match(/<main\b[^>]*>([\s\S]*)<\/main>/i);
  return match ? match[1] : String(screenHtml ?? "");
}

function pelicanSidebarItems(server) {
  if (ui.screen === "create-server") {
    return [
      { kind: "action", label: "Servers", active: false, action: "go-manager", iconName: "server" },
      { kind: "static", label: "Create Server", active: true, iconName: "plus" },
    ];
  }

  if (ui.screen === "manager" || !server) {
    return [{ kind: "action", label: "Servers", active: true, action: "go-manager", iconName: "server" }];
  }

  if (ui.screen === "setup" || !server.setupComplete) {
    return [
      { kind: "action", label: "Servers", active: false, action: "go-manager", iconName: "server" },
      { kind: "static", label: "Setup", active: true, iconName: "layers" },
    ];
  }

  return [
    { kind: "action", label: "Servers", active: false, action: "go-manager", iconName: "server" },
    ...sections.map((section) => ({
      kind: "section",
      label: section.label,
      active: ui.section === section.id,
      sectionId: section.id,
      iconName:
        section.id === "server" ? "grid"
          : section.id === "software" ? "layers"
            : section.id === "console" ? "terminal"
              : section.id === "players" ? "users"
                : section.id === "worlds" ? "globe"
                  : section.id === "addons" ? "plug"
                    : section.id === "backups" ? "archive"
                      : "sliders",
    })),
  ];
}

function pelicanPageMeta(server) {
  if (ui.screen === "manager" || !server) {
    return {
      eyebrow: "Client Area",
      title: "Server Control",
      detail: "Pelican-style navigation with the current Releu backend and data flow untouched.",
    };
  }

  if (ui.screen === "create-server") {
    return {
      eyebrow: "Servers",
      title: "Create Server",
      detail: "Create the server first, then continue directly into Setup with the selected choices ready.",
    };
  }

  if (ui.screen === "setup" || !server.setupComplete) {
    return {
      eyebrow: "Server Setup",
      title: server.name,
      detail: "Install software and tune runtime limits before opening the full panel.",
    };
  }

  return {
    eyebrow: ui.section === "server" ? "Overview" : sections.find((entry) => entry.id === ui.section)?.label ?? "Panel",
    title: server.name,
    detail: serverStatusPresentation(server).detail,
  };
}

function renderPelicanSidebar(server) {
  const items = pelicanSidebarItems(server);
  const serverBadge = server && ui.screen !== "manager"
    ? `<div class="fi-sidebar-footer">
        <div class="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/10 dark:bg-white/5">
          <div class="text-xs text-gray-500 dark:text-gray-400">Active Server</div>
          <div class="mt-1 text-sm font-semibold text-gray-950 dark:text-white">${escapeHtml(server.name)}</div>
          <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">127.0.0.1:${escapeHtml(serverPort(server))}</div>
        </div>
      </div>`
    : "";
  return `<aside class="fi-sidebar fixed inset-y-0 left-0 z-40 hidden w-[18rem] flex-col bg-white ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10 lg:flex">
      <div class="fi-sidebar-header flex h-16 items-center bg-white px-6 ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
        <div class="fi-logo text-xl font-black tracking-tight text-gray-950 dark:text-white">Releu</div>
      </div>
      <nav class="fi-sidebar-nav">
        <ul class="fi-sidebar-nav-groups">
          <li class="fi-sidebar-group flex flex-col gap-y-1">
            <ul class="fi-sidebar-group-items flex flex-col gap-y-1">
              ${items.map((item) => {
                const label = escapeHtml(item.label);
                const iconSvg = icon(item.iconName, "fi-icon h-5 w-5");
                const liClass = `fi-sidebar-item ${item.active ? "fi-active" : ""} ${item.kind !== "static" ? "fi-sidebar-item-has-url" : ""}`;
                const actionAttrs =
                  item.kind === "action"
                    ? `data-action="${escapeHtml(item.action)}"`
                    : item.kind === "section"
                      ? `data-action="switch-section" data-section="${escapeHtml(item.sectionId)}"`
                      : "";
                const element = item.kind === "static" ? "div" : "button";
                return `<li class="${liClass}">
                    <${element} ${element === "button" ? 'type="button"' : ""} ${actionAttrs} class="fi-sidebar-item-btn group">
                      ${iconSvg}
                      <span class="fi-sidebar-item-label">${label}</span>
                    </${element}>
                  </li>`;
              }).join("")}
            </ul>
          </li>
        </ul>
      </nav>
      ${serverBadge}
      <div class="fi-sidebar-footer">
        <button type="button" class="fi-btn rounded-lg bg-primary-600 text-white hover:bg-primary-500 dark:bg-primary-500 dark:text-gray-950 dark:hover:bg-primary-400" data-action="add-server-prompt">Add Server</button>
      </div>
    </aside>`;
}

function renderPelicanBlueprintShell(screenHtml, server) {
  const headerActions = server && ui.screen !== "manager"
    ? `<div class="flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-700 dark:bg-white/5 dark:text-gray-200"><span class="${escapeHtml(serverStatusPresentation(server).tone.dot)} h-2 w-2 rounded-full"></span><span>${escapeHtml(serverStatusPresentation(server).label)}</span></div>`
    : "";
  return `<div class="releu-pelican-frame min-h-screen bg-gray-50 text-gray-950 dark:bg-gray-950 dark:text-white">
      <div class="fi-layout flex min-h-screen w-full">
        ${renderPelicanSidebar(server)}
        <div class="min-w-0 flex-1 lg:ml-[18rem]">
          <div class="fi-topbar-ctn">
            <header class="fi-topbar">
              <div class="fi-topbar-start">
                <div class="fi-logo text-lg font-black tracking-tight text-gray-950 dark:text-white">Releu</div>
              </div>
              <div class="fi-topbar-end">
                ${headerActions}
                <button type="button" class="fi-btn rounded-lg bg-primary-600 text-white hover:bg-primary-500 dark:bg-primary-500 dark:text-gray-950 dark:hover:bg-primary-400" data-action="add-server-prompt">Add Server</button>
              </div>
            </header>
          </div>
          <main class="fi-main mx-auto h-full w-full max-w-7xl px-4 py-6 md:px-6">
            <div class="fi-page flex flex-col gap-y-6">
              ${extractMainContent(screenHtml)}
            </div>
          </main>
        </div>
      </div>
    </div>`;
}

function renderPlayitGateScreen() {
  const playit = runtime.data?.playit ?? {};
  const waiting = Boolean(playit.claimWaiting);
  const startingLinkedAgent = Boolean(playit.secretConfigured && !playit.running && !waiting);
  const title = waiting
    ? "Finish Playit Agent Link To Continue"
    : startingLinkedAgent
      ? "Connecting Playit Agent To Continue"
      : "Connect Playit Agent To Continue";
  const detail = waiting
    ? "Complete the playit.gg browser link. Releu will move to the main menu automatically as soon as the agent is connected."
    : startingLinkedAgent
      ? "Releu is starting the linked playit.gg agent now. This page will continue automatically when the agent connects."
      : "Link playit.gg once for this app. Releu will reuse that connection for every server you create on this PC.";
  const note =
    playit.lastError ||
    playit.statusMessage ||
    "You can relink or reset the agent later from Settings.";
  const primaryAction = waiting
    ? `<a class="${C.btnPrimary}" href="${escapeHtml(playit.claimUrl ?? playit.dashboardTunnelUrl)}" target="_blank" rel="noreferrer">Open Playit Link</a>`
    : startingLinkedAgent
      ? `<button type="button" class="${C.btnGhost}" data-action="refresh-playit-gate">Refresh Status</button>`
      : `<button type="button" class="${C.btnPrimary}" data-action="playit-connect">Connect Playit Agent</button>`;
  const secondaryAction = waiting
    ? `<button type="button" class="${C.btnGhost}" data-action="refresh-playit-gate">Refresh Status</button>`
    : "";
  return `<div class="releu-screen min-h-screen bg-black text-white"><header class="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-outline bg-black px-6"><div class="text-xl font-black tracking-tight text-white">Releu</div></header><main class="mx-auto flex min-h-[calc(100vh-64px)] max-w-3xl items-center justify-center p-8"><section class="releu-panel w-full border border-outline bg-surface p-8 text-center"><p class="${C.label} mb-4">Playit Agent</p><h1 class="mx-auto max-w-2xl text-4xl font-black uppercase tracking-tight text-white">${escapeHtml(title)}</h1><p class="mx-auto mt-4 max-w-2xl text-sm leading-7 text-zinc-400">${escapeHtml(detail)}</p><div class="mx-auto mt-8 max-w-2xl border border-outline bg-black px-5 py-4 text-left text-sm text-zinc-400"><div class="${C.label} mb-2">Status</div><p>${escapeHtml(note)}</p></div><div class="mt-8 flex flex-wrap justify-center gap-3">${primaryAction}${secondaryAction}</div></section></main></div>`;
}

function renderBootstrapScreen() {
  if (ui.bootstrap.stage === "downloading" || ui.bootstrap.stage.startsWith("app-update-")) {
    return `<div class="min-h-screen bg-black text-white"><main class="flex min-h-screen items-center justify-center bg-black"><div class="flex w-full max-w-md flex-col items-center px-8"><h1 class="mb-4 text-center text-4xl font-black uppercase tracking-[0.18em] text-white">${escapeHtml(ui.bootstrap.title || "Installing Dependencies")}</h1><div class="relative h-px w-full overflow-hidden bg-zinc-800"><div class="absolute inset-y-0 left-0 bg-white transition-all duration-200" style="width:${Math.max(8, Math.min(100, ui.bootstrap.progressWidth))}%"></div></div><div class="mt-3 flex w-full items-center justify-between opacity-60"><span class="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">${escapeHtml(ui.bootstrap.metaLeft)}</span><span class="font-mono text-[13px] text-zinc-400">${escapeHtml(ui.bootstrap.metaRight || "Preparing")}</span></div><p class="mt-4 text-center text-sm text-zinc-400">${escapeHtml(ui.bootstrap.detail)}</p>${ui.bootstrap.warning ? `<p class="mt-3 text-center text-[12px] font-bold uppercase tracking-[0.16em] text-zinc-500">${escapeHtml(ui.bootstrap.warning)}</p>` : ""}</div></main><div aria-hidden="true" class="pointer-events-none fixed bottom-8 right-8 opacity-20"><span class="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">System Boot // Core_v2.0.4</span></div></div>`;
  }

  return `<div class="min-h-screen bg-black text-white"><main class="flex min-h-screen items-center justify-center bg-black"><div class="flex w-full max-w-md flex-col items-center space-y-6 px-6"><h1 class="select-none text-center text-4xl font-semibold uppercase tracking-[0.15em] text-white">${escapeHtml(ui.bootstrap.title || "Checking For Dependencies")}</h1><div class="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white"></div><p class="text-center text-sm text-zinc-400">${escapeHtml(ui.bootstrap.detail)}</p>${ui.bootstrap.warning ? `<p class="text-center text-[12px] font-bold uppercase tracking-[0.16em] text-zinc-500">${escapeHtml(ui.bootstrap.warning)}</p>` : ""}</div></main><div aria-hidden="true" class="pointer-events-none fixed bottom-8 right-8 opacity-20"><span class="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">System Boot // Core_v2.0.4</span></div></div>`;
}

function renderModal() {
  if (!ui.modal) return "";
  if (ui.modal.type === "create-server") {
    return `<div class="releu-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"><div class="releu-modal-panel w-full max-w-xl border border-outline bg-surface p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"><div class="mb-6 flex items-start justify-between gap-4"><div><p class="${C.label} mb-2">Add Server</p><h2 class="text-3xl font-black tracking-tight text-white">Create a new Minecraft server.</h2><p class="mt-3 text-sm text-zinc-400">Releu creates the folder automatically, picks a free port automatically, and saves the server to disk right away.</p></div><button type="button" class="text-zinc-500 transition hover:text-white" data-action="close-modal" aria-label="Close">${icon("plus", "h-5 w-5 rotate-45")}</button></div><form data-form="create-server-modal" class="space-y-4"><label class="block"><span class="${C.label} mb-3 block">Server Name</span><input name="name" data-modal-input="server-name" type="text" value="${escapeHtml(ui.modal.name ?? "")}" placeholder="Primary Server" autocomplete="off" autocapitalize="words" spellcheck="false" required class="${C.input} w-full text-2xl font-semibold tracking-tight text-white" /></label><div class="flex flex-wrap justify-end gap-2"><button type="button" class="${C.btnGhost}" data-action="close-modal">Cancel</button><button type="submit" class="${C.btnPrimary}" data-busy-label="Creating...">Add Server</button></div></form></div></div>`;
  }
  if (ui.modal.type === "delete-server") {
    return `<div class="releu-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"><div class="releu-modal-panel w-full max-w-lg border border-outline bg-surface p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"><div class="mb-6"><p class="${C.label} mb-2">Delete Server</p><h2 class="text-3xl font-black tracking-tight text-white">${escapeHtml(ui.modal.serverName)}</h2><p class="mt-3 text-sm text-zinc-400">This removes the server from Releu and deletes its local server files, panel data, and backups.</p></div><form data-form="delete-server-modal" class="space-y-4"><div class="rounded-sm border border-outline bg-black px-4 py-3 text-sm text-zinc-400">This action cannot be undone.</div><div class="flex flex-wrap justify-end gap-2"><button type="button" class="${C.btnGhost}" data-action="close-modal">Cancel</button><button type="submit" class="border border-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white transition hover:bg-white hover:text-black">Delete Server</button></div></form></div></div>`;
  }
  if (ui.modal.type === "playit-reset") {
    return `<div class="releu-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"><div class="releu-modal-panel w-full max-w-lg border border-outline bg-surface p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"><div class="mb-6"><p class="${C.label} mb-2">Reset Agent</p><h2 class="text-3xl font-black tracking-tight text-white">Reset playit.gg agent link</h2><p class="mt-3 text-sm text-zinc-400">This stops the local playit agent, clears the saved playit account link, and removes the current tunnel session from Releu. You can link a different playit.gg account again right after this.</p></div><form data-form="playit-reset-modal" class="space-y-4"><div class="rounded-sm border border-outline bg-black px-4 py-3 text-sm text-zinc-400">If the agent file is missing, Releu will reinstall it automatically the next time you link playit.gg.</div><div class="flex flex-wrap justify-end gap-2"><button type="button" class="${C.btnGhost}" data-action="close-modal">Cancel</button><button type="submit" class="border border-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white transition hover:bg-white hover:text-black">Reset Agent</button></div></form></div></div>`;
  }
  if (ui.modal.type === "ui-picker") {
    const currentVariant = currentUiSettings().variant === UI_VARIANT_PELICAN_BLUEPRINT
      ? UI_VARIANT_PELICAN_BLUEPRINT
      : UI_VARIANT_CLASSIC;
    return `<div class="releu-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/82 p-4"><div class="releu-modal-panel w-full max-w-5xl border border-outline bg-surface p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
      <div class="mb-6">
        <p class="${C.label} mb-2">Choose Releu UI</p>
        <h2 class="text-3xl font-black tracking-tight text-white">Legacy UI is the default. You can switch to the new Pelican-based UI anytime.</h2>
        <p class="mt-3 max-w-3xl text-sm text-zinc-400">This picker uses the original Releu styling on purpose. Pick the shell this PC should open by default, and you can change it again later from Settings.</p>
      </div>
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section class="border ${currentVariant === UI_VARIANT_CLASSIC ? "border-white bg-black" : "border-outline bg-surfaceAlt"} p-5">
          <div class="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 class="text-xl font-semibold text-white">Legacy UI</h3>
              <p class="mt-2 text-sm text-zinc-400">The original Releu layout. Best when you want the most proven feature coverage first.</p>
            </div>
            <span class="${C.chip} ${currentVariant === UI_VARIANT_CLASSIC ? "!border-white !text-white" : ""}">${currentVariant === UI_VARIANT_CLASSIC ? "Current Default" : "Option"}</span>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <div class="border border-outline bg-surface p-4">
              <div class="${C.labelOn} mb-3">Pros</div>
              <div class="space-y-2 text-sm text-zinc-300">
                <div>Most complete and battle-tested feature coverage</div>
                <div>Denser server controls and quicker action access</div>
                <div>Best fallback if you want the least experimental route</div>
              </div>
            </div>
            <div class="border border-outline bg-surface p-4">
              <div class="${C.labelOn} mb-3">Cons</div>
              <div class="space-y-2 text-sm text-zinc-300">
                <div>Heavier, more utilitarian panel look</div>
                <div>Less like a hosted game-panel shell</div>
              </div>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" class="${C.btnPrimary}" data-action="choose-ui-variant" data-ui-variant="${UI_VARIANT_CLASSIC}">Continue With Legacy UI</button>
          </div>
        </section>
        <section class="border ${currentVariant === UI_VARIANT_PELICAN_BLUEPRINT ? "border-white bg-black" : "border-outline bg-surfaceAlt"} p-5">
          <div class="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 class="text-xl font-semibold text-white">New UI</h3>
              <p class="mt-2 text-sm text-zinc-400">A Pelican-based shell wired to Releu’s backend. Cleaner browsing and calmer page structure, with newer bridge logic underneath.</p>
            </div>
            <span class="${C.chip} ${currentVariant === UI_VARIANT_PELICAN_BLUEPRINT ? "!border-white !text-white" : ""}">${currentVariant === UI_VARIANT_PELICAN_BLUEPRINT ? "Current Default" : "Option"}</span>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <div class="border border-outline bg-surface p-4">
              <div class="${C.labelOn} mb-3">Pros</div>
              <div class="space-y-2 text-sm text-zinc-300">
                <div>Cleaner hosted-panel style navigation</div>
                <div>Better visual hierarchy for browsing and setup</div>
                <div>Pelican-based structure with Releu data wired in</div>
              </div>
            </div>
            <div class="border border-outline bg-surface p-4">
              <div class="${C.labelOn} mb-3">Cons</div>
              <div class="space-y-2 text-sm text-zinc-300">
                <div>Newer shell, so edge-case flows need more verification</div>
                <div>Some advanced pages still depend on bridge patching</div>
              </div>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" class="${C.btnGhost}" data-action="choose-ui-variant" data-ui-variant="${UI_VARIANT_PELICAN_BLUEPRINT}">Use New UI</button>
          </div>
        </section>
      </div>
    </div></div>`;
  }
  return "";
}

function renderManagerScreen() {
  if (isPelicanBlueprintVariant()) {
    return renderPelicanManagerScreen();
  }
  const servers = runtime.data?.servers ?? [];
  const gridClass = ui.managerView === "list" ? "grid grid-cols-1 gap-6" : "grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3";
  const cards = servers
    .map((server) => {
      const presentation = serverStatusPresentation(server);
      const software = server.install.installedSoftware ?? server.install.software ?? "purpur";
      const version = server.install.installedVersion ?? server.install.requestedVersion ?? "latest";
      const cpuPercent = Number(server.metrics?.cpuPercent ?? 0);
      const ramMaxMb = Number(server.metrics?.ramMaxMb ?? 0);
      const ramUsedMb = Number(server.metrics?.ramUsedMb ?? 0);
      const loadWidth = Math.max(cpuPercent, ramMaxMb ? (ramUsedMb / ramMaxMb) * 100 : 0);
      const secondaryCommand = server.jarInstalled ? (server.status === "running" ? "restart" : "start") : null;
      return `<article class="releu-panel relative overflow-hidden border border-outline bg-surface transition hover:border-zinc-500"><div class="absolute right-0 top-0 p-4"><div class="flex items-center gap-2"><div class="${escapeHtml(presentation.tone.dot)} h-2 w-2 rounded-full"></div><span class="text-[10px] font-bold uppercase tracking-[0.18em] ${escapeHtml(presentation.tone.text)}">${escapeHtml(presentation.label)}</span></div></div><div class="p-6"><div class="flex flex-col gap-4"><div><h3 class="mb-1 text-xl font-semibold tracking-tight text-white">${escapeHtml(server.name)}</h3><p class="font-mono text-[11px] text-zinc-500">${escapeHtml(server.serverDir)}</p></div><div class="flex flex-wrap gap-2"><span class="${C.chip}">Port ${escapeHtml(server.port)}</span><span class="${C.chip}">${escapeHtml(softwareLabel(software))}</span><span class="${C.chip}">${escapeHtml(version)}</span></div><div class="space-y-3 border-t border-zinc-900 pt-4"><div class="flex items-center justify-between"><span class="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Resource Load</span><span class="font-mono text-[10px] text-white">${escapeHtml(formatPercent(loadWidth))}</span></div><div class="h-1 w-full bg-zinc-900"><div class="releu-progress-fill h-full bg-white" style="width:${Math.max(0, Math.min(100, loadWidth))}%"></div></div><p class="text-xs leading-6 text-zinc-400">${escapeHtml(presentation.detail)}</p></div></div></div><div class="grid grid-cols-3 border-t border-outline"><button type="button" class="releu-button border-r border-outline py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white transition hover:bg-white hover:text-black" data-action="select-server" data-server-id="${escapeHtml(server.id)}">${server.jarInstalled ? "Manage" : "Setup"}</button>${secondaryCommand ? `<button type="button" class="releu-button border-r border-outline py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white transition hover:bg-white hover:text-black" data-action="quick-server-control" data-server-id="${escapeHtml(server.id)}" data-server-command="${escapeHtml(secondaryCommand)}">${secondaryCommand === "restart" ? "Restart" : "Start"}</button>` : `<button type="button" class="releu-button border-r border-outline py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 transition hover:bg-white hover:text-black" data-action="select-server" data-server-id="${escapeHtml(server.id)}">Open</button>`}<button type="button" class="releu-button py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 transition hover:bg-white hover:text-black" data-action="delete-server" data-server-id="${escapeHtml(server.id)}" data-server-name="${escapeHtml(server.name)}">Delete</button></div></article>`;
    })
    .join("");
  return `<div class="releu-screen min-h-screen bg-black text-white">${renderHeader()}<main class="mx-auto w-full max-w-7xl p-8"><div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div class="space-y-2"><p class="${C.label}">Server Selector</p><h1 class="text-3xl font-black tracking-tight text-white">Choose a server or add a new one.</h1><p class="max-w-3xl text-sm text-zinc-400">New servers are created automatically in the Releu data folder, ports are assigned automatically, and server data is saved automatically to disk.</p></div><div class="flex gap-2"><button type="button" class="releu-button flex h-10 w-10 items-center justify-center border border-outline transition hover:bg-surfaceAlt ${ui.managerView === "grid" ? "bg-surface text-white" : "text-zinc-500"}" data-action="toggle-manager-view" data-view="grid">${icon("grid")}</button><button type="button" class="releu-button flex h-10 w-10 items-center justify-center border border-outline transition hover:bg-surfaceAlt ${ui.managerView === "list" ? "bg-surface text-white" : "text-zinc-500"}" data-action="toggle-manager-view" data-view="list">${icon("list")}</button></div></div><div class="${gridClass}">${cards}<button type="button" class="releu-panel group flex min-h-[290px] flex-col items-center justify-center border border-dashed border-outline p-12 text-center transition hover:border-white" data-action="add-server-prompt"><div class="mb-4 text-zinc-500 transition group-hover:text-white">${icon("plus", "h-9 w-9")}</div><span class="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500 transition group-hover:text-white">Add Server</span></button></div></main></div>`;
}

function renderSetupScreen() {
  const server = activeServer();
  const versionOptions = getVersionOptions(ui.installDraft.software, ui.installDraft.version);
  const installState = server.server.operation?.active
    ? {
        label: server.server.operation.shortLabel ?? server.server.operation.title ?? "Installing",
        detail: server.server.operation.detail ?? "Releu is installing server software.",
      }
    : {
        label: "Ready For Install",
        detail: "The server folder already exists, the port is reserved, and backups are ready. Install the selected software to open the full panel.",
      };
  return `<div class="releu-screen min-h-screen bg-black text-white">${renderHeader()}<main class="mx-auto max-w-[1440px] p-8"><header class="mb-10"><h1 class="text-3xl font-black uppercase tracking-tight text-white">Server Setup</h1><p class="mt-2 max-w-3xl text-sm text-zinc-400">Configure the software, resource limits, and launcher path. Releu accepts the Minecraft EULA automatically during install.</p></header><div class="grid grid-cols-1 gap-4 md:grid-cols-12"><section class="${C.card} flex flex-col gap-6 md:col-span-4"><div class="border-b border-zinc-900 pb-4"><h2 class="${C.label}">Selected Server</h2></div><div class="space-y-6"><div><label class="${C.label} mb-2 block">Server Name</label><p class="text-2xl font-semibold text-white">${escapeHtml(server.name)}</p></div><div><label class="${C.label} mb-2 block">Auto Folder</label><div class="border border-outline bg-black p-4 font-mono text-[11px] text-zinc-300">${escapeHtml(server.serverDir)}</div></div><div class="grid grid-cols-2 gap-4"><div><label class="${C.label} mb-1 block">Port</label><p class="text-sm text-white">${escapeHtml(server.server.properties["server-port"] ?? 25565)}</p></div><div><label class="${C.label} mb-1 block">Backups</label><p class="text-sm text-white">${server.backups.enabled ? `Every ${escapeHtml(server.backups.intervalMinutes)} minutes` : "Disabled"}</p></div></div><div class="space-y-2 border-t border-zinc-900 pt-4 text-xs text-zinc-400"><p>Folders are created automatically in the Releu data folder.</p></div></div></section><section class="${C.card} flex flex-col gap-6 md:col-span-8"><div class="border-b border-zinc-900 pb-4"><h2 class="${C.label}">Choose Software</h2></div><div class="grid grid-cols-2 gap-4 lg:grid-cols-4">${softwareChoices().map((option) => { const selected = option.id === ui.installDraft.software; return `<button type="button" class="releu-button flex min-h-[148px] flex-col justify-between border ${selected ? "border-white bg-white text-black" : "border-outline bg-black text-white hover:border-zinc-600"} p-4 text-left transition" data-action="pick-software" data-software-id="${escapeHtml(option.id)}"><div class="flex items-start justify-between gap-3"><div class="${selected ? "text-black" : "text-zinc-500"}">${icon(selected ? "server" : "layers", "h-5 w-5")}</div>${selected ? `<div class="h-2 w-2 rounded-full bg-black"></div>` : ""}</div><div class="space-y-2"><div class="text-sm font-bold tracking-tight">${escapeHtml(option.name)}</div><div class="text-[10px] uppercase tracking-[0.18em] ${selected ? "text-zinc-700" : "text-zinc-500"}">${escapeHtml(option.latestHint ?? option.releaseChannel ?? option.id)}</div></div></button>`; }).join("")}</div><label class="flex flex-col gap-2"><span class="${C.label}">Minecraft Version</span><select data-install-field="version" class="w-full border border-outline bg-black px-4 py-3 text-white outline-none transition focus:border-white">${versionOptions.map((version) => `<option value="${escapeHtml(version)}" ${version === ui.installDraft.version ? "selected" : ""}>${escapeHtml(version)}</option>`).join("")}</select></label></section><section class="${C.card} flex flex-col gap-8 md:col-span-8"><div class="border-b border-zinc-900 pb-4"><h2 class="${C.label}">Server Resources</h2></div><div class="grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-2"><label class="space-y-4"><div class="flex items-center justify-between"><span class="${C.label}">Max RAM Allocation</span><span class="font-mono text-sm text-white" data-output="maxRamMb">${escapeHtml(mbToRamString(ui.installDraft.maxRamMb))}</span></div><input type="range" min="512" max="${escapeHtml(runtime.data.host.totalMemoryMb)}" step="256" value="${escapeHtml(ui.installDraft.maxRamMb)}" data-install-field="maxRamMb" class="w-full accent-white" /></label><label class="space-y-4"><div class="flex items-center justify-between"><span class="${C.label}">Min RAM Allocation</span><span class="font-mono text-sm text-white" data-output="minRamMb">${escapeHtml(mbToRamString(ui.installDraft.minRamMb))}</span></div><input type="range" min="512" max="${escapeHtml(ui.installDraft.maxRamMb)}" step="256" value="${escapeHtml(ui.installDraft.minRamMb)}" data-install-field="minRamMb" class="w-full accent-white" /></label><label class="space-y-4"><div class="flex items-center justify-between"><span class="${C.label}">CPU Core Limit</span><span class="font-mono text-sm text-white" data-output="cpuCores">${escapeHtml(ui.installDraft.cpuCores)}</span></div><input type="range" min="1" max="${escapeHtml(runtime.data.host.cpuCores)}" step="1" value="${escapeHtml(ui.installDraft.cpuCores)}" data-install-field="cpuCores" class="w-full accent-white" /></label><label class="space-y-4"><div class="flex items-center justify-between"><span class="${C.label}">GPU Share</span><span class="font-mono text-sm text-white" data-output="gpuShare">${escapeHtml(`${ui.installDraft.gpuShare}%`)}</span></div><input type="range" min="0" max="100" step="5" value="${escapeHtml(ui.installDraft.gpuShare)}" data-install-field="gpuShare" class="w-full accent-white" /></label><label class="space-y-2 md:col-span-2"><span class="${C.label}">Java Executable Path</span><input data-install-field="javaPath" type="text" value="${escapeHtml(ui.installDraft.javaPath)}" class="${C.input} font-mono text-sm" /></label></div></section><section class="${C.card} flex flex-col gap-6 md:col-span-4"><div class="border-b border-zinc-900 pb-4"><h2 class="${C.label}">Install And Open</h2></div><div class="flex flex-1 flex-col justify-between gap-6"><div class="space-y-4 text-sm text-zinc-300"><p>${escapeHtml(installState.detail)}</p><div class="flex items-center gap-3"><div class="h-2 w-2 rounded-full ${server.server.operation?.active ? "bg-zinc-300" : "bg-white"}"></div><span class="text-[11px] font-bold uppercase tracking-[0.18em] text-white">${escapeHtml(installState.label)}</span></div></div><button type="button" data-action="install-setup" class="w-full border border-white bg-white py-6 text-[11px] font-bold uppercase tracking-[0.18em] text-black transition hover:bg-zinc-200">${escapeHtml(server.server.operation?.active ? (server.server.operation.shortLabel ?? "Installing") : "Install Server")}</button></div></section></div></main></div>`;
}

function renderCreateServerScreen() {
  const draft = ui.createDraft ?? buildCreateDraft();
  const versionOptions = getVersionOptions(draft.software, draft.version);
  return `<div class="space-y-6">
      ${renderPelicanPageIntro({
        eyebrow: "Servers",
        title: "Create Server",
        detail: "Create the server first, then Releu will open Setup with these software and runtime choices ready.",
      })}
      <form data-form="create-server-page" class="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <section class="fi-section overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
          <div class="border-b border-gray-200 px-6 py-4 dark:border-white/10">
            <div class="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Server Identity</div>
          </div>
          <div class="space-y-6 px-6 py-6">
            <label class="block">
              <span class="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Server Name</span>
              <input name="name" type="text" value="${escapeHtml(draft.name ?? "")}" data-create-field="name" placeholder="Minecraft Test Server" autocomplete="off" autocapitalize="words" spellcheck="false" required class="mt-3 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-950 outline-none transition focus:border-primary-500 dark:border-white/10 dark:bg-gray-950 dark:text-white" />
            </label>
            <div class="rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
              Releu creates the folder automatically, reserves a free port automatically, and opens the new server in Setup right after creation.
            </div>
          </div>
        </section>
        <section class="fi-section overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
          <div class="border-b border-gray-200 px-6 py-4 dark:border-white/10">
            <div class="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Create And Open</div>
          </div>
          <div class="space-y-6 px-6 py-6">
            <div class="space-y-3 text-sm text-gray-600 dark:text-gray-300">
              <p>The new server will be created now.</p>
              <p>Software, Minecraft version, RAM, CPU, GPU share, and Java path will carry into Setup so you can install immediately.</p>
            </div>
            <div class="flex flex-wrap gap-3">
              <button type="submit" class="fi-btn rounded-lg bg-primary-600 text-white hover:bg-primary-500 dark:bg-primary-500 dark:text-gray-950 dark:hover:bg-primary-400" data-busy-label="Creating...">Create Server</button>
              <button type="button" class="fi-btn rounded-lg bg-transparent text-gray-700 ring-1 ring-gray-950/10 hover:bg-gray-50 dark:text-gray-200 dark:ring-white/10 dark:hover:bg-white/5" data-action="go-manager">Cancel</button>
            </div>
          </div>
        </section>
        <section class="fi-section overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
          <div class="border-b border-gray-200 px-6 py-4 dark:border-white/10">
            <div class="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Software / Version And Loader</div>
          </div>
          <div class="space-y-5 px-6 py-6">
            <div class="grid grid-cols-2 gap-4 xl:grid-cols-3">
              ${softwareChoices().map((option) => {
                const selected = option.id === draft.software;
                return `<button type="button" class="fi-btn block rounded-xl border px-4 py-4 text-left transition ${selected ? "border-primary-400 bg-primary-50 text-gray-950 dark:border-primary-400 dark:bg-primary-400 dark:text-gray-950" : "border-gray-200 bg-white text-gray-800 hover:border-primary-300 dark:border-white/10 dark:bg-gray-950 dark:text-white dark:hover:border-primary-400"}" data-action="pick-create-software" data-software-id="${escapeHtml(option.id)}"><div class="text-[11px] font-semibold uppercase tracking-[0.18em] ${selected ? "text-gray-600" : "text-gray-500 dark:text-gray-400"}">${escapeHtml(option.latestHint ?? option.releaseChannel ?? option.id)}</div><div class="mt-3 text-sm font-bold">${escapeHtml(option.name)}</div></button>`;
              }).join("")}
            </div>
            <label class="block">
              <span class="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Minecraft Version</span>
              <select data-create-field="version" class="mt-3 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-950 outline-none transition focus:border-primary-500 dark:border-white/10 dark:bg-gray-950 dark:text-white">${versionOptions.map((version) => `<option value="${escapeHtml(version)}" ${version === draft.version ? "selected" : ""}>${escapeHtml(version)}</option>`).join("")}</select>
            </label>
          </div>
        </section>
        <section class="fi-section overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
          <div class="border-b border-gray-200 px-6 py-4 dark:border-white/10">
            <div class="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Resources / Runtime</div>
          </div>
          <div class="space-y-6 px-6 py-6">
            <label class="block">
              <div class="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                <span>Max RAM</span><span data-create-output="maxRamMb">${escapeHtml(mbToRamString(draft.maxRamMb))}</span>
              </div>
              <input type="range" min="512" max="${escapeHtml(runtime.data.host.totalMemoryMb)}" step="256" value="${escapeHtml(draft.maxRamMb)}" data-create-field="maxRamMb" class="mt-3 w-full accent-current" />
            </label>
            <label class="block">
              <div class="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                <span>Min RAM</span><span data-create-output="minRamMb">${escapeHtml(mbToRamString(draft.minRamMb))}</span>
              </div>
              <input type="range" min="512" max="${escapeHtml(draft.maxRamMb)}" step="256" value="${escapeHtml(draft.minRamMb)}" data-create-field="minRamMb" class="mt-3 w-full accent-current" />
            </label>
            <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
              <label class="block">
                <div class="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                  <span>CPU Cores</span><span data-create-output="cpuCores">${escapeHtml(String(draft.cpuCores))}</span>
                </div>
                <input type="range" min="1" max="${escapeHtml(runtime.data.host.cpuCores)}" step="1" value="${escapeHtml(draft.cpuCores)}" data-create-field="cpuCores" class="mt-3 w-full accent-current" />
              </label>
              <label class="block">
                <div class="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                  <span>GPU Share</span><span data-create-output="gpuShare">${escapeHtml(`${draft.gpuShare}%`)}</span>
                </div>
                <input type="range" min="0" max="100" step="5" value="${escapeHtml(draft.gpuShare)}" data-create-field="gpuShare" class="mt-3 w-full accent-current" />
              </label>
            </div>
            <label class="block">
              <span class="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Java Executable Path</span>
              <input type="text" value="${escapeHtml(draft.javaPath)}" data-create-field="javaPath" class="mt-3 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-950 outline-none transition focus:border-primary-500 dark:border-white/10 dark:bg-gray-950 dark:text-white" />
            </label>
          </div>
        </section>
      </form>
    </div>`;
}

function renderOverviewSection(server) {
  const joinState = playitAddressState(server);
  const metrics = server.server.metrics ?? {};
  const cpuPercent = Number(metrics.cpuPercent ?? 0);
  const ramMaxMb = Number(metrics.ramMaxMb ?? ramStringToMb(server.launcher.maxRam, 4096));
  const ramUsedMb = Number(metrics.ramUsedMb ?? 0);
  const ramLeftMb = Math.max(0, Number(metrics.ramLeftMb ?? ramMaxMb - ramUsedMb));
  const loadPercent = Math.max(cpuPercent, ramMaxMb ? (ramUsedMb / ramMaxMb) * 100 : 0);
  const world = currentWorld(server)?.name ?? server.server.properties["level-name"] ?? "world";
  const status = serverStatusPresentation(server);
  const players = server.players?.filter((entry) => entry.online).slice(0, 5) ?? [];
  const ipAction = playitMinecraftIp(server)
    ? `<button type="button" class="${C.btnGhost}" data-action="copy-address">Copy IP</button>`
    : `<button type="button" class="${C.btnGhost}" data-action="switch-section" data-section="settings">Open Tunnel Settings</button>`;
  const publicStatusLabel =
    playitMinecraftIp(server)
      ? "Live"
      : joinState.value === "No Tunnel Created Yet"
        ? "No Tunnel"
        : joinState.value === "Tunnel Uses Different Port"
          ? "Mismatch"
          : "Pending";
  const memoryPercent = ramMaxMb ? (ramUsedMb / ramMaxMb) * 100 : 0;
  const startDisabled = server.server.status === "running" || server.server.status === "starting";
  const stopDisabled = server.server.status === "stopped" || server.server.status === "stopping";
  const restartDisabled = server.server.status !== "running";
  const killDisabled = !server.server.pid;
  const actionButtonClass = (primary, disabled = false) =>
    [
      primary ? C.btnPrimary : C.btnGhost,
      disabled ? "cursor-not-allowed opacity-40 hover:bg-inherit hover:text-inherit" : "",
    ].join(" ");
  const actionButton = (command, label, primary, disabled = false) =>
    `<button type="button" class="${actionButtonClass(primary, disabled)}" data-action="server-control" data-server-command="${escapeHtml(command)}" data-busy-label="${escapeHtml(label)}..." ${disabled ? "disabled" : ""}>${escapeHtml(label)}</button>`;

  const summaryTiles = [
    renderTile("Minecraft IP", joinState.value, joinState.detail),
    renderTile("Status", status.label, status.detail),
    renderTile(
      "Resource Load",
      formatPercent(loadPercent),
      `CPU ${formatPercent(cpuPercent)} / Memory ${formatPercent(memoryPercent)}`,
    ),
    renderTile(
      "Active Players",
      `${server.server.playerCount} / ${playerCapacity(server)}`,
      players.length ? `${players.length} online right now` : "No players online",
    ),
    renderTile("RAM Left", formatMemoryFromMb(ramLeftMb), `Used ${formatMemoryFromMb(ramUsedMb)} of ${formatMemoryFromMb(ramMaxMb)}`),
    renderTile(
      "Software",
      softwareLabel(server.install.installedSoftware ?? server.install.software ?? "purpur"),
      server.install.installedVersion ?? server.install.requestedVersion ?? "latest",
    ),
    renderTile("Port", server.server.properties["server-port"] ?? 25565, "Auto-selected and saved"),
    renderTile("Active World", world, `${worldCount(server)} world folder(s) detected`),
  ].join("");

  const playerRows = players.length
    ? players
        .map(
          (player) => `<div class="flex items-center justify-between gap-3 font-mono text-[11px]">
              <div class="flex items-center gap-3">
                <img src="${escapeHtml(playerAvatarUrl(player))}" alt="${escapeHtml(player.name)}" class="h-8 w-8 border border-outline bg-black object-cover" loading="lazy" />
                <span class="text-white">${escapeHtml(player.name)}</span>
              </div>
              <span class="text-zinc-500">${player.op ? "OP" : player.whitelisted ? "WL" : "Player"}</span>
            </div>`,
        )
        .join("")
    : `<div class="text-sm text-zinc-500">No players are online.</div>`;

  return `<section class="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div class="space-y-2">
        <div class="flex items-center gap-3">
          <span class="h-2 w-2 rounded-full ${escapeHtml(status.tone.dot)}"></span>
          <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">System Status: ${escapeHtml(status.label)}</p>
        </div>
        <h1 class="text-4xl font-black uppercase tracking-tight text-white">${escapeHtml(server.name)}</h1>
        <p class="max-w-3xl text-sm leading-7 text-zinc-400">${escapeHtml(status.detail)}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        ${actionButton("start", server.server.status === "starting" ? "Starting..." : "Start", true, startDisabled)}
        ${actionButton("stop", server.server.status === "stopping" ? "Stopping..." : "Stop", false, stopDisabled)}
        ${actionButton("restart", "Restart", false, restartDisabled)}
        ${actionButton("kill", "Force Kill", false, killDisabled)}
      </div>
    </section>
    <section class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">${summaryTiles}</section>
    <section class="grid grid-cols-1 gap-4 md:grid-cols-12">
      <div class="${C.card} md:col-span-8">
        <div class="mb-6 flex items-start justify-between gap-4">
          <h2 class="${C.label} text-white">Server Load</h2>
          <span class="font-mono text-sm text-white">${escapeHtml(formatPercent(loadPercent))}</span>
        </div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <article class="border border-outline bg-black p-4">
            <div class="${C.label} mb-3">CPU Utilization</div>
            <div class="mb-2 text-2xl font-black tracking-tight text-white">${escapeHtml(formatPercent(cpuPercent))}</div>
            <p class="text-xs leading-6 text-zinc-400">Live process usage from the running Minecraft server.</p>
          </article>
          <article class="border border-outline bg-black p-4">
            <div class="${C.label} mb-3">Memory Pressure</div>
            <div class="mb-2 text-2xl font-black tracking-tight text-white">${escapeHtml(formatPercent(memoryPercent))}</div>
            <p class="text-xs leading-6 text-zinc-400">Using ${escapeHtml(formatMemoryFromMb(ramUsedMb))} out of ${escapeHtml(formatMemoryFromMb(ramMaxMb))}.</p>
          </article>
          <article class="border border-outline bg-black p-4">
            <div class="${C.label} mb-3">Public Access</div>
            <div class="mb-2 text-2xl font-black tracking-tight text-white">${escapeHtml(publicStatusLabel)}</div>
            <p class="text-xs leading-6 text-zinc-400">${escapeHtml(joinState.detail)}</p>
            ${ipAction ? `<div class="mt-4 flex flex-wrap gap-2">${ipAction}</div>` : ""}
          </article>
        </div>
      </div>
      <div class="space-y-4 md:col-span-4">
        <div class="${C.card}">
          <h2 class="${C.label} mb-4 text-white">Active Players</h2>
          <div class="mb-4 flex items-baseline gap-2">
            <span class="text-4xl font-black tracking-tight text-white">${escapeHtml(server.server.playerCount)}</span>
            <span class="text-xl font-bold text-zinc-500">/ ${escapeHtml(playerCapacity(server))}</span>
          </div>
          <div class="space-y-3">${playerRows}</div>
        </div>
      </div>
      <div class="border border-outline bg-black md:col-span-12">
        <div class="flex items-center justify-between border-b border-outline bg-surface px-4 py-3">
          <h2 class="${C.labelOn}">Console Stream</h2>
          <button type="button" class="${C.btnGhost}" data-action="switch-section" data-section="console">Open Console</button>
        </div>
        <pre data-role="console-output" class="h-64 overflow-y-auto whitespace-pre-wrap p-6 font-mono text-xs text-zinc-300">${escapeHtml(runtime.consoleText || "Console output will appear here once the server starts.")}</pre>
      </div>
    </section>`;
}

function renderSoftwareSection(server) {
  const versionOptions = getVersionOptions(ui.installDraft.software, ui.installDraft.version);
  const installButtonLabel = server.server.operation?.active
    ? server.server.operation.shortLabel ?? "Installing"
    : "Install / Update Software";
  return `<div class="grid grid-cols-1 gap-8 xl:grid-cols-2"><section class="flex flex-col gap-6"><div class="flex items-center justify-between border-b border-zinc-900 pb-4"><h2 class="${C.labelOn}">Software / Version And Loader</h2><div class="text-zinc-600">${icon("layers")}</div></div><div class="grid grid-cols-2 gap-4">${softwareChoices().map((option) => { const selected = option.id === ui.installDraft.software; return `<button type="button" class="flex min-h-[148px] flex-col justify-between border ${selected ? "border-white bg-white text-black" : "border-outline bg-black text-white hover:border-zinc-600"} p-4 text-left transition" data-action="pick-software" data-software-id="${escapeHtml(option.id)}"><div class="flex items-start justify-between gap-3"><div class="${selected ? "text-black" : "text-zinc-500"}">${icon(selected ? "server" : "layers", "h-5 w-5")}</div>${selected ? `<div class="h-2 w-2 rounded-full bg-black"></div>` : ""}</div><div class="space-y-2"><div class="text-sm font-bold tracking-tight">${escapeHtml(option.name)}</div><div class="text-[10px] uppercase tracking-[0.18em] ${selected ? "text-zinc-700" : "text-zinc-500"}">${escapeHtml(option.latestHint ?? option.releaseChannel ?? option.id)}</div></div></button>`; }).join("")}</div><form data-form="software-install" class="space-y-4"><label class="flex flex-col gap-2"><span class="${C.label}">Minecraft Version</span><select data-install-field="version" class="w-full border border-outline bg-black px-4 py-3 text-white outline-none transition focus:border-white">${versionOptions.map((version) => `<option value="${escapeHtml(version)}" ${version === ui.installDraft.version ? "selected" : ""}>${escapeHtml(version)}</option>`).join("")}</select></label><button type="submit" class="w-full ${C.btnPrimary} py-4">${escapeHtml(installButtonLabel)}</button></form></section><section class="flex flex-col gap-6"><div class="flex items-center justify-between border-b border-zinc-900 pb-4"><h2 class="${C.labelOn}">Resources / Limit Management</h2><div class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500"><span class="h-2 w-2 rounded-full bg-white"></span><span>${escapeHtml(formatStatus(server.server.status))}</span></div></div><form data-form="runtime-settings" class="space-y-8 py-2"><label class="space-y-4"><div class="flex items-end justify-between"><span class="${C.label}">Max RAM Allocation</span><span class="font-mono text-sm text-white" data-output="maxRamMb">${escapeHtml(mbToRamString(ui.installDraft.maxRamMb))}</span></div><input type="range" min="512" max="${escapeHtml(runtime.data.host.totalMemoryMb)}" step="256" value="${escapeHtml(ui.installDraft.maxRamMb)}" data-install-field="maxRamMb" class="w-full accent-white" /></label><label class="space-y-4"><div class="flex items-end justify-between"><span class="${C.label}">Min RAM</span><span class="font-mono text-sm text-white" data-output="minRamMb">${escapeHtml(mbToRamString(ui.installDraft.minRamMb))}</span></div><input type="range" min="512" max="${escapeHtml(ui.installDraft.maxRamMb)}" step="256" value="${escapeHtml(ui.installDraft.minRamMb)}" data-install-field="minRamMb" class="w-full accent-white" /></label><div class="grid grid-cols-1 gap-8 md:grid-cols-2"><label class="space-y-4"><div class="flex items-end justify-between"><span class="${C.label}">CPU Cores</span><span class="font-mono text-sm text-white" data-output="cpuCores">${escapeHtml(ui.installDraft.cpuCores)}</span></div><input type="range" min="1" max="${escapeHtml(runtime.data.host.cpuCores)}" step="1" value="${escapeHtml(ui.installDraft.cpuCores)}" data-install-field="cpuCores" class="w-full accent-white" /></label><label class="space-y-4"><div class="flex items-end justify-between"><span class="${C.label}">GPU Share</span><span class="font-mono text-sm text-white" data-output="gpuShare">${escapeHtml(`${ui.installDraft.gpuShare}%`)}</span></div><input type="range" min="0" max="100" step="5" value="${escapeHtml(ui.installDraft.gpuShare)}" data-install-field="gpuShare" class="w-full accent-white" /></label></div><label class="space-y-2"><span class="${C.label}">Java Executable Path</span><input data-install-field="javaPath" type="text" value="${escapeHtml(ui.installDraft.javaPath)}" class="${C.input} font-mono text-sm" /></label><button type="submit" class="w-full ${C.btnPrimary} py-4">Save Resource Limits</button></form></section></div>`;
}

function renderConsoleSection(server) {
  if (isPelicanBlueprintVariant()) {
    return renderPelicanConsoleSection(server);
  }
  const metrics = server.server.metrics ?? {};
  const ramMaxMb = Number(metrics.ramMaxMb ?? ramStringToMb(server.launcher.maxRam, 4096));
  const ramUsedMb = Number(metrics.ramUsedMb ?? 0);
  const commandDraft = getConsoleDraft(server.id);
  return `<main class="flex min-h-[calc(100vh-180px)] flex-col overflow-hidden bg-black"><div class="mb-4 flex items-center justify-between px-2"><div class="flex items-center gap-4"><div class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-white"></span><span class="${C.labelOn}">${escapeHtml(server.name)}</span></div><span class="font-mono text-[11px] text-zinc-600">|</span><span class="font-mono text-[11px] text-zinc-500">LAST START: ${escapeHtml(formatTimestamp(serverLastStartedAt(server)))}</span></div></div><div class="flex flex-1 flex-col overflow-hidden border border-outline bg-black"><div class="flex-1 overflow-y-auto p-6 font-mono text-xs text-zinc-300"><pre data-role="console-output" class="whitespace-pre-wrap">${escapeHtml(runtime.consoleText || "Console output will appear here once the server starts.")}</pre></div><form data-form="console-command" class="flex items-center gap-3 border-t border-outline bg-black p-4"><span class="text-zinc-500">${icon("terminal")}</span><input name="command" type="text" value="${escapeHtml(commandDraft)}" autocomplete="off" spellcheck="false" placeholder="Enter server command..." class="flex-1 border-none bg-transparent font-mono text-sm text-white outline-none placeholder:text-zinc-700" /></form></div><div class="mt-4 flex flex-wrap gap-6 px-2 pb-2"><div class="min-w-[140px] space-y-1"><span class="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">CPU Load</span><div class="relative h-1 w-full bg-zinc-900"><div class="absolute inset-y-0 left-0 bg-white" style="width:${Math.max(0, Math.min(100, Number(metrics.cpuPercent ?? 0)))}%"></div></div><span class="font-mono text-[11px] text-white">${escapeHtml(formatPercent(metrics.cpuPercent ?? 0))}</span></div><div class="min-w-[140px] space-y-1"><span class="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">RAM Alloc</span><div class="relative h-1 w-full bg-zinc-900"><div class="absolute inset-y-0 left-0 bg-white" style="width:${Math.max(0, Math.min(100, ramMaxMb ? (ramUsedMb / ramMaxMb) * 100 : 0))}%"></div></div><span class="font-mono text-[11px] text-white">${escapeHtml(`${formatMemoryFromMb(ramUsedMb)} / ${formatMemoryFromMb(ramMaxMb)}`)}</span></div><div class="min-w-[140px] space-y-1"><span class="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">Players</span><div class="relative h-1 w-full bg-zinc-900"><div class="absolute inset-y-0 left-0 bg-white" style="width:${Math.max(0, Math.min(100, (Number(server.server.playerCount ?? 0) / playerCapacity(server)) * 100))}%"></div></div><span class="font-mono text-[11px] text-white">${escapeHtml(`${server.server.playerCount} / ${playerCapacity(server)}`)}</span></div><div class="ml-auto flex items-center gap-3"><button type="button" class="${C.btnPrimary}" data-action="server-control" data-server-command="restart">Restart Server</button><button type="button" class="${C.btnGhost}" data-action="server-control" data-server-command="backup">Backup Now</button></div></div></main>`;
}

function renderPlayersSection(server) {
  const onlinePlayers = server.players.filter((entry) => entry.online).length;
  return `<div class="flex flex-col gap-8"><div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><h1 class="mb-2 text-4xl font-black tracking-tight text-white">Player Database</h1><p class="max-w-3xl text-sm text-zinc-400">Manage known players, online players, and offline permission lists from one place.</p></div><div class="flex flex-wrap gap-2"><div class="flex items-center gap-2 border border-outline bg-surface px-4 py-2"><span class="h-2 w-2 rounded-full bg-white"></span><span class="text-[11px] font-bold uppercase tracking-[0.18em]">${escapeHtml(`${onlinePlayers} Active`)}</span></div><div class="flex items-center gap-2 border border-outline bg-surface px-4 py-2"><span class="h-2 w-2 rounded-full border border-white"></span><span class="text-[11px] font-bold uppercase tracking-[0.18em]">${escapeHtml(`${server.players.length} Total`)}</span></div></div></div><form data-form="player-register" class="grid gap-4 border border-outline bg-surface p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]"><label class="flex flex-col gap-2"><span class="${C.label}">Player Name</span><input name="name" type="text" required class="${C.input}" placeholder="Steve" /></label><label class="flex flex-col gap-2"><span class="${C.label}">UUID (Optional)</span><input name="uuid" type="text" class="${C.input} font-mono" placeholder="00000000-0000-0000-0000-000000000000" /></label><button type="submit" class="self-end ${C.btnPrimary} py-3" data-busy-label="Adding...">Add Player</button></form><div class="overflow-hidden border border-outline bg-surface"><div class="overflow-x-auto"><table class="w-full border-collapse text-left"><thead><tr class="border-b border-outline bg-surfaceAlt"><th class="p-4 ${C.label}">Status</th><th class="p-4 ${C.label}">Player</th><th class="p-4 ${C.label}">Flags</th><th class="p-4 ${C.label}">Last Seen</th><th class="p-4 text-right ${C.label}">Administrative Actions</th></tr></thead><tbody class="divide-y divide-zinc-900">${server.players.length ? server.players.map((player) => { const draft = ensurePlayerDraft(player); const key = playerDraftKey(player.name); return `<tr class="transition hover:bg-surfaceAlt" data-player-card data-player-key="${escapeHtml(key)}"><td class="p-4"><span class="block h-2 w-2 rounded-full ${player.online ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" : "border border-white"}"></span></td><td class="p-4"><div class="flex items-center gap-3"><img src="${escapeHtml(playerAvatarUrl(player))}" alt="${escapeHtml(player.name)}" class="h-10 w-10 border border-outline bg-black object-cover" loading="lazy" /><div><div class="text-sm font-semibold text-white">${escapeHtml(player.name)}</div><div class="font-mono text-xs text-zinc-500">${escapeHtml(player.uuid ?? "UUID unknown")}</div></div></div></td><td class="p-4 font-mono text-xs text-white">${escapeHtml(renderPlayerFlags(player))}</td><td class="p-4 font-mono text-xs text-zinc-400">${escapeHtml(formatLastSeen(player.lastSeenAt))}</td><td class="p-4"><div class="ml-auto flex max-w-[540px] flex-wrap justify-end gap-2"><input name="reason" type="text" value="${escapeHtml(draft.reason)}" placeholder="Reason shown to player" class="min-w-[120px] border border-outline bg-black px-2 py-1 text-[10px] text-white outline-none placeholder:text-zinc-700 focus:border-white" /><select name="mode" class="border border-outline bg-black px-2 py-1 text-[10px] text-white outline-none focus:border-white">${renderPlayerModeOptions(String(draft.mode ?? player.gamemode ?? "survival").toLowerCase())}</select><input name="destination" type="text" value="${escapeHtml(draft.destination)}" placeholder="Teleport target" class="min-w-[120px] border border-outline bg-black px-2 py-1 text-[10px] text-white outline-none placeholder:text-zinc-700 focus:border-white" />${renderPlayerButtons(player)}</div></td></tr>`; }).join("") : `<tr><td colspan="5" class="p-6 text-sm text-zinc-500">No players are registered yet.</td></tr>`}</tbody></table></div></div></div>`;
}

function renderWorldsSection(server) {
  const world = currentWorld(server)?.name ?? server.server.properties["level-name"] ?? "world";
  const levelSeed = String(server.server?.properties?.["level-seed"] ?? "").trim();
  return `<div class="space-y-8"><div class="grid grid-cols-1 gap-4 md:grid-cols-3"><section class="flex flex-col gap-6 border border-white bg-black p-6"><div><h3 class="${C.labelOn} mb-2">Worlds</h3><h2 class="text-2xl font-semibold uppercase text-white">Active World</h2></div><form data-form="world-select" class="flex flex-col gap-4"><label class="flex flex-col gap-2"><span class="${C.label}">World Name</span><select name="name" class="${C.input}">${server.worlds.map((entry) => `<option value="${escapeHtml(entry.name)}" ${entry.name === world ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("")}</select></label><label class="flex flex-col gap-2"><span class="${C.label}">Level Seed (Optional)</span><input name="seed" type="text" value="${escapeHtml(levelSeed)}" placeholder="Leave blank for random generation" class="${C.input}" /></label><div class="flex flex-col gap-2"><button type="submit" class="${C.btnPrimary} py-3">Use This World</button><button type="button" class="${C.btnGhost} py-3" data-action="regenerate-active-world">Regenerate Active World</button></div></form></section><section class="flex flex-col gap-6 border border-white bg-black p-6"><div><h3 class="${C.labelOn} mb-2">Upload World</h3><h2 class="text-2xl font-semibold uppercase text-white">Import A Zip</h2></div><form data-form="world-archive-upload" class="flex flex-col gap-4"><input name="file" type="file" accept=".zip,.mcworld" required class="w-full border border-outline bg-black px-4 py-3 text-sm text-zinc-300 file:mr-4 file:border-0 file:bg-white file:px-3 file:py-2 file:text-[11px] file:font-bold file:uppercase file:tracking-[0.18em] file:text-black" /><div class="text-sm leading-6 text-zinc-400">Releu uses the selected archive name automatically. Just choose a <code>.zip</code> or <code>.mcworld</code> file and upload it.</div><button type="submit" class="${C.btnPrimary} py-3">Upload World Archive</button></form></section><section class="flex flex-col gap-6 border border-white bg-black p-6"><div><h3 class="${C.labelOn} mb-2">Import Folder</h3><h2 class="text-2xl font-semibold uppercase text-white">Use A Local World Folder</h2></div><form data-form="world-folder-import" class="flex flex-col gap-4"><div class="flex gap-2"><input name="sourcePath" type="text" placeholder="C:\\Worlds\\MyWorld" class="${C.input} flex-1" />${isDesktopApp() ? `<button type="button" class="${C.btnGhost}" data-action="pick-world-folder">Browse</button>` : ""}</div><input name="worldName" type="text" placeholder="local-import-01" class="${C.input}" /><button type="submit" class="${C.btnPrimary} py-3">Import World Folder</button></form></section></div><div class="grid grid-cols-1 gap-4 xl:grid-cols-2">${server.worlds.map((entry) => renderWorldCard(entry)).join("")}</div></div>`;
}

function renderAddonCompatibilityBanner(server, kind) {
  const state = addonSupportState(server, kind);
  const toneClass = state.supported
    ? "border-outline bg-surfaceAlt text-zinc-400"
    : "border-white bg-black text-zinc-300";
  return `<div class="border ${toneClass} p-4"><p class="${state.supported ? C.label : C.labelOn} mb-2">${escapeHtml(state.title)}</p><p class="text-sm leading-7">${escapeHtml(state.detail)}</p></div>`;
}

function renderAddonColumn(kind, profiles, assets, resultSet) {
  const label = kind === "plugin" ? "Plugin" : "Mod";
  const server = activeServer();
  const support = addonSupportState(server, kind);
  const gameVersion = resultSet?.gameVersion ?? activeServer()?.catalog?.gameVersion ?? "";
  const profileId = resultSet?.profile?.id ?? activeServer()?.catalog?.defaults?.[kind] ?? profiles[0]?.id ?? "";
  return `<section class="space-y-6 border border-outline bg-black p-6">
    <div class="border-b border-zinc-900 pb-4"><h2 class="${C.labelOn}">${escapeHtml(label)} Catalog</h2></div>
    ${renderAddonCompatibilityBanner(server, kind)}
    <form data-form="catalog-search" data-kind="${escapeHtml(kind)}" class="space-y-4">
      <div class="flex gap-2">
        <input name="query" type="text" required placeholder="Enter ${escapeHtml(label.toLowerCase())} name..." class="${C.input} flex-1" ${support.supported ? "" : "disabled"} />
        <button type="submit" class="${C.btnPrimary} py-3" data-busy-label="Searching..." ${support.supported ? "" : "disabled"}>Search</button>
      </div>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <select name="profileId" class="${C.input}" ${support.supported ? "" : "disabled"}>${profiles.map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === profileId ? "selected" : ""}>${escapeHtml(profile.label)}</option>`).join("")}</select>
        <input name="gameVersion" type="text" value="${escapeHtml(gameVersion)}" class="${C.input}" ${support.supported ? "" : "disabled"} />
      </div>
    </form>
    <div class="space-y-4">${renderCatalogResults(kind, resultSet)}</div>
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <form data-form="asset-upload" data-kind="${escapeHtml(kind)}" class="space-y-4 border border-outline p-5">
        <h3 class="${C.label}">Upload ${escapeHtml(label)}</h3>
        <input name="file" type="file" required class="w-full border border-outline bg-black px-4 py-3 text-sm text-zinc-300 file:mr-4 file:border-0 file:bg-white file:px-3 file:py-2 file:text-[11px] file:font-bold file:uppercase file:tracking-[0.18em] file:text-black" ${support.supported ? "" : "disabled"} />
        <button type="submit" class="w-full ${C.btnPrimary} py-3" data-busy-label="Uploading..." ${support.supported ? "" : "disabled"}>Upload File</button>
      </form>
      <form data-form="asset-url" data-kind="${escapeHtml(kind)}" class="space-y-4 border border-outline p-5">
        <h3 class="${C.label}">Install From URL</h3>
        <input name="url" type="url" required placeholder="https://example.com/file.jar" class="${C.input}" ${support.supported ? "" : "disabled"} />
        <button type="submit" class="w-full ${C.btnGhost} py-3" data-busy-label="Installing..." ${support.supported ? "" : "disabled"}>Install File</button>
      </form>
    </div>
    <div class="overflow-hidden border border-outline">
      <table class="w-full border-collapse text-left font-mono text-xs">
        <thead class="border-b border-outline bg-zinc-900/20">
          <tr><th class="px-6 py-4 ${C.label}">${escapeHtml(label)} Name</th><th class="px-6 py-4 ${C.label}">Size</th><th class="px-6 py-4 text-right ${C.label}">Action</th></tr>
        </thead>
        <tbody>${renderInstalledAssets(kind, assets)}</tbody>
      </table>
    </div>
  </section>`;
}

function renderResourcePackSection(server) {
  const props = server.server.properties ?? {};
  return `<section class="space-y-6 border border-outline bg-black p-6 xl:col-span-2">
    <div class="border-b border-zinc-900 pb-4">
      <h2 class="${C.labelOn}">Resource Pack</h2>
    </div>
    <div class="border border-outline bg-surfaceAlt p-4">
      <p class="${C.label} mb-2">Server Resource Pack</p>
      <p class="text-sm leading-7 text-zinc-400">Send a resource pack URL through Minecraft itself. Players will see it after the next server restart. Some packs still need client-side support such as Continuity or OptiFine for connected textures, or ETF/EMF for custom entity models and Fresh Animations.</p>
    </div>
    <form data-form="resource-pack-settings" class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <label class="flex flex-col gap-2 md:col-span-2">
        <span class="${C.label}">Resource Pack URL</span>
        <input name="resource-pack" type="url" value="${escapeHtml(props["resource-pack"] ?? "")}" placeholder="https://example.com/pack.zip" class="${C.input}" />
      </label>
      <label class="flex flex-col gap-2">
        <span class="${C.label}">SHA1 Hash</span>
        <input name="resource-pack-sha1" type="text" value="${escapeHtml(props["resource-pack-sha1"] ?? "")}" placeholder="40-character sha1" class="${C.input} font-mono" />
      </label>
      <label class="flex flex-col gap-2">
        <span class="${C.label}">Prompt</span>
        <input name="resource-pack-prompt" type="text" value="${escapeHtml(props["resource-pack-prompt"] ?? "")}" placeholder="Recommended texture pack" class="${C.input}" />
      </label>
      <label class="flex items-center gap-3 md:col-span-2">
        <input name="require-resource-pack" type="checkbox" class="h-4 w-4 accent-white" ${String(props["require-resource-pack"] ?? "false") === "true" ? "checked" : ""} />
        <span class="text-[11px] font-bold uppercase tracking-[0.18em] text-white">Require Resource Pack</span>
      </label>
      <button type="submit" class="${C.btnPrimary} py-3 md:col-span-2" data-busy-label="Saving...">Save Resource Pack</button>
    </form>
  </section>`;
}

function renderAddonsSection(server) {
  if (isPelicanBlueprintVariant()) {
    return `<div class="space-y-8">
      ${renderBlueprintAddonColumn("plugin", server.catalog.pluginProfiles, server.plugins, ui.catalog.plugin)}
      ${renderBlueprintAddonColumn("mod", server.catalog.modProfiles, server.mods, ui.catalog.mod)}
      ${renderResourcePackSection(server)}
    </div>`;
  }
  return `<div class="grid grid-cols-1 gap-8 xl:grid-cols-2">${renderAddonColumn("plugin", server.catalog.pluginProfiles, server.plugins, ui.catalog.plugin)}${renderAddonColumn("mod", server.catalog.modProfiles, server.mods, ui.catalog.mod)}${renderResourcePackSection(server)}</div>`;
}

function renderBackupsSection(server) {
  const backups = Array.isArray(server.backups?.recent) ? server.backups.recent : [];
  const totalBytes = Math.max(0, Number(server.backups?.totalBytes ?? 0) || 0);
  const maxStorageGb = Math.max(1, Number(server.backups?.maxStorageGb ?? 10) || 10);
  const nextBackupAt = server.backups?.nextBackupAt ? formatTimestamp(server.backups.nextBackupAt) : "Disabled";
  return `<div class="grid grid-cols-1 gap-4 md:grid-cols-12">
    <section class="${C.card} space-y-6 md:col-span-4">
      <div class="space-y-2">
        <h2 class="${C.labelOn}">Protection</h2>
        <div class="h-px w-full bg-outline"></div>
      </div>
      <form data-form="backup-settings" class="space-y-4">
        <label class="flex items-center gap-3">
          <input name="autoBackups" type="checkbox" class="h-4 w-4 accent-white" ${server.backups.enabled ? "checked" : ""} />
          <span class="text-[12px] text-zinc-300">Enable automatic backups</span>
        </label>
        <label class="flex flex-col gap-2">
          <span class="${C.label}">Backup Interval Minutes</span>
          <input name="backupIntervalMinutes" type="number" min="5" step="5" value="${escapeHtml(server.backups.intervalMinutes ?? 60)}" class="${C.input} font-mono" />
        </label>
        <label class="flex flex-col gap-2">
          <span class="${C.label}">Max Total Backup Storage (GB)</span>
          <input name="maxBackupStorageGb" type="number" min="1" step="1" value="${escapeHtml(maxStorageGb)}" class="${C.input} font-mono" />
        </label>
        <div class="space-y-2 border border-outline bg-black p-4 text-sm text-zinc-400">
          <div class="flex items-center justify-between gap-3"><span>Current Usage</span><span class="font-mono text-white">${escapeHtml(formatBytes(totalBytes))}</span></div>
          <div class="flex items-center justify-between gap-3"><span>Next Scheduled Backup</span><span class="font-mono text-white">${escapeHtml(nextBackupAt)}</span></div>
        </div>
        <div class="rounded-sm border border-outline bg-black px-4 py-3 text-sm text-zinc-400">If the total backup folder size reaches the configured max, Releu deletes the oldest local backups first to make room for new ones.</div>
        <button type="submit" class="w-full ${C.btnPrimary} py-4">Save Backup Settings</button>
      </form>
      <button type="button" class="w-full ${C.btnGhost} py-4" data-action="server-control" data-server-command="backup">Create Backup Now</button>
    </section>
    <section class="flex min-h-[600px] flex-col border border-outline bg-surface md:col-span-8">
      <div class="space-y-2 p-6">
        <h2 class="${C.labelOn}">Backup History</h2>
        <div class="h-px w-full bg-outline"></div>
        <p class="text-sm text-zinc-400">Revert creates one safety backup first, then restores the selected backup onto the current server after three confirmations.</p>
      </div>
      <div class="flex-1 overflow-hidden">
        <table class="w-full border-collapse text-left">
          <thead>
            <tr class="border-b border-zinc-900">
              <th class="p-4 ${C.label}">Timestamp</th>
              <th class="p-4 ${C.label}">Size</th>
              <th class="p-4 ${C.label}">Folder Path</th>
              <th class="p-4 text-right ${C.label}">Actions</th>
            </tr>
          </thead>
          <tbody class="font-mono text-[13px]">
            ${backups.length ? backups.map((backup) => `<tr class="border-b border-zinc-900 transition hover:bg-surfaceAlt"><td class="p-4 text-white">${escapeHtml(formatTimestamp(backup.createdAt))}</td><td class="p-4 text-zinc-300">${escapeHtml(formatBytes(backup.bytes ?? 0))}</td><td class="p-4 text-zinc-500">${escapeHtml(backup.path)}</td><td class="space-x-3 p-4 text-right"><button type="button" class="text-[11px] font-bold uppercase tracking-[0.18em] text-white transition hover:text-zinc-300" data-action="backup-revert" data-backup-name="${escapeHtml(backup.name)}" data-busy-label="Reverting...">Revert</button>${isDesktopApp() ? `<button type="button" class="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500 transition hover:text-white" data-action="open-path" data-path="${escapeHtml(backup.path)}">Open Folder</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="4" class="p-6 text-sm text-zinc-500">No backups have been created yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  </div>`;
}

function renderMiscSection(server) {
  const properties = server.server?.properties ?? {};
  const misc = server.misc ?? {};
  const boolProp = (key, fallback = false) =>
    String(properties[key] ?? String(fallback)).toLowerCase() === "true";
  const crackedClientsEnabled = !boolProp("online-mode", true);
  const allowProxyConnections = !boolProp("prevent-proxy-connections", false);
  const pauseWhenEmptyEnabled =
    (Number.parseInt(String(properties["pause-when-empty-seconds"] ?? "-1"), 10) || -1) > 0;
  const selectField = (name, label, enabled, help = "") => `
    <label class="block space-y-2">
      <span class="${C.label} block">${escapeHtml(label)}</span>
      <select name="${escapeHtml(name)}" class="${C.input} w-full font-mono text-sm">
        <option value="false" ${enabled ? "" : "selected"}>Disabled</option>
        <option value="true" ${enabled ? "selected" : ""}>Enabled</option>
      </select>
      ${help ? `<span class="block text-xs leading-5 text-zinc-500">${escapeHtml(help)}</span>` : ""}
    </label>`;
  const numberField = (name, label, value, help = "", minimum = 0) => `
    <label class="block space-y-2">
      <span class="${C.label} block">${escapeHtml(label)}</span>
      <input name="${escapeHtml(name)}" type="number" min="${minimum}" value="${escapeHtml(String(value ?? minimum))}" class="${C.input} w-full font-mono text-sm" />
      ${help ? `<span class="block text-xs leading-5 text-zinc-500">${escapeHtml(help)}</span>` : ""}
    </label>`;

  return `<div class="grid grid-cols-12 gap-4">
    <section class="${C.card} col-span-12 space-y-6">
      <div class="space-y-3">
        <h2 class="border-b border-zinc-900 pb-2 text-xl font-semibold uppercase tracking-[0.12em] text-white">Misc</h2>
        <p class="text-sm text-zinc-400">Gameplay, visibility, and server access controls that sync back into the real server files. Changes save automatically while this page checks for external file updates every second.</p>
      </div>
      <form data-form="misc-settings" class="space-y-6">
        <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div class="space-y-4 border border-outline bg-black p-5">
            <div class="${C.labelOn}">Player Access</div>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              ${selectField("allowCrackedClients", "Allow Cracked Clients", crackedClientsEnabled, "Let players join without a premium account by turning online-mode off.")}
              ${selectField("whitelist", "Whitelist", boolProp("white-list", false), "Only players on the allowlist can join the server.")}
              ${selectField("showPlayerCount", "Show Player Count", boolProp("enable-status", true), "Expose the server in the multiplayer list with status and player counts.")}
              ${selectField("hideOnlinePlayers", "Hide Online Players", boolProp("hide-online-players", false), "Hide the online player sample from server-list pings while keeping the server visible.")}
              ${selectField("allowProxyConnections", "Allow Proxy Connections", allowProxyConnections, "Allow players to join through proxy or tunnel setups instead of blocking mismatched ISP checks.")}
              ${numberField("maxPlayers", "Max Players", properties["max-players"] ?? 100, "Set how many players can join at the same time. Defaults to 100 if no value is set yet.", 1)}
              ${numberField("playerIdleTimeout", "Idle Kick Time", properties["player-idle-timeout"] ?? 0, "Kick idle players after this many minutes. Set 0 to disable the idle kick.", 0)}
            </div>
          </div>
          <div class="space-y-4 border border-outline bg-black p-5">
            <div class="${C.labelOn}">Server Admin</div>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              ${selectField("commandBlocks", "Command Blocks", boolProp("enable-command-block", false), "Allow command block logic inside the world.")}
              ${numberField("spawnProtection", "Spawn Protection", properties["spawn-protection"] ?? 0, "Protection radius around world spawn in blocks. Use 0 to disable it.", 0)}
              ${selectField("pauseWhenEmpty", "Pause When Empty", pauseWhenEmptyEnabled, "Pause the server after it has been empty for a while. Releu uses 60 seconds when enabled.")}
              ${selectField("logPlayerIPs", "Log Player IPs", boolProp("log-ips", true), "Write connecting player IP addresses into the server log.")}
            </div>
          </div>
        </div>

        <div class="space-y-4 border border-outline bg-black p-5">
          <div class="${C.labelOn}">World Rules</div>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            ${selectField("pvp", "PvP", boolProp("pvp", true), "Allow players to damage each other.")}
            ${selectField("allowFlight", "Allow Flight", boolProp("allow-flight", false), "Prevent players with flying mods or plugin powers from being kicked.")}
            ${selectField("keepInventory", "Keep Inventory", Boolean(misc.keepInventory), "Applied through a gamerule when the server is running.")}
            ${selectField("sharedHealth", "Shared Health", Boolean(misc.sharedHealth), "Saved as a Releu preference for shared-health-compatible setups.")}
            ${selectField("hardcore", "Hardcore Mode", boolProp("hardcore", false), "Players become spectators on death and the world behaves like a hardcore server.")}
            ${selectField("forceGamemode", "Force Gamemode", boolProp("force-gamemode", false), "Reset joining players back to the default gamemode every time they reconnect.")}
            ${selectField("generateStructures", "Generate Structures", boolProp("generate-structures", true), "Create villages, temples, strongholds, and other generated structures.")}
          </div>
        </div>

        <div class="space-y-4 border border-outline bg-black p-5">
          <div class="${C.labelOn}">Dimensions</div>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            ${selectField("allowNether", "Allow Nether", boolProp("allow-nether", true), "Let portals send players into the Nether dimension.")}
            ${selectField("allowEnd", "Allow The End", boolProp("allow-end", true), "Let players enter The End. Paper and Purpur also mirror this into bukkit.yml when available.")}
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-900 pt-4">
          <div class="text-xs text-zinc-500" data-misc-autosave-status>Changes save automatically.</div>
          <button type="button" class="${C.btnGhost}" data-action="switch-section" data-section="settings">Back To Settings</button>
        </div>
      </form>
    </section>
  </div>`;
}

function renderUiPreferencePanel() {
  return "";
  const uiSettings = currentUiSettings();
  const currentVariant = uiSettings.variant === UI_VARIANT_PELICAN_BLUEPRINT
    ? UI_VARIANT_PELICAN_BLUEPRINT
    : UI_VARIANT_CLASSIC;
  const variantCards = [
    {
      id: UI_VARIANT_CLASSIC,
      title: "Legacy UI",
      detail:
        "The original Releu layout. This remains the default and gets new features first when you have not chosen a UI yet.",
      pros: [
        "Most complete and battle-tested control surface",
        "Faster access to dense server actions",
        "Best fallback when a newer page flow is still being refined",
      ],
      cons: [
        "Heavier and more utilitarian visually",
        "Less like a hosted game-panel shell",
      ],
    },
    {
      id: UI_VARIANT_PELICAN_BLUEPRINT,
      title: "New UI",
      detail:
        "A Pelican-based shell wired to the Releu backend. Cleaner browsing and calmer page structure, but still a newer surface.",
      pros: [
        "Cleaner hosted-panel style layout",
        "Better page hierarchy for browsing and setup",
        "Pelican-based navigation and presentation",
      ],
      cons: [
        "Newer shell, so edge-case flows can need more verification",
        "Some advanced pages still depend on newer bridge wiring",
      ],
    },
  ];

  return `<div class="${C.card}">
    <div class="mb-4 border-b border-zinc-900 pb-2">
      <h2 class="text-xl font-semibold uppercase tracking-[0.12em] text-white">Interface Mode</h2>
    </div>
    <p class="mb-4 text-sm text-zinc-400">Pick which Releu shell this PC should open by default. If you have never chosen one before, Releu stays on the Legacy UI until you decide.</p>
    <div class="space-y-4">
      ${variantCards
        .map((entry) => {
          const selected = currentVariant === entry.id;
          return `<section class="border ${selected ? "border-white bg-black" : "border-outline bg-surfaceAlt"} p-5">
            <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div class="space-y-2">
                <div class="flex items-center gap-3">
                  <h3 class="text-lg font-semibold text-white">${escapeHtml(entry.title)}</h3>
                  <span class="${C.chip} ${selected ? "!border-white !text-white" : ""}">${selected ? "Current" : "Available"}</span>
                </div>
                <p class="max-w-2xl text-sm text-zinc-400">${escapeHtml(entry.detail)}</p>
              </div>
              <button type="button" class="${selected ? C.btnPrimary : C.btnGhost}" data-action="choose-ui-variant" data-ui-variant="${escapeHtml(entry.id)}">
                ${selected ? "Keep This UI" : `Use ${escapeHtml(entry.title)}`}
              </button>
            </div>
            <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div class="border border-outline bg-black p-4">
                <div class="${C.labelOn} mb-3">Pros</div>
                <div class="space-y-2 text-sm text-zinc-300">${entry.pros.map((point) => `<div>${escapeHtml(point)}</div>`).join("")}</div>
              </div>
              <div class="border border-outline bg-black p-4">
                <div class="${C.labelOn} mb-3">Cons</div>
                <div class="space-y-2 text-sm text-zinc-300">${entry.cons.map((point) => `<div>${escapeHtml(point)}</div>`).join("")}</div>
              </div>
            </div>
          </section>`;
        })
        .join("")}
    </div>
    <div class="mt-4 flex flex-wrap gap-2">
      <button type="button" class="${C.btnGhost}" data-action="open-ui-picker">Open UI Picker</button>
    </div>
  </div>`;
}

function renderSettingsSection(server) {
  const playit = runtime.data.playit;
  const appUpdate = runtime.data.appUpdate;
  const cloud = ui.cloudBackupStatus ?? {};
  const cloudConfig = runtime.data.cloudBackupSettings ?? {};
  const cloudProvider = cloud.provider ?? cloudConfig.provider ?? "tailscale-ssh";
  const usingTailscaleCloud = cloudProvider === "tailscale-ssh";
  const cloudNeedsAuthGate = usingTailscaleCloud && !cloud.loggedIn;
  const cloudDraft = {
    deviceLabel:
      String(ui.cloudBackupDraft?.deviceLabel ?? "").trim() ||
      String(cloud.deviceLabel ?? cloudConfig.deviceLabel ?? "").trim(),
    accountUsername:
      String(ui.cloudBackupDraft?.accountUsername ?? "").trim() ||
      String(cloud.accountUsername ?? cloudConfig.accountUsername ?? "").trim(),
    accountPassword: String(ui.cloudBackupDraft?.accountPassword ?? ""),
    targetRestoreKey:
      String(ui.cloudBackupDraft?.targetRestoreKey ?? "").trim() ||
      String(cloud.targetRestoreKey ?? cloudConfig.targetRestoreKey ?? "").trim(),
  };
  const cloudUploadLimitBytes =
    Number(cloud.uploadLimitBytes ?? (cloudConfig.uploadLimitMb ?? 50) * 1024 * 1024) || 0;
  const cloudUploadLimitLabel = usingTailscaleCloud
    ? (cloud.uploadLimitLabel ?? "Remote server disk")
    : formatBytes(cloudUploadLimitBytes);
  const joinState = playitAddressState(server);
  const playitAction = !playit.secretConfigured
    ? `<button type="button" class="${C.btnPrimary}" data-action="playit-connect">Connect Playit Agent</button>`
    : playit.claimWaiting
      ? `<a class="${C.btnPrimary}" href="${escapeHtml(playit.claimUrl ?? playit.dashboardTunnelUrl)}" target="_blank" rel="noreferrer">Finish Playit Link</a>`
      : playit.needsWebSetup || Number(playit.configuredTunnelCount ?? 0) === 0
        ? `<a class="${C.btnPrimary}" href="${escapeHtml(playit.newTunnelUrl ?? playit.dashboardTunnelUrl)}" target="_blank" rel="noreferrer">Create Tunnel</a>`
        : `<a class="${C.btnPrimary}" href="${escapeHtml(playit.dashboardTunnelUrl)}" target="_blank" rel="noreferrer">Open Tunnel Dashboard</a>`;
  return `<div class="grid grid-cols-12 gap-4">
    <section class="${C.card} col-span-12 lg:col-span-8">
      <div class="mb-6">
        <h2 class="mb-4 border-b border-zinc-900 pb-2 text-xl font-semibold uppercase tracking-[0.12em] text-white">Server Properties</h2>
      </div>
      <form data-form="server-settings" class="space-y-8">
        <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div class="space-y-4">
            <input name="motd" type="text" value="${escapeHtml(server.server.properties.motd ?? "")}" class="${C.input} font-mono text-sm" placeholder="MOTD" />
            <input name="server-port" type="number" value="${escapeHtml(server.server.properties["server-port"] ?? 25565)}" class="${C.input} font-mono text-sm" placeholder="Port" />
            <input name="max-players" type="number" value="${escapeHtml(server.server.properties["max-players"] ?? 20)}" class="${C.input} font-mono text-sm" placeholder="Max players" />
            <input name="level-name" type="text" value="${escapeHtml(server.server.properties["level-name"] ?? "world")}" class="${C.input} font-mono text-sm" placeholder="Level name" />
            <div class="space-y-2">
              <select name="gamemode" class="${C.input} font-mono text-sm">${["survival", "creative", "adventure", "spectator"].map((value) => `<option value="${escapeHtml(value)}" ${String(server.server.properties.gamemode ?? "").toLowerCase() === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>
              <p class="text-xs text-zinc-500">Default gamemode is only for new joins. Player actions can still change an online player's gamemode unless <span class="font-mono">force-gamemode=true</span>.</p>
            </div>
          </div>
          <div class="space-y-4">
            <select name="difficulty" class="${C.input} font-mono text-sm">${["peaceful", "easy", "normal", "hard"].map((value) => `<option value="${escapeHtml(value)}" ${String(server.server.properties.difficulty ?? "").toLowerCase() === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>
            <input name="view-distance" type="number" value="${escapeHtml(server.server.properties["view-distance"] ?? 10)}" class="${C.input} font-mono text-sm" placeholder="View distance" />
            <input name="simulation-distance" type="number" value="${escapeHtml(server.server.properties["simulation-distance"] ?? 10)}" class="${C.input} font-mono text-sm" placeholder="Simulation distance" />
            <input name="spawn-protection" type="number" value="${escapeHtml(server.server.properties["spawn-protection"] ?? 16)}" class="${C.input} font-mono text-sm" placeholder="Spawn protection" />
          </div>
        </div>
        <button type="submit" class="${C.btnPrimary} py-4">Save Server Settings</button>
      </form>
    </section>
    <section class="col-span-12 space-y-4 lg:col-span-4">
      ${renderUiPreferencePanel()}
      <div class="${C.card}">
        <div class="mb-4 border-b border-zinc-900 pb-2">
          <h2 class="text-xl font-semibold uppercase tracking-[0.12em] text-white">Public Access</h2>
        </div>
        <code class="block break-all text-lg font-semibold text-white">${escapeHtml(joinState.value)}</code>
        <p class="mt-2 text-sm text-zinc-400">${escapeHtml(joinState.detail)}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          ${playitAction}
          ${playit.secretConfigured ? `<a class="${C.btnGhost}" href="${escapeHtml(playit.dashboardTunnelUrl)}" target="_blank" rel="noreferrer">Open Dashboard</a>` : ""}
          ${playitMinecraftIp(server) ? `<button type="button" class="${C.btnGhost}" data-action="copy-address">Copy IP</button>` : ""}
        </div>
      </div>
      <div class="${C.card}">
        <div class="mb-4 border-b border-zinc-900 pb-2">
          <h2 class="text-xl font-semibold uppercase tracking-[0.12em] text-white">Playit Agent</h2>
        </div>
        <p class="text-sm text-zinc-400">${escapeHtml(playit.secretConfigured ? "Reset the saved playit.gg link if this PC was connected to the wrong account or if you want to relink from scratch." : "No playit.gg account is linked right now. If the agent file is ever missing, Releu will reinstall it automatically the next time you link it.")}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          ${playit.secretConfigured
            ? `<button type="button" class="${C.btnGhost}" data-action="playit-reset-prompt">Reset Agent</button>`
            : `<button type="button" class="${C.btnPrimary}" data-action="playit-connect">Connect Playit Agent</button>`}
        </div>
      </div>
      <div class="${C.card}">
        <div class="mb-4 border-b border-zinc-900 pb-2">
          <h2 class="text-xl font-semibold uppercase tracking-[0.12em] text-white">Releu Updates</h2>
        </div>
        <form data-form="app-update-settings" class="space-y-4">
          <div class="rounded-sm border border-outline bg-black px-4 py-3 text-sm text-zinc-400">
            Automatic updates are always enabled in Releu. The app will keep checking GitHub and auto-apply staged updates when it is safe to restart.
          </div>
          <div class="rounded-sm border border-outline bg-black px-4 py-3 text-sm text-zinc-400">
            <div>Update source: <span class="font-mono text-zinc-200">${escapeHtml(`${appUpdate?.githubOwner ?? runtime.data.updaterSettings?.githubOwner ?? "dragonbox102"}/${appUpdate?.githubRepo ?? runtime.data.updaterSettings?.githubRepo ?? "Releu-minecraft"}`)}</span></div>
            <div class="mt-1">Locked release asset: <span class="font-mono text-zinc-200">${escapeHtml(appUpdate?.assetName ?? runtime.data.updaterSettings?.assetName ?? "Releu-minecraft.exe")}</span></div>
            <div class="mt-1">This source and the auto-update behavior are locked by Releu and cannot be disabled from the panel.</div>
          </div>
          <label class="block">
            <span class="${C.label} mb-2 block">Check Interval (Hours)</span>
            <input name="checkIntervalHours" type="number" min="1" value="${escapeHtml(runtime.data.updaterSettings?.checkIntervalHours ?? 6)}" class="${C.input} w-full font-mono" />
          </label>
          <div class="rounded-sm border border-outline bg-black px-4 py-3 text-sm text-zinc-400">
            <div>Current version: <span class="font-mono text-zinc-200">${escapeHtml(appUpdate?.currentVersion ?? "unknown")}</span></div>
            <div class="mt-1">Latest version: <span class="font-mono text-zinc-200">${escapeHtml(appUpdate?.latestVersion ?? "not checked")}</span></div>
            <div class="mt-1">Status: ${escapeHtml(appUpdate?.statusMessage ?? "Waiting for settings.")}</div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="submit" class="${C.btnPrimary}">Save Update Settings</button>
            <button type="button" class="${C.btnGhost}" data-action="check-app-update">Check GitHub Now</button>
            ${isDesktopApp() && appUpdate?.updateReady && appUpdate?.stagedFilePath ? `<button type="button" class="${C.btnGhost}" data-action="apply-app-update">Apply Update</button>` : ""}
            ${appUpdate?.releasePageUrl ? `<a class="${C.btnGhost}" href="${escapeHtml(appUpdate.releasePageUrl)}" target="_blank" rel="noreferrer">Open Release</a>` : ""}
          </div>
        </form>
      </div>
      <div class="${C.card}">
        <div class="mb-4 border-b border-zinc-900 pb-2">
          <h2 class="text-xl font-semibold uppercase tracking-[0.12em] text-white">Cloud Backup</h2>
        </div>
        <form data-form="cloud-backup-settings" class="space-y-4">
          <label class="flex items-center gap-3">
            <input name="enabled" type="checkbox" class="h-4 w-4 accent-white" ${cloudConfig.enabled ? "checked" : ""} />
            <span class="text-[11px] font-bold uppercase tracking-[0.18em] text-white">Enable Cloud Backup</span>
          </label>
          <label class="block">
            <span class="${C.label} mb-2 block">Device Label</span>
            <input name="deviceLabel" type="text" value="${escapeHtml(cloudDraft.deviceLabel)}" placeholder="My desktop PC" class="${C.input} w-full" />
          </label>
          <input name="provider" type="hidden" value="${escapeHtml(cloudProvider)}" />
          ${usingTailscaleCloud && cloudNeedsAuthGate
            ? `
              <div class="rounded-sm border border-outline bg-black px-4 py-3 text-sm text-zinc-400">
                <div class="mb-1 text-white">Sign in or create a cloud backup account first.</div>
                <div>Cloud upload, restore, backup keys, and shared backup targets stay locked until you log in.</div>
              </div>
              <label class="block">
                <span class="${C.label} mb-2 block">Cloud Username</span>
                <input name="accountUsername" type="text" value="${escapeHtml(cloudDraft.accountUsername)}" placeholder="alex" class="${C.input} w-full" />
              </label>
              <label class="block">
                <span class="${C.label} mb-2 block">Cloud Password</span>
                <input name="accountPassword" type="password" value="${escapeHtml(cloudDraft.accountPassword)}" placeholder="Log in to backup" class="${C.input} w-full" />
              </label>`
            : usingTailscaleCloud
            ? `
              <label class="block">
                <span class="${C.label} mb-2 block">Cloud Username</span>
                <input name="accountUsername" type="text" value="${escapeHtml(cloudDraft.accountUsername)}" placeholder="alex" class="${C.input} w-full" />
              </label>
              <label class="block">
                <span class="${C.label} mb-2 block">Cloud Password</span>
                <input name="accountPassword" type="password" value="${escapeHtml(cloudDraft.accountPassword)}" placeholder="Log in to backup" class="${C.input} w-full" />
              </label>
              <label class="block">
                <span class="${C.label} mb-2 block">My Backup Key</span>
                <input type="text" readonly value="${escapeHtml(cloud.restoreKey ?? "")}" placeholder="Register or log in first" class="${C.input} w-full font-mono text-xs" />
              </label>
              <label class="block">
                <span class="${C.label} mb-2 block">Shared Backup Key (Optional)</span>
                <input name="targetRestoreKey" type="text" value="${escapeHtml(cloudDraft.targetRestoreKey)}" placeholder="Enter another user's key to upload or restore their backup space" class="${C.input} w-full font-mono text-xs" />
              </label>`
            : `
              <label class="block">
                <span class="${C.label} mb-2 block">Restore Key</span>
                <input type="text" readonly value="${escapeHtml(cloud.restoreKey ?? "")}" placeholder="Generate a restore key first" class="${C.input} w-full font-mono text-xs" />
              </label>`}
          <div class="rounded-sm border border-outline bg-black px-4 py-3 text-sm text-zinc-400">
            <div>${usingTailscaleCloud ? "Connection" : "Function"}: <span class="font-mono text-zinc-200">${escapeHtml(cloud.functionReady ? "ready" : ui.cloudBackupStatusLoading ? "checking" : "not ready")}</span></div>
            ${usingTailscaleCloud ? `<div class="mt-1">Login: <span class="font-mono text-zinc-200">${escapeHtml(cloud.loggedIn ? `logged in as ${cloud.accountUsername || "account"}` : "not logged in")}</span></div>` : ""}
            ${cloudNeedsAuthGate ? "" : `<div class="mt-1">Upload limit: <span class="font-mono text-zinc-200">${escapeHtml(cloudUploadLimitLabel)}</span></div>`}
            ${cloudNeedsAuthGate ? "" : `<div class="mt-1">Cloud used: <span class="font-mono text-zinc-200">${escapeHtml(formatBytes(cloud.usedBytes ?? 0))}</span></div>`}
            ${cloudNeedsAuthGate ? "" : `<div class="mt-1">Saved backups: <span class="font-mono text-zinc-200">${escapeHtml(formatCount(cloud.backupsCount ?? 0))}</span></div>`}
            ${cloudNeedsAuthGate ? "" : `<div class="mt-1">Latest backup: <span class="font-mono text-zinc-200">${escapeHtml(cloud.latestBackup?.backup_name ?? "None yet")}</span></div>`}
            ${usingTailscaleCloud && cloud.usingSharedRestoreKey && !cloudNeedsAuthGate ? `<div class="mt-1">Target key: <span class="font-mono text-zinc-200">shared backup space</span></div>` : ""}
            ${cloud.authError ? `<div class="mt-2 text-red-300">${escapeHtml(cloud.authError)}</div>` : ""}
            ${cloud.functionError ? `<div class="mt-2 text-red-300">${escapeHtml(cloud.functionError)}</div>` : ""}
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="submit" class="${C.btnPrimary}">${cloudNeedsAuthGate ? "Save Cloud Setup" : "Save Cloud Settings"}</button>
            <button type="button" class="${C.btnGhost}" data-action="cloud-backup-refresh">Refresh Cloud Status</button>
            ${usingTailscaleCloud && cloudNeedsAuthGate
              ? `
                <button type="button" class="${C.btnGhost}" data-action="cloud-backup-register">Create Account</button>
                <button type="button" class="${C.btnGhost}" data-action="cloud-backup-login">Log In</button>`
              : usingTailscaleCloud
              ? `
                ${cloud.loggedIn ? `<button type="button" class="${C.btnGhost}" data-action="cloud-backup-logout">Log Out</button>` : ""}
                ${cloud.loggedIn ? `<button type="button" class="${C.btnGhost}" data-action="cloud-backup-rotate-key">Rotate Key</button>` : ""}
                <button type="button" class="${C.btnGhost}" data-action="cloud-backup-upload" ${!cloudConfig.enabled || !cloud.loggedIn ? "disabled" : ""}>Backup To Cloud Now</button>`
              : `
                <button type="button" class="${C.btnGhost}" data-action="cloud-backup-issue-key">${cloud.restoreKeyPresent ? "Regenerate Key" : "Generate Key"}</button>
                ${!cloud.restoreKeyPresent ? "" : `<button type="button" class="${C.btnGhost}" data-action="cloud-backup-rotate-key">Rotate Key</button>`}
                <button type="button" class="${C.btnGhost}" data-action="cloud-backup-upload" ${!cloudConfig.enabled || !cloud.restoreKeyPresent ? "disabled" : ""}>Backup To Cloud Now</button>`}
          </div>
          ${cloudNeedsAuthGate ? "" : `<div class="rounded-sm border border-outline bg-black px-4 py-3 text-sm text-zinc-400">
            <div class="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-white">${usingTailscaleCloud ? "Rolling Cloud Backup" : "Cloud Backups"}</div>
            ${
              cloud.backups?.length
                ? cloud.backups
                    .map(
                      (entry) => `
                <div class="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-900 py-3 last:border-b-0 last:pb-0 first:pt-0">
                  <div>
                    <div class="font-mono text-xs text-zinc-200">${escapeHtml(entry.backup_name ?? "Backup")}</div>
                    <div class="mt-1 text-[11px] text-zinc-500">${escapeHtml(formatTimestamp(entry.created_at ?? entry.updated_at))}</div>
                    <div class="mt-1 text-[11px] text-zinc-500">${escapeHtml(formatBytes(entry.size_bytes ?? 0))}</div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button type="button" class="${C.btnGhost}" data-action="cloud-backup-download" data-backup-id="${escapeHtml(entry.id)}">Download</button>
                    <button type="button" class="${C.btnGhost}" data-action="cloud-backup-restore" data-backup-id="${escapeHtml(entry.id)}">Restore</button>
                  </div>
                </div>`,
                    )
                    .join("")
                : `<div class="text-[11px] text-zinc-500">No cloud backups uploaded yet.</div>`
            }
          </div>`}
        </form>
      </div>
      <div class="${C.card}">
        <div class="mb-4 border-b border-zinc-900 pb-2">
          <h2 class="text-xl font-semibold uppercase tracking-[0.12em] text-white">Server Folder</h2>
        </div>
        <p class="break-all font-mono text-xs text-zinc-400">${escapeHtml(server.serverDir)}</p>
        ${isDesktopApp() ? `<button type="button" class="mt-4 ${C.btnGhost}" data-action="open-path" data-path="${escapeHtml(server.serverDir)}">Open Folder</button>` : ""}
      </div>
      <div class="${C.card}">
        <div class="mb-4 border-b border-zinc-900 pb-2">
          <h2 class="text-xl font-semibold uppercase tracking-[0.12em] text-white">Delete Server</h2>
        </div>
        <p class="text-sm text-zinc-400">Remove this server from the panel and delete its local server files, data, and backups.</p>
        <button type="button" class="mt-4 border border-outline px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500 transition hover:border-white hover:text-white" data-action="delete-server" data-server-id="${escapeHtml(server.id)}" data-server-name="${escapeHtml(server.name)}">Delete Server</button>
      </div>
    </section>
  </div>`;
}

function renderPanelScreen() {
  const server = activeServer();
  const content =
    ui.section === "software" ? renderSoftwareSection(server)
      : ui.section === "console" ? renderConsoleSection(server)
      : ui.section === "players" ? renderPlayersSection(server)
      : ui.section === "worlds" ? renderWorldsSection(server)
      : ui.section === "addons" ? renderAddonsSection(server)
      : ui.section === "backups" ? renderBackupsSection(server)
      : ui.section === "misc" ? renderMiscSection(server)
      : ui.section === "settings" ? renderSettingsSection(server)
      : "";
  const overview = isPelicanBlueprintVariant() ? renderPelicanOverviewSection(server) : renderOverviewSection(server);
  return `<div class="releu-screen min-h-screen bg-black text-white">${renderHeader()}<main class="mx-auto max-w-[1440px] p-6 lg:p-8">${content || overview}</main></div>`;
}

function shouldRenderBlockingBootstrap() {
  return ui.bootstrap.active;
}

function render() {
  syncVariantAssets();
  const focusSnapshot = captureEditableFocus();
  let page;
  if (shouldRenderBlockingBootstrap()) {
    stopPlayitGatePolling();
    app.innerHTML = renderBootstrapScreen();
    restoreEditableFocus(focusSnapshot);
    return;
  }
  if (!runtime.data) {
    stopPlayitGatePolling();
    page = `<div class="min-h-screen bg-black text-white"><div class="mx-auto max-w-5xl p-8"><section class="${C.card}"><h2 class="text-2xl font-semibold text-white">Loading panel...</h2></section></div></div>`;
    app.innerHTML = `${page}${renderModal()}`;
    restoreEditableFocus(focusSnapshot);
    return;
  }
  syncInstallDraft();
  if (playitLinkRequired()) {
    maybeKickoffPlayitGateConnection();
    startPlayitGatePolling();
    app.innerHTML = `${renderPlayitGateScreen()}${renderModal()}`;
    restoreEditableFocus(focusSnapshot);
    return;
  }
  stopPlayitGatePolling();
  const server = activeServer();
  if (ui.screen === "create-server") {
    const createScreen = renderCreateServerScreen();
    page = isPelicanBlueprintVariant()
      ? renderPelicanBlueprintShell(createScreen, server)
      : createScreen;
  } else if (!server || ui.screen === "manager") {
    const managerScreen = renderManagerScreen();
    page = isPelicanBlueprintVariant()
      ? renderPelicanBlueprintShell(managerScreen, server)
      : managerScreen;
  } else if (!server.setupComplete || ui.screen === "setup") {
    const setupScreen = renderSetupScreen(server);
    page = isPelicanBlueprintVariant()
      ? renderPelicanBlueprintShell(setupScreen, server)
      : setupScreen;
  } else {
    const panelScreen = renderPanelScreen(server);
    page = isPelicanBlueprintVariant()
      ? renderPelicanBlueprintShell(panelScreen, server)
      : panelScreen;
  }
  app.innerHTML = `${page}${renderModal()}${renderOperationOverlay()}`;
  if (
    ui.screen === "panel" &&
    ui.section === "settings" &&
    !ui.cloudBackupStatusLoading &&
    (!ui.cloudBackupStatus || Date.now() - ui.cloudBackupStatusFetchedAt > 15000)
  ) {
    refreshCloudBackupStatus().catch(() => {});
  }
  updateConsoleElement();
  restoreEditableFocus(focusSnapshot);
  if (ui.modal?.type === "create-server" && ui.modal.justOpened) {
    const input = document.querySelector('[data-modal-input="server-name"]');
    input?.focus();
    const currentLength = input?.value?.length ?? 0;
    input?.setSelectionRange?.(currentLength, currentLength);
    ui.modal.justOpened = false;
  }
}

async function ensureDependenciesReady() {
  ui.bootstrap.active = true;
  ui.bootstrap.minDurationMs =
    DEPENDENCY_CHECK_MIN_MS +
    Math.floor(Math.random() * (DEPENDENCY_CHECK_MAX_MS - DEPENDENCY_CHECK_MIN_MS + 1));
  updateBootstrapFromDependencies(null, "checking");
  const startedAt = Date.now();
  render();

  const payload = await api("/api/dependencies/state");
  const dependencies = payload.dependencies;
  const waitForMinimum = async () => {
    const remainingMs = ui.bootstrap.minDurationMs - (Date.now() - startedAt);
    if (remainingMs > 0) {
      await sleep(remainingMs);
    }
  };

  if (dependencies.ready) {
    await waitForMinimum();
    ui.bootstrap.active = false;
    return dependencies;
  }

  await waitForMinimum();
  updateBootstrapFromDependencies(dependencies, "downloading");
  render();

  let ensureError = null;
  api("/api/dependencies/ensure", {
    method: "POST",
  }).catch((error) => {
    ensureError = error;
  });

  for (;;) {
    await sleep(350);
    if (ensureError) throw ensureError;
    const statePayload = await api("/api/dependencies/state");
    const current = statePayload.dependencies;
    updateBootstrapFromDependencies(current, "downloading");
    render();
    if (current.ready) {
      ui.bootstrap.active = false;
      return current;
    }
  }
}

async function ensureDependenciesReadyOnce() {
  if (startup.dependenciesReady) {
    return runtime.data?.dependencies ?? null;
  }
  if (startup.dependencyPromise) {
    return startup.dependencyPromise;
  }

  startup.dependencyPromise = (async () => {
    const dependencies = await ensureDependenciesReady();
    startup.dependenciesReady = true;
    startup.redirectReady = true;
    runStartupAppUpdateCheck().catch((error) => {
      console.error(error);
    });
    await refreshState();
    return dependencies;
  })().finally(() => {
    startup.dependencyPromise = null;
  });

  return startup.dependencyPromise;
}

async function refreshState(serverId = activeServer()?.id ?? runtime.data?.activeServerId ?? null) {
  const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
  const payload = await api(`/api/state${query}`);
  runtime.data = payload.state;
  syncUiPickerPrompt();
  if (maybeRedirectToPreferredUi()) {
    return;
  }
  syncPlayerDrafts();
  syncInstallDraft();
  if (ui.installDraft?.software) await ensureVersions(ui.installDraft.software);
  if (!startup.dependenciesReady && !ui.bootstrap.active && !playitLinkRequired()) {
    ensureDependenciesReadyOnce().catch((error) => {
      console.error(error);
      showError(error);
    });
  }
  const handledAppUpdate = await maybeAutoApplyAppUpdate();
  if (!handledAppUpdate) {
    if (ui.bootstrap.stage.startsWith("app-update-") && !appUpdateState()?.downloading) {
      ui.bootstrap.active = false;
    }
    render();
  }
}

async function waitForInitialState() {
  const deadline = Date.now() + INITIAL_PANEL_CONNECT_TIMEOUT_MS;
  let lastError = null;
  for (;;) {
    try {
      await refreshState();
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientLaunchFetchError(error) || Date.now() >= deadline) {
        throw lastError;
      }
      ui.bootstrap.active = true;
      ui.bootstrap.stage = "checking";
      ui.bootstrap.title = "Opening Releu";
      ui.bootstrap.detail = "Connecting to the local Releu panel.";
      ui.bootstrap.warning = "";
      ui.bootstrap.metaLeft = "System Node_01";
      ui.bootstrap.metaRight = "Retrying";
      ui.bootstrap.progressWidth = 30;
      render();
      await sleep(INITIAL_PANEL_CONNECT_RETRY_MS);
    }
  }
}

async function refreshCloudBackupStatus(force = false) {
  if (ui.cloudBackupStatusLoading) {
    return ui.cloudBackupStatus;
  }
  if (!force && ui.cloudBackupStatus && Date.now() - ui.cloudBackupStatusFetchedAt < 15000) {
    return ui.cloudBackupStatus;
  }
  ui.cloudBackupStatusLoading = true;
  try {
    const query = activeServer()?.id ?? runtime.data?.activeServerId
      ? `?serverId=${encodeURIComponent(activeServer()?.id ?? runtime.data?.activeServerId)}`
      : "";
    const payload = await api(`/api/cloud-backup/status${query}`);
    ui.cloudBackupStatus = payload.cloudBackup ?? null;
    ui.cloudBackupStatusFetchedAt = Date.now();
    render();
    return ui.cloudBackupStatus;
  } finally {
    ui.cloudBackupStatusLoading = false;
  }
}

async function runStartupAppUpdateCheck() {
  const currentUpdate = appUpdateState();
  if (!isDesktopApp() || !currentUpdate?.enabled || !currentUpdate?.autoInstall) {
    return false;
  }

  let checkError = null;
  api("/api/app-update/check", {
    method: "POST",
  }).catch((error) => {
    checkError = error;
  });

  for (;;) {
    await sleep(350);
    if (checkError) throw checkError;

    const serverId = activeServer()?.id ?? runtime.data?.activeServerId ?? null;
    const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
    const payload = await api(`/api/state${query}`);
    runtime.data = payload.state;
    syncInstallDraft();
    if (ui.installDraft?.software) await ensureVersions(ui.installDraft.software);

    const appUpdate = appUpdateState();
    if (appUpdate?.downloading) {
      updateBootstrapFromAppUpdate(appUpdate, "download");
      render();
    }

    if (!appUpdate?.checking && !appUpdate?.downloading) {
      return maybeAutoApplyAppUpdate();
    }
  }
}

async function refreshLogs(serverId = activeServer()?.id ?? runtime.data?.activeServerId ?? null) {
  if (!serverId) return;
  const query = new URLSearchParams({ serverId, after: String(runtime.latestLogId) });
  const payload = await api(`/api/logs?${query.toString()}`);
  appendLogs(payload.entries ?? []);
}

async function saveRuntimeSettings() {
  await api(activeServerPath("/settings/runtime"), {
    method: "POST",
    body: {
      javaPath: ui.installDraft.javaPath,
      minRam: mbToRamString(ui.installDraft.minRamMb),
      maxRam: mbToRamString(ui.installDraft.maxRamMb),
      cpuCores: ui.installDraft.cpuCores,
      gpuShare: ui.installDraft.gpuShare,
    },
  });
}

async function installSelectedSoftware() {
  await api(activeServerPath("/install/server"), {
    method: "POST",
    body: {
      software: ui.installDraft.software,
      version: ui.installDraft.version,
      acceptEula: true,
    },
  });
}

async function trackServerOperationWhile(promise, fallbackOperation) {
  let settled = false;
  let result;
  let failure;

  promise
    .then((payload) => {
      result = payload;
    })
    .catch((error) => {
      failure = error;
    })
    .finally(() => {
      settled = true;
    });

  while (!settled) {
    await sleep(900);
    try {
      const serverId = activeServer()?.id ?? runtime.data?.activeServerId ?? null;
      const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
      const payload = await api(`/api/state${query}`);
      runtime.data = payload.state;
      syncInstallDraft();
      const operation = activeServer()?.server?.operation;
      setUiOperation(
        operation?.active
          ? {
              tone: operation.type ?? fallbackOperation.tone ?? "working",
              title: operation.title ?? fallbackOperation.title,
              detail: operation.detail ?? fallbackOperation.detail,
            }
          : fallbackOperation,
      );
    } catch {
      setUiOperation(fallbackOperation);
    }
  }

  if (failure) throw failure;
  return result;
}

async function performSetupInstall() {
  setUiOperation({
    tone: "install",
    title: "Preparing Server Install",
    detail: "Saving the selected runtime limits and launcher settings.",
  });

  try {
    await saveRuntimeSettings();
    setUiOperation({
      tone: "install",
      title: "Installing Server Software",
      detail: `Downloading and installing ${softwareLabel(ui.installDraft.software)} ${ui.installDraft.version}.`,
    });

    const installPromise = api(activeServerPath("/install/server"), {
      method: "POST",
      body: {
        software: ui.installDraft.software,
        version: ui.installDraft.version,
        acceptEula: true,
      },
    });
    const payload = await trackServerOperationWhile(installPromise, {
      tone: "install",
      title: "Installing Server Software",
      detail: `Downloading and installing ${softwareLabel(ui.installDraft.software)} ${ui.installDraft.version}.`,
    });
    runtime.data = payload.state;
    ui.screen = "panel";
    ui.section = "server";
    await refreshLogs();
  } finally {
    clearUiOperation();
  }
}

async function performSoftwareUpdate() {
  setUiOperation({
    tone: "install",
    title: "Updating Server Software",
    detail: `Downloading and installing ${softwareLabel(ui.installDraft.software)} ${ui.installDraft.version}.`,
  });

  try {
    const installPromise = api(activeServerPath("/install/server"), {
      method: "POST",
      body: {
        software: ui.installDraft.software,
        version: ui.installDraft.version,
        acceptEula: true,
      },
    });
    const payload = await trackServerOperationWhile(installPromise, {
      tone: "install",
      title: "Updating Server Software",
      detail: `Downloading and installing ${softwareLabel(ui.installDraft.software)} ${ui.installDraft.version}.`,
    });
    runtime.data = payload.state;
    await refreshLogs();
  } finally {
    clearUiOperation();
  }
}

async function runServerControl(command) {
  await api(activeServerPath(`/server/${command}`), { method: "POST" });
  await refreshState();
  await refreshLogs();
}

function updateInstallDraftField(target) {
  if (!target?.dataset?.installField || !ui.installDraft) return;
  const field = target.dataset.installField;
  let value = target.value;
  if (["minRamMb", "maxRamMb", "cpuCores", "gpuShare"].includes(field)) value = Number(value);
  ui.installDraft[field] = value;
  if (field === "maxRamMb" && ui.installDraft.minRamMb > ui.installDraft.maxRamMb) {
    ui.installDraft.minRamMb = ui.installDraft.maxRamMb;
    const minInput = document.querySelector('[data-install-field="minRamMb"]');
    if (minInput) {
      minInput.value = String(ui.installDraft.minRamMb);
      minInput.max = String(ui.installDraft.maxRamMb);
    }
  }
  if (field === "minRamMb") {
    const maxInput = document.querySelector('[data-install-field="maxRamMb"]');
    if (maxInput) maxInput.min = String(ui.installDraft.minRamMb);
  }
  const outputs = {
    minRamMb: mbToRamString(ui.installDraft.minRamMb),
    maxRamMb: mbToRamString(ui.installDraft.maxRamMb),
    cpuCores: String(ui.installDraft.cpuCores),
    gpuShare: `${ui.installDraft.gpuShare}%`,
  };
  for (const [key, outputValue] of Object.entries(outputs)) {
    const output = document.querySelector(`[data-output="${key}"]`);
    if (output) output.textContent = outputValue;
  }
}

async function handleAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  event.preventDefault();
  if (isUiLocked()) return;
  const action = button.dataset.action;
  const busyActions = new Set([
    "select-server",
    "quick-server-control",
    "server-control",
    "copy-address",
    "check-app-update",
    "apply-app-update",
    "open-path",
    "pick-world-folder",
    "use-world",
    "regenerate-world",
    "regenerate-active-world",
    "playit-connect",
    "refresh-playit-gate",
    "remove-asset",
    "install-catalog",
    "player-action",
    "cloud-backup-refresh",
    "cloud-backup-issue-key",
    "cloud-backup-rotate-key",
    "cloud-backup-upload",
    "cloud-backup-download",
    "cloud-backup-restore",
    "backup-revert",
    "choose-ui-variant",
  ]);

  const run = async () => {
    switch (button.dataset.action) {
      case "go-manager":
        ui.createDraft = null;
        ui.screen = "manager";
        render();
        break;
      case "add-server-prompt":
      case "focus-add-server": {
        if (isPelicanBlueprintVariant()) {
          await ensureVersions((ui.createDraft ?? buildCreateDraft()).software);
          openCreateServerScreen();
        } else {
          openCreateServerModal();
        }
        break;
      }
      case "close-modal":
        closeModal();
        break;
      case "toggle-manager-view":
        ui.managerView = button.dataset.view === "list" ? "list" : "grid";
        render();
        break;
      case "select-server":
        resetLogs();
        ui.catalog.plugin = null;
        ui.catalog.mod = null;
        await api(`/api/servers/${encodeURIComponent(button.dataset.serverId)}/select`, { method: "POST" });
        await refreshState(button.dataset.serverId);
        ui.screen = activeServer()?.setupComplete ? "panel" : "setup";
        ui.section = "server";
        await refreshLogs(button.dataset.serverId);
        render();
        break;
      case "quick-server-control":
        resetLogs();
        ui.catalog.plugin = null;
        ui.catalog.mod = null;
        await api(`/api/servers/${encodeURIComponent(button.dataset.serverId)}/select`, { method: "POST" });
        await refreshState(button.dataset.serverId);
        ui.screen = activeServer()?.setupComplete ? "panel" : "setup";
        ui.section = "server";
        if (button.dataset.serverCommand && activeServer()?.setupComplete) await runServerControl(button.dataset.serverCommand);
        await refreshLogs(button.dataset.serverId);
        render();
        break;
      case "pick-software":
        ui.installDraft.software = button.dataset.softwareId;
        ui.installDraft.version = "latest";
        ui.catalog.plugin = null;
        ui.catalog.mod = null;
        await ensureVersions(ui.installDraft.software);
        render();
        break;
      case "pick-create-software":
        if (!ui.createDraft) ui.createDraft = buildCreateDraft();
        ui.createDraft.software = button.dataset.softwareId;
        ui.createDraft.version = "latest";
        syncCreateDraftBounds();
        await ensureVersions(ui.createDraft.software);
        render();
        break;
      case "switch-section":
        ui.section = button.dataset.section;
        render();
        if (ui.section === "console") await refreshLogs();
        break;
      case "open-setup":
        ui.screen = "setup";
        render();
        break;
      case "install-setup":
        await performSetupInstall();
        break;
      case "server-control":
        await runServerControl(button.dataset.serverCommand);
        break;
      case "backup-revert": {
        const backupName = String(button.dataset.backupName ?? "").trim();
        if (!backupName) {
          throw new Error("Choose a backup first.");
        }
        if (!window.confirm(`Revert the current server to "${backupName}"?\n\nThis overwrites the live server files and worlds with the selected backup.`)) {
          break;
        }
        if (!window.confirm("This can permanently replace newer progress if you choose the wrong backup.\n\nAre you sure you want to continue?")) {
          break;
        }
        if (!window.confirm(`Final warning: Releu will create one safety backup, then revert this server to "${backupName}".\n\nProceed with the revert?`)) {
          break;
        }
        await api(activeServerPath("/backups/revert"), {
          method: "POST",
          body: { backupName },
        });
        await refreshState();
        await refreshLogs();
        break;
      }
      case "copy-address":
        if (!playitMinecraftIp()) throw new Error(runtime.data?.playit?.secretConfigured ? "No public join address is available yet." : "Link playit.gg once first.");
        await copyText(playitMinecraftIp());
        break;
      case "delete-server": {
        const serverId = button.dataset.serverId ?? activeServer()?.id;
        const serverName = button.dataset.serverName ?? activeServer()?.name ?? serverId;
        openDeleteServerModal(serverId, serverName);
        break;
      }
      case "playit-reset-prompt":
        openPlayitResetModal();
        break;
      case "open-ui-picker":
        ui.modal = { type: "ui-picker" };
        render();
        break;
      case "choose-ui-variant": {
        ui.modal = null;
        await saveUiPreference(button.dataset.uiVariant, {
          redirect: true,
          hasChosenVariant: true,
        });
        break;
      }
      case "check-app-update": {
        const payload = await api("/api/app-update/check", { method: "POST" });
        runtime.data = payload.state;
        render();
        await maybeAutoApplyAppUpdate();
        break;
      }
      case "apply-app-update": {
        const appUpdate = appUpdateState();
        if (!isDesktopApp() || !window.desktop?.installAppUpdate) {
          throw new Error("App self-update is available only in the desktop build.");
        }
        if (!appUpdate?.stagedFilePath) {
          throw new Error("No downloaded Releu update is ready yet.");
        }
        await api("/api/app-update/applying", { method: "POST" });
        await window.desktop.installAppUpdate(appUpdate.stagedFilePath);
        break;
      }
      case "open-path":
        await openLocalPath(button.dataset.path);
        break;
      case "pick-world-folder": {
        const pickedPath = await pickLocalDirectory();
        if (!pickedPath) break;
        const form = button.closest("form");
        const input = form?.querySelector('[name="sourcePath"]');
        if (input) input.value = pickedPath;
        break;
      }
      case "use-world":
        await api(activeServerPath("/worlds/select"), {
          method: "POST",
          body: {
            name: button.dataset.worldName,
            seed: document.querySelector('[data-form="world-select"] [name="seed"]')?.value ?? "",
          },
        });
        await refreshState();
        break;
      case "regenerate-world":
        if (!window.confirm(`Regenerate "${button.dataset.worldName}"?\n\nReleu will keep the current world as a saved switchable world, then Minecraft will generate a fresh "${button.dataset.worldName}" on the next server start.`)) {
          break;
        }
        await api(activeServerPath("/worlds/regenerate"), {
          method: "POST",
          body: {
            name: button.dataset.worldName,
            seed: document.querySelector('[data-form="world-select"] [name="seed"]')?.value ?? "",
          },
        });
        await refreshState();
        break;
      case "regenerate-active-world":
        {
          const activeWorldName = activeServer()?.server?.properties?.["level-name"] ?? "world";
          if (!window.confirm(`Regenerate "${activeWorldName}"?\n\nReleu will keep the current world as a saved switchable world, then Minecraft will generate a fresh "${activeWorldName}" on the next server start.`)) {
            break;
          }
        }
        await api(activeServerPath("/worlds/regenerate"), {
          method: "POST",
          body: {
            name: activeServer()?.server?.properties?.["level-name"] ?? "world",
            seed: document.querySelector('[data-form="world-select"] [name="seed"]')?.value ?? "",
          },
        });
        await refreshState();
        break;
      case "playit-connect": {
        const payload = await api("/api/playit/connect", { method: "POST" });
        runtime.data = payload.state;
        render();
        if (payload.connect?.claimUrl) window.open(payload.connect.claimUrl, "_blank", "noopener,noreferrer");
        else if (runtime.data?.playit?.dashboardTunnelUrl) window.open(runtime.data.playit.dashboardTunnelUrl, "_blank", "noopener,noreferrer");
        await refreshLogs();
        break;
      }
      case "refresh-playit-gate":
        await refreshState();
        break;
      case "cloud-backup-refresh":
        await refreshCloudBackupStatus(true);
        break;
      case "cloud-backup-issue-key": {
        const deviceLabel =
          document.querySelector('[data-form="cloud-backup-settings"] [name="deviceLabel"]')
            ?.value ?? "";
        const payload = await api("/api/cloud-backup/issue-key", {
          method: "POST",
          body: { deviceLabel },
        });
        runtime.data = payload.state;
        ui.cloudBackupStatus = payload.cloudBackup ?? null;
        ui.cloudBackupStatusFetchedAt = Date.now();
        render();
        break;
      }
      case "cloud-backup-rotate-key": {
        const payload = await api("/api/cloud-backup/rotate-key", { method: "POST" });
        runtime.data = payload.state;
        ui.cloudBackupStatus = payload.cloudBackup ?? null;
        ui.cloudBackupStatusFetchedAt = Date.now();
        render();
        break;
      }
      case "cloud-backup-register": {
        const form = document.querySelector('[data-form="cloud-backup-settings"]');
        const payload = await api("/api/cloud-backup/register", {
          method: "POST",
          body: {
            username: form?.elements?.accountUsername?.value ?? "",
            password: form?.elements?.accountPassword?.value ?? "",
            deviceLabel: form?.elements?.deviceLabel?.value ?? "",
          },
        });
        runtime.data = payload.state;
        ui.cloudBackupStatus = payload.cloudBackup ?? null;
        ui.cloudBackupStatusFetchedAt = Date.now();
        ui.cloudBackupDraft.accountUsername = form?.elements?.accountUsername?.value ?? "";
        ui.cloudBackupDraft.accountPassword = "";
        ui.cloudBackupDraft.deviceLabel = form?.elements?.deviceLabel?.value ?? "";
        render();
        break;
      }
      case "cloud-backup-login": {
        const form = document.querySelector('[data-form="cloud-backup-settings"]');
        const payload = await api("/api/cloud-backup/login", {
          method: "POST",
          body: {
            username: form?.elements?.accountUsername?.value ?? "",
            password: form?.elements?.accountPassword?.value ?? "",
            deviceLabel: form?.elements?.deviceLabel?.value ?? "",
          },
        });
        runtime.data = payload.state;
        ui.cloudBackupStatus = payload.cloudBackup ?? null;
        ui.cloudBackupStatusFetchedAt = Date.now();
        ui.cloudBackupDraft.accountUsername = form?.elements?.accountUsername?.value ?? "";
        ui.cloudBackupDraft.accountPassword = "";
        ui.cloudBackupDraft.deviceLabel = form?.elements?.deviceLabel?.value ?? "";
        render();
        break;
      }
      case "cloud-backup-logout": {
        const payload = await api("/api/cloud-backup/logout", { method: "POST" });
        runtime.data = payload.state;
        ui.cloudBackupStatus = payload.cloudBackup ?? null;
        ui.cloudBackupStatusFetchedAt = Date.now();
        ui.cloudBackupDraft.accountPassword = "";
        render();
        break;
      }
      case "cloud-backup-upload": {
        const payload = await api(activeServerPath("/cloud-backup/upload"), { method: "POST" });
        runtime.data = payload.state;
        ui.cloudBackupStatus = payload.upload?.cloudBackup ?? null;
        ui.cloudBackupStatusFetchedAt = Date.now();
        await refreshLogs();
        render();
        break;
      }
      case "cloud-backup-download": {
        await api(activeServerPath("/cloud-backup/download"), {
          method: "POST",
          body: { backupId: button.dataset.backupId },
        });
        await refreshState();
        break;
      }
      case "cloud-backup-restore": {
        if (!window.confirm("Restore this cloud backup onto the current server? The server must stay stopped during the restore.")) {
          break;
        }
        const payload = await api(activeServerPath("/cloud-backup/restore"), {
          method: "POST",
          body: { backupId: button.dataset.backupId },
        });
        runtime.data = payload.state;
        ui.cloudBackupStatus = payload.restore?.cloudBackup ?? null;
        ui.cloudBackupStatusFetchedAt = Date.now();
        await refreshLogs();
        render();
        break;
      }
      case "remove-asset":
        await api(activeServerPath("/assets/remove"), { method: "POST", body: { kind: button.dataset.kind, fileName: button.dataset.fileName } });
        await refreshState();
        await refreshLogs();
        break;
      case "install-catalog":
        {
          const item =
            ui.catalog?.[button.dataset.kind]?.results?.find(
              (entry) => String(entry.id) === String(button.dataset.projectId),
            ) ?? null;
          const warning = addonInstallWarning(
            item ?? {
              title: button.dataset.projectTitle,
              clientSide: button.dataset.clientSide,
              serverSide: button.dataset.serverSide,
            },
            button.dataset.kind,
          );
          if (warning && !window.confirm(`${warning.title}\n\n${warning.message}`)) {
            break;
          }
        }
        await api(activeServerPath("/catalog/install"), {
          method: "POST",
          body: {
            kind: button.dataset.kind,
            projectId: button.dataset.projectId,
            profileId: button.dataset.profileId,
            gameVersion: activeServer()?.catalog?.gameVersion ?? ui.installDraft.version,
          },
        });
        await refreshState();
        await refreshLogs();
        break;
      case "player-action": {
        const card = button.closest("[data-player-card]");
        await api(activeServerPath(`/players/${encodeURIComponent(button.dataset.playerName)}/action`), {
          method: "POST",
          body: {
            action: button.dataset.playerAction,
            reason: card?.querySelector('[name="reason"]')?.value ?? "",
            mode: card?.querySelector('[name="mode"]')?.value ?? "survival",
            destination: card?.querySelector('[name="destination"]')?.value ?? "",
          },
        });
        await refreshState();
        await refreshLogs();
        break;
      }
      default:
        break;
    }
  };

  try {
    if (busyActions.has(action)) {
      await withBusyElement(button, run);
      return;
    }
    await run();
  } catch (error) {
    showError(error);
  }
}

async function handleSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  if (isUiLocked()) return;
  const submitter = event.submitter ?? form.querySelector('button[type="submit"]');
  const run = async () => {
    switch (form.dataset.form) {
      case "create-server-modal": {
        await createServerFromName(form.elements.name.value);
        break;
      }
      case "delete-server-modal": {
        const serverId = ui.modal?.serverId;
        if (!serverId) throw new Error("No server is selected.");
        ui.modal = null;
        resetLogs();
        const payload = await api(`/api/servers/${encodeURIComponent(serverId)}/delete`, { method: "POST" });
        runtime.data = payload.state;
        ui.screen = "manager";
        ui.section = "server";
        render();
        break;
      }
      case "playit-reset-modal": {
        ui.modal = null;
        const payload = await api("/api/playit/reset", { method: "POST" });
        runtime.data = payload.state;
        render();
        break;
      }
      case "create-server": {
        resetLogs();
        ui.catalog.plugin = null;
        ui.catalog.mod = null;
        const payload = await api("/api/servers", { method: "POST", body: { name: form.elements.name.value, installNow: false, acceptEula: true } });
        runtime.data = payload.state;
        ui.screen = "setup";
        ui.section = "server";
        syncInstallDraft();
        await ensureVersions(ui.installDraft.software);
        render();
        break;
      }
      case "create-server-page": {
        const draft = ui.createDraft ?? buildCreateDraft();
        const trimmedName = String(form.elements.name.value ?? draft.name ?? "").trim();
        if (!trimmedName) {
          throw new Error("Enter a server name first.");
        }
        resetLogs();
        ui.catalog.plugin = null;
        ui.catalog.mod = null;
        const payload = await api("/api/servers", {
          method: "POST",
          body: { name: trimmedName, installNow: false, acceptEula: true },
        });
        runtime.data = payload.state;
        const newServerId = runtime.data?.activeServerId ?? activeServer()?.id;
        applyCreateDraftToInstallDraft(newServerId);
        ui.createDraft = null;
        ui.screen = "setup";
        ui.section = "server";
        await ensureVersions(ui.installDraft.software);
        render();
        break;
      }
      case "software-install":
        await performSoftwareUpdate();
        break;
      case "world-select":
        await api(activeServerPath("/worlds/select"), {
          method: "POST",
          body: {
            name: form.elements.name.value,
            seed: form.elements.seed?.value ?? "",
          },
        });
        await refreshState();
        break;
      case "world-archive-upload": {
        const file = form.elements.file.files?.[0];
        if (!file) throw new Error("Choose a world archive first.");
        await apiRaw(activeServerPath("/worlds/upload-archive"), await file.arrayBuffer(), { "Content-Type": "application/octet-stream", "X-File-Name": file.name });
        form.reset();
        await refreshState();
        await refreshLogs();
        break;
      }
      case "world-folder-import":
        await api(activeServerPath("/worlds/import-folder"), { method: "POST", body: { sourcePath: form.elements.sourcePath.value, worldName: form.elements.worldName.value } });
        form.reset();
        await refreshState();
        await refreshLogs();
        break;
      case "runtime-settings":
        await saveRuntimeSettings();
        await refreshState();
        break;
      case "console-command":
        await api(activeServerPath("/server/command"), { method: "POST", body: { command: form.elements.command.value } });
        setConsoleDraft("");
        form.reset();
        await refreshLogs();
        break;
      case "player-register":
        await api(activeServerPath("/players/register"), { method: "POST", body: { name: form.elements.name.value, uuid: form.elements.uuid.value } });
        form.reset();
        await refreshState();
        await refreshLogs();
        break;
      case "catalog-search": {
        const params = new URLSearchParams({
          kind: form.dataset.kind,
          query: form.elements.query.value,
          profileId: form.elements.profileId.value,
          gameVersion: form.elements.gameVersion.value,
        });
        const payload = await api(`${activeServerPath("/catalog/search")}?${params.toString()}`);
        ui.catalog[form.dataset.kind] = payload.catalog;
        render();
        break;
      }
      case "asset-upload": {
        const file = form.elements.file.files?.[0];
        if (!file) throw new Error("Choose a file first.");
        await apiRaw(`${activeServerPath("/assets/install-upload")}?kind=${encodeURIComponent(form.dataset.kind)}`, await file.arrayBuffer(), { "Content-Type": "application/octet-stream", "X-File-Name": file.name });
        form.reset();
        await refreshState();
        await refreshLogs();
        break;
      }
      case "asset-url":
        await api(activeServerPath("/assets/install-url"), { method: "POST", body: { kind: form.dataset.kind, url: form.elements.url.value } });
        form.reset();
        await refreshState();
        await refreshLogs();
        break;
      case "resource-pack-settings":
        await api(activeServerPath("/settings/server-properties"), {
          method: "POST",
          body: {
            "resource-pack": form.elements["resource-pack"].value,
            "resource-pack-sha1": form.elements["resource-pack-sha1"].value,
            "resource-pack-prompt": form.elements["resource-pack-prompt"].value,
            "require-resource-pack": form.elements["require-resource-pack"].checked,
          },
        });
        await refreshState();
        await refreshLogs();
        break;
      case "backup-settings":
        await api(activeServerPath("/settings/backups"), {
          method: "POST",
          body: {
            autoBackups: form.elements.autoBackups.checked,
            backupIntervalMinutes: Number(form.elements.backupIntervalMinutes.value) || 60,
            maxBackupStorageGb: Number(form.elements.maxBackupStorageGb.value) || 10,
          },
        });
        await refreshState();
        break;
      case "server-settings":
        await api(activeServerPath("/settings/server-properties"), {
          method: "POST",
          body: {
            motd: form.elements.motd.value,
            "server-port": form.elements["server-port"].value,
            "max-players": form.elements["max-players"].value,
            "level-name": form.elements["level-name"].value,
            gamemode: form.elements.gamemode.value,
            difficulty: form.elements.difficulty.value,
            "view-distance": form.elements["view-distance"].value,
            "simulation-distance": form.elements["simulation-distance"].value,
            "spawn-protection": form.elements["spawn-protection"].value,
          },
        });
        await api(activeServerPath("/settings/eula"), { method: "POST", body: { accepted: true } });
        await refreshState();
        break;
      case "misc-settings":
        form.dataset.miscSaving = "true";
        form.dataset.miscResubmit = "false";
        try {
          const currentAllowCrackedClients =
            String(activeServer().server?.properties?.["online-mode"] ?? "true").toLowerCase() !== "true";
          const nextAllowCrackedClients = form.elements.allowCrackedClients.value === "true";
          if (currentAllowCrackedClients !== nextAllowCrackedClients) {
            const proceed = window.confirm(
              "Warning: changing Allow Cracked Clients switches players to a different save slot / UUID, so their inventory can look missing in this mode.\n\nIf you switch it back later, the original save usually comes back.\n\nDo you want to continue?",
            );
            if (!proceed) {
              form.elements.allowCrackedClients.value = currentAllowCrackedClients ? "true" : "false";
              const statusNode = document.querySelector("[data-misc-autosave-status]");
              if (statusNode) {
                statusNode.textContent = "Allow Cracked Clients change cancelled.";
              }
              break;
            }
          }
          if (Boolean(activeServer().misc?.keepInventory) !== (form.elements.keepInventory.value === "true")) {
            const proceed = window.confirm(
              "Warning: changing Keep Inventory can sometimes make every user's inventory look missing or get lost, and sometimes nothing happens.\n\nThis usually depends on when player data gets saved, deaths, and world state.\n\nDo you want to continue?",
            );
            if (!proceed) {
              form.elements.keepInventory.value = Boolean(activeServer().misc?.keepInventory) ? "true" : "false";
              const statusNode = document.querySelector("[data-misc-autosave-status]");
              if (statusNode) {
                statusNode.textContent = "Keep Inventory change cancelled.";
              }
              break;
            }
          }
          await api(activeServerPath("/settings/misc"), {
            method: "POST",
            body: {
              allowCrackedClients: form.elements.allowCrackedClients.value === "true",
              whitelist: form.elements.whitelist.value === "true",
              commandBlocks: form.elements.commandBlocks.value === "true",
              showPlayerCount: form.elements.showPlayerCount.value === "true",
              hideOnlinePlayers: form.elements.hideOnlinePlayers.value === "true",
              allowProxyConnections: form.elements.allowProxyConnections.value === "true",
              maxPlayers: form.elements.maxPlayers.value,
              playerIdleTimeout: form.elements.playerIdleTimeout.value,
              spawnProtection: form.elements.spawnProtection.value,
              pauseWhenEmpty: form.elements.pauseWhenEmpty.value === "true",
              pvp: form.elements.pvp.value === "true",
              allowFlight: form.elements.allowFlight.value === "true",
              keepInventory: form.elements.keepInventory.value === "true",
              sharedHealth: form.elements.sharedHealth.value === "true",
              hardcore: form.elements.hardcore.value === "true",
              forceGamemode: form.elements.forceGamemode.value === "true",
              generateStructures: form.elements.generateStructures.value === "true",
              logPlayerIPs: form.elements.logPlayerIPs.value === "true",
              allowNether: form.elements.allowNether.value === "true",
              allowEnd: form.elements.allowEnd.value === "true",
            },
          });
          await refreshState();
          {
            const statusNode = document.querySelector("[data-misc-autosave-status]");
            if (statusNode) {
              statusNode.textContent = `Saved automatically at ${new Date().toLocaleTimeString()}.`;
            }
          }
        } finally {
          form.dataset.miscSaving = "false";
          if (form.dataset.miscResubmit === "true") {
            form.dataset.miscResubmit = "false";
            window.setTimeout(() => {
              if (document.body.contains(form)) {
                form.requestSubmit();
              }
            }, 0);
          }
        }
        break;
      case "cloud-backup-settings": {
        const body = {
          enabled: form.elements.enabled.checked,
          provider: form.elements.provider?.value ?? "tailscale-ssh",
          deviceLabel: form.elements.deviceLabel.value,
          targetRestoreKey: form.elements.targetRestoreKey?.value ?? "",
        };
        if (form.elements.tailscaleHost) {
          body.tailscaleHost = form.elements.tailscaleHost.value;
        }
        if (form.elements.tailscaleUser) {
          body.tailscaleUser = form.elements.tailscaleUser.value;
        }
        if (form.elements.tailscaleRemoteDir) {
          body.tailscaleRemoteDir = form.elements.tailscaleRemoteDir.value;
        }
        const payload = await api("/api/cloud-backup/settings", {
          method: "POST",
          body,
        });
        runtime.data = payload.state;
        ui.cloudBackupStatus = payload.status ?? null;
        ui.cloudBackupStatusFetchedAt = Date.now();
        ui.cloudBackupDraft.deviceLabel = form.elements.deviceLabel.value;
        ui.cloudBackupDraft.targetRestoreKey = form.elements.targetRestoreKey?.value ?? "";
        render();
        break;
      }
      case "app-update-settings": {
        const payload = await api("/api/settings/updater", {
          method: "POST",
          body: {
            checkIntervalHours: Number(form.elements.checkIntervalHours.value) || 6,
          },
        });
        runtime.data = payload.state;
        render();
        break;
      }
      default:
        break;
    }
  };

  try {
    await withBusyElement(submitter, run);
  } catch (error) {
    showError(error);
  }
}

function handleInput(event) {
  if (event.target?.dataset?.modalInput === "server-name" && ui.modal?.type === "create-server") {
    ui.modal.name = event.target.value;
    ui.modal.selectionStart = event.target.selectionStart ?? ui.modal.name.length;
    ui.modal.selectionEnd = event.target.selectionEnd ?? ui.modal.name.length;
  }
  if (event.target?.dataset?.createField) {
    if (!ui.createDraft) ui.createDraft = buildCreateDraft();
    const field = event.target.dataset.createField;
    let value = event.target.value;
    if (["minRamMb", "maxRamMb", "cpuCores", "gpuShare"].includes(field)) value = Number(value);
    ui.createDraft[field] = value;
    syncCreateDraftBounds();
    const outputs = {
      minRamMb: mbToRamString(ui.createDraft.minRamMb),
      maxRamMb: mbToRamString(ui.createDraft.maxRamMb),
      cpuCores: String(ui.createDraft.cpuCores),
      gpuShare: `${ui.createDraft.gpuShare}%`,
    };
    for (const [key, outputValue] of Object.entries(outputs)) {
      const output = document.querySelector(`[data-create-output="${key}"]`);
      if (output) output.textContent = outputValue;
    }
    if (field === "maxRamMb") {
      const minInput = document.querySelector('[data-create-field="minRamMb"]');
      if (minInput) {
        minInput.value = String(ui.createDraft.minRamMb);
        minInput.max = String(ui.createDraft.maxRamMb);
      }
    }
    if (field === "minRamMb") {
      const maxInput = document.querySelector('[data-create-field="maxRamMb"]');
      if (maxInput) maxInput.min = String(ui.createDraft.minRamMb);
    }
  }
  const cloudForm = event.target?.closest?.('form[data-form="cloud-backup-settings"]');
  if (
    cloudForm &&
    ["deviceLabel", "accountUsername", "accountPassword", "targetRestoreKey"].includes(
      event.target?.name ?? "",
    )
  ) {
    ui.cloudBackupDraft[event.target.name] = event.target.value;
  }
  const commandForm = event.target?.closest?.('form[data-form="console-command"]');
  if (commandForm && event.target?.name === "command") {
    setConsoleDraft(event.target.value);
  }
  const miscForm = event.target?.closest?.('form[data-form="misc-settings"]');
  if (miscForm && event.target?.name) {
    if (miscForm.dataset.miscSaving === "true") {
      miscForm.dataset.miscResubmit = "true";
    } else {
      if (miscAutosaveTimer) {
        window.clearTimeout(miscAutosaveTimer);
      }
      miscAutosaveTimer = window.setTimeout(() => {
        if (document.body.contains(miscForm)) {
          miscForm.requestSubmit();
        }
      }, event.target.type === "number" ? 500 : 150);
    }
  }
  const playerCard = event.target?.closest?.("[data-player-card]");
  if (playerCard && ["reason", "mode", "destination"].includes(event.target?.name ?? "")) {
    const key = playerCard.dataset.playerKey;
    if (key) {
      if (!ui.playerDrafts[key]) {
        ui.playerDrafts[key] = { reason: "", destination: "", mode: "survival" };
      }
      ui.playerDrafts[key][event.target.name] = event.target.value;
    }
  }
  updateInstallDraftField(event.target);
}

function handleKeydown(event) {
  if (event.key === "Escape" && ui.modal) {
    event.preventDefault();
    closeModal();
  }
}

function scheduleLogsPolling() {
  if (logsPollTimer) {
    window.clearTimeout(logsPollTimer);
  }
  logsPollTimer = window.setTimeout(async () => {
    try {
      if (!isCreateServerModalOpen()) {
        await refreshLogs();
      }
    } catch (error) {
      console.error(error);
    }
    scheduleLogsPolling();
  }, currentLogPollMs());
}

function scheduleStatePolling() {
  if (statePollTimer) {
    window.clearTimeout(statePollTimer);
  }
  statePollTimer = window.setTimeout(async () => {
    try {
      if (!isCreateServerModalOpen()) {
        await refreshState();
      }
    } catch (error) {
      console.error(error);
    }
    scheduleStatePolling();
  }, currentStatePollMs());
}

async function boot() {
  document.addEventListener("click", handleAction);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleInput);
  document.addEventListener("keydown", handleKeydown);
  render();
  await sleep(25);
  await waitForInitialState();
  scheduleLogsPolling();
  scheduleStatePolling();
  if (playitLinkRequired()) {
    ui.bootstrap.active = false;
    render();
    return;
  }
  await ensureDependenciesReadyOnce();
}

boot().catch((error) => {
  console.error(error);
  showError(error);
});
