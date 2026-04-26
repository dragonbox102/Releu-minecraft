const app = document.getElementById("app");
const STATE_POLL_MS = 12000;
const LOG_POLL_MS = 2500;
const SOFTWARE_ORDER = ["purpur", "paper", "vanilla", "fabric", "forge", "neoforge", "quilt"];
const DEPENDENCY_CHECK_MIN_MS = 3000;
const DEPENDENCY_CHECK_MAX_MS = 6000;

const runtime = { latestLogId: 0, consoleText: "", data: null, versionCache: new Map() };
let playitGatePollTimer = null;
let logsPollTimer = null;
let statePollTimer = null;
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
  catalog: { plugin: null, mod: null },
  modal: null,
  operation: null,
  appUpdateAttemptedVersion: null,
};

const sections = [
  { id: "server", label: "Overview" },
  { id: "software", label: "Software" },
  { id: "console", label: "Console" },
  { id: "players", label: "Players" },
  { id: "worlds", label: "Worlds" },
  { id: "addons", label: "Add-ons" },
  { id: "backups", label: "Backups" },
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

function getSoftwareOption(softwareId) {
  return runtime.data?.softwareOptions?.find((entry) => entry.id === softwareId) ?? null;
}

function softwareLabel(softwareId) {
  return getSoftwareOption(softwareId)?.name ?? String(softwareId ?? "Unknown").toUpperCase();
}

function isDesktopApp() {
  return Boolean(window.desktop?.isDesktop);
}

function playitPrimaryTunnel() {
  return runtime.data?.playit?.tunnels?.find((entry) => entry.publicAddress) ??
    runtime.data?.playit?.tunnels?.[0] ??
    null;
}

function playitMinecraftIp() {
  return playitPrimaryTunnel()?.publicAddress ?? null;
}

function appUpdateState() {
  return runtime.data?.appUpdate ?? null;
}

function playitLinkRequired() {
  return !runtime.data?.playit?.secretConfigured;
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
      detail: "Switch this server to Fabric before installing mod add-ons.",
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
  const software = server.install.software ?? server.install.installedSoftware ?? "purpur";
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
  if (!softwareId || runtime.versionCache.has(softwareId)) return;
  const payload = await api(`/api/software/versions?software=${encodeURIComponent(softwareId)}`);
  runtime.versionCache.set(softwareId, ["latest", ...(payload.versions ?? [])]);
}

function getVersionOptions(softwareId, selectedVersion = "latest") {
  const options = runtime.versionCache.get(softwareId) ?? ["latest"];
  return !selectedVersion || options.includes(selectedVersion) ? options : [selectedVersion, ...options];
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
  const ip = playitMinecraftIp();
  const running = String(server?.server?.status ?? "").toLowerCase() === "running";
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
  if (playit?.needsWebSetup || Number(playit?.configuredTunnelCount ?? 0) === 0) {
    return {
      value: "No Tunnel Assigned Yet",
      detail: `Create or assign a Minecraft Java tunnel for ${playit?.recommendedTunnelTarget ?? "127.0.0.1:25565"} in Settings.`,
    };
  }
  if (!running) {
    return {
      value: "Run Server To Get Address",
      detail:
        playit.statusMessage ??
        `Start this server on ${playit.recommendedTunnelTarget} so playit can publish the join address.`,
    };
  }
  return {
    value: "Waiting For Public Address",
    detail:
      playit.statusMessage ??
      `Releu is waiting for playit.gg to publish the public join address for ${playit.recommendedTunnelTarget}.`,
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

function renderTile(label, value, detail = "") {
  return `<article class="${C.card}"><p class="${C.label} mb-3">${escapeHtml(label)}</p><div class="text-2xl font-black tracking-tight text-white">${escapeHtml(value)}</div>${detail ? `<p class="mt-2 text-xs leading-6 text-zinc-400">${escapeHtml(detail)}</p>` : ""}</article>`;
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

function renderWorldCard(world) {
  return `<article class="${C.card}"><div class="mb-4 flex items-start justify-between gap-4"><div><div class="${world.isActive ? C.labelOn : C.label} mb-2">${world.isActive ? "Active World" : "World Slot"}</div><h3 class="text-xl font-semibold text-white">${escapeHtml(world.name)}</h3><p class="mt-2 font-mono text-xs text-zinc-500">${escapeHtml(world.path)}</p></div><div class="text-zinc-500">${icon("globe", "h-5 w-5")}</div></div><div class="mb-4 flex flex-wrap gap-2"><span class="${C.chip}">${world.exists ? "Base" : "Missing"}</span><span class="${C.chip}">${world.netherExists ? "Nether" : "No Nether"}</span><span class="${C.chip}">${world.endExists ? "End" : "No End"}</span></div><div class="flex flex-wrap gap-2"><button type="button" class="${C.btnPrimary}" data-action="use-world" data-world-name="${escapeHtml(world.name)}">Use This World</button><button type="button" class="${C.btnGhost}" data-action="regenerate-world" data-world-name="${escapeHtml(world.name)}">Regenerate</button>${isDesktopApp() ? `<button type="button" class="border border-outline px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400 transition hover:border-white hover:text-white" data-action="open-path" data-path="${escapeHtml(world.path)}">Open Folder</button>` : ""}</div></article>`;
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
          <button type="button" class="${C.btnPrimary}" data-action="install-catalog" data-kind="${escapeHtml(kind)}" data-project-id="${escapeHtml(item.id)}" data-profile-id="${escapeHtml(resultSet.profile.id)}" data-busy-label="Installing..." ${support.supported ? "" : "disabled"}>Install</button>
        </div>
        <p class="text-sm text-zinc-400">${escapeHtml(item.description ?? "No description provided.")}</p>
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

function renderPlayitGateScreen() {
  const playit = runtime.data?.playit ?? {};
  const waiting = Boolean(playit.claimWaiting);
  const title = waiting
    ? "Finish Playit Agent Link To Continue"
    : "Connect Playit Agent To Continue";
  const detail = waiting
    ? "Complete the playit.gg browser link. Releu will move to the main menu automatically as soon as the agent is connected."
    : "Link playit.gg once for this app. Releu will reuse that connection for every server you create on this PC.";
  const note =
    playit.lastError ||
    playit.statusMessage ||
    "You can relink or reset the agent later from Settings.";
  const primaryAction = waiting
    ? `<a class="${C.btnPrimary}" href="${escapeHtml(playit.claimUrl ?? playit.dashboardTunnelUrl)}" target="_blank" rel="noreferrer">Open Playit Link</a>`
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
  return "";
}

function renderManagerScreen() {
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
  return `<div class="releu-screen min-h-screen bg-black text-white">${renderHeader()}<main class="mx-auto w-full max-w-7xl p-8"><div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div class="space-y-2"><p class="${C.label}">Server Selector</p><h1 class="text-3xl font-black tracking-tight text-white">Choose a server or add a new one.</h1><p class="max-w-3xl text-sm text-zinc-400">New servers are created automatically in Local App Data, ports are assigned automatically, and server data is saved automatically to disk.</p></div><div class="flex gap-2"><button type="button" class="releu-button flex h-10 w-10 items-center justify-center border border-outline transition hover:bg-surfaceAlt ${ui.managerView === "grid" ? "bg-surface text-white" : "text-zinc-500"}" data-action="toggle-manager-view" data-view="grid">${icon("grid")}</button><button type="button" class="releu-button flex h-10 w-10 items-center justify-center border border-outline transition hover:bg-surfaceAlt ${ui.managerView === "list" ? "bg-surface text-white" : "text-zinc-500"}" data-action="toggle-manager-view" data-view="list">${icon("list")}</button></div></div><div class="${gridClass}">${cards}<button type="button" class="releu-panel group flex min-h-[290px] flex-col items-center justify-center border border-dashed border-outline p-12 text-center transition hover:border-white" data-action="add-server-prompt"><div class="mb-4 text-zinc-500 transition group-hover:text-white">${icon("plus", "h-9 w-9")}</div><span class="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500 transition group-hover:text-white">Add Server</span></button></div></main></div>`;
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
  return `<div class="releu-screen min-h-screen bg-black text-white">${renderHeader()}<main class="mx-auto max-w-[1440px] p-8"><header class="mb-10"><h1 class="text-3xl font-black uppercase tracking-tight text-white">Server Setup</h1><p class="mt-2 max-w-3xl text-sm text-zinc-400">Configure the software, resource limits, and launcher path. Releu accepts the Minecraft EULA automatically during install.</p></header><div class="grid grid-cols-1 gap-4 md:grid-cols-12"><section class="${C.card} flex flex-col gap-6 md:col-span-4"><div class="border-b border-zinc-900 pb-4"><h2 class="${C.label}">Selected Server</h2></div><div class="space-y-6"><div><label class="${C.label} mb-2 block">Server Name</label><p class="text-2xl font-semibold text-white">${escapeHtml(server.name)}</p></div><div><label class="${C.label} mb-2 block">Auto Folder</label><div class="border border-outline bg-black p-4 font-mono text-[11px] text-zinc-300">${escapeHtml(server.serverDir)}</div></div><div class="grid grid-cols-2 gap-4"><div><label class="${C.label} mb-1 block">Port</label><p class="text-sm text-white">${escapeHtml(server.server.properties["server-port"] ?? 25565)}</p></div><div><label class="${C.label} mb-1 block">Backups</label><p class="text-sm text-white">${server.backups.enabled ? `Every ${escapeHtml(server.backups.intervalMinutes)} minutes` : "Disabled"}</p></div></div><div class="space-y-2 border-t border-zinc-900 pt-4 text-xs text-zinc-400"><p>Folders are created in Local App Data automatically.</p></div></div></section><section class="${C.card} flex flex-col gap-6 md:col-span-8"><div class="border-b border-zinc-900 pb-4"><h2 class="${C.label}">Choose Software</h2></div><div class="grid grid-cols-2 gap-4 lg:grid-cols-4">${softwareChoices().map((option) => { const selected = option.id === ui.installDraft.software; return `<button type="button" class="releu-button flex min-h-[148px] flex-col justify-between border ${selected ? "border-white bg-white text-black" : "border-outline bg-black text-white hover:border-zinc-600"} p-4 text-left transition" data-action="pick-software" data-software-id="${escapeHtml(option.id)}"><div class="flex items-start justify-between gap-3"><div class="${selected ? "text-black" : "text-zinc-500"}">${icon(selected ? "server" : "layers", "h-5 w-5")}</div>${selected ? `<div class="h-2 w-2 rounded-full bg-black"></div>` : ""}</div><div class="space-y-2"><div class="text-sm font-bold tracking-tight">${escapeHtml(option.name)}</div><div class="text-[10px] uppercase tracking-[0.18em] ${selected ? "text-zinc-700" : "text-zinc-500"}">${escapeHtml(option.latestHint ?? option.releaseChannel ?? option.id)}</div></div></button>`; }).join("")}</div><label class="flex flex-col gap-2"><span class="${C.label}">Minecraft Version</span><select data-install-field="version" class="w-full border border-outline bg-black px-4 py-3 text-white outline-none transition focus:border-white">${versionOptions.map((version) => `<option value="${escapeHtml(version)}" ${version === ui.installDraft.version ? "selected" : ""}>${escapeHtml(version)}</option>`).join("")}</select></label></section><section class="${C.card} flex flex-col gap-8 md:col-span-8"><div class="border-b border-zinc-900 pb-4"><h2 class="${C.label}">Server Resources</h2></div><div class="grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-2"><label class="space-y-4"><div class="flex items-center justify-between"><span class="${C.label}">Max RAM Allocation</span><span class="font-mono text-sm text-white" data-output="maxRamMb">${escapeHtml(mbToRamString(ui.installDraft.maxRamMb))}</span></div><input type="range" min="512" max="${escapeHtml(runtime.data.host.totalMemoryMb)}" step="256" value="${escapeHtml(ui.installDraft.maxRamMb)}" data-install-field="maxRamMb" class="w-full accent-white" /></label><label class="space-y-4"><div class="flex items-center justify-between"><span class="${C.label}">Min RAM Allocation</span><span class="font-mono text-sm text-white" data-output="minRamMb">${escapeHtml(mbToRamString(ui.installDraft.minRamMb))}</span></div><input type="range" min="512" max="${escapeHtml(ui.installDraft.maxRamMb)}" step="256" value="${escapeHtml(ui.installDraft.minRamMb)}" data-install-field="minRamMb" class="w-full accent-white" /></label><label class="space-y-4"><div class="flex items-center justify-between"><span class="${C.label}">CPU Core Limit</span><span class="font-mono text-sm text-white" data-output="cpuCores">${escapeHtml(ui.installDraft.cpuCores)}</span></div><input type="range" min="1" max="${escapeHtml(runtime.data.host.cpuCores)}" step="1" value="${escapeHtml(ui.installDraft.cpuCores)}" data-install-field="cpuCores" class="w-full accent-white" /></label><label class="space-y-4"><div class="flex items-center justify-between"><span class="${C.label}">GPU Share</span><span class="font-mono text-sm text-white" data-output="gpuShare">${escapeHtml(`${ui.installDraft.gpuShare}%`)}</span></div><input type="range" min="0" max="100" step="5" value="${escapeHtml(ui.installDraft.gpuShare)}" data-install-field="gpuShare" class="w-full accent-white" /></label><label class="space-y-2 md:col-span-2"><span class="${C.label}">Java Executable Path</span><input data-install-field="javaPath" type="text" value="${escapeHtml(ui.installDraft.javaPath)}" class="${C.input} font-mono text-sm" /></label></div></section><section class="${C.card} flex flex-col gap-6 md:col-span-4"><div class="border-b border-zinc-900 pb-4"><h2 class="${C.label}">Install And Open</h2></div><div class="flex flex-1 flex-col justify-between gap-6"><div class="space-y-4 text-sm text-zinc-300"><p>${escapeHtml(installState.detail)}</p><div class="flex items-center gap-3"><div class="h-2 w-2 rounded-full ${server.server.operation?.active ? "bg-zinc-300" : "bg-white"}"></div><span class="text-[11px] font-bold uppercase tracking-[0.18em] text-white">${escapeHtml(installState.label)}</span></div></div><button type="button" data-action="install-setup" class="w-full border border-white bg-white py-6 text-[11px] font-bold uppercase tracking-[0.18em] text-black transition hover:bg-zinc-200">${escapeHtml(server.server.operation?.active ? (server.server.operation.shortLabel ?? "Installing") : "Install Server")}</button></div></section></div></main></div>`;
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
  const ipAction = playitMinecraftIp()
    ? `<button type="button" class="${C.btnGhost}" data-action="copy-address">Copy IP</button>`
    : joinState.value === "No Tunnel Assigned Yet"
      ? `<button type="button" class="${C.btnGhost}" data-action="switch-section" data-section="settings">Fix Tunnel</button>`
      : "";
  const publicStatusLabel =
    playitMinecraftIp() ? "Live" : joinState.value === "No Tunnel Assigned Yet" ? "No Tunnel" : "Pending";
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
          </article>
        </div>
      </div>
      <div class="space-y-4 md:col-span-4">
        <div class="${C.card}">
          <h2 class="${C.label} mb-4 text-white">Minecraft IP</h2>
          <div class="space-y-4">
            <code class="block break-all text-xl font-semibold text-white">${escapeHtml(joinState.value)}</code>
            <p class="text-sm leading-7 text-zinc-400">${escapeHtml(joinState.detail)}</p>
            ${ipAction ? `<div class="flex flex-wrap gap-2">${ipAction}</div>` : ""}
          </div>
        </div>
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
  const metrics = server.server.metrics ?? {};
  const ramMaxMb = Number(metrics.ramMaxMb ?? ramStringToMb(server.launcher.maxRam, 4096));
  const ramUsedMb = Number(metrics.ramUsedMb ?? 0);
  return `<main class="flex min-h-[calc(100vh-180px)] flex-col overflow-hidden bg-black"><div class="mb-4 flex items-center justify-between px-2"><div class="flex items-center gap-4"><div class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-white"></span><span class="${C.labelOn}">${escapeHtml(server.name)}</span></div><span class="font-mono text-[11px] text-zinc-600">|</span><span class="font-mono text-[11px] text-zinc-500">LAST START: ${escapeHtml(formatTimestamp(server.server.lastStartedAt))}</span></div></div><div class="flex flex-1 flex-col overflow-hidden border border-outline bg-black"><div class="flex-1 overflow-y-auto p-6 font-mono text-xs text-zinc-300"><pre data-role="console-output" class="whitespace-pre-wrap">${escapeHtml(runtime.consoleText || "Console output will appear here once the server starts.")}</pre></div><form data-form="console-command" class="flex items-center gap-3 border-t border-outline bg-black p-4"><span class="text-zinc-500">${icon("terminal")}</span><input name="command" type="text" placeholder="Enter server command..." class="flex-1 border-none bg-transparent font-mono text-sm text-white outline-none placeholder:text-zinc-700" /></form></div><div class="mt-4 flex flex-wrap gap-6 px-2 pb-2"><div class="min-w-[140px] space-y-1"><span class="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">CPU Load</span><div class="relative h-1 w-full bg-zinc-900"><div class="absolute inset-y-0 left-0 bg-white" style="width:${Math.max(0, Math.min(100, Number(metrics.cpuPercent ?? 0)))}%"></div></div><span class="font-mono text-[11px] text-white">${escapeHtml(formatPercent(metrics.cpuPercent ?? 0))}</span></div><div class="min-w-[140px] space-y-1"><span class="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">RAM Alloc</span><div class="relative h-1 w-full bg-zinc-900"><div class="absolute inset-y-0 left-0 bg-white" style="width:${Math.max(0, Math.min(100, ramMaxMb ? (ramUsedMb / ramMaxMb) * 100 : 0))}%"></div></div><span class="font-mono text-[11px] text-white">${escapeHtml(`${formatMemoryFromMb(ramUsedMb)} / ${formatMemoryFromMb(ramMaxMb)}`)}</span></div><div class="min-w-[140px] space-y-1"><span class="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">Players</span><div class="relative h-1 w-full bg-zinc-900"><div class="absolute inset-y-0 left-0 bg-white" style="width:${Math.max(0, Math.min(100, (Number(server.server.playerCount ?? 0) / playerCapacity(server)) * 100))}%"></div></div><span class="font-mono text-[11px] text-white">${escapeHtml(`${server.server.playerCount} / ${playerCapacity(server)}`)}</span></div><div class="ml-auto flex items-center gap-3"><button type="button" class="${C.btnPrimary}" data-action="server-control" data-server-command="restart">Restart Server</button><button type="button" class="${C.btnGhost}" data-action="server-control" data-server-command="backup">Backup Now</button></div></div></main>`;
}

function renderPlayersSection(server) {
  const onlinePlayers = server.players.filter((entry) => entry.online).length;
  return `<div class="flex flex-col gap-8"><div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><h1 class="mb-2 text-4xl font-black tracking-tight text-white">Player Database</h1><p class="max-w-3xl text-sm text-zinc-400">Manage known players, online players, and offline permission lists from one place.</p></div><div class="flex flex-wrap gap-2"><div class="flex items-center gap-2 border border-outline bg-surface px-4 py-2"><span class="h-2 w-2 rounded-full bg-white"></span><span class="text-[11px] font-bold uppercase tracking-[0.18em]">${escapeHtml(`${onlinePlayers} Active`)}</span></div><div class="flex items-center gap-2 border border-outline bg-surface px-4 py-2"><span class="h-2 w-2 rounded-full border border-white"></span><span class="text-[11px] font-bold uppercase tracking-[0.18em]">${escapeHtml(`${server.players.length} Total`)}</span></div></div></div><form data-form="player-register" class="grid gap-4 border border-outline bg-surface p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]"><label class="flex flex-col gap-2"><span class="${C.label}">Player Name</span><input name="name" type="text" required class="${C.input}" placeholder="Steve" /></label><label class="flex flex-col gap-2"><span class="${C.label}">UUID (Optional)</span><input name="uuid" type="text" class="${C.input} font-mono" placeholder="00000000-0000-0000-0000-000000000000" /></label><button type="submit" class="self-end ${C.btnPrimary} py-3" data-busy-label="Adding...">Add Player</button></form><div class="overflow-hidden border border-outline bg-surface"><div class="overflow-x-auto"><table class="w-full border-collapse text-left"><thead><tr class="border-b border-outline bg-surfaceAlt"><th class="p-4 ${C.label}">Status</th><th class="p-4 ${C.label}">Player</th><th class="p-4 ${C.label}">Flags</th><th class="p-4 ${C.label}">Last Seen</th><th class="p-4 text-right ${C.label}">Administrative Actions</th></tr></thead><tbody class="divide-y divide-zinc-900">${server.players.length ? server.players.map((player) => `<tr class="transition hover:bg-surfaceAlt" data-player-card><td class="p-4"><span class="block h-2 w-2 rounded-full ${player.online ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" : "border border-white"}"></span></td><td class="p-4"><div class="flex items-center gap-3"><img src="${escapeHtml(playerAvatarUrl(player))}" alt="${escapeHtml(player.name)}" class="h-10 w-10 border border-outline bg-black object-cover" loading="lazy" /><div><div class="text-sm font-semibold text-white">${escapeHtml(player.name)}</div><div class="font-mono text-xs text-zinc-500">${escapeHtml(player.uuid ?? "UUID unknown")}</div></div></div></td><td class="p-4 font-mono text-xs text-white">${escapeHtml(renderPlayerFlags(player))}</td><td class="p-4 font-mono text-xs text-zinc-400">${escapeHtml(formatLastSeen(player.lastSeenAt))}</td><td class="p-4"><div class="ml-auto flex max-w-[540px] flex-wrap justify-end gap-2"><input name="reason" type="text" placeholder="Reason" class="min-w-[120px] border border-outline bg-black px-2 py-1 text-[10px] text-white outline-none placeholder:text-zinc-700 focus:border-white" /><select name="mode" class="border border-outline bg-black px-2 py-1 text-[10px] text-white outline-none focus:border-white"><option value="survival">Survival</option><option value="creative">Creative</option><option value="adventure">Adventure</option><option value="spectator">Spectator</option></select><input name="destination" type="text" placeholder="Teleport target" class="min-w-[120px] border border-outline bg-black px-2 py-1 text-[10px] text-white outline-none placeholder:text-zinc-700 focus:border-white" />${renderPlayerButtons(player)}</div></td></tr>`).join("") : `<tr><td colspan="5" class="p-6 text-sm text-zinc-500">No players are registered yet.</td></tr>`}</tbody></table></div></div></div>`;
}

function renderWorldsSection(server) {
  const world = currentWorld(server)?.name ?? server.server.properties["level-name"] ?? "world";
  return `<div class="space-y-8"><div class="grid grid-cols-1 gap-4 md:grid-cols-3"><section class="flex flex-col gap-6 border border-white bg-black p-6"><div><h3 class="${C.labelOn} mb-2">Worlds</h3><h2 class="text-2xl font-semibold uppercase text-white">Active World</h2></div><form data-form="world-select" class="flex flex-col gap-4"><label class="flex flex-col gap-2"><span class="${C.label}">World Name</span><select name="name" class="${C.input}">${server.worlds.map((entry) => `<option value="${escapeHtml(entry.name)}" ${entry.name === world ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("")}</select></label><div class="flex flex-col gap-2"><button type="submit" class="${C.btnPrimary} py-3">Use This World</button><button type="button" class="${C.btnGhost} py-3" data-action="regenerate-active-world">Regenerate Active World</button></div></form></section><section class="flex flex-col gap-6 border border-white bg-black p-6"><div><h3 class="${C.labelOn} mb-2">Upload World</h3><h2 class="text-2xl font-semibold uppercase text-white">Import A Zip</h2></div><form data-form="world-archive-upload" class="flex flex-col gap-4"><input name="file" type="file" accept=".zip,.mcworld" required class="w-full border border-outline bg-black px-4 py-3 text-sm text-zinc-300 file:mr-4 file:border-0 file:bg-white file:px-3 file:py-2 file:text-[11px] file:font-bold file:uppercase file:tracking-[0.18em] file:text-black" /><input name="worldName" type="text" placeholder="survival-archive" class="${C.input}" /><button type="submit" class="${C.btnPrimary} py-3">Upload World Archive</button></form></section><section class="flex flex-col gap-6 border border-white bg-black p-6"><div><h3 class="${C.labelOn} mb-2">Import Folder</h3><h2 class="text-2xl font-semibold uppercase text-white">Use A Local World Folder</h2></div><form data-form="world-folder-import" class="flex flex-col gap-4"><div class="flex gap-2"><input name="sourcePath" type="text" placeholder="C:\\Worlds\\MyWorld" class="${C.input} flex-1" />${isDesktopApp() ? `<button type="button" class="${C.btnGhost}" data-action="pick-world-folder">Browse</button>` : ""}</div><input name="worldName" type="text" placeholder="local-import-01" class="${C.input}" /><button type="submit" class="${C.btnPrimary} py-3">Import World Folder</button></form></section></div><div class="grid grid-cols-1 gap-4 xl:grid-cols-2">${server.worlds.map((entry) => renderWorldCard(entry)).join("")}</div></div>`;
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
      <p class="text-sm leading-7 text-zinc-400">Send a resource pack URL through Minecraft itself. Players will see it after the next server restart.</p>
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
  return `<div class="grid grid-cols-1 gap-8 xl:grid-cols-2">${renderAddonColumn("plugin", server.catalog.pluginProfiles, server.plugins, ui.catalog.plugin)}${renderAddonColumn("mod", server.catalog.modProfiles, server.mods, ui.catalog.mod)}${renderResourcePackSection(server)}</div>`;
}

function renderBackupsSection(server) {
  return `<div class="grid grid-cols-1 gap-4 md:grid-cols-12"><section class="${C.card} space-y-6 md:col-span-4"><div class="space-y-2"><h2 class="${C.labelOn}">Protection</h2><div class="h-px w-full bg-outline"></div></div><form data-form="backup-settings" class="space-y-4"><label class="flex items-center gap-3"><input name="autoBackups" type="checkbox" class="h-4 w-4 accent-white" ${server.backups.enabled ? "checked" : ""} /><span class="text-[12px] text-zinc-300">Enable automatic backups</span></label><input name="backupIntervalMinutes" type="number" min="5" value="${escapeHtml(server.backups.intervalMinutes ?? 60)}" class="${C.input} font-mono" /><button type="submit" class="w-full ${C.btnPrimary} py-4">Save Backup Schedule</button></form><button type="button" class="w-full ${C.btnGhost} py-4" data-action="server-control" data-server-command="backup">Create Backup Now</button></section><section class="flex min-h-[600px] flex-col border border-outline bg-surface md:col-span-8"><div class="space-y-2 p-6"><h2 class="${C.labelOn}">Backup History</h2><div class="h-px w-full bg-outline"></div></div><div class="flex-1 overflow-hidden"><table class="w-full border-collapse text-left"><thead><tr class="border-b border-zinc-900"><th class="p-4 ${C.label}">Timestamp</th><th class="p-4 ${C.label}">Folder Path</th><th class="p-4 text-right ${C.label}">Actions</th></tr></thead><tbody class="font-mono text-[13px]">${server.backups.recent.length ? server.backups.recent.map((backup) => `<tr class="border-b border-zinc-900 transition hover:bg-surfaceAlt"><td class="p-4 text-white">${escapeHtml(formatTimestamp(backup.createdAt))}</td><td class="p-4 text-zinc-500">${escapeHtml(backup.path)}</td><td class="space-x-3 p-4 text-right">${isDesktopApp() ? `<button type="button" class="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500 transition hover:text-white" data-action="open-path" data-path="${escapeHtml(backup.path)}">Open Folder</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="3" class="p-6 text-sm text-zinc-500">No backups have been created yet.</td></tr>`}</tbody></table></div></section></div>`;
}

function renderSettingsSection(server) {
  const playit = runtime.data.playit;
  const appUpdate = runtime.data.appUpdate;
  const joinState = playitAddressState(server);
  const crackedClientsEnabled =
    String(server.server.properties["online-mode"] ?? "true").toLowerCase() !== "true";
  const settingToggles = [
    ["white-list", "Whitelist"],
    ["pvp", "PvP"],
    ["allow-flight", "Allow Flight"],
    ["enable-command-block", "Command Blocks"],
  ];
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
            <select name="gamemode" class="${C.input} font-mono text-sm">${["survival", "creative", "adventure", "spectator"].map((value) => `<option value="${escapeHtml(value)}" ${String(server.server.properties.gamemode ?? "").toLowerCase() === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>
          </div>
          <div class="space-y-4">
            <select name="difficulty" class="${C.input} font-mono text-sm">${["peaceful", "easy", "normal", "hard"].map((value) => `<option value="${escapeHtml(value)}" ${String(server.server.properties.difficulty ?? "").toLowerCase() === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>
            <input name="view-distance" type="number" value="${escapeHtml(server.server.properties["view-distance"] ?? 10)}" class="${C.input} font-mono text-sm" placeholder="View distance" />
            <input name="simulation-distance" type="number" value="${escapeHtml(server.server.properties["simulation-distance"] ?? 10)}" class="${C.input} font-mono text-sm" placeholder="Simulation distance" />
            <input name="spawn-protection" type="number" value="${escapeHtml(server.server.properties["spawn-protection"] ?? 16)}" class="${C.input} font-mono text-sm" placeholder="Spawn protection" />
          </div>
        </div>
        <div class="border-t border-zinc-900 pt-4">
          <div class="border border-outline bg-black p-4">
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div class="space-y-2">
                <p class="${C.labelOn}">Cracked Support</p>
                <p class="text-sm text-zinc-400">Turn this on only if you want offline or cracked clients to join. Releu will set <span class="font-mono text-zinc-300">online-mode=false</span> when enabled.</p>
              </div>
              <label class="flex items-center gap-3">
                <input name="allow-cracked-clients" type="checkbox" class="h-4 w-4 accent-white" ${crackedClientsEnabled ? "checked" : ""} />
                <span class="text-[11px] font-bold uppercase tracking-[0.18em] text-white">Allow Cracked Clients</span>
              </label>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4 border-t border-zinc-900 pt-4 md:grid-cols-2 lg:grid-cols-4">
          ${settingToggles.map(([key, label]) => `<label class="flex items-center gap-3"><input name="${escapeHtml(key)}" type="checkbox" class="h-4 w-4 accent-white" ${String(server.server.properties[key] ?? "false") === "true" ? "checked" : ""} /><span class="text-[11px] font-bold uppercase tracking-[0.18em] text-white">${escapeHtml(label)}</span></label>`).join("")}
        </div>
        <button type="submit" class="${C.btnPrimary} py-4">Save Server Settings</button>
      </form>
    </section>
    <section class="col-span-12 space-y-4 lg:col-span-4">
      <div class="${C.card}">
        <div class="mb-4 border-b border-zinc-900 pb-2">
          <h2 class="text-xl font-semibold uppercase tracking-[0.12em] text-white">Public Access</h2>
        </div>
        <code class="block break-all text-lg font-semibold text-white">${escapeHtml(joinState.value)}</code>
        <p class="mt-2 text-sm text-zinc-400">${escapeHtml(joinState.detail)}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          ${playitAction}
          ${playit.secretConfigured ? `<a class="${C.btnGhost}" href="${escapeHtml(playit.dashboardTunnelUrl)}" target="_blank" rel="noreferrer">Open Dashboard</a>` : ""}
          ${playitMinecraftIp() ? `<button type="button" class="${C.btnGhost}" data-action="copy-address">Copy IP</button>` : ""}
        </div>
      </div>
      <div class="${C.card}">
        <div class="mb-4 border-b border-zinc-900 pb-2">
          <h2 class="text-xl font-semibold uppercase tracking-[0.12em] text-white">Playit Agent</h2>
        </div>
        <p class="text-sm text-zinc-400">${escapeHtml(playit.secretConfigured ? "Reset the saved playit.gg link if this PC was connected to the wrong account or if you want to relink from scratch." : "No playit.gg account is linked right now. If the agent file is ever missing, Releu will reinstall it automatically the next time you link it.")}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" class="${C.btnGhost}" data-action="playit-reset-prompt">Reset Agent</button>
        </div>
      </div>
      <div class="${C.card}">
        <div class="mb-4 border-b border-zinc-900 pb-2">
          <h2 class="text-xl font-semibold uppercase tracking-[0.12em] text-white">Releu Updates</h2>
        </div>
        <form data-form="app-update-settings" class="space-y-4">
          <label class="flex items-center gap-3">
            <input name="enabled" type="checkbox" class="h-4 w-4 accent-white" ${appUpdate?.enabled ? "checked" : ""} />
            <span class="text-[11px] font-bold uppercase tracking-[0.18em] text-white">Enable GitHub Updates</span>
          </label>
          <label class="flex items-center gap-3">
            <input name="autoInstall" type="checkbox" class="h-4 w-4 accent-white" ${appUpdate?.autoInstall ? "checked" : ""} />
            <span class="text-[11px] font-bold uppercase tracking-[0.18em] text-white">Auto Install And Restart</span>
          </label>
          <label class="block">
            <span class="${C.label} mb-2 block">GitHub Owner</span>
            <input name="githubOwner" type="text" value="${escapeHtml(appUpdate?.githubOwner ?? "")}" class="${C.input} w-full" placeholder="your-github-name" />
          </label>
          <label class="block">
            <span class="${C.label} mb-2 block">GitHub Repo</span>
            <input name="githubRepo" type="text" value="${escapeHtml(appUpdate?.githubRepo ?? "")}" class="${C.input} w-full" placeholder="releu-minecraft" />
          </label>
          <label class="block">
            <span class="${C.label} mb-2 block">Release Asset Name</span>
            <input name="assetName" type="text" value="${escapeHtml(appUpdate?.assetName ?? "")}" class="${C.input} w-full" placeholder="${escapeHtml(appUpdate?.assetName ?? runtime.data.updaterSettings?.assetName ?? "Releu-minecraft")}" />
          </label>
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
      : ui.section === "settings" ? renderSettingsSection(server)
      : "";
  return `<div class="releu-screen min-h-screen bg-black text-white">${renderHeader()}<main class="mx-auto max-w-[1440px] p-6 lg:p-8">${content || renderOverviewSection(server)}</main></div>`;
}

function render() {
  let page;
  if (ui.bootstrap.active) {
    stopPlayitGatePolling();
    app.innerHTML = renderBootstrapScreen();
    return;
  }
  if (!runtime.data) {
    stopPlayitGatePolling();
    page = `<div class="min-h-screen bg-black text-white"><div class="mx-auto max-w-5xl p-8"><section class="${C.card}"><h2 class="text-2xl font-semibold text-white">Loading panel...</h2></section></div></div>`;
    app.innerHTML = `${page}${renderModal()}`;
    return;
  }
  syncInstallDraft();
  if (playitLinkRequired()) {
    startPlayitGatePolling();
    app.innerHTML = `${renderPlayitGateScreen()}${renderModal()}`;
    return;
  }
  stopPlayitGatePolling();
  const server = activeServer();
  if (!server || ui.screen === "manager") page = renderManagerScreen();
  else if (!server.setupComplete || ui.screen === "setup") page = renderSetupScreen(server);
  else page = renderPanelScreen(server);
  app.innerHTML = `${page}${renderModal()}${renderOperationOverlay()}`;
  updateConsoleElement();
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

async function refreshState(serverId = activeServer()?.id ?? runtime.data?.activeServerId ?? null) {
  const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
  const payload = await api(`/api/state${query}`);
  runtime.data = payload.state;
  syncInstallDraft();
  if (ui.installDraft?.software) await ensureVersions(ui.installDraft.software);
  const handledAppUpdate = await maybeAutoApplyAppUpdate();
  if (!handledAppUpdate) {
    if (ui.bootstrap.stage.startsWith("app-update-") && !appUpdateState()?.downloading) {
      ui.bootstrap.active = false;
    }
    render();
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
  ]);

  const run = async () => {
    switch (button.dataset.action) {
      case "go-manager":
        ui.screen = "manager";
        render();
        break;
      case "add-server-prompt":
      case "focus-add-server": {
        openCreateServerModal();
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
        await api(activeServerPath("/worlds/select"), { method: "POST", body: { name: button.dataset.worldName } });
        await refreshState();
        break;
      case "regenerate-world":
        await api(activeServerPath("/worlds/regenerate"), { method: "POST", body: { name: button.dataset.worldName } });
        await refreshState();
        break;
      case "regenerate-active-world":
        await api(activeServerPath("/worlds/regenerate"), { method: "POST", body: { name: activeServer()?.server?.properties?.["level-name"] ?? "world" } });
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
      case "remove-asset":
        await api(activeServerPath("/assets/remove"), { method: "POST", body: { kind: button.dataset.kind, fileName: button.dataset.fileName } });
        await refreshState();
        await refreshLogs();
        break;
      case "install-catalog":
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
      case "software-install":
        await performSoftwareUpdate();
        break;
      case "world-select":
        await api(activeServerPath("/worlds/select"), { method: "POST", body: { name: form.elements.name.value } });
        await refreshState();
        break;
      case "world-archive-upload": {
        const file = form.elements.file.files?.[0];
        if (!file) throw new Error("Choose a world archive first.");
        const params = new URLSearchParams();
        if (String(form.elements.worldName.value ?? "").trim()) params.set("worldName", String(form.elements.worldName.value).trim());
        await apiRaw(`${activeServerPath("/worlds/upload-archive")}?${params.toString()}`, await file.arrayBuffer(), { "Content-Type": "application/octet-stream", "X-File-Name": file.name });
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
        await api(activeServerPath("/settings/profile"), { method: "POST", body: { name: activeServer().name, autoBackups: form.elements.autoBackups.checked, backupIntervalMinutes: Number(form.elements.backupIntervalMinutes.value) || 60 } });
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
            "white-list": form.elements["white-list"].checked,
            "online-mode": !form.elements["allow-cracked-clients"].checked,
            pvp: form.elements.pvp.checked,
            "allow-flight": form.elements["allow-flight"].checked,
            "enable-command-block": form.elements["enable-command-block"].checked,
          },
        });
        await api(activeServerPath("/settings/eula"), { method: "POST", body: { accepted: true } });
        await refreshState();
        break;
      case "app-update-settings": {
        const payload = await api("/api/settings/updater", {
          method: "POST",
          body: {
            enabled: form.elements.enabled.checked,
            autoInstall: form.elements.autoInstall.checked,
            githubOwner: form.elements.githubOwner.value,
            githubRepo: form.elements.githubRepo.value,
            assetName: form.elements.assetName.value,
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
  await sleep(250);
  await ensureDependenciesReady();
  await refreshState();
  await runStartupAppUpdateCheck();
  scheduleLogsPolling();
  scheduleStatePolling();
}

boot().catch((error) => {
  console.error(error);
  showError(error);
});
