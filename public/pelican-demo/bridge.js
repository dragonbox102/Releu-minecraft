const PAGE = location.pathname.split("/").pop() || "servers.html";
const SERVER_PAGES = new Set([
  "overview.html",
  "console.html",
  "players.html",
  "files.html",
  "backups.html",
  "worlds.html",
  "addons-mods.html",
  "software.html",
  "misc.html",
  "settings.html",
]);

const APP_STATE = {
  state: null,
  logs: [],
  versionsBySoftware: new Map(),
  catalogResults: { plugin: null, mod: null, resourcepack: null },
  catalogPaging: {
    plugin: { page: 1 },
    mod: { page: 1 },
    resourcepack: { page: 1 },
  },
  createDraft: null,
  softwareDraft: null,
  broadcastDraft: { title: "", subtitle: "", staySeconds: 4 },
  catalogBootstrap: { plugin: false, mod: false, resourcepack: false },
  installHud: null,
  installHudTimer: null,
  profileSaveTimer: null,
  profileSaveState: { message: "", tone: "neutral" },
  cloudBackup: { status: null, loading: false, lastFetchedAt: 0 },
  consoleDraft: "",
  consoleHelpOpen: false,
  consoleStickToBottom: true,
  consoleDistanceFromBottom: 0,
};
const PAGE_TRANSITION_MS = 170;

function injectReleaseChromeStyles() {
  if (document.getElementById("releu-release-shell-style")) return;
  const style = document.createElement("style");
  style.id = "releu-release-shell-style";
  style.textContent = `
    body[data-releu-shell="true"] .fi-sidebar,
    body[data-releu-shell="true"] .fi-topbar,
    body[data-releu-shell="true"] .fi-main-ctn,
    body[data-releu-shell="true"] .fi-page-content > *,
    body[data-releu-shell="true"] .fi-section,
    body[data-releu-shell="true"] .pelican-stat-card,
    body[data-releu-shell="true"] .pm-result-card,
    body[data-releu-shell="true"] .pw-card,
    body[data-releu-shell="true"] .psw-panel,
    body[data-releu-shell="true"] .ppl-table-wrap {
      transition:
        opacity ${PAGE_TRANSITION_MS}ms ease,
        transform ${PAGE_TRANSITION_MS}ms ease,
        filter ${PAGE_TRANSITION_MS}ms ease,
        border-color 180ms ease,
        background-color 180ms ease;
      will-change: opacity, transform;
    }

    body.releu-shell-enter .fi-sidebar,
    body.releu-shell-enter .fi-topbar,
    body.releu-shell-enter .fi-main-ctn,
    body.releu-shell-enter .fi-page-content > *,
    body.releu-shell-enter .fi-section,
    body.releu-shell-enter .pelican-stat-card,
    body.releu-shell-enter .pm-result-card,
    body.releu-shell-enter .pw-card,
    body.releu-shell-enter .psw-panel,
    body.releu-shell-enter .ppl-table-wrap,
    body.releu-shell-leaving .fi-sidebar,
    body.releu-shell-leaving .fi-topbar,
    body.releu-shell-leaving .fi-main-ctn,
    body.releu-shell-leaving .fi-page-content > *,
    body.releu-shell-leaving .fi-section,
    body.releu-shell-leaving .pelican-stat-card,
    body.releu-shell-leaving .pm-result-card,
    body.releu-shell-leaving .pw-card,
    body.releu-shell-leaving .psw-panel,
    body.releu-shell-leaving .ppl-table-wrap {
      opacity: 0;
      transform: translateY(10px);
      filter: blur(1px);
    }

    body.releu-shell-ready .fi-sidebar,
    body.releu-shell-ready .fi-topbar,
    body.releu-shell-ready .fi-main-ctn,
    body.releu-shell-ready .fi-page-content > *,
    body.releu-shell-ready .fi-section,
    body.releu-shell-ready .pelican-stat-card,
    body.releu-shell-ready .pm-result-card,
    body.releu-shell-ready .pw-card,
    body.releu-shell-ready .psw-panel,
    body.releu-shell-ready .ppl-table-wrap {
      opacity: 1;
      transform: none;
      filter: none;
    }

    body[data-releu-shell="true"] .fi-page-content > *:nth-child(1) { transition-delay: 20ms; }
    body[data-releu-shell="true"] .fi-page-content > *:nth-child(2) { transition-delay: 38ms; }
    body[data-releu-shell="true"] .fi-page-content > *:nth-child(3) { transition-delay: 56ms; }
    body[data-releu-shell="true"] .fi-page-content > *:nth-child(4) { transition-delay: 74ms; }
    body[data-releu-shell="true"] .fi-page-content > *:nth-child(5) { transition-delay: 92ms; }

    body[data-releu-shell="true"] .releu-sidebar-servers .fi-sidebar-item-btn,
    body[data-releu-shell="true"] .releu-sidebar-servers .fi-sidebar-item-label {
      color: rgb(248 250 252) !important;
    }

    body[data-releu-shell="true"] .releu-sidebar-servers .fi-sidebar-item-btn {
      font-weight: 600;
    }
  `;
  document.head.append(style);
}

function beginShellEnter() {
  document.body.dataset.releuShell = "true";
  document.body.classList.remove("releu-shell-ready", "releu-shell-leaving");
  document.body.classList.add("releu-shell-enter");
}

function finishShellEnter() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.remove("releu-shell-enter", "releu-shell-leaving");
      document.body.classList.add("releu-shell-ready");
    });
  });
}

function navigateTo(href) {
  const target = new URL(href, location.href);
  if (`${target.pathname}${target.search}` === `${location.pathname}${location.search}`) return;
  document.body.classList.remove("releu-shell-ready");
  document.body.classList.add("releu-shell-leaving");
  window.setTimeout(() => {
    location.href = target.href;
  }, PAGE_TRANSITION_MS);
}

function wireLocalNavigation() {
  if (document.body.dataset.releuNavBound) return;
  document.body.dataset.releuNavBound = "true";
  document.addEventListener(
    "click",
    (event) => {
      const routed = event.target.closest?.("[data-releu-route]");
      if (routed) {
        event.preventDefault();
        navigateTo(routed.dataset.releuRoute);
        return;
      }
      const anchor = event.target.closest?.('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (/^https?:/i.test(href) && !href.startsWith(location.origin)) return;
      if (!href.includes(".html")) return;
      event.preventDefault();
      navigateTo(anchor.href);
    },
    true,
  );
}

function ensureServersSidebarLink() {
  if (PAGE === "servers.html") return;
  const list = document.querySelector(".fi-sidebar-group-items");
  if (!list || list.querySelector("[data-releu-sidebar-servers]")) return;
  const item = document.createElement("li");
  item.className = "fi-sidebar-item fi-sidebar-item-has-url releu-sidebar-servers";
  item.dataset.releuSidebarServers = "true";
  item.innerHTML = `<a href="${escapeHtml(buildLocalPageHref("servers.html"))}" class="fi-sidebar-item-btn"><span class="fi-sidebar-item-label">Servers</span></a>`;
  list.prepend(item);
}

function ensureMiscSidebarLink() {
  if (PAGE === "servers.html") return;
  const list = document.querySelector(".fi-sidebar-group-items");
  if (!list) return;
  const existing = [...list.querySelectorAll(".fi-sidebar-item-label")].find(
    (node) => node.textContent?.trim().toLowerCase() === "misc",
  );
  if (existing) return;
  const item = document.createElement("li");
  item.className = `fi-sidebar-item fi-sidebar-item-has-url${PAGE === "misc.html" ? " fi-active" : ""}`;
  item.innerHTML = `<a href="${escapeHtml(buildLocalPageHref("misc.html"))}" class="fi-sidebar-item-btn"><span class="fi-sidebar-item-label">Misc</span></a>`;
  const settingsItem = [...list.children].find((node) =>
    node.querySelector(".fi-sidebar-item-label")?.textContent?.trim().toLowerCase() === "settings",
  );
  if (settingsItem?.parentNode) {
    settingsItem.parentNode.insertBefore(item, settingsItem);
  } else {
    list.append(item);
  }
}

function stripReleaseBranding() {
  document.querySelectorAll(".fi-logo").forEach((node) => {
    node.textContent = "Releu";
  });
  document.querySelectorAll(".fi-section-header-description").forEach((node) => {
    if (node.textContent?.includes("Pelican-shell")) {
      node.textContent = "Create a new Minecraft server in Releu.";
    }
    if (node.textContent?.includes("plugin and mod wiring")) {
      node.textContent = "Browse, install, and manage plugins, mods, and resource packs for this server.";
    }
    if (node.textContent?.includes("world management wiring")) {
      node.textContent = "Manage worlds, imports, and active world selection for this server.";
    }
    if (node.textContent?.includes("software selection and runtime limits")) {
      node.textContent = "Choose server software and manage runtime limits for this server.";
    }
    if (node.textContent?.includes("summary tiles and console")) {
      node.textContent = "Live server summary, status, and recent console activity.";
    }
  });
  document.querySelectorAll("p").forEach((node) => {
    if (node.textContent?.includes("Demo server entry")) {
      node.textContent = "Manage your Minecraft servers from the Releu server list.";
    }
  });
  document.querySelectorAll("footer, .fi-footer, .fi-simple-footer").forEach((node) => {
    if (node.textContent?.includes("© 2026 Pelican")) node.remove();
  });
  document.querySelectorAll(".fi-dropdown-list-item-label, .fi-tenant-menu-trigger-tenant-name, .fi-user-menu-trigger-text").forEach((node) => {
    if (node.textContent?.trim() === "Pelican Demo") node.textContent = "Releu";
  });
}

function suppressSavedShellBehavior() {
  if (document.body.dataset.releuShellSuppressed) return;
  document.body.dataset.releuShellSuppressed = "true";
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.releuAllowSubmit === "true") return;
      event.preventDefault();
    },
    true,
  );
}

function stripUnusedTopbarChrome() {
  document.querySelectorAll(".fi-topbar-database-notifications-btn").forEach((node) => {
    node.closest(".fi-no-database")?.remove();
  });
  document.querySelectorAll(".fi-user-menu").forEach((node) => node.remove());
  document.querySelectorAll("[data-fi-modal-id='database-notifications'], #database-notifications").forEach((node) => node.remove());
}

function showStatus(message, tone = "info") {
  let banner = document.querySelector("[data-releu-status-banner]");
  if (!banner) {
    banner = document.createElement("div");
    banner.dataset.releuStatusBanner = "true";
    Object.assign(banner.style, {
      position: "sticky",
      top: "0",
      zIndex: "50",
      padding: "0.75rem 1rem",
      fontSize: "0.8125rem",
      fontWeight: "600",
      borderBottom: "1px solid #2b3642",
      backdropFilter: "blur(12px)",
    });
    document.body.prepend(banner);
  }
  const palette =
    tone === "error"
      ? { background: "rgba(127,29,29,.82)", color: "#fecaca" }
      : tone === "success"
        ? { background: "rgba(20,83,45,.82)", color: "#bbf7d0" }
        : { background: "rgba(15,23,42,.82)", color: "#cbd5e1" };
  banner.style.background = palette.background;
  banner.style.color = palette.color;
  banner.textContent = message;
}

function clearStatus() {
  document.querySelector("[data-releu-status-banner]")?.remove();
}

function devConsoleLogsEnabled() {
  return localStorage.getItem("releu.pelican.devConsoleLogs") === "true";
}

function setDevConsoleLogsEnabled(value) {
  localStorage.setItem("releu.pelican.devConsoleLogs", value ? "true" : "false");
}

function visibleLogs() {
  if (devConsoleLogsEnabled()) {
    return APP_STATE.logs;
  }
  return APP_STATE.logs.filter((entry) => entry.source === "server");
}

function setInstallHud(message, phase = "working", progress = 18) {
  if (APP_STATE.installHudTimer) {
    window.clearTimeout(APP_STATE.installHudTimer);
    APP_STATE.installHudTimer = null;
  }
  APP_STATE.installHud = { message, phase, progress };
  let hud = document.querySelector("[data-releu-install-hud]");
  if (!hud) {
    hud = document.createElement("aside");
    hud.dataset.releuInstallHud = "true";
    hud.style.position = "fixed";
    hud.style.right = "18px";
    hud.style.bottom = "18px";
    hud.style.zIndex = "80";
    hud.style.minWidth = "300px";
    hud.style.maxWidth = "360px";
    hud.style.padding = "14px 16px";
    hud.style.border = "1px solid #2b3642";
    hud.style.borderRadius = "12px";
    hud.style.background = "rgba(15,20,27,0.96)";
    hud.style.backdropFilter = "blur(18px)";
    hud.style.boxShadow = "0 18px 48px rgba(0,0,0,0.45)";
    document.body.append(hud);
  }
  const tone =
    phase === "error"
      ? { color: "#fca5a5", bar: "#ef4444" }
      : phase === "success"
        ? { color: "#86efac", bar: "#22c55e" }
        : { color: "#dbeafe", bar: "#3b82f6" };
  hud.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;"><div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#94a3b8;">Install Status</div><div style="font-size:11px;color:${tone.color};">${escapeHtml(phase === "success" ? "Done" : phase === "error" ? "Error" : "Working")}</div></div><div style="font-size:13px;line-height:1.55;color:#e2e8f0;">${escapeHtml(message)}</div><div style="margin-top:12px;height:6px;border-radius:999px;background:#18212b;overflow:hidden;"><div style="height:100%;width:${Math.max(6, Math.min(100, progress))}%;background:${tone.bar};transition:width 180ms ease;"></div></div>`;
}

function clearInstallHud(delayMs = 1800) {
  const hud = document.querySelector("[data-releu-install-hud]");
  if (!hud) return;
  if (APP_STATE.installHudTimer) {
    window.clearTimeout(APP_STATE.installHudTimer);
  }
  APP_STATE.installHudTimer = window.setTimeout(() => {
    hud.remove();
    APP_STATE.installHud = null;
    APP_STATE.installHudTimer = null;
  }, Math.max(0, Number(delayMs ?? 0) || 0));
}

function showError(error) {
  const message = error?.message ?? String(error ?? "Unexpected error.");
  showStatus(message, "error");
  console.error(error);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatMb(value) {
  return `${Math.max(0, Math.round(Number(value ?? 0)))} MB`;
}

function formatBytes(value) {
  const size = Math.max(0, Number(value ?? 0) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
}

function ramStringToMb(value, fallback = 0) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return fallback;
  const match = raw.match(/^(\d+(?:\.\d+)?)([MGT])?$/);
  if (!match) return fallback;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return fallback;
  const unit = match[2] ?? "M";
  if (unit === "G") return Math.round(numeric * 1024);
  if (unit === "T") return Math.round(numeric * 1024 * 1024);
  return Math.round(numeric);
}

function activeServer() {
  return APP_STATE.state?.activeServer ?? null;
}

function activeServerSoftwareId() {
  const server = activeServer();
  return server?.install?.installedSoftware ?? server?.install?.software ?? null;
}

function activeServerSoftwareOption() {
  const softwareId = activeServerSoftwareId();
  return APP_STATE.state?.softwareOptions?.find((entry) => entry.id === softwareId) ?? null;
}

function activeServerId() {
  return APP_STATE.state?.activeServerId ?? localStorage.getItem("releu.pelican.serverId") ?? "";
}

function getRequestedServerId() {
  const params = new URLSearchParams(location.search);
  return String(params.get("serverId") ?? "").trim() || localStorage.getItem("releu.pelican.serverId") || "";
}

function persistServerId(serverId) {
  const normalized = String(serverId ?? "").trim();
  if (normalized) {
    localStorage.setItem("releu.pelican.serverId", normalized);
  }
}

function syncServerIdInLocation(serverId) {
  if (!SERVER_PAGES.has(PAGE)) return;
  const normalized = String(serverId ?? "").trim();
  const url = new URL(location.href);
  if (normalized) {
    url.searchParams.set("serverId", normalized);
  } else {
    url.searchParams.delete("serverId");
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (next !== current) {
    history.replaceState({}, "", next);
  }
}

function buildLocalPageHref(pageName, serverId = activeServerId()) {
  const url = new URL(`./${pageName}`, location.href);
  if (SERVER_PAGES.has(pageName) && serverId) {
    url.searchParams.set("serverId", serverId);
  } else {
    url.searchParams.delete("serverId");
  }
  return `${url.pathname.split("/").pop()}${url.search}`;
}

function normalizeSavedServerRoute(rawHref, serverIdFallback = activeServerId()) {
  const value = String(rawHref ?? "").trim();
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value, location.href);
  } catch {
    return null;
  }
  const match = parsed.pathname.match(/\/server\/([^/]+)(?:\/([^/?#]+))?/i);
  if (!match) return null;
  const serverId = match[1] || serverIdFallback;
  const section = String(match[2] ?? "").trim().toLowerCase();
  const pageName =
    !section ? "overview.html"
    : section === "console" ? "console.html"
    : section === "files" ? "files.html"
    : section === "backups" ? "backups.html"
    : section === "misc" ? "misc.html"
    : section === "settings" ? "settings.html"
    : section === "players" ? "players.html"
    : section === "worlds" ? "worlds.html"
    : section === "software" ? "software.html"
    : ["extensions", "addons", "mods", "add-ons"].includes(section) ? "addons-mods.html"
    : "overview.html";
  return buildLocalPageHref(pageName, serverId);
}

function serverPlaceholderDataUrl(serverName = "Releu") {
  const label = String(serverName ?? "Releu").trim() || "Releu";
  const letter = label.charAt(0).toUpperCase() || "R";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0f172a" />
          <stop offset="100%" stop-color="#1e293b" />
        </linearGradient>
      </defs>
      <rect width="160" height="160" rx="24" fill="url(#bg)" />
      <rect x="18" y="18" width="124" height="124" rx="18" fill="none" stroke="#334155" stroke-width="4" />
      <path d="M44 108V52h40c24 0 37 11 37 28 0 13-8 22-22 26l20 24H92L75 108H44zm29-21c13 0 20-4 20-12s-7-12-20-12H67v24h6z" fill="#e2e8f0"/>
      <circle cx="124" cy="36" r="8" fill="#60a5fa" opacity=".95" />
      <text x="80" y="142" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="13" fill="#64748b">${escapeHtml(letter)}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function updateLocalLinks() {
  const serverId = activeServerId();
  document.querySelectorAll('a[href$=".html"], a[href*=".html?"]').forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (!href || /^https?:/i.test(href) || href.startsWith("javascript:")) return;
    const fileName = href.split("?")[0].split("/").pop();
    if (!fileName) return;
    anchor.setAttribute("href", buildLocalPageHref(fileName, serverId));
  });
  document.querySelectorAll("a[href]").forEach((anchor) => {
    const localHref = normalizeSavedServerRoute(anchor.getAttribute("href"), serverId);
    if (localHref) {
      anchor.setAttribute("href", localHref);
    }
  });
  document.querySelectorAll("[x-on\\:click],[x-on\\:auxclick\\.prevent]").forEach((node) => {
    const clickValue = node.getAttribute("x-on:click") ?? "";
    const auxValue = node.getAttribute("x-on:auxclick.prevent") ?? "";
    const clickMatch = clickValue.match(/Livewire\.navigate\((['"])(.+?)\1\)/i);
    const auxMatch = auxValue.match(/window\.open\((['"])(.+?)\1/i);
    const localHref = normalizeSavedServerRoute(clickMatch?.[2] ?? auxMatch?.[2] ?? "", serverId);
    if (!localHref) return;
    node.removeAttribute("x-on:click");
    node.removeAttribute("x-on:auxclick.prevent");
    node.dataset.releuRoute = localHref;
  });
}

function updateChrome(state) {
  document.title = `${PAGE.replace(".html", "")} - Releu`;
  document.querySelectorAll(".fi-logo").forEach((node) => {
    node.textContent = "Releu";
  });
  const activeSummary =
    state?.servers?.find((entry) => entry.id === state?.activeServerId) ?? null;
  const iconUrl =
    state?.activeServer?.iconUrl ??
    activeSummary?.iconUrl ??
    serverPlaceholderDataUrl(state?.activeServer?.name ?? activeSummary?.name ?? "Releu");
  const iconAlt = `Icon of ${state?.activeServer?.name ?? activeSummary?.name ?? "Releu"}`;
  const tenantName = document.querySelector(".fi-tenant-menu-trigger-tenant-name");
  if (tenantName) {
    tenantName.textContent = state.activeServer?.name ?? "Releu";
  }
  document.querySelectorAll(".fi-tenant-avatar").forEach((node) => {
    node.setAttribute("src", iconUrl);
    node.setAttribute("alt", iconAlt);
  });
  document.querySelectorAll(".fi-user-avatar").forEach((node) => {
    node.setAttribute("src", iconUrl);
    node.setAttribute("alt", iconAlt);
  });
  updateLocalLinks();
  ensureServersSidebarLink();
  ensureMiscSidebarLink();
  stripReleaseBranding();
  stripUnusedTopbarChrome();
}

function currentUiSettings() {
  return APP_STATE.state?.uiSettings ?? {
    variant: "classic",
    hasChosenVariant: false,
  };
}

function buildLegacyUiUrl(serverId = activeServerId()) {
  return serverId ? `/?serverId=${encodeURIComponent(serverId)}` : "/";
}

function buildPelicanUiUrl(serverId = activeServerId()) {
  return serverId
    ? `/pelican-demo/servers.html?serverId=${encodeURIComponent(serverId)}`
    : "/pelican-demo/servers.html";
}

function maybeRedirectToPreferredUi() {
  const uiSettings = currentUiSettings();
  if (!uiSettings.hasChosenVariant) {
    return false;
  }
  if (String(uiSettings.variant ?? "").trim().toLowerCase() === "pelican-blueprint") {
    return false;
  }
  if (!window.location.pathname.startsWith("/pelican-demo/")) {
    return false;
  }
  window.location.replace(buildLegacyUiUrl());
  return true;
}

async function api(url, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 0) || 0);
  const controller = timeoutMs ? new AbortController() : null;
  let timeoutId = null;
  if (controller) {
    timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller?.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error ?? `Request failed (${response.status}).`);
    }
    return payload;
  } catch (error) {
    if (controller && error?.name === "AbortError") {
      throw new Error(
        options.timeoutMessage ??
          `The request timed out after ${Math.max(1, Math.round(timeoutMs / 1000))} seconds.`,
      );
    }
    throw error;
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function refreshCloudBackupStatus(force = false) {
  if (APP_STATE.cloudBackup.loading) {
    return APP_STATE.cloudBackup.status;
  }
  if (
    !force &&
    APP_STATE.cloudBackup.status &&
    Date.now() - APP_STATE.cloudBackup.lastFetchedAt < 15000
  ) {
    return APP_STATE.cloudBackup.status;
  }

  APP_STATE.cloudBackup.loading = true;
  try {
    const query = activeServerId() ? `?serverId=${encodeURIComponent(activeServerId())}` : "";
    const payload = await api(`/api/cloud-backup/status${query}`);
    APP_STATE.cloudBackup.status = payload.cloudBackup ?? null;
    APP_STATE.cloudBackup.lastFetchedAt = Date.now();
    return APP_STATE.cloudBackup.status;
  } finally {
    APP_STATE.cloudBackup.loading = false;
  }
}

async function refreshState(serverId = getRequestedServerId()) {
  const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
  const payload = await api(`/api/state${query}`);
  APP_STATE.state = payload.state;
  if (maybeRedirectToPreferredUi()) {
    return APP_STATE.state;
  }
  if (payload.state?.activeServerId) {
    persistServerId(payload.state.activeServerId);
    syncServerIdInLocation(payload.state.activeServerId);
  }
  updateChrome(payload.state);
  return payload.state;
}

async function refreshLogs() {
  const serverId = activeServerId();
  const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
  const payload = await api(`/api/logs${query}`);
  APP_STATE.logs = payload.entries ?? [];
  return APP_STATE.logs;
}

async function selectServer(serverId) {
  await api(`/api/servers/${encodeURIComponent(serverId)}/select`, { method: "POST" });
  persistServerId(serverId);
  return refreshState(serverId);
}

async function fetchVersions(softwareId) {
  if (!softwareId) return [];
  if (APP_STATE.versionsBySoftware.has(softwareId)) {
    return APP_STATE.versionsBySoftware.get(softwareId);
  }
  const payload = await api(`/api/software/versions?software=${encodeURIComponent(softwareId)}`);
  const versions = payload.versions ?? [];
  APP_STATE.versionsBySoftware.set(softwareId, versions);
  return versions;
}

function softwareDisplayName(id) {
  return APP_STATE.state?.softwareOptions?.find((entry) => entry.id === id)?.name ?? id ?? "Unknown";
}

function formatOperationLabel(server) {
  const operation = server?.server?.operation ?? server?.operation;
  if (operation?.active) {
    return operation.shortLabel || operation.title || operation.type || "Working";
  }
  const status = server?.server?.status ?? server?.status ?? "stopped";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function setButtonBusy(button, busy, label = null) {
  if (!button) return;
  if (busy) {
    button.dataset.releuOriginalText = button.textContent.trim();
    button.disabled = true;
    button.textContent = label ?? "Loading...";
  } else {
    button.disabled = false;
    if (button.dataset.releuOriginalText) {
      button.textContent = button.dataset.releuOriginalText;
      delete button.dataset.releuOriginalText;
    }
  }
}

function getMatchingTunnel(state, port) {
  const tunnels = state?.playit?.tunnels ?? [];
  return (
    tunnels.find((entry) => Number(entry.localPort ?? 0) === Number(port)) ??
    tunnels.find((entry) => entry.publicAddress) ??
    null
  );
}

function getPublicAddress(state, server) {
  const port = Number(server?.server?.properties?.["server-port"] ?? server?.port ?? 25565);
  return getMatchingTunnel(state, port)?.publicAddress ?? null;
}

function resolvedServerIconUrl(server) {
  if (server?.iconUrl) return server.iconUrl;
  const active = activeServer();
  if (active?.id === server?.id && active?.iconUrl) return active.iconUrl;
  return serverPlaceholderDataUrl(server?.name ?? "Releu");
}

function getPublicAddressDescription(state, server) {
  const publicAddress = getPublicAddress(state, server);
  return publicAddress
    ? { value: publicAddress, description: "Public join address from the linked playit agent." }
    : {
        value: "Run Server To Get Address",
        description:
          state?.playit?.statusMessage ??
          "Link playit.gg once, then start the server to get a public join address.",
      };
}

async function normalizeServerIconUpload(file) {
  if (!file) {
    throw new Error("Choose an icon file first.");
  }
  if (!window.createImageBitmap) {
    return {
      fileName: file.name || "server-icon.png",
      bytes: await file.arrayBuffer(),
    };
  }
  const bitmap = await window.createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) {
      return {
        fileName: file.name || "server-icon.png",
        bytes: await file.arrayBuffer(),
      };
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, 64, 64);
    context.drawImage(bitmap, 0, 0, 64, 64);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Unable to convert the server icon to PNG."))), "image/png"),
    );
    return {
      fileName: "server-icon.png",
      bytes: await blob.arrayBuffer(),
    };
  } finally {
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

function getRecentServerLogs(limit = 40) {
  const serverId = activeServerId();
  return APP_STATE.logs.filter((entry) => !entry.serverId || entry.serverId === serverId).slice(-limit);
}

function toLogBlock(limit = 40) {
  return (
    visibleLogs()
      .filter((entry) => !entry.serverId || entry.serverId === activeServerId())
      .slice(-limit)
      .map((entry) => `[${formatDate(entry.timestamp)}] [${entry.source}] ${entry.message}`)
      .join("\n") || "[panel] No logs yet."
  );
}

function patchServersPage() {
  const state = APP_STATE.state;
  const originalContent = document.querySelector(".fi-ta-content-ctn");
  const pageContent = document.querySelector(".fi-page-content") ?? document.querySelector("main");
  if (!originalContent || !pageContent) return;
  originalContent.style.display = "none";
  let mount = document.querySelector("[data-releu-servers-mount]");
  if (!mount) {
    mount = document.createElement("section");
    mount.dataset.releuServersMount = "true";
    mount.className = "fi-section";
    originalContent.before(mount);
  }
  const servers = state.servers ?? [];
  const hostCpuCores = Math.max(1, Number(state.host?.cpuCores ?? 1));
  const hostMemoryMb = Math.max(1024, Number(state.host?.totalMemoryMb ?? 4096));
  const formatRatio = (value, total, suffix = "") =>
    `${Number(value).toLocaleString()}${suffix} / ${Number(total).toLocaleString()}${suffix}`;
  mount.innerHTML = `<div class="fi-section-content-ctn"><div class="fi-section-content"><div class="flex flex-col gap-6">${
    servers.length
    ? servers
        .map((server) => {
          const localPort = Number(server.server?.properties?.["server-port"] ?? server.port ?? 25565);
          const publicAddress = getPublicAddress(state, server);
          const addressValue = publicAddress || `127.0.0.1:${localPort}`;
          const addressLabel = publicAddress ? "Public Address" : "Local Address";
          const software = softwareDisplayName(server.install?.installedSoftware ?? server.install?.software);
          const version = server.install?.installedVersion ?? server.install?.requestedVersion ?? "latest";
          const launcher = server.launcher ?? {};
          const requestedCpuCores = Math.max(0, Number(launcher.cpuCores ?? 0) || 0);
          const allocatedCpuCores = requestedCpuCores > 0 ? Math.min(hostCpuCores, requestedCpuCores) : hostCpuCores;
          const allocatedCpuPercent = Math.max(8, Math.min(100, Math.round((allocatedCpuCores / hostCpuCores) * 100)));
          const allocatedRamMaxMb = Math.max(
            512,
            ramStringToMb(launcher.maxRam, Number(server.metrics?.ramMaxMb ?? 4096) || 4096),
          );
          const allocatedRamMinMb = Math.max(
            512,
            ramStringToMb(launcher.minRam, Number(server.metrics?.ramMinMb ?? 2048) || 2048),
          );
          const allocatedRamPercent = Math.max(
            8,
            Math.min(100, Math.round((allocatedRamMaxMb / hostMemoryMb) * 100)),
          );
          const gpuShare = Math.max(0, Math.min(100, Number(launcher.gpuShare ?? 0) || 0));
          const gpuPercent = gpuShare > 0 ? gpuShare : 6;
          const tone =
            server.status === "running"
              ? { color: "rgb(34 197 94)", label: "Online" }
              : server.status === "starting" || server.status === "stopping"
                ? { color: "rgb(234 179 8)", label: formatOperationLabel(server) }
                : { color: "rgb(148 163 184)", label: "Offline" };
          const serverIcon = resolvedServerIconUrl(server);
          return `
            <div class="fi-ta-record rounded-xl border border-white/10 bg-[rgba(255,255,255,0.02)] p-6 shadow-sm" data-server-id="${escapeHtml(server.id)}">
              <div class="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
                <div class="flex min-w-0 flex-1 items-start gap-5">
                  <div class="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[#11161f]">
                    <img src="${escapeHtml(serverIcon)}" alt="${escapeHtml(server.name)} icon" class="h-full w-full object-cover">
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-3">
                      <span class="inline-flex h-3 w-3 rounded-full" style="background:${tone.color};"></span>
                      <h3 class="truncate text-2xl font-semibold text-white">${escapeHtml(server.name)}</h3>
                      <span class="text-sm font-medium" style="color:${tone.color};">${escapeHtml(tone.label)}</span>
                    </div>
                    <p class="mt-2 text-sm text-slate-400">${escapeHtml(server.description || `${software} ${version}`)}</p>
                    <div class="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-400">
                      <span><span class="text-slate-500">${escapeHtml(addressLabel)}:</span> <span class="font-medium text-slate-200">${escapeHtml(addressValue)}</span></span>
                      <span><span class="text-slate-500">Software:</span> <span class="font-medium text-slate-200">${escapeHtml(`${software} ${version}`)}</span></span>
                      <span><span class="text-slate-500">Port:</span> <span class="font-medium text-slate-200">${escapeHtml(String(localPort))}</span></span>
                    </div>
                  </div>
                </div>
                <div class="flex flex-wrap gap-3 xl:justify-end">
                  <button class="fi-btn fi-btn-color-primary fi-size-sm" type="button" data-server-id="${escapeHtml(server.id)}" data-control="${server.status === "running" ? "stop" : "start"}">${server.status === "running" ? "Stop" : "Start"}</button>
                  <button class="fi-btn fi-size-sm fi-ac-btn-action" type="button" data-server-id="${escapeHtml(server.id)}" data-page="overview.html">Open</button>
                  <button class="fi-btn fi-size-sm fi-ac-btn-action" type="button" data-server-id="${escapeHtml(server.id)}" data-delete-server="true">Delete</button>
                </div>
              </div>
              <div class="mt-6 grid gap-4 lg:grid-cols-3">
                <div class="rounded-xl border border-white/10 bg-[#0f141b] px-4 py-4">
                  <div class="text-xs uppercase tracking-[0.18em] text-slate-500">CPU Allocation</div>
                  <div class="mt-3 h-3 overflow-hidden rounded-full bg-[rgba(59,130,246,0.15)]" role="progressbar" aria-valuenow="${allocatedCpuPercent}" aria-valuemin="0" aria-valuemax="100">
                    <div class="h-full rounded-full bg-[rgb(59,130,246)]" style="width:${allocatedCpuPercent}%"></div>
                  </div>
                  <div class="mt-3 text-sm text-slate-300">${escapeHtml(formatRatio(allocatedCpuCores, hostCpuCores, " cores"))}</div>
                </div>
                <div class="rounded-xl border border-white/10 bg-[#0f141b] px-4 py-4">
                  <div class="text-xs uppercase tracking-[0.18em] text-slate-500">RAM Allocation</div>
                  <div class="mt-3 h-3 overflow-hidden rounded-full bg-[rgba(34,197,94,0.15)]" role="progressbar" aria-valuenow="${allocatedRamPercent}" aria-valuemin="0" aria-valuemax="100">
                    <div class="h-full rounded-full bg-[rgb(34,197,94)]" style="width:${allocatedRamPercent}%"></div>
                  </div>
                  <div class="mt-3 text-sm text-slate-300">${escapeHtml(`${formatMb(allocatedRamMaxMb)} / ${formatMb(hostMemoryMb)}`)}</div>
                  <div class="mt-1 text-xs text-slate-500">Min ${escapeHtml(formatMb(allocatedRamMinMb))}</div>
                </div>
                <div class="rounded-xl border border-white/10 bg-[#0f141b] px-4 py-4">
                  <div class="text-xs uppercase tracking-[0.18em] text-slate-500">GPU Share</div>
                  <div class="mt-3 h-3 overflow-hidden rounded-full bg-[rgba(168,85,247,0.15)]" role="progressbar" aria-valuenow="${gpuPercent}" aria-valuemin="0" aria-valuemax="100">
                    <div class="h-full rounded-full bg-[rgb(168,85,247)]" style="width:${gpuPercent}%"></div>
                  </div>
                  <div class="mt-3 text-sm text-slate-300">${escapeHtml(`${gpuShare}% / 100%`)}</div>
                </div>
              </div>
              <div class="mt-5 flex flex-wrap gap-3">
                ${[
                  ["Overview", "overview.html"],
                  ["Console", "console.html"],
                  ["Players", "players.html"],
                  ["Files", "files.html"],
                  ["Backups", "backups.html"],
                  ["Worlds", "worlds.html"],
                  ["Add-ons / Mods", "addons-mods.html"],
                  ["Software", "software.html"],
                  ["Misc", "misc.html"],
                  ["Settings", "settings.html"],
                ]
                  .map(
                    ([label, page]) =>
                      `<button class="fi-btn fi-size-sm fi-ac-btn-action" type="button" data-server-id="${escapeHtml(server.id)}" data-page="${escapeHtml(page)}">${escapeHtml(label)}</button>`,
                  )
                  .join("")}
              </div>
            </div>`;
        })
        .join("")
    : `<div class="rounded-lg border border-dashed border-gray-700 px-6 py-8 text-center text-gray-400">No servers yet. Use Add Server to create the first one.</div>`
  }</div></div></div>`;
  document.querySelectorAll(".fi-pagination-overview").forEach((node) => {
    node.textContent = `Showing ${servers.length} result${servers.length === 1 ? "" : "s"}`;
  });

  [...document.querySelectorAll(".fi-btn, .fi-ac-btn-action")]
    .filter((button) => /add server/i.test(button.textContent))
    .forEach((button) => {
      if (button.dataset.releuBound) return;
      button.dataset.releuBound = "true";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        navigateTo(buildLocalPageHref("create-server.html"));
      });
    });

  mount.querySelectorAll(".fi-ta-record[data-server-id]").forEach((card) => {
    if (card.dataset.releuCardBound === "true") return;
    card.dataset.releuCardBound = "true";
    card.addEventListener("click", async (event) => {
      if (event.target.closest("button")) return;
      try {
        await selectServer(card.dataset.serverId);
        navigateTo(buildLocalPageHref("overview.html", card.dataset.serverId));
      } catch (error) {
        showError(error);
      }
    });
  });

  mount.querySelectorAll("button[data-page]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      try {
        setButtonBusy(button, true);
        await selectServer(button.dataset.serverId);
        navigateTo(buildLocalPageHref(button.dataset.page, button.dataset.serverId));
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  mount.querySelectorAll("[data-control]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        setButtonBusy(button, true);
        await api(`/api/servers/${encodeURIComponent(button.dataset.serverId)}/server/${button.dataset.control}`, { method: "POST" });
        await refreshState(button.dataset.serverId);
        patchServersPage();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  mount.querySelectorAll("[data-delete-server]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const server = servers.find((entry) => entry.id === button.dataset.serverId);
      if (!window.confirm(`Delete server "${server?.name ?? button.dataset.serverId}"?`)) return;
      try {
        setButtonBusy(button, true, "Deleting...");
        await api(`/api/servers/${encodeURIComponent(button.dataset.serverId)}/delete`, { method: "POST" });
        await refreshState();
        patchServersPage();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  return;
  content.innerHTML = servers.length
    ? servers
        .map((server) => {
          const localPort = Number(server.server?.properties?.["server-port"] ?? server.port ?? 25565);
          const publicAddress = getPublicAddress(state, server);
          const addressValue = publicAddress || `127.0.0.1:${localPort}`;
          const addressLabel = publicAddress ? "Public Address" : "Local Address";
          const software = softwareDisplayName(server.install?.installedSoftware ?? server.install?.software);
          const version = server.install?.installedVersion ?? server.install?.requestedVersion ?? "latest";
          const cpu = Math.round(server.metrics?.cpuPercent ?? 0);
          const ramMax = Number(server.metrics?.ramMaxMb ?? 0);
          const ramUsed = Number(server.metrics?.ramUsedMb ?? 0);
          const ramPercent = ramMax > 0 ? Math.min(100, Math.round((ramUsed / ramMax) * 100)) : 0;
          const tone =
            server.status === "running"
              ? { color: "rgb(34 197 94)", label: "Online" }
              : server.status === "starting" || server.status === "stopping"
                ? { color: "rgb(234 179 8)", label: formatOperationLabel(server) }
                : { color: "rgb(148 163 184)", label: "Offline" };
          const backgroundStyle = `background: url('${escapeHtml(resolvedServerIconUrl(server))}') right no-repeat; background-size: contain; opacity: 0.20; max-width: 680px; max-height: 140px;`;
          return `
            <section class="fi-section">
              <div class="fi-section-content-ctn">
                <div class="fi-section-content">
                  <div class="relative cursor-pointer" data-page="overview.html" data-server-id="${escapeHtml(server.id)}">
                    <div class="absolute left-0 top-1 bottom-0 w-1 rounded-lg" style="background-color:${tone.color};"></div>
                    <div class="relative flex-1 dark:bg-gray-800 dark:text-white rounded-lg overflow-hidden p-3">
                      <div style="position:absolute;inset:0;${backgroundStyle}"></div>
                      <div class="relative flex items-center gap-2 mb-5">
                        <button class="fi-icon-btn fi-size-lg" title="${escapeHtml(tone.label)}" aria-label="${escapeHtml(tone.label)}" type="button">
                          <svg class="fi-icon fi-size-lg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${tone.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                            <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path>
                            <path d="M9 10h.01"></path>
                            <path d="M15 10h.01"></path>
                            <path d="M9.5 15a5 5 0 0 1 5 0"></path>
                          </svg>
                        </button>
                        <h2 class="text-xl font-bold">
                          ${escapeHtml(server.name)}
                          <span class="dark:text-gray-400">(${escapeHtml(tone.label)})</span>
                        </h2>
                      </div>
                      <div class="relative text-left mb-1 ml-4 pl-4">
                        <p class="text-base dark:text-gray-400">${escapeHtml(server.description || server.serverDir)}</p>
                      </div>
                      <div class="relative flex justify-between text-center items-center gap-4">
                        <div class="w-full max-w-xs">
                          <div class="fi-ta-text block w-full px-3">
                            <div class="flex flex-col gap-2">
                              <div class="relative rounded-full overflow-hidden w-full" style="height: 0.725rem; background-color: rgba(34, 197, 94, 0.15);" role="progressbar" aria-valuenow="${cpu}" aria-valuemin="0" aria-valuemax="100" aria-label="CPU">
                                <div class="h-full rounded-full transition-all duration-300 ease-in-out" style="width: ${cpu}%; background-color: rgb(34 197 94);"></div>
                              </div>
                              <span class="text-sm text-center text-gray-500 dark:text-gray-400">${cpu}% CPU</span>
                            </div>
                          </div>
                        </div>
                        <div class="w-full max-w-xs">
                          <div class="fi-ta-text block w-full px-3">
                            <div class="flex flex-col gap-2">
                              <div class="relative rounded-full overflow-hidden w-full" style="height: 0.725rem; background-color: rgba(59, 130, 246, 0.15);" role="progressbar" aria-valuenow="${ramPercent}" aria-valuemin="0" aria-valuemax="100" aria-label="Memory">
                                <div class="h-full rounded-full transition-all duration-300 ease-in-out" style="width: ${ramPercent}%; background-color: rgb(59 130 246);"></div>
                              </div>
                              <span class="text-sm text-center text-gray-500 dark:text-gray-400">${formatMb(ramUsed)} / ${formatMb(ramMax)}</span>
                            </div>
                          </div>
                        </div>
                        <div class="hidden sm:block">
                          <p class="text-sm dark:text-gray-400">${escapeHtml(addressLabel)}</p>
                          <p class="text-md font-semibold">${escapeHtml(addressValue)}</p>
                          <p class="mt-1 text-xs text-gray-500">${escapeHtml(publicAddress ? `${software} ${version}` : `Local target 127.0.0.1:${localPort} • ${software} ${version}`)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="mt-4 flex flex-wrap gap-3 pl-6">
                    ${[
                      ["Overview", "overview.html"],
                      ["Console", "console.html"],
                      ["Players", "players.html"],
                      ["Files", "files.html"],
                      ["Backups", "backups.html"],
                      ["Worlds", "worlds.html"],
                      ["Add-ons / Mods", "addons-mods.html"],
                      ["Software", "software.html"],
                      ["Misc", "misc.html"],
                      ["Settings", "settings.html"],
                    ]
                      .map(
                        ([label, page]) =>
                          `<button class="fi-btn fi-size-md fi-ac-btn-action" type="button" data-server-id="${escapeHtml(server.id)}" data-page="${escapeHtml(page)}">${escapeHtml(label)}</button>`,
                      )
                      .join("")}
                    <button class="fi-btn fi-size-md fi-ac-btn-action" type="button" data-server-id="${escapeHtml(server.id)}" data-control="${server.status === "running" ? "stop" : "start"}">${server.status === "running" ? "Stop" : "Start"}</button>
                    <button class="fi-btn fi-size-md fi-ac-btn-action" type="button" data-server-id="${escapeHtml(server.id)}" data-delete-server="true">Delete</button>
                  </div>
                </div>
              </div>
            </section>`;
        })
        .join("")
    : `<section class="fi-section"><div class="fi-section-content-ctn"><div class="fi-section-content"><div class="rounded-lg border border-dashed border-gray-700 px-6 py-8 text-center text-gray-400">No servers yet. Use Add Server to create the first one.</div></div></div></section>`;

  [...document.querySelectorAll(".fi-btn, .fi-ac-btn-action")]
    .filter((button) => /add server/i.test(button.textContent))
    .forEach((button) => {
      if (button.dataset.releuBound) return;
      button.dataset.releuBound = "true";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        navigateTo(buildLocalPageHref("create-server.html"));
      });
    });

  content.querySelectorAll('[data-page="overview.html"][data-server-id]').forEach((card) => {
    if (card.dataset.releuBound) return;
    card.dataset.releuBound = "true";
    card.addEventListener("click", async () => {
      try {
        await selectServer(card.dataset.serverId);
        navigateTo(buildLocalPageHref("overview.html", card.dataset.serverId));
      } catch (error) {
        showError(error);
      }
    });
  });

  content.querySelectorAll("button[data-page]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        setButtonBusy(button, true);
        await selectServer(button.dataset.serverId);
        navigateTo(buildLocalPageHref(button.dataset.page, button.dataset.serverId));
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  content.querySelectorAll("[data-control]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        setButtonBusy(button, true);
        await api(`/api/servers/${encodeURIComponent(button.dataset.serverId)}/server/${button.dataset.control}`, { method: "POST" });
        await refreshState(button.dataset.serverId);
        patchServersPage();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  content.querySelectorAll("[data-delete-server]").forEach((button) => {
    button.addEventListener("click", async () => {
      const server = servers.find((entry) => entry.id === button.dataset.serverId);
      if (!window.confirm(`Delete server "${server?.name ?? button.dataset.serverId}"?`)) return;
      try {
        setButtonBusy(button, true, "Deleting...");
        await api(`/api/servers/${encodeURIComponent(button.dataset.serverId)}/delete`, { method: "POST" });
        await refreshState();
        patchServersPage();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
}

function patchServersPageExactShell() {
  const state = APP_STATE.state;
  const originalContent = document.querySelector(".fi-ta-content-ctn");
  if (!originalContent) return;
  document.querySelector("[data-releu-servers-mount]")?.remove();
  originalContent.style.display = "";

  const templateCard = originalContent.querySelector(".fi-ta-record");
  const recordsParent = templateCard?.parentElement;
  const servers = state?.servers ?? [];
  if (!templateCard || !recordsParent) return;

  const patchProgressBlock = (block, widthPercent, labelText, fillColor) => {
    const progress = block.querySelector('[role="progressbar"]');
    const fill = progress?.querySelector("div");
    const label = block.querySelector("span");
    if (progress) {
      progress.setAttribute("aria-valuenow", String(Math.round(widthPercent)));
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-label", labelText);
    }
    if (fill) {
      fill.style.width = `${Math.max(0, Math.min(100, widthPercent))}%`;
      fill.style.backgroundColor = fillColor;
    }
    if (label) {
      label.textContent = labelText;
    }
  };

  const patchServerCard = (card, server) => {
    const localPort = Number(server.server?.properties?.["server-port"] ?? server.port ?? 25565);
    const publicAddress = getPublicAddress(state, server);
    const addressValue = publicAddress || `127.0.0.1:${localPort}`;
    const software = softwareDisplayName(server.install?.installedSoftware ?? server.install?.software);
    const version = server.install?.installedVersion ?? server.install?.requestedVersion ?? "latest";
    const launcher = server.launcher ?? {};
    const allocatedRamMaxMb = Math.max(
      512,
      ramStringToMb(launcher.maxRam, Number(server.metrics?.ramMaxMb ?? 4096) || 4096),
    );
    const liveCpuPercent = Math.max(0, Number(server.metrics?.cpuPercent ?? 0) || 0);
    const liveRamUsedMb = Math.max(0, Number(server.metrics?.ramUsedMb ?? 0) || 0);
    const liveRamPercent =
      allocatedRamMaxMb > 0 ? Math.max(0, Math.min(100, (liveRamUsedMb / allocatedRamMaxMb) * 100)) : 0;
    const gpuShare = Math.max(0, Math.min(100, Number(launcher.gpuShare ?? 0) || 0));
    const tone =
      server.status === "running"
        ? { color: "rgb(34 197 94)", label: "Online" }
        : server.status === "starting" || server.status === "stopping"
          ? { color: "rgb(234 179 8)", label: formatOperationLabel(server) }
          : { color: "rgb(148 163 184)", label: "Offline" };

    card.dataset.serverId = server.id;
    card.dataset.releuServerCard = "true";

    const statusRail = card.querySelector(".absolute.left-0");
    if (statusRail) {
      statusRail.style.backgroundColor = tone.color;
    }

    const title = card.querySelector("h2");
    if (title) {
      title.innerHTML = `${escapeHtml(server.name)} <span class="dark:text-gray-400">(${escapeHtml(tone.label)})</span>`;
    }

    const topButtons = card.querySelectorAll("button");
    if (topButtons[0]) {
      topButtons[0].title = tone.label;
      topButtons[0].setAttribute("aria-label", tone.label);
      topButtons[0].innerHTML = `
        <svg class="fi-icon fi-size-lg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${tone.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
          <circle cx="12" cy="12" r="9"></circle>
          <circle cx="12" cy="12" r="3" fill="${tone.color}" stroke="none"></circle>
        </svg>`;
    }
    if (topButtons[1]) {
      topButtons[1].title = server.status === "running" ? "Stop server" : "Start server";
      topButtons[1].setAttribute("aria-label", server.status === "running" ? "Stop server" : "Start server");
      topButtons[1].dataset.serverId = server.id;
      topButtons[1].dataset.control = server.status === "running" ? "stop" : "start";
    }

    const descriptionNode =
      card.querySelector(".relative.text-left p") ??
      [...card.querySelectorAll("p")].find((node) => node.textContent?.includes("Minecraft Test Server"));
    if (descriptionNode) {
      descriptionNode.textContent = server.description || `${software} ${version}`;
    }

    const backgroundOverlay = [...card.querySelectorAll("div")].find((node) =>
      String(node.getAttribute("style") ?? "").includes("background: url("),
    );
    if (backgroundOverlay) {
      backgroundOverlay.setAttribute(
        "style",
        `position:absolute;inset:0;background: url('${escapeHtml(resolvedServerIconUrl(server))}') right no-repeat; background-size: contain; opacity: 0.20; max-width: 680px; max-height: 140px;`,
      );
    }

    const statBlocks = card.querySelectorAll(".fi-ta-text .flex.flex-col.gap-2");
    if (statBlocks[0]) {
      patchProgressBlock(
        statBlocks[0],
        liveCpuPercent,
        `${Math.round(liveCpuPercent * 10) / 10}% / 100%`,
        "rgb(59 130 246)",
      );
    }
    if (statBlocks[1]) {
      patchProgressBlock(
        statBlocks[1],
        liveRamPercent,
        `${formatMb(liveRamUsedMb)} / ${formatMb(allocatedRamMaxMb)}`,
        "rgb(34 197 94)",
      );
    }
    if (statBlocks[2]) {
      patchProgressBlock(
        statBlocks[2],
        gpuShare,
        gpuShare > 0 ? `${gpuShare}% planned / 100%` : "0% planned / 100%",
        "rgb(168 85 247)",
      );
    }

    const networkLabel = [...card.querySelectorAll("p")].find((node) => node.textContent?.trim() === "Network");
    const networkValue = networkLabel?.parentElement?.querySelector("p.text-md, p.font-semibold");
    if (networkLabel) {
      networkLabel.textContent = publicAddress ? "Public Address" : "Local Address";
    }
    if (networkValue) {
      networkValue.textContent = addressValue;
    }

    if (card.dataset.releuCardBound !== "true") {
      card.dataset.releuCardBound = "true";
      card.addEventListener("click", async (event) => {
        if (event.target.closest("button")) return;
        try {
          await selectServer(card.dataset.serverId);
          navigateTo(buildLocalPageHref("overview.html", card.dataset.serverId));
        } catch (error) {
          showError(error);
        }
      });
    }
  };

  recordsParent.innerHTML = "";
  if (servers.length) {
    servers.forEach((server) => {
      const card = templateCard.cloneNode(true);
      patchServerCard(card, server);
      recordsParent.append(card);
    });
  } else {
    const empty = document.createElement("div");
    empty.className = "rounded-lg border border-dashed border-gray-700 px-6 py-8 text-center text-gray-400";
    empty.textContent = "No servers yet. Use Add Server to create the first one.";
    recordsParent.append(empty);
  }

  document.querySelectorAll(".fi-pagination-overview").forEach((node) => {
    node.textContent = `Showing ${servers.length} result${servers.length === 1 ? "" : "s"}`;
  });

  [...document.querySelectorAll(".fi-btn, .fi-ac-btn-action")]
    .filter((button) => /add server/i.test(button.textContent))
    .forEach((button) => {
      if (button.dataset.releuBound) return;
      button.dataset.releuBound = "true";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        navigateTo(buildLocalPageHref("create-server.html"));
      });
    });

  originalContent.querySelectorAll("[data-control]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        setButtonBusy(button, true);
        await api(`/api/servers/${encodeURIComponent(button.dataset.serverId)}/server/${button.dataset.control}`, { method: "POST" });
        await refreshState(button.dataset.serverId);
        patchServersPageExactShell();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
}

function ensureCreateNamePanel() {
  const root = document.querySelector(".psw-root");
  if (!root || root.querySelector("[data-create-name-panel]")) return;
  const panel = document.createElement("div");
  panel.className = "psw-panel";
  panel.dataset.createNamePanel = "true";
  panel.innerHTML = `
    <div class="psw-panel-head">Create Server</div>
    <div class="psw-panel-body">
      <div class="psw-java-row">
        <span class="psw-java-label">Server Name</span>
        <div class="psw-java-input-wrap">
          <span class="psw-java-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/></svg></span>
          <input type="text" class="psw-input" data-create-server-name placeholder="Primary Server">
        </div>
      </div>
      <div class="mt-4 text-xs text-slate-500" data-create-status>Releu will create the folder automatically and pick a free port.</div>
    </div>`;
  root.prepend(panel);
}

function buildCreateDraft() {
  return { name: "", software: "purpur", version: "latest", minRamMb: 1024, maxRamMb: 4096, cpuCores: 4, gpuShare: 0, javaPath: "/usr/bin/java" };
}

function buildSoftwareDraft(server) {
  const launcher = server?.launcher ?? {};
  return {
    serverId: server?.id ?? activeServerId(),
    software: server?.install?.installedSoftware ?? server?.install?.software ?? "purpur",
    version: server?.install?.installedVersion ?? server?.install?.requestedVersion ?? "latest",
    maxRamMb: Number(String(launcher.maxRam ?? "4096").replace(/[^\d]/g, "")) || 4096,
    minRamMb: Number(String(launcher.minRam ?? "1024").replace(/[^\d]/g, "")) || 1024,
    cpuCores: Number(launcher.cpuCores ?? 0) || 0,
    gpuShare: Number(launcher.gpuShare ?? 0) || 0,
    javaPath: launcher.javaPath ?? "java",
  };
}

function ensureSoftwareDraft(server) {
  if (!server) return null;
  if (!APP_STATE.softwareDraft || APP_STATE.softwareDraft.serverId !== server.id) {
    APP_STATE.softwareDraft = buildSoftwareDraft(server);
  }
  return APP_STATE.softwareDraft;
}

function softwareIdFromLabel(label) {
  const normalized = String(label ?? "").trim().toLowerCase();
  if (normalized === "paper") return "paper";
  if (normalized === "vanilla") return "vanilla";
  if (normalized === "fabric") return "fabric";
  if (normalized === "forge") return "forge";
  if (normalized === "neoforge") return "neoforge";
  if (normalized.includes("forge") && normalized.includes("neo")) return "forge-family";
  return "purpur";
}

async function populateVersionSelect(select, softwareId, selectedVersion = "latest") {
  if (!select) return;
  const effectiveSoftware =
    softwareId === "forge-family"
      ? (activeServer()?.install?.installedSoftware === "neoforge" ? "neoforge" : "forge")
      : softwareId;
  const versions = await fetchVersions(effectiveSoftware);
  const options = versions.length ? versions : [{ id: "latest", label: "latest" }];
  select.innerHTML = options
    .map((entry) => {
      const value = entry.id ?? entry.version ?? entry;
      const label = entry.label ?? entry.version ?? entry.name ?? value;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  select.value = [...select.options].some((option) => option.value === selectedVersion) ? selectedVersion : select.options[0]?.value ?? "latest";
}

async function patchCreateServerPage() {
  ensureCreateNamePanel();
  APP_STATE.createDraft = APP_STATE.createDraft ?? buildCreateDraft();
  const hostCpu = Math.max(1, Number(APP_STATE.state?.host?.cpuCores ?? 4));
  const loaderCards = [...document.querySelectorAll(".psw-loader-card")];
  const versionSelect = document.querySelector(".psw-version-row .psw-select");
  const ranges = [...document.querySelectorAll(".psw-range")];
  const nameInput = document.querySelector("[data-create-server-name]");
  const statusText = document.querySelector("[data-create-status]");
  const javaInput = document.querySelector(".psw-java-row .psw-input");
  const installButton = [...document.querySelectorAll(".fi-btn.fi-ac-btn-action")].find((button) => /install|create/i.test(button.textContent));

  APP_STATE.createDraft.cpuCores = Math.min(APP_STATE.createDraft.cpuCores, hostCpu);
  APP_STATE.createDraft.javaPath = APP_STATE.state?.dependencies?.java?.preferredPath ?? APP_STATE.createDraft.javaPath;
  ranges[2]?.setAttribute("max", String(hostCpu));
  await populateVersionSelect(versionSelect, APP_STATE.createDraft.software, APP_STATE.createDraft.version);

  const syncRanges = () => {
    const values = [
      APP_STATE.createDraft.maxRamMb,
      APP_STATE.createDraft.minRamMb,
      APP_STATE.createDraft.cpuCores,
      APP_STATE.createDraft.gpuShare,
    ];
    ranges.forEach((input, index) => {
      input.value = String(values[index] ?? 0);
      const label = index === 3 ? `${values[index]}%` : index < 2 ? `${values[index]} MB` : String(values[index]);
      input.closest(".psw-range-row")?.querySelector(".psw-range-val")?.replaceChildren(document.createTextNode(label));
    });
    if (javaInput) javaInput.value = APP_STATE.createDraft.javaPath;
    if (nameInput) nameInput.value = APP_STATE.createDraft.name;
  };
  syncRanges();

  loaderCards.forEach((card) => {
    const softwareId = softwareIdFromLabel(card.querySelector(".psw-loader-name")?.textContent);
    card.classList.toggle("active", softwareId === APP_STATE.createDraft.software);
    if (card.dataset.releuBound) return;
    card.dataset.releuBound = "true";
    card.addEventListener("click", async () => {
      APP_STATE.createDraft.software = softwareId;
      APP_STATE.createDraft.version = "latest";
      loaderCards.forEach((entry) => entry.classList.toggle("active", entry === card));
      await populateVersionSelect(versionSelect, softwareId, "latest");
    });
  });

  versionSelect?.addEventListener("change", () => {
    APP_STATE.createDraft.version = versionSelect.value;
  });
  nameInput?.addEventListener("input", () => {
    APP_STATE.createDraft.name = nameInput.value;
  });
  javaInput?.addEventListener("input", () => {
    APP_STATE.createDraft.javaPath = javaInput.value;
  });
  ["maxRamMb", "minRamMb", "cpuCores", "gpuShare"].forEach((key, index) => {
    ranges[index]?.addEventListener("input", () => {
      APP_STATE.createDraft[key] = Number(ranges[index].value);
      if (key === "maxRamMb" && APP_STATE.createDraft.minRamMb > APP_STATE.createDraft.maxRamMb) APP_STATE.createDraft.minRamMb = APP_STATE.createDraft.maxRamMb;
      if (key === "minRamMb" && APP_STATE.createDraft.maxRamMb < APP_STATE.createDraft.minRamMb) APP_STATE.createDraft.maxRamMb = APP_STATE.createDraft.minRamMb;
      syncRanges();
    });
  });

  if (installButton && !installButton.dataset.releuBound) installButton.addEventListener("click", async () => {
    try {
      const name = String(nameInput?.value ?? "").trim();
      if (!name) throw new Error("Enter a server name first.");
      APP_STATE.createDraft.name = name;
      setButtonBusy(installButton, true, "Creating...");
      if (statusText) statusText.textContent = "Creating server record...";
      const created = await api("/api/servers", { method: "POST", body: { name, installNow: false, acceptEula: true } });
      APP_STATE.state = created.state;
      const serverId = created.state?.activeServerId;
      persistServerId(serverId);
      if (statusText) statusText.textContent = "Saving runtime settings...";
      await api(`/api/servers/${encodeURIComponent(serverId)}/settings/runtime`, {
        method: "POST",
        body: {
          javaPath: APP_STATE.createDraft.javaPath,
          minRam: `${APP_STATE.createDraft.minRamMb}M`,
          maxRam: `${APP_STATE.createDraft.maxRamMb}M`,
          cpuCores: APP_STATE.createDraft.cpuCores,
          gpuShare: APP_STATE.createDraft.gpuShare,
        },
      });
      if (statusText) statusText.textContent = "Installing server software...";
      await api(`/api/servers/${encodeURIComponent(serverId)}/install/server`, {
        method: "POST",
        body: {
          software: APP_STATE.createDraft.software,
          version: APP_STATE.createDraft.version,
          acceptEula: true,
        },
      });
      navigateTo(buildLocalPageHref("overview.html", serverId));
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(installButton, false);
    }
  }), installButton && (installButton.dataset.releuBound = "true");
}

function updateOverviewCardByLabel(label, value, description = null) {
  const cards = [...document.querySelectorAll(".pelican-stat-card")];
  const card = cards.find((entry) => entry.querySelector(".pelican-stat-label")?.textContent?.toLowerCase().includes(label.toLowerCase()));
  if (!card) return;
  const valueNode = card.querySelector(".pelican-stat-value");
  const descNode = card.querySelector(".pelican-stat-desc");
  if (valueNode) valueNode.textContent = value;
  if (descNode && description !== null) descNode.textContent = description;
}

async function sendServerCommand(command) {
  await api(`/api/servers/${encodeURIComponent(activeServerId())}/server/command`, {
    method: "POST",
    body: { command },
  });
}

function consoleHelpMarkup() {
  const commands = [
    ["?help", "Show Releu's command help without sending anything to Minecraft."],
    ["list", "Show players currently online."],
    ["say <message>", "Send a server chat announcement."],
    ["title @a title {...}", "Send a big screen title to everyone."],
    ["whitelist add <name>", "Add a player to the whitelist."],
    ["op <name>", "Grant operator access."],
    ["kick <name> <reason>", "Kick a player from the server."],
    ["save-all", "Force the world to save immediately."],
    ["stop", "Gracefully stop the Minecraft server."],
  ];
  return `
    <div data-releu-console-help class="mt-4 rounded-lg border border-[#2b3642] bg-[#0f141b] px-4 py-4 text-sm text-slate-300">
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="font-semibold text-slate-100">Console Help</div>
          <div class="mt-1 text-xs text-slate-400">These are direct Minecraft server commands. Releu only intercepts <span class="font-mono">?help</span>.</div>
        </div>
        <button type="button" class="fi-btn fi-size-sm fi-ac-btn-action" data-releu-console-help-close>Hide</button>
      </div>
      <div class="mt-4 grid gap-2">
        ${commands
          .map(
            ([command, description]) => `
              <div class="rounded-md border border-[#23303b] bg-[#111821] px-3 py-2">
                <div class="font-mono text-xs text-blue-200">${escapeHtml(command)}</div>
                <div class="mt-1 text-xs text-slate-400">${escapeHtml(description)}</div>
              </div>`,
          )
          .join("")}
      </div>
    </div>`;
}

function patchOverviewPage() {
  const state = APP_STATE.state;
  const server = activeServer();
  if (!server) return;
  const address = getPublicAddressDescription(state, server);
  const properties = server.server?.properties ?? {};
  const metrics = server.server?.metrics ?? {};
  const players = server.players ?? [];
  const maxPlayers = Number(properties["max-players"] ?? 20);
  updateOverviewCardByLabel("Minecraft IP", address.value, address.description);
  updateOverviewCardByLabel("Status", formatOperationLabel(server), `The server is ${server.server?.status ?? "stopped"}.`);
  updateOverviewCardByLabel("Software", `${softwareDisplayName(server.install?.installedSoftware ?? server.install?.software)} ${server.install?.installedVersion ?? server.install?.requestedVersion ?? "latest"}`, "Current runtime and version summary.");
  updateOverviewCardByLabel("Players", `${players.filter((entry) => entry.online).length} / ${maxPlayers}`, "Live player count and max slots.");
  updateOverviewCardByLabel("Port", String(properties["server-port"] ?? 25565), "Local server port.");
  updateOverviewCardByLabel("Active World", properties["level-name"] ?? "world", "Current active world folder.");
  const console = document.querySelector(".pelican-console-pre");
  if (console) {
    console.textContent = toLogBlock(50);
    console.scrollTop = console.scrollHeight;
  }
  const rows = [...document.querySelectorAll(".pelican-res-row")];
  const cpuRow = rows.find((row) => row.textContent.includes("CPU"));
  const memoryRow = rows.find((row) => row.textContent.includes("Memory"));
  const playerRow = rows.find((row) => row.textContent.includes("Players"));
  if (cpuRow) {
    cpuRow.querySelector(".pelican-res-val").textContent = `${Math.round(metrics.cpuPercent ?? 0)}% / 100%`;
    cpuRow.querySelector(".pelican-fill").style.width = `${Math.min(100, Math.round(metrics.cpuPercent ?? 0))}%`;
  }
  if (memoryRow) {
    const used = Number(metrics.ramUsedMb ?? 0);
    const max = Number(metrics.ramMaxMb ?? 0);
    memoryRow.querySelector(".pelican-res-val").textContent = `${used} MB / ${max} MB`;
    memoryRow.querySelector(".pelican-fill").style.width = `${max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0}%`;
  }
  if (playerRow) {
    const online = players.filter((entry) => entry.online).length;
    playerRow.querySelector(".pelican-res-val").textContent = `${online} / ${maxPlayers}`;
    playerRow.querySelector(".pelican-fill").style.width = `${maxPlayers > 0 ? Math.min(100, Math.round((online / maxPlayers) * 100)) : 0}%`;
  }
  const rightCol = document.querySelector(".pelican-right-col");
  if (rightCol && !rightCol.querySelector("[data-releu-broadcast-panel]")) {
    const panel = document.createElement("div");
    panel.className = "pelican-panel";
    panel.dataset.releuBroadcastPanel = "true";
    panel.innerHTML = `
      <div class="pelican-panel-head"><span class="releu-panel-title"><svg class="releu-panel-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9-9"/><path d="M4 5v6h6"/><path d="M20 13a9 9 0 0 1-9 9"/><path d="M20 19v-6h-6"/><path d="M8 12h8"/><path d="M12 8v8"/></svg><span>Broadcast Title</span></span></div>
      <div class="pelican-panel-body">
        <form data-releu-broadcast-form style="display:flex;flex-direction:column;gap:.75rem">
          <div>
            <label class="pelican-res-name" style="display:block;margin-bottom:.35rem">Main Title</label>
            <input class="fi-input" name="title" type="text" maxlength="120" placeholder="Server restart in 5 minutes">
          </div>
          <div>
            <label class="pelican-res-name" style="display:block;margin-bottom:.35rem">Subtitle</label>
            <input class="fi-input" name="subtitle" type="text" maxlength="160" placeholder="Finish what you're doing and head to spawn">
          </div>
          <div>
            <label class="pelican-res-name" style="display:block;margin-bottom:.35rem">Display Time (seconds)</label>
            <input class="fi-input" name="staySeconds" type="number" min="1" max="30" step="1" value="4">
          </div>
          <p class="pelican-empty" data-releu-broadcast-status>Shows centered title text to everyone online, not a chat message.</p>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button type="submit" class="fi-btn fi-size-md fi-ac-btn-action" data-busy-label="Broadcasting...">Broadcast</button>
            <button type="button" class="fi-btn fi-size-md fi-ac-btn-action" data-releu-broadcast-clear>Clear Title</button>
          </div>
        </form>
      </div>`;
    rightCol.append(panel);
  }
  const broadcastForm = rightCol?.querySelector("[data-releu-broadcast-form]");
  if (broadcastForm) {
    const titleInput = broadcastForm.elements.title;
    const subtitleInput = broadcastForm.elements.subtitle;
    const stayInput = broadcastForm.elements.staySeconds;
    const statusNode = broadcastForm.querySelector("[data-releu-broadcast-status]");
    if (titleInput) titleInput.value = APP_STATE.broadcastDraft.title ?? "";
    if (subtitleInput) subtitleInput.value = APP_STATE.broadcastDraft.subtitle ?? "";
    if (stayInput) stayInput.value = String(APP_STATE.broadcastDraft.staySeconds ?? 4);
    if (statusNode) {
      statusNode.textContent =
        server.server?.status === "running"
          ? "Shows centered title text to everyone online, not a chat message."
          : "Start the server first before broadcasting a title.";
    }
    [titleInput, subtitleInput, stayInput].forEach((input) => {
      if (!input || input.dataset.releuBound) return;
      input.dataset.releuBound = "true";
      input.addEventListener("input", () => {
        APP_STATE.broadcastDraft.title = titleInput?.value ?? "";
        APP_STATE.broadcastDraft.subtitle = subtitleInput?.value ?? "";
        APP_STATE.broadcastDraft.staySeconds = Number(stayInput?.value ?? 4) || 4;
      });
    });
    if (!broadcastForm.dataset.releuBound) {
      broadcastForm.dataset.releuBound = "true";
      broadcastForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = broadcastForm.querySelector('button[type="submit"]');
        const title = String(titleInput?.value ?? "").trim();
        const subtitle = String(subtitleInput?.value ?? "").trim();
        const staySeconds = Math.max(1, Math.min(30, Number(stayInput?.value ?? 4) || 4));
        if (!title) {
          showError(new Error("Enter a main title first."));
          return;
        }
        try {
          setButtonBusy(submitButton, true, submitButton?.dataset.busyLabel ?? "Broadcasting...");
          await sendServerCommand(`title @a times 10 ${staySeconds * 20} 10`);
          await sendServerCommand(`title @a title ${JSON.stringify({ text: title, color: "gold", bold: true })}`);
          if (subtitle) {
            await sendServerCommand(`title @a subtitle ${JSON.stringify({ text: subtitle, color: "white" })}`);
          }
          if (statusNode) statusNode.textContent = "Broadcast title sent to everyone online.";
          showStatus("Broadcast title sent.", "success");
          window.setTimeout(() => clearStatus(), 1400);
        } catch (error) {
          showError(error);
        } finally {
          setButtonBusy(submitButton, false);
        }
      });
    }
    const clearButton = broadcastForm.querySelector("[data-releu-broadcast-clear]");
    if (clearButton && !clearButton.dataset.releuBound) {
      clearButton.dataset.releuBound = "true";
      clearButton.addEventListener("click", async () => {
        try {
          setButtonBusy(clearButton, true, "Clearing...");
          await sendServerCommand("title @a clear");
          if (statusNode) statusNode.textContent = "Cleared the current title for everyone online.";
          showStatus("Broadcast title cleared.", "success");
          window.setTimeout(() => clearStatus(), 1400);
        } catch (error) {
          showError(error);
        } finally {
          setButtonBusy(clearButton, false);
        }
      });
    }
  }
}

async function runServerControl(action, button = null) {
  try {
    if (button) setButtonBusy(button, true, `${action[0].toUpperCase()}${action.slice(1)}...`);
    await api(`/api/servers/${encodeURIComponent(activeServerId())}/server/${action}`, { method: "POST" });
    await refreshState(activeServerId());
    await refreshLogs();
    if (PAGE === "console.html") patchConsolePage();
    if (PAGE === "overview.html") patchOverviewPage();
  } catch (error) {
    showError(error);
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

function patchConsolePage() {
  const state = APP_STATE.state;
  const server = activeServer();
  if (!server) return;
  [...document.querySelectorAll(".fi-small-stat-block")].forEach((block) => {
    const label = block.querySelector(".text-md.font-medium")?.textContent?.trim()?.toLowerCase();
    const value = block.querySelector(".text-md.font-semibold");
    if (!label || !value) return;
    if (label === "name") value.textContent = server.name;
    if (label === "status") value.textContent = formatOperationLabel(server);
    if (label === "address") value.textContent = getPublicAddress(state, server) ?? `127.0.0.1:${server.server?.properties?.["server-port"] ?? 25565}`;
    if (label === "cpu") value.textContent = `${Math.round(server.server?.metrics?.cpuPercent ?? 0)}%`;
    if (label === "memory") value.textContent = `${server.server?.metrics?.ramUsedMb ?? 0} MB / ${server.server?.metrics?.ramMaxMb ?? 0} MB`;
    if (label === "disk") value.textContent = server.server?.jarInstalled ? "Ready" : "Not Installed";
  });
  const terminal = document.getElementById("terminal");
  if (terminal) {
    const previousBlock = terminal.querySelector(".pelican-console-pre");
    if (previousBlock) {
      const previousDistance =
        previousBlock.scrollHeight - previousBlock.clientHeight - previousBlock.scrollTop;
      APP_STATE.consoleDistanceFromBottom = Math.max(0, previousDistance);
      APP_STATE.consoleStickToBottom = previousDistance <= 24;
    }
    terminal.innerHTML = `<pre class="pelican-console-pre" style="height:26rem;overflow:auto;white-space:pre-wrap;background:rgba(19,26,32,.7);">${escapeHtml(toLogBlock(120))}</pre>`;
    const consoleBlock = terminal.querySelector(".pelican-console-pre");
    if (consoleBlock) {
      requestAnimationFrame(() => {
        if (APP_STATE.consoleStickToBottom) {
          consoleBlock.scrollTop = consoleBlock.scrollHeight;
        } else {
          consoleBlock.scrollTop = Math.max(
            0,
            consoleBlock.scrollHeight -
              consoleBlock.clientHeight -
              APP_STATE.consoleDistanceFromBottom,
          );
        }
      });
      if (!consoleBlock.dataset.releuBound) {
        consoleBlock.dataset.releuBound = "true";
        consoleBlock.addEventListener("scroll", () => {
          const distance =
            consoleBlock.scrollHeight - consoleBlock.clientHeight - consoleBlock.scrollTop;
          APP_STATE.consoleDistanceFromBottom = Math.max(0, distance);
          APP_STATE.consoleStickToBottom = distance <= 24;
        });
      }
    }
  }
  let helpPanel = document.querySelector("[data-releu-console-help]");
  if (APP_STATE.consoleHelpOpen) {
    if (!helpPanel && terminal?.parentElement) {
      terminal.insertAdjacentHTML("afterend", consoleHelpMarkup());
      helpPanel = document.querySelector("[data-releu-console-help]");
    }
  } else {
    helpPanel?.remove();
    helpPanel = null;
  }
  helpPanel?.querySelector("[data-releu-console-help-close]")?.addEventListener("click", () => {
    APP_STATE.consoleHelpOpen = false;
    patchConsolePage();
  }, { once: true });
  const input = document.getElementById("send-command");
  if (input) {
    const canSend = server.server?.status === "running";
    input.readOnly = !canSend;
    input.disabled = !canSend;
    input.placeholder = canSend ? "Type ?help or a Minecraft command..." : "Server Offline...";
    input.title = canSend ? "Type ?help for command help or send a Minecraft command." : "Can't send command when the server is Offline";
    if (document.activeElement !== input && input.value !== APP_STATE.consoleDraft) {
      input.value = APP_STATE.consoleDraft;
    }
    if (!input.dataset.releuBound) {
      input.dataset.releuBound = "true";
      input.addEventListener("input", () => {
        APP_STATE.consoleDraft = input.value;
      });
      input.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter") return;
        const command = input.value.trim();
        if (!command) return;
        if (command.toLowerCase() === "?help") {
          APP_STATE.consoleHelpOpen = true;
          APP_STATE.consoleDraft = "";
          input.value = "";
          patchConsolePage();
          return;
        }
        try {
          input.disabled = true;
          await api(`/api/servers/${encodeURIComponent(activeServerId())}/server/command`, { method: "POST", body: { command } });
          APP_STATE.consoleHelpOpen = false;
          APP_STATE.consoleDraft = "";
          input.value = "";
          await refreshLogs();
          patchConsolePage();
        } catch (error) {
          showError(error);
        } finally {
          input.disabled = !canSend;
        }
      });
    }
  }
  [...document.querySelectorAll(".fi-header-actions-ctn .fi-btn")].forEach((button) => {
    const label = button.textContent.trim().toLowerCase();
    if (button.dataset.releuBound) return;
    if (label === "start" || label === "restart" || label === "stop") {
      button.dataset.releuBound = "true";
      button.addEventListener("click", () => runServerControl(label, button));
    }
  });
}

function playerAvatar(player) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(player.uuid || player.name)}/32`;
}

function renderPlayerRow(player) {
  const flags = [
    player.online ? `<span class="ppl-flag ppl-flag-online">Online</span>` : "",
    player.op ? `<span class="ppl-flag ppl-flag-op">OP</span>` : "",
    player.whitelisted ? `<span class="ppl-flag ppl-flag-wl">Whitelist</span>` : "",
    player.banned ? `<span class="ppl-flag ppl-flag-banned">Banned</span>` : "",
  ].filter(Boolean).join("");
  const toggleBan = player.banned ? ["pardon", "Pardon"] : ["ban", "Ban"];
  return `<tr data-player-name="${escapeHtml(player.name)}"><td><span class="ppl-dot"><svg viewBox="0 0 8 8" fill="${player.online ? "rgb(34,197,94)" : "rgb(100,116,139)"}" xmlns="http://www.w3.org/2000/svg"><circle cx="4" cy="4" r="4"/></svg></span></td><td><div class="ppl-player-cell"><div class="ppl-avatar"><img src="${playerAvatar(player)}" alt="${escapeHtml(player.name)}" width="32" height="32" style="border-radius:6px"></div><div><div class="ppl-player-name">${escapeHtml(player.name)}</div><div class="ppl-player-uuid">${escapeHtml(player.uuid ?? "UUID unknown")}</div></div></div></td><td><div class="ppl-flags">${flags || `<span class="ppl-flag">Seen</span>`}</div></td><td><span class="ppl-lastseen">${escapeHtml(formatDate(player.lastSeenAt))}</span></td><td><div class="ppl-actions"><input type="text" class="ppl-action-input" placeholder="Reason"><select class="ppl-select">${["survival", "creative", "adventure", "spectator"].map((mode) => `<option value="${mode}" ${player.gamemode === mode ? "selected" : ""}>${mode}</option>`).join("")}</select><button class="ppl-action-btn" type="button" data-player-action="gamemode">Gamemode</button><button class="ppl-action-btn" type="button" data-player-action="kick">Kick</button><button class="ppl-action-btn danger" type="button" data-player-action="${toggleBan[0]}">${toggleBan[1]}</button><button class="ppl-action-btn" type="button" data-player-action="${player.whitelisted ? "whitelist-remove" : "whitelist-add"}">${player.whitelisted ? "Unwhitelist" : "Whitelist"}</button><button class="ppl-action-btn" type="button" data-player-action="${player.op ? "deop" : "op"}">${player.op ? "Deop" : "OP"}</button></div></td></tr>`;
}

function patchPlayersPage() {
  const server = activeServer();
  if (!server) return;
  const tbody = document.querySelector(".ppl-tbody");
  if (tbody) tbody.innerHTML = (server.players ?? []).map(renderPlayerRow).join("") || `<tr><td colspan="5" class="p-4 text-sm text-slate-400">No players tracked yet.</td></tr>`;
  const addInputs = [...document.querySelectorAll(".ppl-toolbar .ppl-input")];
  const addButton = [...document.querySelectorAll(".ppl-toolbar .fi-btn")].find((button) => /add player/i.test(button.textContent));
  addButton?.addEventListener("click", async () => {
    try {
      setButtonBusy(addButton, true, "Adding...");
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/players/register`, { method: "POST", body: { name: addInputs[0]?.value ?? "", uuid: addInputs[1]?.value ?? "" } });
      addInputs.forEach((input) => { input.value = ""; });
      await refreshState(activeServerId());
      patchPlayersPage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(addButton, false);
    }
  });
  tbody?.querySelectorAll("[data-player-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      try {
        setButtonBusy(button, true);
        await api(`/api/servers/${encodeURIComponent(activeServerId())}/players/${encodeURIComponent(row.dataset.playerName)}/action`, { method: "POST", body: { action: button.dataset.playerAction, mode: row.querySelector(".ppl-select")?.value ?? "survival", reason: row.querySelector(".ppl-action-input")?.value ?? "" } });
        await refreshState(activeServerId());
        await refreshLogs();
        patchPlayersPage();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
}

function patchWorldsPage() {
  const server = activeServer();
  if (!server) return;
  const worlds = server.worlds ?? [];
  const activeWorld = worlds.find((entry) => entry.isActive) ?? worlds[0] ?? null;
  const inputs = [...document.querySelectorAll(".pw-input")];
  const worldNameInput = inputs[0] ?? null;
  const sourcePathInput = inputs[1] ?? null;
  const importNameInput = inputs[2] ?? null;
  if (worldNameInput && activeWorld) worldNameInput.value = activeWorld.name;
  const activePath = document.querySelector(".pw-card .pw-card-path");
  if (activePath && activeWorld) activePath.textContent = activeWorld.path;
  const useButton = [...document.querySelectorAll(".pw-card .fi-btn")].find((button) => /use this world/i.test(button.textContent));
  const regenButton = [...document.querySelectorAll(".pw-card .fi-btn")].find((button) => /regenerate active world/i.test(button.textContent));
  const uploadButton = [...document.querySelectorAll(".fi-btn")].find((button) => /upload world archive/i.test(button.textContent));
  const importButton = [...document.querySelectorAll(".fi-btn")].find((button) => /import world folder/i.test(button.textContent));
  if (useButton && !useButton.dataset.releuBound) useButton.addEventListener("click", async () => {
    try {
      setButtonBusy(useButton, true);
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/worlds/select`, { method: "POST", body: { name: worldNameInput?.value ?? activeWorld?.name ?? "world" } });
      await refreshState(activeServerId());
      patchWorldsPage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(useButton, false);
    }
  }), useButton && (useButton.dataset.releuBound = "true");
  if (regenButton && !regenButton.dataset.releuBound) regenButton.addEventListener("click", async () => {
    try {
      setButtonBusy(regenButton, true);
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/worlds/regenerate`, { method: "POST", body: { name: worldNameInput?.value ?? activeWorld?.name ?? "world" } });
      await refreshState(activeServerId());
      patchWorldsPage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(regenButton, false);
    }
  }), regenButton && (regenButton.dataset.releuBound = "true");
  if (uploadButton && !uploadButton.dataset.releuBound) uploadButton.addEventListener("click", () => showStatus("World archive upload is still handled by the classic UI for now.")), uploadButton.dataset.releuBound = "true";
  if (importButton && !importButton.dataset.releuBound) importButton.addEventListener("click", async () => {
    try {
      setButtonBusy(importButton, true);
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/worlds/import-folder`, { method: "POST", body: { sourcePath: sourcePathInput?.value ?? "", worldName: importNameInput?.value ?? "" } });
      await refreshState(activeServerId());
      patchWorldsPage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(importButton, false);
    }
  }), importButton && (importButton.dataset.releuBound = "true");
}

async function patchSoftwarePage() {
  const server = activeServer();
  if (!server) return;
  const draft = ensureSoftwareDraft(server);
  const selectedSoftware = draft.software;
  const selectedVersion = draft.version;
  const cards = [...document.querySelectorAll(".psw-card")];
  const softwareCard = cards[0] ?? null;
  const runtimeCard = cards[1] ?? null;
  const versionSelect = softwareCard?.querySelector(".psw-select") ?? null;
  const loaderCards = [...(softwareCard?.querySelectorAll(".psw-loader-btn") ?? [])];
  const ranges = [...document.querySelectorAll(".psw-range")];
  const javaInput = runtimeCard?.querySelector(".psw-input") ?? null;
  const installedSoftware = server.install?.installedSoftware ?? server.install?.software ?? selectedSoftware;
  const installedVersion = server.install?.installedVersion ?? server.install?.requestedVersion ?? selectedVersion ?? "latest";
  const installedBuild = server.install?.installedBuild ?? null;
  loaderCards.forEach((card) => {
    const labelNode = card.querySelector(".psw-loader-label");
    const versionNode = card.querySelector(".psw-loader-version");
    const softwareId = softwareIdFromLabel(labelNode?.textContent);
    const isForgeFamily = softwareId === "forge-family";
    const isActive = isForgeFamily
      ? ["forge", "neoforge"].includes(selectedSoftware)
      : softwareId === selectedSoftware;
    card.classList.toggle("active", isActive);
    if (versionNode) {
      if (isForgeFamily) {
        labelNode.textContent = selectedSoftware === "neoforge" ? "NeoForge" : "Forge";
        versionNode.textContent = isActive
          ? `${installedVersion}${installedBuild ? ` / ${installedBuild}` : ""}`
          : "Version Catalog";
      } else if (softwareId === installedSoftware) {
        versionNode.textContent = `${installedVersion}${installedBuild && softwareId === "fabric" ? ` / ${installedBuild}` : ""}`;
      } else {
        versionNode.textContent = "Version Catalog";
      }
    }
  });
  await populateVersionSelect(versionSelect, selectedSoftware, selectedVersion);
  draft.version = versionSelect?.value ?? draft.version;
  const values = [draft.maxRamMb, draft.minRamMb, draft.cpuCores, draft.gpuShare];
  ranges.forEach((input, index) => {
    input.value = String(values[index] ?? 0);
    const metaValue = input.closest(".psw-range-row")?.querySelector(".psw-range-meta span:last-child");
    metaValue?.replaceChildren(document.createTextNode(index === 3 ? `${values[index]}%` : index < 2 ? `${values[index]} MB` : String(values[index])));
  });
  if (javaInput) javaInput.value = draft.javaPath ?? "";
  loaderCards.forEach((card) => {
    if (card.dataset.releuBound) return;
    card.dataset.releuBound = "true";
    card.addEventListener("click", async () => {
      loaderCards.forEach((entry) => entry.classList.toggle("active", entry === card));
      const clickedSoftware = softwareIdFromLabel(card.querySelector(".psw-loader-label")?.textContent);
      draft.software =
        clickedSoftware === "forge-family"
          ? (draft.software === "neoforge" ? "neoforge" : "forge")
          : clickedSoftware;
      draft.version = "latest";
      await populateVersionSelect(versionSelect, draft.software, "latest");
      draft.version = versionSelect?.value ?? "latest";
      patchSoftwarePage();
    });
  });
  if (versionSelect && !versionSelect.dataset.releuBound) {
    versionSelect.dataset.releuBound = "true";
    versionSelect.addEventListener("change", () => {
      draft.version = versionSelect.value;
    });
  }
  ranges.forEach((input, index) => {
    if (input.dataset.releuBound) return;
    input.dataset.releuBound = "true";
    input.addEventListener("input", () => {
      const value = Number(input.value) || 0;
      if (index === 0) draft.maxRamMb = value;
      if (index === 1) draft.minRamMb = value;
      if (index === 2) draft.cpuCores = value;
      if (index === 3) draft.gpuShare = value;
      if (draft.minRamMb > draft.maxRamMb) draft.minRamMb = draft.maxRamMb;
      if (draft.maxRamMb < draft.minRamMb) draft.maxRamMb = draft.minRamMb;
      const valuesNow = [draft.maxRamMb, draft.minRamMb, draft.cpuCores, draft.gpuShare];
      ranges.forEach((range, valueIndex) => {
        range.value = String(valuesNow[valueIndex] ?? 0);
        range
          .closest(".psw-range-row")
          ?.querySelector(".psw-range-meta span:last-child")
          ?.replaceChildren(
            document.createTextNode(
              valueIndex === 3
                ? `${valuesNow[valueIndex]}%`
                : valueIndex < 2
                  ? `${valuesNow[valueIndex]} MB`
                  : String(valuesNow[valueIndex]),
            ),
          );
      });
    });
  });
  if (javaInput && !javaInput.dataset.releuBound) {
    javaInput.dataset.releuBound = "true";
    javaInput.addEventListener("input", () => {
      draft.javaPath = javaInput.value;
    });
  }
  const installButton = [...document.querySelectorAll(".fi-btn")].find((button) => /install \/ update software/i.test(button.textContent));
  if (installButton && !installButton.dataset.releuBound) installButton.addEventListener("click", async () => {
    try {
      setButtonBusy(installButton, true, "Installing...");
      draft.version = versionSelect?.value ?? draft.version ?? "latest";
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/install/server`, { method: "POST", body: { software: draft.software, version: draft.version, acceptEula: true } });
      await refreshState(activeServerId());
      await refreshLogs();
      APP_STATE.softwareDraft = buildSoftwareDraft(activeServer());
      patchSoftwarePage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(installButton, false);
    }
  }), installButton && (installButton.dataset.releuBound = "true");
  const saveRuntimeButton = [...document.querySelectorAll(".fi-btn")].find((button) => /save resource limits/i.test(button.textContent));
  if (saveRuntimeButton && !saveRuntimeButton.dataset.releuBound) saveRuntimeButton.addEventListener("click", async () => {
    try {
      setButtonBusy(saveRuntimeButton, true, "Saving...");
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/settings/runtime`, { method: "POST", body: { maxRam: `${draft.maxRamMb}M`, minRam: `${draft.minRamMb}M`, cpuCores: draft.cpuCores, gpuShare: draft.gpuShare, javaPath: draft.javaPath ?? "java" } });
      await refreshState(activeServerId());
      APP_STATE.softwareDraft = buildSoftwareDraft(activeServer());
      patchSoftwarePage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(saveRuntimeButton, false);
    }
  }), saveRuntimeButton && (saveRuntimeButton.dataset.releuBound = "true");
}

function catalogKindForActiveTab() {
  const activeTab = document.querySelector(".pm-tab.active");
  const explicitKind = activeTab?.dataset.releuTabKind?.trim()?.toLowerCase();
  if (explicitKind) return explicitKind;
  const label = activeTab?.textContent?.toLowerCase() ?? "";
  if (label.includes("installed") || label.includes("downloaded")) return "installed";
  if (label.includes("resource")) return "resourcepack";
  return label.includes("mod") ? "mod" : "plugin";
}

function selectedCatalogProfileId(kind) {
  const defaults = activeServer()?.catalog?.defaults ?? {};
  if (kind === "plugin") return defaults.plugin;
  if (kind === "resourcepack") return defaults.resourcepack ?? "resourcepack";
  return defaults.mod;
}

function selectedGameVersion() {
  return activeServer()?.catalog?.gameVersion ?? activeServer()?.install?.installedVersion ?? activeServer()?.install?.requestedVersion ?? "latest";
}

function ensureSelectValue(select, value, label = value) {
  if (!select || !value) return;
  const normalized = String(value).trim();
  const existing =
    [...select.options].find((entry) => String(entry.value).trim().toLowerCase() === normalized.toLowerCase()) ??
    [...select.options].find((entry) => String(entry.textContent ?? "").trim().toLowerCase() === normalized.toLowerCase());
  if (existing) {
    select.value = existing.value;
    return;
  }
  const option = document.createElement("option");
  option.value = normalized;
  option.textContent = String(label ?? normalized);
  select.prepend(option);
  select.value = normalized;
}

function selectedPaneVersion(kind) {
  const pane =
    kind === "mod"
      ? document.querySelector('[data-pm-pane="mods"]')
      : kind === "resourcepack"
        ? document.querySelector('[data-pm-pane="resourcepacks"]')
        : document.querySelector('[data-pm-pane="plugins"]');
  const selects = [...(pane?.querySelectorAll(".pm-filter-select") ?? [])];
  return selects[0]?.value?.trim() || selectedGameVersion();
}

function selectedPaneProfile(kind) {
  if (kind === "resourcepack") return selectedCatalogProfileId("resourcepack");
  if (kind !== "mod") return selectedCatalogProfileId("plugin");
  const pane = document.querySelector('[data-pm-pane="mods"]');
  const selects = [...(pane?.querySelectorAll(".pm-filter-select") ?? [])];
  const value = selects[1]?.value?.trim()?.toLowerCase() ?? "";
  if (["fabric", "forge", "neoforge", "quilt"].includes(value)) return value;
  return selectedCatalogProfileId("mod");
}

function getCatalogPage(kind) {
  return Math.max(1, Number(APP_STATE.catalogPaging?.[kind]?.page ?? 1) || 1);
}

function setCatalogPage(kind, page = 1) {
  if (!APP_STATE.catalogPaging[kind]) {
    APP_STATE.catalogPaging[kind] = { page: 1 };
  }
  APP_STATE.catalogPaging[kind].page = Math.max(1, Number(page) || 1);
}

function addonsPane(kind) {
  return document.querySelector(
    kind === "installed"
      ? '[data-pm-pane="installed"]'
      :
    kind === "plugin"
      ? '[data-pm-pane="plugins"]'
      : kind === "mod"
        ? '[data-pm-pane="mods"]'
        : '[data-pm-pane="resourcepacks"]',
  );
}

function addonsTab(kind) {
  if (kind === "installed") {
    return document.querySelector('[data-releu-tab-kind="installed"]');
  }
  return [...document.querySelectorAll(".pm-tab")].find((button) => {
    const text = button.textContent?.toLowerCase() ?? "";
    return kind === "resourcepack"
      ? text.includes("resource")
      : text.includes(kind);
  }) ?? null;
}

function setActiveAddonsTab(kind) {
  const pane = addonsPane(kind);
  const tab = addonsTab(kind);
  if (!pane || !tab) return;
  document.querySelectorAll(".pm-pane").forEach((entry) => {
    entry.classList.toggle("active", entry === pane);
  });
  document.querySelectorAll(".pm-tab").forEach((entry) => {
    entry.classList.toggle("active", entry === tab);
  });
}

function kindSupported(kind) {
  if (kind === "resourcepack") return true;
  const option = activeServerSoftwareOption();
  if (kind === "plugin") return Boolean(option?.supportsPlugins);
  if (kind === "mod") return Boolean(option?.supportsMods);
  return true;
}

function incompatibleKindMessage(kind) {
  const option = activeServerSoftwareOption();
  const softwareName = option?.name ?? softwareDisplayName(activeServerSoftwareId());
  if (kind === "plugin") {
    return `${softwareName} does not load plugins. Switch this server to Paper or Purpur to browse and install plugin add-ons.`;
  }
  if (kind === "mod") {
    return `${softwareName} does not load mods. Switch this server to Fabric, Forge, NeoForge, or Quilt to browse and install mods.`;
  }
  return "";
}

function renderUnsupportedKindState(pane, kind) {
  const results = pane?.querySelector("[data-pm-results]");
  if (!results) return;
  const message = incompatibleKindMessage(kind);
  results.innerHTML = `<div class="pm-result-card" data-pm-card><div class="pm-result-body"><div class="pm-result-name">${escapeHtml(kind === "plugin" ? "Plugins Unavailable" : "Mods Unavailable")}</div><div class="pm-result-desc">${escapeHtml(message)}</div></div></div>`;
  pane.querySelector("[data-pm-count]")?.replaceChildren(document.createTextNode(message));
}

function stripSavedAddonsPageListeners() {
  const root = document.querySelector(".pm-search-root");
  if (!root || root.dataset.releuNeutralized === "true") return;
  root.dataset.releuNeutralized = "true";

  const replaceWithClone = (node) => {
    if (!node?.parentNode) return node;
    const clone = node.cloneNode(true);
    if (node instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
      clone.value = node.value;
    }
    node.parentNode.replaceChild(clone, node);
    return clone;
  };

  root.querySelectorAll(".pm-tab").forEach((node) => replaceWithClone(node));
  replaceWithClone(root.querySelector(".pm-searchbar-input"));
  replaceWithClone(root.querySelector("[data-pm-rp-save]"));
  replaceWithClone(root.querySelector("[data-pm-rp-clear]"));
}

function ensureInstalledAddonsTab() {
  const root = document.querySelector(".pm-search-root");
  if (!root) return { tab: null, pane: null };
  const tabRow = root.querySelector(".pm-tab-row");
  let tab = root.querySelector('[data-releu-tab-kind="installed"]');
  if (!tab && tabRow) {
    tab = document.createElement("button");
    tab.type = "button";
    tab.className = "pm-tab";
    tab.dataset.releuTabKind = "installed";
    tab.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Installed`;
    tabRow.append(tab);
  }
  let pane = root.querySelector('[data-pm-pane="installed"]');
  if (!pane) {
    pane = document.createElement("div");
    pane.className = "pm-pane";
    pane.dataset.pmPane = "installed";
    const resourcePane = root.querySelector('[data-pm-pane="resourcepacks"]');
    resourcePane?.after(pane);
  }
  return { tab, pane };
}

function normalizeSideSupport(value) {
  const normalized = String(value ?? "unknown").trim().toLowerCase();
  return ["required", "optional", "unsupported", "unknown"].includes(normalized)
    ? normalized
    : "unknown";
}

function renderSideSupportBadge(side, channel) {
  const normalized = normalizeSideSupport(side);
  if (normalized === "unknown") return "";
  const tone =
    normalized === "required"
      ? "pm-badge-compat"
      : normalized === "optional"
        ? "pm-badge-cat"
        : "pm-badge";
  const label =
    normalized === "required"
      ? `${channel} required`
      : normalized === "optional"
        ? `${channel} features`
        : `${channel} unsupported`;
  return `<span class="pm-badge ${tone}">${escapeHtml(label)}</span>`;
}

function getClientInstallWarning(entry) {
  const clientSide = normalizeSideSupport(entry?.clientSide);
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

function resourcePackNeedsClientSupport(entry) {
  const summary = [
    entry?.title,
    entry?.displayName,
    entry?.description,
    ...(entry?.categories ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /(fresh animations|better animations?|connected textures|continuity|optifine|entity texture features|entity model features|custom entity model|cem|ctm|etf|emf)/i.test(
    summary,
  );
}

function getInstallCompatibilityWarning(kind, entry) {
  if (kind === "mod") {
    return getClientInstallWarning(entry);
  }
  if (kind === "resourcepack" && resourcePackNeedsClientSupport(entry)) {
    return {
      title: "Client-Side Features Detected",
      message:
        "This resource pack is sent by the server, but features like connected textures, custom entity models, or Fresh Animations still need compatible client support such as Continuity, OptiFine, ETF, or EMF. Continue saving it to the server?",
    };
  }
  return null;
}

function renderClientRequirementSummary(entry) {
  const warning = getInstallCompatibilityWarning("mod", entry);
  return warning ? warning.message.replace(" Continue installing it on the server?", "") : "";
}

function renderResourcePackRequirementSummary(entry) {
  const warning = getInstallCompatibilityWarning("resourcepack", entry);
  return warning ? warning.message.replace(" Continue saving it to the server?", "") : "";
}

function renderCatalogCard(kind, result) {
  const icon = result.iconUrl ? `<img src="${escapeHtml(result.iconUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:8px">` : "";
  const badges = [
    ...(result.categories ?? []).slice(0, 3).map((entry) => `<span class="pm-badge pm-badge-cat">${escapeHtml(entry)}</span>`),
    result.compatibleVersionNumber ? `<span class="pm-badge pm-badge-compat">${escapeHtml(result.compatibleVersionNumber)}</span>` : "",
    kind === "mod" ? renderSideSupportBadge(result.clientSide, "Client") : "",
    kind !== "resourcepack" ? renderSideSupportBadge(result.serverSide, "Server") : "",
  ].filter(Boolean).join("");
  const versionPicker =
    ["mod", "resourcepack"].includes(kind) && (result.availableVersions?.length ?? 0) > 0
      ? `<select class="pm-filter-select" data-install-version style="min-width:170px">${result.availableVersions
          .map(
            (entry) =>
              `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.versionNumber ?? entry.name ?? "version")}</option>`,
          )
          .join("")}</select>`
      : "";
  const requirementSummary =
    kind === "mod"
      ? renderClientRequirementSummary(result)
      : kind === "resourcepack"
        ? renderResourcePackRequirementSummary(result)
        : "";
  return `<div class="pm-result-card" data-pm-card><div class="pm-result-icon">${icon}</div><div class="pm-result-body"><div class="pm-result-top"><div><div class="pm-result-name">${escapeHtml(result.title)}</div><div class="pm-result-version">${escapeHtml(result.author ?? "Unknown author")}</div></div></div><div class="pm-result-desc">${escapeHtml(result.description ?? "No description.")}${requirementSummary ? `<div class="mt-2 text-xs text-slate-400">${escapeHtml(requirementSummary)}</div>` : ""}</div><div class="pm-result-badges">${badges}</div><div class="pm-result-meta"><span class="pm-result-meta-item">${escapeHtml(String(result.downloads ?? 0))} downloads</span><span class="pm-result-meta-item">${escapeHtml(formatDate(result.dateModified))}</span></div></div><div class="pm-result-actions">${versionPicker}<button class="pm-btn-install" type="button" data-install-project="${escapeHtml(result.id)}" data-install-kind="${escapeHtml(kind)}" data-project-title="${escapeHtml(result.title)}" data-client-side="${escapeHtml(normalizeSideSupport(result.clientSide))}" data-server-side="${escapeHtml(normalizeSideSupport(result.serverSide))}">Install</button></div></div>`;
}

function renderInstalledAssetCard(kind, entry) {
  const icon = entry.iconUrl ? `<img src="${escapeHtml(entry.iconUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:8px">` : "";
  const actionButton =
    kind === "resourcepack"
      ? `<button class="pm-btn-install is-installed" type="button" data-clear-resource-pack="true">Clear</button>`
      : `<button class="pm-btn-install is-installed" type="button" data-remove-asset="${escapeHtml(entry.name)}" data-kind="${escapeHtml(kind)}">Remove</button>`;
  const sideBadges = [
    kind === "mod" ? renderSideSupportBadge(entry.clientSide, "Client") : "",
    kind !== "resourcepack" ? renderSideSupportBadge(entry.serverSide, "Server") : "",
  ].filter(Boolean).join("");
  const clientSummary = kind === "mod" ? renderClientRequirementSummary(entry) : "";
  return `<div class="pm-result-card" data-pm-card><div class="pm-result-icon">${icon}</div><div class="pm-result-body"><div class="pm-result-top"><div><div class="pm-result-name">${escapeHtml(entry.displayName ?? entry.name)}</div><div class="pm-result-version">${escapeHtml(entry.versionNumber ?? entry.name)}</div></div></div><div class="pm-result-desc">${escapeHtml(entry.restartReason ?? `Installed ${kind}.`)}${clientSummary ? `<div class="mt-2 text-xs text-slate-400">${escapeHtml(clientSummary)}</div>` : ""}</div>${sideBadges ? `<div class="pm-result-badges">${sideBadges}</div>` : ""}<div class="pm-result-meta"><span class="pm-result-meta-item">${escapeHtml(formatDate(entry.installedAt ?? entry.updatedAt))}</span></div></div><div class="pm-result-actions">${actionButton}</div></div>`;
}

async function loadPluginCatalog(query = "", page = getCatalogPage("plugin")) {
  const payload = await api(
    `/api/servers/${encodeURIComponent(activeServerId())}/catalog/search?${new URLSearchParams({
      kind: "plugin",
      query,
      profileId: selectedCatalogProfileId("plugin"),
      gameVersion: selectedPaneVersion("plugin"),
      limit: "15",
      page: String(page),
      index: query ? "relevance" : "downloads",
    }).toString()}`,
  );
  APP_STATE.catalogResults.plugin = payload.catalog;
  setCatalogPage("plugin", payload.catalog?.page ?? page);
  return payload.catalog;
}

function ensureInstalledSection(pane, kind, entries) {
  if (!pane) return;
  let section = pane.querySelector("[data-pm-installed]");
  if (!section) {
    section = document.createElement("section");
    section.dataset.pmInstalled = "true";
    section.style.display = "flex";
    section.style.flexDirection = "column";
    section.style.gap = ".5rem";
    const results = pane.querySelector("[data-pm-results]");
    results?.before(section);
  }
  const labels = {
    plugin: "Installed Plugins",
    mod: "Installed Mods",
    resourcepack: "Installed Resource Packs",
  };
  section.innerHTML = `<div class="pm-respack-head">${labels[kind] ?? "Installed Add-ons"}</div><div class="pm-results">${entries.length ? entries.map((entry) => renderInstalledAssetCard(kind, entry)).join("") : `<div class="pm-result-card" data-pm-card><div class="pm-result-body"><div class="pm-result-name">Nothing installed yet</div><div class="pm-result-desc">Installed ${kind}s will appear here separately from the main search results.</div></div></div>`}</div>`;
}

function currentResourcePackEntry(server) {
  const properties = server?.server?.properties ?? {};
  const resourcePackUrl = String(properties["resource-pack"] ?? "").trim();
  if (!resourcePackUrl) {
    return [];
  }
  const requireFlag =
    String(properties["require-resource-pack"] ?? "false").toLowerCase() === "true";
  const prompt = String(properties["resource-pack-prompt"] ?? "").trim();
  return [
    {
      name: resourcePackUrl,
      displayName: "Active Resource Pack",
      versionNumber: properties["resource-pack-sha1"] ? "SHA1 configured" : "No checksum",
      installedAt: server?.updatedAt ?? new Date().toISOString(),
      restartReason: `${requireFlag ? "Required" : "Optional"} server pack. ${prompt || "Restart the server to apply this pack to joining players."}`,
    },
  ];
}

function renderInstalledGroup(title, kind, entries) {
  return `<section data-releu-installed-group="${escapeHtml(kind)}" style="display:flex;flex-direction:column;gap:.75rem;">
    <div class="pm-respack-head">${escapeHtml(title)}</div>
    <div class="pm-results">${
      entries.length
        ? entries.map((entry) => renderInstalledAssetCard(kind, entry)).join("")
        : `<div class="pm-result-card" data-pm-card><div class="pm-result-body"><div class="pm-result-name">Nothing installed yet</div><div class="pm-result-desc">Installed ${escapeHtml(kind)} items will appear here.</div></div></div>`
    }</div>
  </section>`;
}

function renderInstalledPane(pane, server) {
  if (!pane) return;
  const plugins = server.plugins ?? [];
  const mods = server.mods ?? [];
  const resourcePacks = currentResourcePackEntry(server);
  const total = plugins.length + mods.length + resourcePacks.length;
  const clientRequiredMods = mods.filter((entry) =>
    ["required", "optional"].includes(normalizeSideSupport(entry.clientSide)),
  );
  pane.innerHTML = `
    <div class="pm-filters" data-pm-filters>
      <span class="pm-filter-count" data-pm-count>${total} installed add-ons</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:1rem;">
      ${
        clientRequiredMods.length
          ? renderInstalledGroup("Client Mods Required", "mod", clientRequiredMods)
          : ""
      }
      ${renderInstalledGroup("Installed Plugins", "plugin", plugins)}
      ${renderInstalledGroup("Installed Mods", "mod", mods)}
      ${renderInstalledGroup("Installed Resource Packs", "resourcepack", resourcePacks)}
    </div>
  `;
}

function filterStaticCatalogCards(pane, query = "", emptyText = "No results found.") {
  const results = pane?.querySelector("[data-pm-results]");
  if (!results) return;
  const cards = [...results.querySelectorAll("[data-pm-card]")];
  const normalized = String(query ?? "").trim().toLowerCase();
  let visible = 0;
  cards.forEach((card) => {
    const show = !normalized || card.textContent.toLowerCase().includes(normalized);
    card.style.display = show ? "" : "none";
    if (show) visible += 1;
  });
  let empty = results.querySelector("[data-pm-empty]");
  if (!visible) {
    if (!empty) {
      empty = document.createElement("div");
      empty.dataset.pmEmpty = "true";
      empty.className = "text-sm text-slate-400";
      results.append(empty);
    }
    empty.textContent = emptyText;
  } else if (empty) {
    empty.remove();
  }
}

async function loadModCatalog(query = "") {
  const payload = await api(
    `/api/servers/${encodeURIComponent(activeServerId())}/catalog/search?${new URLSearchParams({
      kind: "mod",
      query,
      profileId: selectedPaneProfile("mod"),
      gameVersion: selectedPaneVersion("mod"),
      limit: "15",
      page: String(getCatalogPage("mod")),
      index: query ? "relevance" : "downloads",
    }).toString()}`,
  );
  APP_STATE.catalogResults.mod = payload.catalog;
  setCatalogPage("mod", payload.catalog?.page ?? getCatalogPage("mod"));
  return payload.catalog;
}

async function loadResourcePackCatalog(query = "") {
  const payload = await api(
    `/api/servers/${encodeURIComponent(activeServerId())}/catalog/search?${new URLSearchParams({
      kind: "resourcepack",
      query,
      profileId: selectedCatalogProfileId("resourcepack"),
      gameVersion: selectedPaneVersion("resourcepack"),
      limit: "15",
      page: String(getCatalogPage("resourcepack")),
      index: query ? "relevance" : "downloads",
    }).toString()}`,
  );
  APP_STATE.catalogResults.resourcepack = payload.catalog;
  setCatalogPage("resourcepack", payload.catalog?.page ?? getCatalogPage("resourcepack"));
  return payload.catalog;
}

function patchCatalogPagination(pane, kind, resultSet) {
  const pagination = pane?.querySelector(".pm-pagination");
  if (!pagination) return;

  const currentPage = Math.max(1, Number(resultSet?.page ?? getCatalogPage(kind)) || 1);
  const totalPages = Math.max(1, Number(resultSet?.totalPages ?? 1) || 1);
  const totalHits = Math.max(0, Number(resultSet?.totalHits ?? resultSet?.results?.length ?? 0) || 0);
  const info = pagination.querySelector(".pm-page-info");
  if (info) {
    info.textContent = totalHits
      ? `Page ${currentPage} of ${totalPages}`
      : "No pages";
  }

  const buttonRow = pagination.querySelector(".pm-page-btns");
  if (!buttonRow) return;
  if (!totalHits) {
    buttonRow.innerHTML = "";
    return;
  }

  const pageNumbers = [];
  const startPage = Math.max(1, currentPage - 1);
  const endPage = Math.min(totalPages, startPage + 2);
  for (let page = startPage; page <= endPage; page += 1) {
    pageNumbers.push(page);
  }

  buttonRow.innerHTML = [
    `<button class="pm-page-btn" type="button" data-releu-page-kind="${escapeHtml(kind)}" data-releu-page-target="${Math.max(1, currentPage - 1)}" ${currentPage <= 1 ? "disabled" : ""}>&lsaquo;</button>`,
    ...pageNumbers.map(
      (page) =>
        `<button class="pm-page-btn" type="button" data-releu-page-kind="${escapeHtml(kind)}" data-releu-page-target="${page}" ${page === currentPage ? 'aria-current="page"' : ""}>${page}</button>`,
    ),
    `<button class="pm-page-btn" type="button" data-releu-page-kind="${escapeHtml(kind)}" data-releu-page-target="${Math.min(totalPages, currentPage + 1)}" ${currentPage >= totalPages ? "disabled" : ""}>&rsaquo;</button>`,
  ].join("");

  buttonRow.querySelectorAll("[data-releu-page-target]").forEach((button) => {
    if (button.dataset.releuBound === "true") {
      return;
    }
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      const targetPage = Math.max(1, Number(button.dataset.releuPageTarget ?? currentPage) || currentPage);
      setCatalogPage(kind, targetPage);
      const searchInput = document.querySelector(".pm-searchbar-input");
      const query = String(searchInput?.value ?? "").trim();
      try {
        if (kind === "plugin") {
          await loadPluginCatalog(query, targetPage);
        } else if (kind === "mod") {
          await loadModCatalog(query);
        } else if (kind === "resourcepack") {
          await loadResourcePackCatalog(query);
        }
        patchAddonsPage();
      } catch (error) {
        showError(error);
      }
    });
  });
}

async function patchAddonsPage() {
  const server = activeServer();
  if (!server) return;
  stripSavedAddonsPageListeners();
  const installedUi = ensureInstalledAddonsTab();
  const pluginSupported = kindSupported("plugin");
  const modSupported = kindSupported("mod");
  const pluginPane = document.querySelector('[data-pm-pane="plugins"]');
  const modPane = document.querySelector('[data-pm-pane="mods"]');
  const resourcePane = document.querySelector('[data-pm-pane="resourcepacks"]');
  const installedPane = installedUi.pane;
  const pluginResults = pluginPane?.querySelector("[data-pm-results]");
  const modResults = modPane?.querySelector("[data-pm-results]");
  const resourceResults = resourcePane?.querySelector("[data-pm-results]");
  const pluginSelects = [...(pluginPane?.querySelectorAll(".pm-filter-select") ?? [])];
  const modSelects = [...(modPane?.querySelectorAll(".pm-filter-select") ?? [])];
  const resourceSelects = [...(resourcePane?.querySelectorAll(".pm-filter-select") ?? [])];
  ensureSelectValue(pluginSelects[0], selectedGameVersion(), selectedGameVersion());
  ensureSelectValue(modSelects[0], selectedGameVersion(), selectedGameVersion());
  ensureSelectValue(modSelects[1], selectedCatalogProfileId("mod"), selectedCatalogProfileId("mod"));
  ensureSelectValue(resourceSelects[0], selectedGameVersion(), selectedGameVersion());
  pluginPane?.querySelector("[data-pm-installed]")?.remove();
  modPane?.querySelector("[data-pm-installed]")?.remove();
  resourcePane?.querySelector("[data-pm-installed]")?.remove();
  renderInstalledPane(installedPane, server);

  const activeKind = catalogKindForActiveTab();
  if (!kindSupported(activeKind)) {
    setActiveAddonsTab(modSupported ? "mod" : pluginSupported ? "plugin" : "resourcepack");
  }

  document.querySelectorAll(".pm-tab").forEach((button) => {
    if (button.dataset.releuBoundTab) return;
    button.dataset.releuBoundTab = "true";
    button.addEventListener("click", () => {
      const text = button.textContent?.toLowerCase() ?? "";
      const kind = button.dataset.releuTabKind?.trim()?.toLowerCase() ||
        (text.includes("resource")
        ? "resourcepack"
        : text.includes("mod")
          ? "mod"
          : text.includes("installed")
            ? "installed"
            : "plugin");
      setActiveAddonsTab(kind);
      patchAddonsPage().catch(showError);
    });
  });

  if (!APP_STATE.catalogBootstrap.plugin && pluginResults && pluginSupported) {
    APP_STATE.catalogBootstrap.plugin = true;
    loadPluginCatalog("").then(() => patchAddonsPage()).catch(showError);
  }
  if (!APP_STATE.catalogBootstrap.mod && modResults && modSupported) {
    APP_STATE.catalogBootstrap.mod = true;
    loadModCatalog("").then(() => patchAddonsPage()).catch(showError);
  }
  if (!APP_STATE.catalogBootstrap.resourcepack && resourceResults) {
    APP_STATE.catalogBootstrap.resourcepack = true;
    loadResourcePackCatalog("").then(() => patchAddonsPage()).catch(showError);
  }
  if (pluginResults && !pluginSupported) {
    renderUnsupportedKindState(pluginPane, "plugin");
  } else if (pluginResults && APP_STATE.catalogResults.plugin) {
    pluginResults.innerHTML =
      APP_STATE.catalogResults.plugin.results?.map((entry) => renderCatalogCard("plugin", entry)).join("") ||
      `<div class="text-sm text-slate-400">No compatible plugins found.</div>`;
    pluginPane?.querySelector("[data-pm-count]")?.replaceChildren(
      document.createTextNode(
        `Showing ${APP_STATE.catalogResults.plugin.results?.length ?? 0} of ${APP_STATE.catalogResults.plugin.totalHits ?? 0} plugins`,
      ),
    );
    patchCatalogPagination(pluginPane, "plugin", APP_STATE.catalogResults.plugin);
  }
  if (modResults && !modSupported) {
    renderUnsupportedKindState(modPane, "mod");
  } else if (modResults && APP_STATE.catalogResults.mod) {
    modResults.innerHTML =
      APP_STATE.catalogResults.mod.results?.map((entry) => renderCatalogCard("mod", entry)).join("") ||
      `<div class="text-sm text-slate-400">No compatible mods found.</div>`;
    modPane?.querySelector("[data-pm-count]")?.replaceChildren(
      document.createTextNode(
        `Showing ${APP_STATE.catalogResults.mod.results?.length ?? 0} of ${APP_STATE.catalogResults.mod.totalHits ?? 0} mods`,
      ),
    );
    patchCatalogPagination(modPane, "mod", APP_STATE.catalogResults.mod);
  }
  if (resourceResults && APP_STATE.catalogResults.resourcepack) {
    resourceResults.innerHTML =
      APP_STATE.catalogResults.resourcepack.results?.map((entry) => renderCatalogCard("resourcepack", entry)).join("") ||
      `<div class="text-sm text-slate-400">No compatible resource packs found.</div>`;
    resourcePane?.querySelector("[data-pm-count]")?.replaceChildren(
      document.createTextNode(
        `Showing ${APP_STATE.catalogResults.resourcepack.results?.length ?? 0} of ${APP_STATE.catalogResults.resourcepack.totalHits ?? 0} resource packs`,
      ),
    );
    patchCatalogPagination(resourcePane, "resourcepack", APP_STATE.catalogResults.resourcepack);
  }

  const resourceUrlInput = resourcePane?.querySelector("[data-rp-url-input]");
  const resourceSha1Input = resourcePane?.querySelector("[data-rp-sha1-input]");
  let resourceRequireInput = resourcePane?.querySelector("[data-rp-require-input]");
  let resourcePromptInput = resourcePane?.querySelector("[data-rp-prompt-input]");
  if (resourcePane && (!resourceRequireInput || !resourcePromptInput)) {
    const extraControls = document.createElement("div");
    extraControls.dataset.releuResourcePackControls = "true";
    extraControls.style.display = "grid";
    extraControls.style.gap = ".75rem";
    extraControls.style.marginTop = ".75rem";
    extraControls.innerHTML = `
      <label style="display:flex;align-items:center;gap:.65rem;color:#cbd5e1;font-size:.9rem;">
        <input type="checkbox" data-rp-require-input style="accent-color:#60a5fa;width:16px;height:16px;">
        <span>Require Resource Pack</span>
      </label>
      <div class="pm-rp-input-wrap">
        <span class="pm-rp-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
        <input type="text" class="pm-rp-input" data-rp-prompt-input placeholder="Prompt shown when the pack is required">
      </div>
    `;
    resourcePane.querySelector(".pm-respack-btns")?.before(extraControls);
    resourceRequireInput = extraControls.querySelector("[data-rp-require-input]");
    resourcePromptInput = extraControls.querySelector("[data-rp-prompt-input]");
  }
  if (resourceUrlInput && document.activeElement !== resourceUrlInput) {
    resourceUrlInput.value = server.server?.properties?.["resource-pack"] ?? "";
  }
  if (resourceSha1Input && document.activeElement !== resourceSha1Input) {
    resourceSha1Input.value = server.server?.properties?.["resource-pack-sha1"] ?? "";
  }
  if (resourceRequireInput && document.activeElement !== resourceRequireInput) {
    resourceRequireInput.checked =
      String(server.server?.properties?.["require-resource-pack"] ?? "false").toLowerCase() ===
      "true";
  }
  if (resourcePromptInput && document.activeElement !== resourcePromptInput) {
    resourcePromptInput.value = server.server?.properties?.["resource-pack-prompt"] ?? "";
  }
  const resourcePackStatus = resourcePane?.querySelector("[data-pm-rp-status]");
  if (
    resourcePackStatus &&
    !resourcePackStatus.dataset.releuPinned &&
    String(server.server?.properties?.["resource-pack"] ?? "").trim()
  ) {
    resourcePackStatus.textContent =
      "Saved to server.properties. Restart the server to apply this resource pack to players. Some packs still need client-side support such as Continuity or OptiFine for connected textures, or ETF/EMF for custom entity models and Fresh Animations.";
  }

  const activeBanner = document.querySelector("[data-releu-status-banner]");
  if (
    activeBanner &&
    /does not load plugins|does not load mods/i.test(activeBanner.textContent ?? "")
  ) {
    clearStatus();
  }

  const searchInput = document.querySelector(".pm-searchbar-input");
  const currentKind = catalogKindForActiveTab();
  if (searchInput) {
    searchInput.placeholder =
      currentKind === "installed"
        ? "Installed add-ons are listed below"
        :
      currentKind === "plugin"
        ? pluginSupported
          ? "Search plugins?"
          : "Plugins unavailable on this server"
        : currentKind === "mod"
          ? modSupported
            ? "Search mods?"
            : "Mods unavailable on this server"
          : "Search resource packs?";
    searchInput.disabled =
      currentKind === "installed" ||
      (currentKind === "plugin" && !pluginSupported) ||
      (currentKind === "mod" && !modSupported);
  }
  const runSearch = async (query = "") => {
    const kind = catalogKindForActiveTab();
    if (kind === "installed") {
      return;
    }
    setCatalogPage(kind, 1);
    if (kind === "plugin") {
      if (!pluginSupported) {
        renderUnsupportedKindState(pluginPane, "plugin");
        return;
      }
      await loadPluginCatalog(query);
      patchAddonsPage();
      return;
    }
    if (kind === "resourcepack") {
      await loadResourcePackCatalog(query);
      patchAddonsPage();
      return;
    }
    if (!modSupported) {
      renderUnsupportedKindState(modPane, "mod");
      return;
    }
    await loadModCatalog(query);
    patchAddonsPage();
  };
  if (searchInput && !searchInput.dataset.releuBound) {
    searchInput.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      try {
        await runSearch(event.target.value.trim());
      } catch (error) {
        showError(error);
      }
    });
    searchInput.addEventListener("input", () => {
      clearTimeout(APP_STATE.catalogSearchTimer);
      APP_STATE.catalogSearchTimer = window.setTimeout(() => {
        runSearch(searchInput.value.trim()).catch(showError);
      }, 220);
    });
    searchInput.dataset.releuBound = "true";
  }

  modPane?.querySelectorAll(".pm-filter-select").forEach((select) => {
    if (select.dataset.releuBound) return;
    select.dataset.releuBound = "true";
    select.addEventListener("change", async () => {
      if (!modSupported) return;
      setCatalogPage("mod", 1);
      APP_STATE.catalogBootstrap.mod = true;
      await loadModCatalog(searchInput?.value?.trim() ?? "");
      patchAddonsPage();
    });
  });
  pluginPane?.querySelectorAll(".pm-filter-select").forEach((select) => {
    if (select.dataset.releuBound) return;
    select.dataset.releuBound = "true";
    select.addEventListener("change", async () => {
      if (!pluginSupported) return;
      setCatalogPage("plugin", 1);
      APP_STATE.catalogBootstrap.plugin = true;
      await loadPluginCatalog(searchInput?.value?.trim() ?? "");
      patchAddonsPage();
    });
  });
  resourcePane?.querySelectorAll(".pm-filter-select").forEach((select) => {
    if (select.dataset.releuBound) return;
    select.dataset.releuBound = "true";
    select.addEventListener("change", async () => {
      setCatalogPage("resourcepack", 1);
      APP_STATE.catalogBootstrap.resourcepack = true;
      await loadResourcePackCatalog(searchInput?.value?.trim() ?? "");
      patchAddonsPage();
    });
  });

  document.querySelectorAll("[data-install-project]").forEach((button) => {
    if (button.dataset.releuBound) return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      try {
        const catalogSet = APP_STATE.catalogResults[button.dataset.installKind];
        const catalogEntry =
          catalogSet?.results?.find(
            (entry) => String(entry.id) === String(button.dataset.installProject),
          ) ?? {
            title: button.dataset.projectTitle,
            clientSide: button.dataset.clientSide,
            serverSide: button.dataset.serverSide,
          };
        const installWarning = getInstallCompatibilityWarning(
          button.dataset.installKind,
          catalogEntry,
        );
        if (
          installWarning &&
          !window.confirm(`${installWarning.title}\n\n${installWarning.message}`)
        ) {
          return;
        }
        const row = button.closest("[data-pm-card]");
        const versionId = row?.querySelector("[data-install-version]")?.value ?? "";
        const isResourcePackInstall = button.dataset.installKind === "resourcepack";
        const resourceStatus = resourcePane?.querySelector("[data-pm-rp-status]");
        setInstallHud("Resolving install package...", "working", 22);
        setButtonBusy(button, true, "Installing...");
        setInstallHud("Downloading selected add-on version...", "working", 58);
        await api(`/api/servers/${encodeURIComponent(activeServerId())}/catalog/install`, {
          method: "POST",
          timeoutMs: 5 * 60 * 1000,
          timeoutMessage:
            "The add-on install request timed out. Check whether the panel or server is still busy, then try again.",
          body: {
            kind: button.dataset.installKind,
            projectId: button.dataset.installProject,
            profileId: selectedPaneProfile(button.dataset.installKind),
            gameVersion: selectedPaneVersion(button.dataset.installKind),
            versionId,
          },
        });
        setInstallHud(
          isResourcePackInstall
            ? "Saved the server resource pack. Restart the server to apply it."
            : "Installed successfully. Refreshing add-on state...",
          "success",
          100,
        );
        await refreshState(activeServerId());
        APP_STATE.catalogResults.plugin = null;
        APP_STATE.catalogResults.mod = null;
        APP_STATE.catalogResults.resourcepack = null;
        APP_STATE.catalogBootstrap.plugin = false;
        APP_STATE.catalogBootstrap.mod = false;
        APP_STATE.catalogBootstrap.resourcepack = false;
        patchAddonsPage();
        if (isResourcePackInstall && resourceStatus) {
          resourceStatus.textContent =
            "Saved to server.properties. Restart the server to apply this resource pack to players. Some packs still need client-side support such as Continuity or OptiFine for connected textures, or ETF/EMF for custom entity models and Fresh Animations.";
          resourceStatus.dataset.releuPinned = "true";
        }
        clearInstallHud();
      } catch (error) {
        setInstallHud(error?.message ?? "Install failed.", "error", 100);
        clearInstallHud(3200);
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  document.querySelectorAll("[data-remove-asset]").forEach((button) => {
    if (button.dataset.releuBound) return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      try {
        setButtonBusy(button, true, "Removing...");
        await api(`/api/servers/${encodeURIComponent(activeServerId())}/assets/remove`, { method: "POST", body: { kind: button.dataset.kind, fileName: button.dataset.removeAsset } });
        await refreshState(activeServerId());
        APP_STATE.catalogResults.plugin = null;
        APP_STATE.catalogResults.mod = null;
        APP_STATE.catalogResults.resourcepack = null;
        patchAddonsPage();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  document.querySelectorAll("[data-clear-resource-pack]").forEach((button) => {
    if (button.dataset.releuBound) return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      try {
        setButtonBusy(button, true, "Clearing...");
        await api(`/api/servers/${encodeURIComponent(activeServerId())}/settings/server-properties`, {
          method: "POST",
          body: {
            "resource-pack": "",
            "resource-pack-sha1": "",
            "resource-pack-prompt": "",
            "require-resource-pack": "false",
          },
        });
        await refreshState(activeServerId());
        APP_STATE.catalogResults.resourcepack = null;
        APP_STATE.catalogBootstrap.resourcepack = false;
        const status = resourcePane?.querySelector("[data-pm-rp-status]");
        if (status) {
          delete status.dataset.releuPinned;
        }
        patchAddonsPage();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });

  resourcePane?.querySelectorAll("[data-rp-url]").forEach((button) => {
    if (button.dataset.releuBound) return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", () => {
      const urlInput = resourcePane.querySelector("[data-rp-url-input]");
      const sha1Input = resourcePane.querySelector("[data-rp-sha1-input]");
      const promptInput = resourcePane.querySelector("[data-rp-prompt-input]");
      if (urlInput) urlInput.value = button.dataset.rpUrl ?? "";
      if (sha1Input) sha1Input.value = button.dataset.rpSha1 ?? "";
      if (promptInput && !promptInput.value) {
        promptInput.value = server.server?.properties?.["resource-pack-prompt"] ?? "";
      }
      const status = resourcePane.querySelector("[data-pm-rp-status]");
      if (status) status.textContent = "Resource pack details filled in. Save and restart the server to apply them.";
    });
  });
  const saveRp = resourcePane?.querySelector("[data-pm-rp-save]");
  if (saveRp && !saveRp.dataset.releuBound) saveRp.addEventListener("click", async () => {
    const urlInput = resourcePane.querySelector("[data-rp-url-input]");
    const sha1Input = resourcePane.querySelector("[data-rp-sha1-input]");
    const requireInput = resourcePane.querySelector("[data-rp-require-input]");
    const promptInput = resourcePane.querySelector("[data-rp-prompt-input]");
    const status = resourcePane.querySelector("[data-pm-rp-status]");
    try {
      setButtonBusy(saveRp, true, "Saving...");
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/settings/server-properties`, {
        method: "POST",
        body: {
          "resource-pack": urlInput?.value ?? "",
          "resource-pack-sha1": sha1Input?.value ?? "",
          "resource-pack-prompt": promptInput?.value ?? "",
          "require-resource-pack": Boolean(requireInput?.checked),
        },
      });
      await refreshState(activeServerId());
      if (status) {
        status.textContent =
          "Saved to server.properties. Restart the server to apply this resource pack to players. Some packs still need client-side support such as Continuity or OptiFine for connected textures, or ETF/EMF for custom entity models and Fresh Animations.";
        status.dataset.releuPinned = "true";
      }
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(saveRp, false);
    }
  }), saveRp.dataset.releuBound = "true";
  const clearRp = resourcePane?.querySelector("[data-pm-rp-clear]");
  if (clearRp && !clearRp.dataset.releuBound) clearRp.addEventListener("click", async () => {
    const urlInput = resourcePane.querySelector("[data-rp-url-input]");
    const sha1Input = resourcePane.querySelector("[data-rp-sha1-input]");
    const requireInput = resourcePane.querySelector("[data-rp-require-input]");
    const promptInput = resourcePane.querySelector("[data-rp-prompt-input]");
    const status = resourcePane.querySelector("[data-pm-rp-status]");
    try {
      setButtonBusy(clearRp, true, "Clearing...");
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/settings/server-properties`, {
        method: "POST",
        body: {
          "resource-pack": "",
          "resource-pack-sha1": "",
          "resource-pack-prompt": "",
          "require-resource-pack": "false",
        },
      });
      if (urlInput) urlInput.value = "";
      if (sha1Input) sha1Input.value = "";
      if (promptInput) promptInput.value = "";
      if (requireInput) requireInput.checked = false;
      await refreshState(activeServerId());
      if (status) {
        status.textContent = "Resource pack cleared from server.properties.";
        delete status.dataset.releuPinned;
      }
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(clearRp, false);
    }
  }), clearRp.dataset.releuBound = "true";
}

function patchBackupsPage() {
  const server = activeServer();
  if (!server) return;
  const recent = server.backups?.recent ?? [];
  const table = document.querySelector(".fi-ta-table");
  const emptyState = document.querySelector(".fi-ta-empty-state");
  if (table) {
    const tbody = document.createElement("tbody");
    tbody.innerHTML = recent.map((entry) => `<tr class="fi-ta-row"><td class="fi-ta-cell">${escapeHtml(entry.name)}</td><td class="fi-ta-cell">Folder</td><td class="fi-ta-cell">${escapeHtml(formatDate(entry.createdAt))}</td><td class="fi-ta-cell">Ready</td><td class="fi-ta-cell">Unlocked</td></tr>`).join("");
    table.querySelector("tbody")?.remove();
    table.append(tbody);
  }
  if (emptyState) emptyState.style.display = recent.length ? "none" : "";
  const createButton = document.querySelector(".fi-ac-icon-btn-action");
  if (createButton && !createButton.dataset.releuBound) createButton.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true);
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/server/backup`, { method: "POST" });
      await refreshState(activeServerId());
      patchBackupsPage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(button, false);
    }
  }), createButton && (createButton.dataset.releuBound = "true");
}

function patchFilesPage() {
  const content = document.querySelector(".fi-page-content") ?? document.querySelector("main");
  if (!content || content.querySelector("[data-releu-files-note]")) return;
  const note = document.createElement("section");
  note.dataset.releuFilesNote = "true";
  note.className = "fi-section mt-6";
  note.innerHTML = `<div class="rounded-lg border border-[#2b3642] bg-[#0f141b] px-5 py-4 text-sm text-slate-300">Releu does not have a file browser API yet. Use the classic Releu UI for file management for now.</div>`;
  content.prepend(note);
}

function patchMiscPage() {
  const server = activeServer();
  if (!server) return;
  const properties = server.server?.properties ?? {};
  const misc = server.misc ?? {};
  const form = document.querySelector("[data-releu-misc-form]");
  if (!form) return;

  const setValue = (name, enabled) => {
    const input = form.elements[name];
    if (!input) return;
    input.value = enabled ? "true" : "false";
  };

  setValue("allowCrackedClients", String(properties["online-mode"] ?? "true").toLowerCase() !== "true");
  setValue("whitelist", String(properties["white-list"] ?? "false").toLowerCase() === "true");
  setValue("commandBlocks", String(properties["enable-command-block"] ?? "false").toLowerCase() === "true");
  setValue("pvp", String(properties.pvp ?? "true").toLowerCase() === "true");
  setValue("allowFlight", String(properties["allow-flight"] ?? "false").toLowerCase() === "true");
  setValue("keepInventory", Boolean(misc.keepInventory));
  setValue("sharedHealth", Boolean(misc.sharedHealth));

  if (form.dataset.releuBound === "true") return;
  form.dataset.releuBound = "true";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    try {
      const currentKeepInventory = Boolean(activeServer()?.misc?.keepInventory);
      const nextKeepInventory = form.elements.keepInventory.value === "true";
      if (currentKeepInventory !== nextKeepInventory) {
        const proceed = window.confirm(
          "Warning: changing Keep Inventory can immediately affect what players are wearing or holding in their inventory. Do you want to continue?",
        );
        if (!proceed) {
          return;
        }
      }
      setButtonBusy(submitButton, true, submitButton?.dataset.busyLabel ?? "Saving...");
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/settings/misc`, {
        method: "POST",
        body: {
          allowCrackedClients: form.elements.allowCrackedClients.value === "true",
          whitelist: form.elements.whitelist.value === "true",
          commandBlocks: form.elements.commandBlocks.value === "true",
          pvp: form.elements.pvp.value === "true",
          allowFlight: form.elements.allowFlight.value === "true",
          keepInventory: form.elements.keepInventory.value === "true",
          sharedHealth: form.elements.sharedHealth.value === "true",
        },
      });
      await refreshState(activeServerId());
      patchMiscPage();
      showStatus("Misc settings saved.", "success");
      window.setTimeout(() => clearStatus(), 1400);
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(submitButton, false);
    }
  });
}

function patchSettingsPage() {
  const state = APP_STATE.state;
  const server = activeServer();
  if (!server) return;
  const serverId = activeServerId();
  const properties = server.server?.properties ?? {};
  const boolProp = (key, fallback = false) => String(properties[key] ?? String(fallback)).toLowerCase() === "true";
  if (
    !APP_STATE.cloudBackup.loading &&
    (!APP_STATE.cloudBackup.status || Date.now() - APP_STATE.cloudBackup.lastFetchedAt > 15000)
  ) {
    refreshCloudBackupStatus()
      .then(() => patchSettingsPage())
      .catch(() => {});
  }
  document
    .querySelector("#form\\.uuid")
    ?.closest(".fi-grid-col")
    ?.remove();
  document
    .querySelector("#form\\.uuid_short")
    ?.closest(".fi-grid-col")
    ?.remove();
  document
    .querySelector("#form\\.node\\.name")
    ?.closest(".fi-grid-col")
    ?.remove();

  const profileNameInput = document.querySelector("#form\\.name");
  const profileDescriptionInput = document.querySelector("#form\\.description");
  if (profileNameInput && document.activeElement !== profileNameInput && profileNameInput.dataset.releuDirty !== "true") {
    profileNameInput.value = server.name ?? "";
  }
  if (
    profileDescriptionInput &&
    document.activeElement !== profileDescriptionInput &&
    profileDescriptionInput.dataset.releuDirty !== "true"
  ) {
    profileDescriptionInput.value = server.description ?? "";
  }

  const profileField =
    profileDescriptionInput?.closest(".fi-sc-component") ??
    profileNameInput?.closest(".fi-sc-component");
  let profileStatus = document.querySelector("[data-releu-profile-status]");
  if (!profileStatus && profileField) {
    profileStatus = document.createElement("div");
    profileStatus.dataset.releuProfileStatus = "true";
    profileStatus.className = "mt-3 text-xs";
    profileField.append(profileStatus);
  }
  const paintProfileStatus = (message, tone = "neutral") => {
    APP_STATE.profileSaveState = { message, tone };
    if (!profileStatus) return;
    const color =
      tone === "error"
        ? "#fca5a5"
        : tone === "success"
          ? "#86efac"
          : tone === "saving"
            ? "#93c5fd"
            : "#94a3b8";
    profileStatus.textContent = message;
    profileStatus.style.color = color;
  };
  if (profileStatus) {
    paintProfileStatus(
      APP_STATE.profileSaveState.message ||
        "Releu server name and description save automatically. Minecraft's multiplayer list name is chosen on the client. The server itself controls its MOTD and server icon.",
      APP_STATE.profileSaveState.tone || "neutral",
    );
  }
  const scheduleProfileSave = (immediate = false) => {
    const nameValue = String(profileNameInput?.value ?? "").trim();
    const descriptionValue = String(profileDescriptionInput?.value ?? "").trim();
    if (!nameValue) {
      paintProfileStatus("Server name cannot be empty.", "error");
      return;
    }
    clearTimeout(APP_STATE.profileSaveTimer);
    const runSave = async () => {
      try {
        paintProfileStatus("Saving server details...", "saving");
        await api(`/api/servers/${encodeURIComponent(serverId)}/settings/profile`, {
          method: "POST",
          body: {
            name: nameValue,
            description: descriptionValue,
            autoBackups: server.backups?.enabled,
            backupIntervalMinutes: server.backups?.intervalMinutes,
          },
        });
        await refreshState(serverId);
        if (profileNameInput) profileNameInput.dataset.releuDirty = "false";
        if (profileDescriptionInput) profileDescriptionInput.dataset.releuDirty = "false";
        paintProfileStatus("Server details saved.", "success");
      } catch (error) {
        paintProfileStatus(error?.message ?? "Unable to save server details.", "error");
        showError(error);
      }
    };
    if (immediate) {
      runSave().catch(showError);
      return;
    }
    APP_STATE.profileSaveTimer = window.setTimeout(() => {
      runSave().catch(showError);
    }, 450);
  };
  [profileNameInput, profileDescriptionInput].forEach((input) => {
    if (!input || input.dataset.releuProfileBound === "true") return;
    input.dataset.releuProfileBound = "true";
    input.addEventListener("input", () => {
      input.dataset.releuDirty = "true";
      paintProfileStatus("Saving server details when you stop typing...", "neutral");
      scheduleProfileSave(false);
    });
    input.addEventListener("blur", () => {
      input.dataset.releuDirty = "true";
      scheduleProfileSave(true);
    });
  });

  [...document.querySelectorAll(".rounded-lg.border.border-\\[\\#2b3642\\]")].forEach((card) => {
    const label = card.querySelector("dt")?.textContent?.trim()?.toLowerCase();
    const value = card.querySelector("dd");
    if (!label || !value) return;
    if (label === "agent status") value.textContent = state.playit?.running ? "Connected" : state.playit?.secretConfigured ? "Linked" : "Not Linked";
    if (label === "auto-start") value.textContent = state.playitSettings?.autoStart ? "Enabled" : "Disabled";
    if (label === "public address") value.textContent = getPublicAddress(state, server) ?? "Run Server To Get Address";
    if (label === "tunnel target") value.textContent = state.playit?.recommendedTunnelTarget ?? `127.0.0.1:${server.server?.properties?.["server-port"] ?? 25565}`;
  });
  let propertiesSection = document.querySelector("[data-releu-server-properties]");
  if (!propertiesSection) {
    propertiesSection = document.createElement("section");
    propertiesSection.className = "fi-section fi-section-has-header mt-8";
    propertiesSection.dataset.releuServerProperties = "true";
    const pageContent = document.querySelector(".fi-page-content");
    const playitSection = [...(pageContent?.querySelectorAll(".fi-section") ?? [])].find((section) =>
      /playit agent/i.test(section.textContent ?? ""),
    );
    if (playitSection?.parentNode) {
      playitSection.parentNode.insertBefore(propertiesSection, playitSection);
    } else {
      pageContent?.append(propertiesSection);
    }
  }
  propertiesSection.innerHTML = `
    <header class="fi-section-header">
      <div class="fi-section-header-text-ctn">
        <h2 class="fi-section-header-heading">Server Properties</h2>
        <p class="fi-section-header-description">Core Minecraft server properties.</p>
      </div>
    </header>
    <div class="fi-section-content-ctn">
      <div class="fi-section-content">
        <form data-releu-server-properties-form class="grid gap-6 md:grid-cols-2">
          <label class="block">
            <span class="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-500">MOTD</span>
            <input class="fi-input" name="motd" type="text" value="${escapeHtml(properties.motd ?? "")}">
          </label>
          <label class="block">
            <span class="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-500">Max Players</span>
            <input class="fi-input" name="max-players" type="number" min="1" value="${escapeHtml(properties["max-players"] ?? "20")}">
          </label>
          <label class="block">
            <span class="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-500">Default Gamemode</span>
            <select class="fi-input" name="gamemode">
              ${["survival", "creative", "adventure", "spectator"].map((value) => `<option value="${escapeHtml(value)}" ${String(properties.gamemode ?? "survival").toLowerCase() === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
            </select>
          </label>
          <label class="block">
            <span class="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-500">Difficulty</span>
            <select class="fi-input" name="difficulty">
              ${["peaceful", "easy", "normal", "hard"].map((value) => `<option value="${escapeHtml(value)}" ${String(properties.difficulty ?? "normal").toLowerCase() === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
            </select>
          </label>
          <label class="block">
            <span class="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-500">View Distance</span>
            <input class="fi-input" name="view-distance" type="number" min="2" value="${escapeHtml(properties["view-distance"] ?? "10")}">
          </label>
          <label class="block">
            <span class="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-500">Simulation Distance</span>
            <input class="fi-input" name="simulation-distance" type="number" min="2" value="${escapeHtml(properties["simulation-distance"] ?? "10")}">
          </label>
          <label class="block">
            <span class="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-500">Spawn Protection</span>
            <input class="fi-input" name="spawn-protection" type="number" min="0" value="${escapeHtml(properties["spawn-protection"] ?? "0")}">
          </label>
          <div class="md:col-span-2 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            ${[
              ["force-gamemode", "Force Gamemode", boolProp("force-gamemode", false)],
              ["hardcore", "Hardcore", boolProp("hardcore", false)],
            ].map(([key, label, checked]) => `
              <label class="rounded-lg border border-[#2b3642] bg-[#0f141b] px-4 py-4 text-sm text-slate-300">
                <span class="flex items-center justify-between gap-3">
                  <span>${escapeHtml(label)}</span>
                  <input type="checkbox" name="${escapeHtml(key)}" ${checked ? "checked" : ""}>
                </span>
              </label>`).join("")}
          </div>
          <div class="md:col-span-2 flex items-center justify-between gap-4 rounded-lg border border-[#2b3642] bg-[#0f141b] px-5 py-4">
            <div>
              <div class="font-semibold text-slate-100">Apply changes to this server</div>
              <p class="mt-1 text-xs text-slate-400">These values write directly to <span class="font-mono">server.properties</span>.</p>
            </div>
            <button type="submit" class="fi-btn fi-size-md fi-ac-btn-action" data-busy-label="Saving...">Save Properties</button>
          </div>
        </form>
      </div>
    </div>`;
  const propertiesForm = propertiesSection.querySelector("[data-releu-server-properties-form]");
  if (propertiesForm && !propertiesForm.dataset.releuBound) propertiesForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    try {
      setButtonBusy(submitButton, true, submitButton?.dataset.busyLabel ?? "Saving...");
      await api(`/api/servers/${encodeURIComponent(serverId)}/settings/server-properties`, {
        method: "POST",
        body: {
          motd: form.elements.motd.value,
          "max-players": form.elements["max-players"].value,
          gamemode: form.elements.gamemode.value,
          difficulty: form.elements.difficulty.value,
          "view-distance": form.elements["view-distance"].value,
          "simulation-distance": form.elements["simulation-distance"].value,
          "spawn-protection": form.elements["spawn-protection"].value,
          "force-gamemode": form.elements["force-gamemode"].checked,
          hardcore: form.elements.hardcore.checked,
        },
      });
      await refreshState(serverId);
      patchSettingsPage();
      showStatus("Server properties saved.", "success");
      window.setTimeout(() => clearStatus(), 1400);
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(submitButton, false);
    }
  }), propertiesForm && (propertiesForm.dataset.releuBound = "true");
  const iconPreview = document.querySelector('img[alt="icon"]');
  if (iconPreview) {
    iconPreview.src = server.iconUrl ?? serverPlaceholderDataUrl(server.name);
    iconPreview.alt = `${server.name} icon`;
  }
  const uploadButton = document.querySelector('[aria-label="Upload icon"]');
  let uploadInput = document.querySelector("[data-releu-icon-upload]");
  if (!uploadInput && uploadButton) {
    uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.accept = ".png,.jpg,.jpeg,.webp";
    uploadInput.hidden = true;
    uploadInput.dataset.releuIconUpload = "true";
    document.body.append(uploadInput);
  }
  if (uploadButton && uploadInput && !uploadButton.dataset.releuBound) uploadButton.addEventListener("click", (event) => {
    event.preventDefault();
    uploadInput.click();
  }), uploadButton.dataset.releuBound = "true";
  if (uploadInput && !uploadInput.dataset.releuBound) uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files?.[0];
    if (!file) return;
    try {
      uploadButton?.setAttribute("disabled", "disabled");
      showStatus("Uploading server icon...");
      const normalizedIcon = await normalizeServerIconUpload(file);
      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/icon?fileName=${encodeURIComponent(normalizedIcon.fileName)}`, {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-file-name": normalizedIcon.fileName,
        },
        body: normalizedIcon.bytes,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? `Upload failed (${response.status}).`);
      }
      await refreshState(serverId);
      updateChrome(APP_STATE.state);
      patchSettingsPage();
      showStatus("Server icon updated.", "success");
      window.setTimeout(() => clearStatus(), 1400);
    } catch (error) {
      showError(error);
    } finally {
      uploadInput.value = "";
      uploadButton?.removeAttribute("disabled");
    }
  }), uploadInput && (uploadInput.dataset.releuBound = "true");
  const buttons = [...document.querySelectorAll(".fi-section-footer .fi-btn")];
  const dashboardButton = buttons.find((button) => /open dashboard/i.test(button.textContent));
  if (dashboardButton && !dashboardButton.dataset.releuBound) dashboardButton.addEventListener("click", () => {
    window.open(state.playit?.dashboardTunnelUrl || "https://playit.gg/account/tunnels", "_blank", "noopener,noreferrer");
  }), dashboardButton.dataset.releuBound = "true";
  const resetButton = buttons.find((button) => /reset agent/i.test(button.textContent));
  if (resetButton && !resetButton.dataset.releuBound) resetButton.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!window.confirm("Reset the linked playit agent?")) return;
    try {
      setButtonBusy(button, true, "Resetting...");
      await api("/api/playit/reset", { method: "POST" });
      await refreshState(activeServerId());
      patchSettingsPage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(button, false);
    }
  }), resetButton && (resetButton.dataset.releuBound = "true");
  let cloudSection = document.querySelector("[data-releu-cloud-section]");
  if (!cloudSection) {
    cloudSection = document.createElement("section");
    cloudSection.className = "fi-section mt-6";
    cloudSection.dataset.releuCloudSection = "true";
    document.querySelector(".fi-page-content")?.append(cloudSection);
  }
  const cloud = APP_STATE.cloudBackup.status ?? {};
  const cloudProvider = cloud.provider ?? state.cloudBackupSettings?.provider ?? "supabase";
  const usingTailscaleCloud = cloudProvider === "tailscale-ssh";
  const uploadLimitBytes =
    Number(cloud.uploadLimitBytes ?? (state.cloudBackupSettings?.uploadLimitMb ?? 50) * 1024 * 1024) ||
    0;
  const uploadLimitLabel = usingTailscaleCloud
    ? (cloud.uploadLimitLabel ?? "Remote server disk")
    : formatBytes(uploadLimitBytes);
  cloudSection.innerHTML = `
    <header class="fi-section-header">
      <div>
        <h2 class="fi-section-header-heading">Cloud Backup</h2>
        <p class="fi-section-header-description">${usingTailscaleCloud ? "Store one rolling full-server backup on your Linux machine over Tailscale SSH." : "Upload full server backups to Supabase without exposing the private admin key in the public app."}</p>
      </div>
    </header>
    <div class="fi-section-content-ctn">
      <div class="fi-section-content" style="display:grid;gap:1rem;">
        <div class="rounded-lg border border-[#2b3642] bg-[#0f141b] px-5 py-4 text-sm text-slate-300" style="display:grid;gap:1rem;">
          <label style="display:flex;align-items:center;gap:.75rem;">
            <input type="checkbox" data-releu-cloud-enabled ${state.cloudBackupSettings?.enabled ? "checked" : ""}>
            <span>Enable cloud backup for this Releu install</span>
          </label>
          <label style="display:grid;gap:.5rem;">
            <span class="text-xs uppercase tracking-[0.16em] text-slate-500">Device Label</span>
            <input class="fi-input" data-releu-cloud-device-label type="text" value="${escapeHtml(cloud.deviceLabel ?? state.cloudBackupSettings?.deviceLabel ?? "")}" placeholder="My desktop PC">
          </label>
          <label style="display:grid;gap:.5rem;">
            <span class="text-xs uppercase tracking-[0.16em] text-slate-500">Restore Key</span>
            <input class="fi-input" type="text" readonly value="${escapeHtml(cloud.restoreKey ?? "")}" placeholder="Generate a restore key first">
          </label>
          <div style="display:grid;gap:.65rem;" class="text-xs text-slate-400">
            <div>${usingTailscaleCloud ? "Connection" : "Function"}: <span class="text-slate-200">${cloud.functionReady ? "Ready" : APP_STATE.cloudBackup.loading ? "Checking..." : "Not Ready"}</span></div>
            <div>Upload limit: <span class="text-slate-200">${escapeHtml(uploadLimitLabel)}</span></div>
            <div>Cloud used: <span class="text-slate-200">${escapeHtml(formatBytes(cloud.usedBytes ?? 0))}</span></div>
            <div>Saved backups: <span class="text-slate-200">${escapeHtml(String(cloud.backupsCount ?? 0))}</span></div>
            ${cloud.functionError ? `<div style="color:#fca5a5;">${escapeHtml(cloud.functionError)}</div>` : `<div>Latest backup: <span class="text-slate-200">${escapeHtml(cloud.latestBackup?.backup_name ?? "None yet")}</span></div>`}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:.65rem;">
            <button type="button" class="fi-btn fi-size-md fi-ac-btn-action" data-releu-cloud-save>Save Settings</button>
            <button type="button" class="fi-btn fi-size-md fi-ac-btn-action" data-releu-cloud-issue>${cloud.restoreKeyPresent ? "Regenerate Key" : "Generate Key"}</button>
            ${!cloud.restoreKeyPresent ? "" : `<button type="button" class="fi-btn fi-size-md fi-ac-btn-action" data-releu-cloud-rotate>Rotate Key</button>`}
            <button type="button" class="fi-btn fi-size-md fi-ac-btn-action" data-releu-cloud-upload ${!state.cloudBackupSettings?.enabled || !cloud.restoreKeyPresent ? "disabled" : ""}>Backup To Cloud Now</button>
            <button type="button" class="fi-btn fi-size-md fi-ac-btn-action" data-releu-cloud-refresh>Refresh Status</button>
          </div>
        </div>
        <div class="rounded-lg border border-[#2b3642] bg-[#0f141b] px-5 py-4 text-sm text-slate-300" style="display:grid;gap:.75rem;">
          <div class="font-semibold text-slate-100">${usingTailscaleCloud ? "Rolling Cloud Backup" : "Cloud Backups"}</div>
          ${
            cloud.backups?.length
              ? cloud.backups
                  .map(
                    (entry) => `
              <div class="rounded-lg border border-[#2b3642] bg-black/30 px-4 py-4" style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap;">
                <div style="display:grid;gap:.35rem;">
                  <div class="font-medium text-slate-100">${escapeHtml(entry.backup_name ?? "Backup")}</div>
                  <div class="text-xs text-slate-400">${escapeHtml(formatDate(entry.created_at ?? entry.updated_at))}</div>
                  <div class="text-xs text-slate-500">${escapeHtml(formatBytes(entry.size_bytes ?? 0))}</div>
                </div>
                <div style="display:flex;gap:.55rem;flex-wrap:wrap;">
                  <button type="button" class="fi-btn fi-size-sm fi-ac-btn-action" data-releu-cloud-download="${escapeHtml(entry.id)}">Download</button>
                  <button type="button" class="fi-btn fi-size-sm fi-ac-btn-action" data-releu-cloud-restore="${escapeHtml(entry.id)}">Restore</button>
                </div>
              </div>`,
                  )
                  .join("")
              : `<div class="text-xs text-slate-400">No cloud backups uploaded yet.</div>`
          }
        </div>
      </div>
    </div>`; 
  const cloudEnabled = cloudSection.querySelector("[data-releu-cloud-enabled]");
  const cloudDeviceLabel = cloudSection.querySelector("[data-releu-cloud-device-label]");
  const saveCloudButton = cloudSection.querySelector("[data-releu-cloud-save]");
  const issueCloudButton = cloudSection.querySelector("[data-releu-cloud-issue]");
  const rotateCloudButton = cloudSection.querySelector("[data-releu-cloud-rotate]");
  const uploadCloudButton = cloudSection.querySelector("[data-releu-cloud-upload]");
  const refreshCloudButton = cloudSection.querySelector("[data-releu-cloud-refresh]");
  if (saveCloudButton && !saveCloudButton.dataset.releuBound) saveCloudButton.addEventListener("click", async () => {
    try {
      setButtonBusy(saveCloudButton, true, "Saving...");
      const payload = await api("/api/cloud-backup/settings", {
        method: "POST",
        body: {
          enabled: Boolean(cloudEnabled?.checked),
          provider: cloudProvider,
          deviceLabel: cloudDeviceLabel?.value ?? "",
        },
      });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      APP_STATE.cloudBackup.status = payload.status ?? APP_STATE.cloudBackup.status;
      APP_STATE.cloudBackup.lastFetchedAt = Date.now();
      patchSettingsPage();
      showStatus("Cloud backup settings saved.", "success");
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(saveCloudButton, false);
    }
  }), saveCloudButton.dataset.releuBound = "true";
  if (issueCloudButton && !issueCloudButton.dataset.releuBound) issueCloudButton.addEventListener("click", async () => {
    try {
      setButtonBusy(issueCloudButton, true, "Generating...");
      const payload = await api("/api/cloud-backup/issue-key", {
        method: "POST",
        body: {
          deviceLabel: cloudDeviceLabel?.value ?? "",
        },
      });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      APP_STATE.cloudBackup.status = payload.cloudBackup ?? APP_STATE.cloudBackup.status;
      APP_STATE.cloudBackup.lastFetchedAt = Date.now();
      patchSettingsPage();
      showStatus("Cloud backup key ready.", "success");
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(issueCloudButton, false);
    }
  }), issueCloudButton.dataset.releuBound = "true";
  if (rotateCloudButton && !rotateCloudButton.dataset.releuBound) rotateCloudButton.addEventListener("click", async () => {
    try {
      setButtonBusy(rotateCloudButton, true, "Rotating...");
      const payload = await api("/api/cloud-backup/rotate-key", { method: "POST" });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      APP_STATE.cloudBackup.status = payload.cloudBackup ?? APP_STATE.cloudBackup.status;
      APP_STATE.cloudBackup.lastFetchedAt = Date.now();
      patchSettingsPage();
      showStatus("Cloud backup key rotated.", "success");
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(rotateCloudButton, false);
    }
  }), rotateCloudButton.dataset.releuBound = "true";
  if (uploadCloudButton && !uploadCloudButton.dataset.releuBound) uploadCloudButton.addEventListener("click", async () => {
    try {
      setButtonBusy(uploadCloudButton, true, "Uploading...");
      showStatus("Creating and uploading a full cloud backup...");
      const payload = await api(`/api/servers/${encodeURIComponent(serverId)}/cloud-backup/upload`, {
        method: "POST",
      });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      APP_STATE.cloudBackup.status = payload.upload?.cloudBackup ?? APP_STATE.cloudBackup.status;
      APP_STATE.cloudBackup.lastFetchedAt = Date.now();
      patchSettingsPage();
      showStatus("Cloud backup uploaded.", "success");
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(uploadCloudButton, false);
    }
  }), uploadCloudButton.dataset.releuBound = "true";
  if (refreshCloudButton && !refreshCloudButton.dataset.releuBound) refreshCloudButton.addEventListener("click", async () => {
    try {
      setButtonBusy(refreshCloudButton, true, "Refreshing...");
      await refreshCloudBackupStatus(true);
      patchSettingsPage();
      showStatus("Cloud backup status refreshed.", "success");
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(refreshCloudButton, false);
    }
  }), refreshCloudButton.dataset.releuBound = "true";
  cloudSection.querySelectorAll("[data-releu-cloud-download]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      try {
        setButtonBusy(button, true, "Downloading...");
        await api(`/api/servers/${encodeURIComponent(serverId)}/cloud-backup/download`, {
          method: "POST",
          body: {
            backupId: button.dataset.releuCloudDownload,
          },
        });
        showStatus("Cloud backup downloaded to the local Releu data folder.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  cloudSection.querySelectorAll("[data-releu-cloud-restore]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      if (!window.confirm("Restore this cloud backup onto the current server? The server must stay stopped during the restore.")) {
        return;
      }
      try {
        setButtonBusy(button, true, "Restoring...");
        await api(`/api/servers/${encodeURIComponent(serverId)}/cloud-backup/restore`, {
          method: "POST",
          body: {
            backupId: button.dataset.releuCloudRestore,
          },
        });
        await refreshState(serverId);
        await refreshCloudBackupStatus(true);
        patchSettingsPage();
        showStatus("Cloud backup restored.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  let uiSection = document.querySelector("[data-releu-ui-section]");
  if (!uiSection) {
    uiSection = document.createElement("section");
    uiSection.className = "fi-section mt-6";
    uiSection.dataset.releuUiSection = "true";
    document.querySelector(".fi-page-content")?.append(uiSection);
  }
  const uiSettings = currentUiSettings();
  const currentVariant =
    String(uiSettings.variant ?? "").trim().toLowerCase() === "pelican-blueprint"
      ? "pelican-blueprint"
      : "classic";
  uiSection.innerHTML = `
    <header class="fi-section-header">
      <div>
        <h2 class="fi-section-header-heading">Interface Mode</h2>
        <p class="fi-section-header-description">Switch the default Releu shell for this PC. The new shell is based on Pelican and still uses the same backend.</p>
      </div>
    </header>
    <div class="fi-section-content-ctn">
      <div class="fi-section-content" style="display:grid;gap:1rem;">
        ${[
          {
            id: "classic",
            title: "Legacy UI",
            detail:
              "The original Releu layout. Most battle-tested, denser, and still the default when you have not chosen a UI yet.",
            pros: [
              "Most complete and battle-tested control surface",
              "Quicker access to dense controls",
            ],
            cons: [
              "Heavier look",
              "Less like a hosted game-panel shell",
            ],
          },
          {
            id: "pelican-blueprint",
            title: "New UI",
            detail:
              "A Pelican-based shell wired to Releu. Cleaner hosted-panel structure, but newer bridge logic underneath.",
            pros: [
              "Cleaner layout and navigation",
              "Better hosted-panel style browsing",
            ],
            cons: [
              "Newer shell",
              "Advanced flows can need more verification",
            ],
          },
        ]
          .map(
            (entry) => `
          <div class="rounded-lg border ${currentVariant === entry.id ? "border-white" : "border-[#2b3642]"} bg-[#0f141b] px-5 py-4 text-sm text-slate-300" style="display:grid;gap:1rem;">
            <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap;">
              <div>
                <div class="font-semibold text-slate-100">${escapeHtml(entry.title)}</div>
                <p class="mt-1 text-xs text-slate-400">${escapeHtml(entry.detail)}</p>
              </div>
              <button type="button" class="fi-btn fi-size-md fi-ac-btn-action" data-releu-ui-variant="${escapeHtml(entry.id)}">${currentVariant === entry.id ? "Keep This UI" : `Use ${escapeHtml(entry.title)}`}</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;">
              <div class="rounded-lg border border-[#2b3642] bg-black/30 px-4 py-4">
                <div class="text-xs uppercase tracking-[0.16em] text-slate-500">Pros</div>
                <div class="mt-3" style="display:grid;gap:.45rem;">${entry.pros.map((point) => `<div>${escapeHtml(point)}</div>`).join("")}</div>
              </div>
              <div class="rounded-lg border border-[#2b3642] bg-black/30 px-4 py-4">
                <div class="text-xs uppercase tracking-[0.16em] text-slate-500">Cons</div>
                <div class="mt-3" style="display:grid;gap:.45rem;">${entry.cons.map((point) => `<div>${escapeHtml(point)}</div>`).join("")}</div>
              </div>
            </div>
          </div>`,
          )
          .join("")}
      </div>
    </div>`;
  uiSection.querySelectorAll("[data-releu-ui-variant]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      try {
        setButtonBusy(button, true, "Saving...");
        const variant = button.dataset.releuUiVariant === "pelican-blueprint" ? "pelican-blueprint" : "classic";
        const payload = await api("/api/settings/ui", {
          method: "POST",
          body: {
            variant,
            hasChosenVariant: true,
          },
        });
        APP_STATE.state = payload.state ?? APP_STATE.state;
        if (variant === "classic") {
          window.location.replace(buildLegacyUiUrl(serverId));
          return;
        }
        patchSettingsPage();
        showStatus("Saved preferred Releu UI.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  let devSection = document.querySelector("[data-releu-dev-section]");
  if (!devSection) {
    devSection = document.createElement("section");
    devSection.className = "fi-section mt-6";
    devSection.dataset.releuDevSection = "true";
    devSection.innerHTML = `
      <header class="fi-section-header">
        <div>
          <h2 class="fi-section-header-heading">Developer Console</h2>
          <p class="fi-section-header-description">When off, Releu only shows Minecraft server logs in the console.</p>
        </div>
      </header>
      <div class="fi-section-content-ctn">
        <div class="fi-section-content">
          <div class="rounded-lg border border-[#2b3642] bg-[#0f141b] px-4 py-4 text-sm text-slate-300">
            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="font-semibold text-slate-100">Show playit and panel logs</div>
                <div class="mt-1 text-xs text-slate-400" data-releu-dev-console-state></div>
              </div>
              <button type="button" class="fi-btn fi-size-md fi-ac-btn-action" data-releu-dev-console-toggle></button>
            </div>
          </div>
        </div>
      </div>`;
    document.querySelector(".fi-page-content")?.append(devSection);
  }
  const devState = devSection.querySelector("[data-releu-dev-console-state]");
  const devToggle = devSection.querySelector("[data-releu-dev-console-toggle]");
  if (devState) {
    devState.textContent = devConsoleLogsEnabled()
      ? "Developer logs are visible in the console."
      : "Only Minecraft server logs are visible in the console.";
  }
  if (devToggle) {
    devToggle.textContent = devConsoleLogsEnabled() ? "Disable Dev Logs" : "Enable Dev Logs";
    if (!devToggle.dataset.releuBound) devToggle.addEventListener("click", () => {
      setDevConsoleLogsEnabled(!devConsoleLogsEnabled());
      patchSettingsPage();
    }), devToggle.dataset.releuBound = "true";
  }
}

async function patchPage() {
  if (PAGE === "servers.html") return patchServersPageExactShell();
  if (PAGE === "create-server.html") return patchCreateServerPage();
  if (PAGE === "overview.html") return patchOverviewPage();
  if (PAGE === "console.html") return patchConsolePage();
  if (PAGE === "players.html") return patchPlayersPage();
  if (PAGE === "worlds.html") return patchWorldsPage();
  if (PAGE === "software.html") return patchSoftwarePage();
  if (PAGE === "addons-mods.html") return patchAddonsPage();
  if (PAGE === "backups.html") return patchBackupsPage();
  if (PAGE === "files.html") return patchFilesPage();
  if (PAGE === "misc.html") return patchMiscPage();
  if (PAGE === "settings.html") return patchSettingsPage();
}

async function boot() {
  injectReleaseChromeStyles();
  beginShellEnter();
  wireLocalNavigation();
  suppressSavedShellBehavior();
  showStatus("Loading Releu...");
  await refreshState();
  await refreshLogs().catch(() => []);
  await patchPage();
  stripReleaseBranding();
  finishShellEnter();
  clearStatus();
  if (PAGE !== "servers.html" && PAGE !== "create-server.html") {
    setInterval(async () => {
      try {
        await refreshState(activeServerId());
        await refreshLogs().catch(() => []);
        await patchPage();
      } catch (error) {
        console.error(error);
      }
    }, 4000);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  boot().catch(showError);
});
