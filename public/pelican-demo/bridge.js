const PAGE = location.pathname.split("/").pop() || "servers.html";
const SERVER_PAGES = new Set([
  "overview.html",
  "console.html",
  "players.html",
  "files.html",
  "backups.html",
  "cloud-backup.html",
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
  miscSaveTimer: null,
  miscSaveState: { message: "", tone: "neutral" },
  profileSaveTimer: null,
  profileSaveState: { message: "", tone: "neutral" },
  cloudBackup: {
    status: null,
    loading: false,
    lastFetchedAt: 0,
    draft: {
      deviceLabel: "",
      accountUsername: "",
      accountPassword: "",
      targetRestoreKey: "",
    },
  },
  playerInventoryModal: null,
  filesBrowser: {
    path: "",
    search: "",
    listing: null,
    editor: null,
  },
  quickConsole: {
    open: false,
    draft: "",
    bindingReady: false,
  },
  playersPage: {
    serverId: "",
    search: "",
    rowDrafts: {},
    renderSignature: "",
  },
  backupsPage: {
    serverId: "",
    autoBackups: null,
    backupIntervalMinutes: null,
    maxBackupStorageGb: null,
  },
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

function injectWorldPageStyles() {
  if (document.getElementById("releu-world-page-style")) return;
  const style = document.createElement("style");
  style.id = "releu-world-page-style";
  style.textContent = `
    .pw-grid3{display:grid;gap:.75rem;grid-template-columns:repeat(3,1fr)}
    @media(max-width:1279px){.pw-grid3{grid-template-columns:1fr}}
    .pw-grid2{display:grid;gap:.75rem;grid-template-columns:repeat(2,1fr);margin-top:.75rem}
    @media(max-width:900px){.pw-grid2{grid-template-columns:1fr}}
    .pw-card{background:rgb(var(--gray-900,17 24 32));border:1px solid #2b3642;border-radius:.5rem;overflow:hidden}
    .pw-card-head{padding:.75rem 1rem;border-bottom:1px solid #2b3642}
    .pw-card-title{font-size:.8125rem;font-weight:600;color:#f1f5f9}
    .pw-card-sub{font-size:.75rem;color:#64748b;margin-top:.25rem}
    .pw-card-body{padding:.875rem 1rem;display:flex;flex-direction:column;gap:.625rem}
    .pw-hint{background:rgb(var(--gray-950,15 20 27));border:1px solid #2b3642;border-radius:.375rem;padding:.75rem;font-size:.75rem;color:#64748b;line-height:1.45}
    .pw-desc{font-size:.75rem;color:#94a3b8;line-height:1.5}
    .pw-input{width:100%;background:rgb(var(--gray-950,15 20 27));border:1px solid #2b3642;border-radius:.375rem;padding:.5rem .75rem;font-size:.8125rem;color:#f1f5f9;outline:none}
    .pw-input:focus{border-color:var(--primary-500,#3b82f6)}
    .pw-actions{display:flex;flex-direction:column;gap:.5rem}
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

function ensureBackupsSidebarLink() {
  if (PAGE === "servers.html") return;
  const list = document.querySelector(".fi-sidebar-group-items");
  if (!list) return;
  const existing = [...list.querySelectorAll(".fi-sidebar-item-label")].find(
    (node) => node.textContent?.trim().toLowerCase() === "backups",
  );
  if (existing) return;
  const item = document.createElement("li");
  item.className = `fi-sidebar-item fi-sidebar-item-has-url${PAGE === "backups.html" ? " fi-active" : ""}`;
  item.innerHTML = `<a href="${escapeHtml(buildLocalPageHref("backups.html"))}" class="fi-sidebar-item-btn"><span class="fi-sidebar-item-label">Backups</span></a>`;
  const cloudItem = [...list.children].find((node) =>
    node.querySelector(".fi-sidebar-item-label")?.textContent?.trim().toLowerCase() === "cloud backup",
  );
  const miscItem = [...list.children].find((node) =>
    node.querySelector(".fi-sidebar-item-label")?.textContent?.trim().toLowerCase() === "misc",
  );
  const settingsItem = [...list.children].find((node) =>
    node.querySelector(".fi-sidebar-item-label")?.textContent?.trim().toLowerCase() === "settings",
  );
  if (cloudItem?.parentNode) {
    cloudItem.parentNode.insertBefore(item, cloudItem);
  } else if (miscItem?.parentNode) {
    miscItem.parentNode.insertBefore(item, miscItem);
  } else if (settingsItem?.parentNode) {
    settingsItem.parentNode.insertBefore(item, settingsItem);
  } else {
    list.append(item);
  }
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

function ensureCloudBackupSidebarLink() {
  if (PAGE === "servers.html") return;
  const list = document.querySelector(".fi-sidebar-group-items");
  if (!list) return;
  const existing = [...list.querySelectorAll(".fi-sidebar-item-label")].find(
    (node) => node.textContent?.trim().toLowerCase() === "cloud backup",
  );
  if (existing) return;
  const item = document.createElement("li");
  item.className = `fi-sidebar-item fi-sidebar-item-has-url${PAGE === "cloud-backup.html" ? " fi-active" : ""}`;
  item.innerHTML = `<a href="${escapeHtml(buildLocalPageHref("cloud-backup.html"))}" class="fi-sidebar-item-btn"><span class="fi-sidebar-item-label">Cloud Backup</span></a>`;
  const miscItem = [...list.children].find((node) =>
    node.querySelector(".fi-sidebar-item-label")?.textContent?.trim().toLowerCase() === "misc",
  );
  const settingsItem = [...list.children].find((node) =>
    node.querySelector(".fi-sidebar-item-label")?.textContent?.trim().toLowerCase() === "settings",
  );
  if (miscItem?.parentNode) {
    miscItem.parentNode.insertBefore(item, miscItem);
  } else if (settingsItem?.parentNode) {
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
    : section === "cloud" || section === "cloud-backup" || section === "cloudbackup" ? "cloud-backup.html"
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
  ensureBackupsSidebarLink();
  ensureCloudBackupSidebarLink();
  ensureMiscSidebarLink();
  stripReleaseBranding();
  stripUnusedTopbarChrome();
}

function currentUiSettings() {
  return APP_STATE.state?.uiSettings ?? {
    variant: "pelican-blueprint",
    hasChosenVariant: true,
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

async function apiBinary(url, body, headers = {}, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 0) || 0);
  const controller = timeoutMs ? new AbortController() : null;
  let timeoutId = null;
  if (controller) {
    timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    const response = await fetch(url, {
      method: options.method ?? "POST",
      headers: {
        Accept: "application/json",
        ...(headers ?? {}),
      },
      body,
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

function isDesktopApp() {
  return Boolean(window.desktop);
}

async function pickLocalDirectory() {
  if (!isDesktopApp() || !window.desktop?.pickDirectory) {
    throw new Error("Folder picking is available only in the desktop app.");
  }
  return window.desktop.pickDirectory();
}

async function openLocalPath(targetPath) {
  if (!targetPath) return;
  if (!isDesktopApp() || !window.desktop?.openPath) {
    throw new Error("Opening local folders is available only in the desktop app.");
  }
  const result = await window.desktop.openPath(targetPath);
  if (result) {
    throw new Error(result);
  }
}

function currentDesktopSettings() {
  return APP_STATE.state?.desktopSettings ?? {
    keepServerRunningOnClose: false,
    quickConsoleShortcut: "Ctrl+Shift+Space",
  };
}

async function syncDesktopIntegration() {
  if (!isDesktopApp() || !window.desktop?.applySettings) {
    return;
  }
  try {
    await window.desktop.applySettings(currentDesktopSettings());
  } catch (error) {
    console.error(error);
  }
}

async function openDesktopQuickConsoleWindow(serverId = activeServerId()) {
  if (isDesktopApp() && window.desktop?.openQuickConsole) {
    await window.desktop.openQuickConsole(serverId);
    return;
  }
  navigateToPage("console.html");
}

function normalizeShortcutKey(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "control" || normalized === "ctrl") return "Ctrl";
  if (normalized === "alt" || normalized === "option") return "Alt";
  if (normalized === "shift") return "Shift";
  if (normalized === "meta" || normalized === "cmd" || normalized === "command" || normalized === "win") return "Meta";
  if (normalized === " " || normalized === "space" || normalized === "spacebar") return "Space";
  if (normalized === "escape" || normalized === "esc") return "Escape";
  if (normalized === "arrowup") return "ArrowUp";
  if (normalized === "arrowdown") return "ArrowDown";
  if (normalized === "arrowleft") return "ArrowLeft";
  if (normalized === "arrowright") return "ArrowRight";
  if (normalized === "`" || normalized === "backquote" || normalized === "grave") return "Backquote";
  if (normalized === "/") return "Slash";
  if (normalized.length === 1) return normalized.toUpperCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeShortcutString(value) {
  const tokens = String(value ?? "")
    .split("+")
    .map((part) => normalizeShortcutKey(part))
    .filter(Boolean);
  const modifierOrder = ["Ctrl", "Alt", "Shift", "Meta"];
  const modifiers = modifierOrder.filter((token) => tokens.includes(token));
  const nonModifiers = tokens.filter((token) => !modifierOrder.includes(token));
  return [...modifiers, ...nonModifiers].join("+") || "Ctrl+Shift+Space";
}

function eventMatchesShortcut(event, shortcutValue) {
  const normalizedShortcut = normalizeShortcutString(shortcutValue);
  const parts = normalizedShortcut.split("+").filter(Boolean);
  if (!parts.length) {
    return false;
  }
  const modifiers = new Set(parts.filter((token) => ["Ctrl", "Alt", "Shift", "Meta"].includes(token)));
  const key = parts.find((token) => !["Ctrl", "Alt", "Shift", "Meta"].includes(token)) ?? "";
  if (Boolean(event.ctrlKey) !== modifiers.has("Ctrl")) return false;
  if (Boolean(event.altKey) !== modifiers.has("Alt")) return false;
  if (Boolean(event.shiftKey) !== modifiers.has("Shift")) return false;
  if (Boolean(event.metaKey) !== modifiers.has("Meta")) return false;
  return normalizeShortcutKey(event.key) === key;
}

function injectQuickConsoleStyles() {
  if (document.getElementById("releu-quick-console-style")) return;
  const style = document.createElement("style");
  style.id = "releu-quick-console-style";
  style.textContent = `
    #releu-quick-console{position:fixed;right:1rem;bottom:1rem;z-index:10020}
    #releu-quick-console .rqc-shell{width:min(720px,calc(100vw - 2rem));border:1px solid #2b3642;border-radius:14px;overflow:hidden;background:rgb(var(--gray-900,17 24 32));box-shadow:0 24px 60px rgba(0,0,0,.45)}
    #releu-quick-console .rqc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding:1rem 1rem .8rem;border-bottom:1px solid #2b3642;background:rgb(var(--gray-900,17 24 32))}
    #releu-quick-console .rqc-kicker{font-size:.66rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#94a3b8}
    #releu-quick-console .rqc-title{margin-top:.2rem;font-size:1.05rem;font-weight:700;color:#f8fafc}
    #releu-quick-console .rqc-copy{margin-top:.25rem;font-size:.76rem;line-height:1.45;color:#94a3b8}
    #releu-quick-console .rqc-actions{display:flex;gap:.5rem;flex-wrap:wrap}
    #releu-quick-console .rqc-btn{border:1px solid #2b3642;border-radius:10px;background:rgb(var(--gray-950,15 20 27));padding:.55rem .8rem;font-size:.72rem;font-weight:700;color:#e2e8f0}
    #releu-quick-console .rqc-btn:hover{border-color:#475569}
    #releu-quick-console .rqc-btn[disabled]{opacity:.6;cursor:not-allowed}
    #releu-quick-console .rqc-body{padding:1rem;display:grid;gap:.75rem}
    #releu-quick-console .rqc-status{border:1px solid #2b3642;border-radius:10px;background:rgb(var(--gray-950,15 20 27));padding:.7rem .8rem;font-size:.75rem;color:#94a3b8}
    #releu-quick-console .rqc-log{max-height:260px;overflow:auto;border:1px solid #2b3642;border-radius:10px;background:rgb(var(--gray-950,15 20 27));padding:.85rem 1rem;white-space:pre-wrap;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;color:#e2e8f0}
    #releu-quick-console .rqc-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.65rem}
    #releu-quick-console .rqc-input{width:100%;border:1px solid #2b3642;border-radius:10px;background:rgb(var(--gray-950,15 20 27));padding:.75rem .9rem;font:13px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;color:#f8fafc;outline:none}
    #releu-quick-console .rqc-input:focus{border-color:#64748b}
    #releu-quick-console .rqc-hint{font-size:.72rem;color:#64748b}
    @media (max-width:680px){#releu-quick-console{left:.75rem;right:.75rem;bottom:.75rem}#releu-quick-console .rqc-row{grid-template-columns:1fr}}
  `;
  document.head.append(style);
}

function closeQuickConsole() {
  APP_STATE.quickConsole.open = false;
  renderQuickConsoleOverlay();
}

function renderQuickConsoleOverlay() {
  let host = document.getElementById("releu-quick-console");
  if (!host) {
    host = document.createElement("div");
    host.id = "releu-quick-console";
    document.body.append(host);
  }
  const quickConsole = APP_STATE.quickConsole;
  if (!quickConsole.open) {
    host.innerHTML = "";
    return;
  }
  injectQuickConsoleStyles();
  const server = activeServer();
  const shortcut = normalizeShortcutString(currentDesktopSettings().quickConsoleShortcut);
  const serverRunning = server?.server?.status === "running";
  host.innerHTML = `
    <div class="rqc-shell">
      <div class="rqc-head">
        <div>
          <div class="rqc-kicker">Quick Console</div>
          <div class="rqc-title">${escapeHtml(server?.name ?? "No server selected")}</div>
          <div class="rqc-copy">Shortcut: ${escapeHtml(shortcut)}. ${serverRunning ? "Send Minecraft commands without leaving the current page." : "View the latest logs even while the server is stopped."}</div>
        </div>
        <div class="rqc-actions">
          <button type="button" class="rqc-btn" data-rqc-open-console>Open Console</button>
          <button type="button" class="rqc-btn" data-rqc-close>Close</button>
        </div>
      </div>
      <div class="rqc-body">
        <div class="rqc-status">${escapeHtml(serverRunning ? "Server is running. Commands send instantly." : "Server is offline. You can still read logs here, but command sending is disabled.")}</div>
        <pre class="rqc-log">${escapeHtml(toLogBlock(40) || "No logs yet.")}</pre>
        <div class="rqc-row">
          <input type="text" class="rqc-input" data-rqc-input value="${escapeHtml(quickConsole.draft ?? "")}" placeholder="${escapeHtml(serverRunning ? "Type a Minecraft command..." : "Server offline")}" ${serverRunning ? "" : "disabled"} />
          <button type="button" class="rqc-btn" data-rqc-send ${serverRunning ? "" : "disabled"}>Send</button>
        </div>
        <div class="rqc-hint">Press ${escapeHtml(shortcut)} again to close this panel.</div>
      </div>
    </div>`;
  host.querySelector("[data-rqc-close]")?.addEventListener("click", closeQuickConsole);
  host.querySelector("[data-rqc-open-console]")?.addEventListener("click", () => {
    closeQuickConsole();
    navigateToPage("console.html");
  });
  const input = host.querySelector("[data-rqc-input]");
  if (input) {
    input.addEventListener("input", () => {
      APP_STATE.quickConsole.draft = input.value;
    });
    input.addEventListener("keydown", async (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeQuickConsole();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        await submitQuickConsoleCommand();
      }
    });
    window.requestAnimationFrame(() => {
      if (document.body.contains(input)) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  }
  host.querySelector("[data-rqc-send]")?.addEventListener("click", async () => {
    await submitQuickConsoleCommand();
  });
}

async function submitQuickConsoleCommand() {
  const server = activeServer();
  if (!server || server.server?.status !== "running") {
    return;
  }
  const command = String(APP_STATE.quickConsole.draft ?? "").trim();
  if (!command) {
    return;
  }
  await api(`/api/servers/${encodeURIComponent(activeServerId())}/server/command`, {
    method: "POST",
    body: { command },
  });
  APP_STATE.quickConsole.draft = "";
  await refreshLogs();
  renderQuickConsoleOverlay();
}

function ensureQuickConsoleBinding() {
  if (APP_STATE.quickConsole.bindingReady) {
    return;
  }
  APP_STATE.quickConsole.bindingReady = true;
  document.addEventListener("keydown", async (event) => {
    const shortcut = currentDesktopSettings().quickConsoleShortcut;
    if (!shortcut || !eventMatchesShortcut(event, shortcut) || event.repeat) {
      return;
    }
    event.preventDefault();
    try {
      await openDesktopQuickConsoleWindow(activeServerId());
    } catch (error) {
      showError(error);
    }
  });
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
  await syncDesktopIntegration();
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
    button.dataset.releuOriginalHtml = button.innerHTML;
    button.dataset.releuOriginalText = button.textContent.trim();
    button.disabled = true;
    button.textContent = label ?? "Loading...";
  } else {
    button.disabled = false;
    if (button.dataset.releuOriginalHtml) {
      button.innerHTML = button.dataset.releuOriginalHtml;
      delete button.dataset.releuOriginalHtml;
      delete button.dataset.releuOriginalText;
    } else if (button.dataset.releuOriginalText) {
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
                  ["Cloud Backup", "cloud-backup.html"],
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
                      ["Cloud Backup", "cloud-backup.html"],
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

  const header = document.querySelector(".fi-page-header-main-ctn .fi-header");
  if (header) {
    header.classList.add("justify-between", "gap-4");
    let actions = header.querySelector(".fi-header-actions-ctn");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "fi-header-actions-ctn flex flex-wrap items-center gap-3";
      header.append(actions);
    }
    if (!actions.querySelector("[data-releu-create-server]")) {
      const createButton = document.createElement("button");
      createButton.type = "button";
      createButton.className =
        "fi-color fi-color-primary fi-bg-color-600 hover:fi-bg-color-500 dark:fi-bg-color-600 dark:hover:fi-bg-color-500 fi-text-color-0 hover:fi-text-color-0 dark:fi-text-color-0 dark:hover:fi-text-color-0 fi-btn fi-size-md fi-ac-btn-action";
      createButton.dataset.releuCreateServer = "true";
      createButton.textContent = "Create New Server";
      actions.append(createButton);
    }
  }

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

  document.querySelectorAll("[data-releu-create-server]").forEach((button) => {
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

function normalizeDraftJavaPath(javaPath) {
  const normalized = String(javaPath ?? "").trim();
  if (!normalized) return "java";
  if (/^win/i.test(String(navigator.platform ?? "")) && normalized.startsWith("/")) {
    return "java";
  }
  return normalized;
}

function buildCreateDraft() {
  return { name: "", software: "purpur", version: "latest", minRamMb: 1024, maxRamMb: 4096, cpuCores: 4, gpuShare: 0, javaPath: "java" };
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
    javaPath: normalizeDraftJavaPath(launcher.javaPath),
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
  const javaInput =
    [...document.querySelectorAll(".psw-java-row .psw-input")].find((input) => input !== nameInput) ??
    null;
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
  const serverRunning = server.server?.status === "running";
  [...document.querySelectorAll(".fi-header-actions-ctn .fi-btn, .fi-header-actions-ctn button")].forEach((button) => {
    const label = button.textContent.trim().toLowerCase();
    if (!(label === "start" || label === "restart" || label === "stop")) return;
    button.dataset.releuControlCurrent = label;
    const shouldDisable =
      (label === "start" && serverRunning) ||
      ((label === "restart" || label === "stop") && !serverRunning);
    button.disabled = shouldDisable;
    if (shouldDisable) {
      button.setAttribute("disabled", "disabled");
      button.setAttribute("aria-disabled", "true");
      button.classList.add("fi-disabled");
      button.style.pointerEvents = "none";
      button.style.opacity = ".6";
    } else {
      button.removeAttribute("disabled");
      button.setAttribute("aria-disabled", "false");
      button.classList.remove("fi-disabled");
      button.style.pointerEvents = "auto";
      button.style.opacity = "";
    }
    if (button.dataset.releuBound) return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", (event) => {
      if (button.disabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      runServerControl(
        button.dataset.releuControlCurrent || button.textContent.trim().toLowerCase(),
        button,
      );
    });
  });
}

function playerAvatar(player) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(player.uuid || player.name)}/32`;
}

function inventoryModalState() {
  return APP_STATE.playerInventoryModal;
}

function selectedInventoryCatalogItem() {
  const modal = inventoryModalState();
  if (!modal?.catalog?.results?.length || !modal.selectedItemId) {
    return null;
  }
  return modal.catalog.results.find((entry) => entry.id === modal.selectedItemId) ?? null;
}

function closePlayerInventoryModal() {
  APP_STATE.playerInventoryModal = null;
  delete document.body.dataset.releuInventoryModalOpen;
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
  renderPlayerInventoryModal();
}

async function searchPlayerInventoryCatalog(query = "") {
  const modal = inventoryModalState();
  if (!modal) return;
  modal.catalogQueryDraft = query;
  modal.catalogLoading = true;
  renderPlayerInventoryModal();
  try {
    const payload = await api(
      `/api/servers/${encodeURIComponent(activeServerId())}/items/catalog?query=${encodeURIComponent(query)}`,
    );
    modal.catalog = payload.catalog;
    modal.catalogQuery = query;
    if (!modal.selectedItemId || !modal.catalog.results.some((entry) => entry.id === modal.selectedItemId)) {
      modal.selectedItemId = modal.catalog.results[0]?.id ?? "";
    }
  } catch (error) {
    modal.message = error.message ?? String(error);
    modal.messageTone = "error";
  } finally {
    modal.catalogLoading = false;
    renderPlayerInventoryModal();
  }
}

async function loadPlayerInventoryModal(playerName, { preserveMessage = false } = {}) {
  const modal = inventoryModalState();
  if (!modal) return;
  modal.loading = true;
  if (!preserveMessage) {
    modal.message = "";
    modal.messageTone = "neutral";
  }
  renderPlayerInventoryModal();
  try {
    const payload = await api(
      `/api/servers/${encodeURIComponent(activeServerId())}/players/${encodeURIComponent(playerName)}/inventory`,
    );
    modal.playerName = playerName;
    modal.inventory = payload.inventory;
    modal.lastLoadedAt = Date.now();
  } catch (error) {
    modal.message = error.message ?? String(error);
    modal.messageTone = "error";
  } finally {
    modal.loading = false;
    renderPlayerInventoryModal();
  }
}

async function openPlayerInventoryModal(playerName) {
  APP_STATE.playerInventoryModal = {
    playerName,
    inventory: null,
    loading: true,
    busy: false,
    message: "",
    messageTone: "neutral",
    catalog: null,
    catalogQuery: "",
    catalogQueryDraft: "",
    catalogLoading: false,
    selectedItemId: "",
    addCount: 1,
  };
  renderPlayerInventoryModal();
  await Promise.all([
    loadPlayerInventoryModal(playerName),
    searchPlayerInventoryCatalog(""),
  ]);
}

function inventorySlotMarkupLegacy(slot, kind = "main") {
  const item = slot.item;
  const baseClass = [
    "relative rounded-xl border p-2 text-left transition",
    slot.selected
      ? "border-cyan-400 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.24)]"
      : "border-white/10 bg-slate-950/80",
    item ? "hover:border-white/30" : "",
  ].join(" ");
  const sizeClass = kind === "main" || kind === "hotbar" ? "min-h-[74px]" : "min-h-[82px]";
  const itemName = item?.displayName ?? "Empty";
  return `<div class="${baseClass} ${sizeClass}" title="${escapeHtml(slot.label)}${item ? ` • ${escapeHtml(item.displayName)} x${item.count}` : ""}">
    <div class="mb-1 flex items-start justify-between gap-2">
      <span class="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">${escapeHtml(slot.label)}</span>
      ${item ? `<button type="button" class="rounded border border-rose-400/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-rose-200 hover:border-rose-300 hover:text-white" data-inventory-clear-slot="${slot.slotId}">Clear</button>` : ""}
    </div>
    <div class="space-y-1">
      <div class="line-clamp-2 text-xs font-semibold text-white">${escapeHtml(itemName)}</div>
      <div class="flex items-center justify-between text-[11px] text-slate-300">
        <span>${item ? escapeHtml(item.id.replace(/^minecraft:/, "")) : "empty"}</span>
        <span>${item ? `x${escapeHtml(item.count)}` : ""}</span>
      </div>
    </div>
  </div>`;
}

function renderInventoryModalContentLegacy(modal) {
  const inventory = modal.inventory;
  const catalogResults = modal.catalog?.results ?? [];
  const selectedItem = selectedInventoryCatalogItem();
  const statusToneClass =
    modal.messageTone === "error"
      ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
      : modal.messageTone === "success"
        ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
        : "border-white/10 bg-black/30 text-slate-300";
  return `<div class="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4">
    <div class="w-full max-w-7xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900 text-slate-100 shadow-2xl">
      <div class="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div>
          <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Player Inventory</div>
          <div class="mt-1 text-2xl font-semibold text-white">${escapeHtml(modal.playerName)}</div>
          <div class="mt-1 text-sm text-slate-400">${inventory ? `${escapeHtml(inventory.player.uuid)} • ${inventory.player.online ? "Online" : "Offline"} • ${inventory.occupiedSlots}/${inventory.totalSlots} occupied` : "Loading inventory snapshot..."}</div>
        </div>
        <button type="button" class="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-300 hover:border-white/30 hover:text-white" data-inventory-close>Close</button>
      </div>
      <div class="grid gap-0 xl:grid-cols-[minmax(0,1.35fr)_380px]">
        <div class="border-r border-white/10 p-6">
          <div class="rounded-2xl border border-white/10 bg-slate-950/80 p-5" style="background-image:linear-gradient(rgba(2,6,23,0.90),rgba(2,6,23,0.90)),url('${escapeHtml(inventory?.textureUrl ?? "")}');background-position:center;background-repeat:no-repeat;background-size:cover;image-rendering:pixelated;">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div class="text-sm text-slate-300">${inventory?.source === "live-playerdata" ? "Live player snapshot flushed from the running server." : "Saved playerdata snapshot from disk."}</div>
              <div class="text-xs uppercase tracking-[0.16em] text-slate-500">Selected Hotbar Slot: ${(inventory?.selectedHotbarSlot ?? 0) + 1}</div>
            </div>
            ${modal.loading || !inventory ? `<div class="flex min-h-[460px] items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-slate-400">Loading inventory...</div>` : `
              <div class="grid gap-4 lg:grid-cols-[88px_minmax(0,1fr)_88px]">
                <div class="space-y-3">${inventory.armor.map((slot) => inventorySlotMarkup(slot, "armor")).join("")}</div>
                <div class="space-y-4">
                  <div class="grid grid-cols-9 gap-2">${inventory.main.map((slot) => inventorySlotMarkup(slot, "main")).join("")}</div>
                  <div class="grid grid-cols-9 gap-2">${inventory.hotbar.map((slot) => inventorySlotMarkup(slot, "hotbar")).join("")}</div>
                </div>
                <div class="space-y-3">${inventorySlotMarkup(inventory.offhand, "offhand")}</div>
              </div>
            `}
          </div>
        </div>
        <aside class="space-y-4 p-6">
          <div class="rounded-xl border border-white/10 bg-slate-950/80 p-4">
            <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Inventory Actions</div>
            <div class="mt-3 rounded-xl border ${statusToneClass} px-3 py-2 text-sm">${escapeHtml(modal.message || "Use the item catalog to add items, or clear slots directly from the inventory view.")}</div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" class="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-white/30 hover:text-white" data-inventory-refresh ${modal.busy ? "disabled" : ""}>Refresh</button>
              <button type="button" class="rounded-lg border border-rose-400/30 px-3 py-2 text-sm font-semibold text-rose-100 hover:border-rose-300 hover:text-white" data-inventory-clear-all ${modal.busy ? "disabled" : ""}>Clear Entire Inventory</button>
            </div>
          </div>
          <div class="rounded-xl border border-white/10 bg-slate-950/80 p-4">
            <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Item Catalog</div>
            <form class="mt-3 flex gap-2" data-inventory-search-form>
              <input type="text" name="query" value="${escapeHtml(modal.catalogQuery ?? "")}" placeholder="diamond sword" class="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400" />
              <button type="submit" class="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-white/30 hover:text-white">${modal.catalogLoading ? "Searching..." : "Search"}</button>
            </form>
            <div class="mt-3 flex items-end gap-2">
              <label class="flex-1">
                <div class="mb-1 text-[11px] uppercase tracking-[0.16em] text-slate-500">Count</div>
                <input type="number" min="1" max="9999" value="${escapeHtml(modal.addCount ?? 1)}" data-inventory-count class="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400" />
              </label>
              <button type="button" class="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100 hover:border-cyan-300 hover:text-white" data-inventory-add ${selectedItem ? "" : "disabled"}>${modal.busy ? "Working..." : "Add Item"}</button>
            </div>
            <div class="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">
              ${selectedItem ? `Selected: ${escapeHtml(selectedItem.displayName)} (${escapeHtml(selectedItem.id)})` : "Select an item from the catalog results below."}
            </div>
            <div class="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
              ${catalogResults.length
                ? catalogResults.map((entry) => {
                  const selected = modal.selectedItemId === entry.id;
                  return `<button type="button" class="w-full rounded-xl border px-3 py-3 text-left transition ${selected ? "border-cyan-400 bg-cyan-500/10 text-white" : "border-white/10 bg-slate-900/70 text-slate-200 hover:border-white/25"}" data-inventory-select-item="${escapeHtml(entry.id)}">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <div class="text-sm font-semibold">${escapeHtml(entry.displayName)}</div>
                        <div class="mt-1 text-xs text-slate-400">${escapeHtml(entry.id)} • Stack ${escapeHtml(entry.stackSize)}</div>
                      </div>
                      ${entry.maxDurability ? `<span class="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">Durability ${escapeHtml(entry.maxDurability)}</span>` : ""}
                    </div>
                  </button>`;
                }).join("")
                : `<div class="rounded-xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-500">No catalog items matched that search.</div>`}
            </div>
          </div>
        </aside>
      </div>
    </div>
  </div>`;
}

function renderPlayerInventoryModal() {
  let host = document.getElementById("releu-player-inventory-modal");
  if (!host) {
    host = document.createElement("div");
    host.id = "releu-player-inventory-modal";
    host.style.position = "relative";
    host.style.zIndex = "9999";
    document.body.append(host);
  }
  const modal = inventoryModalState();
  if (!modal) {
    host.innerHTML = "";
    return;
  }
  const previousCatalog = host.querySelector(".rvm-catalog");
  const previousLog = host.querySelector(".rvm-log");
  const previousCatalogScrollTop = previousCatalog?.scrollTop ?? 0;
  const previousLogScrollTop = previousLog?.scrollTop ?? 0;
  document.body.dataset.releuInventoryModalOpen = "true";
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  host.innerHTML = renderInventoryModalContent(modal);
  host.querySelector("[data-inventory-close]")?.addEventListener("click", closePlayerInventoryModal);
  host.querySelector(".rvm-overlay")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closePlayerInventoryModal();
    }
  });
  host.querySelector("[data-inventory-refresh]")?.addEventListener("click", async () => {
    await loadPlayerInventoryModal(modal.playerName, { preserveMessage: true });
  });
  host.querySelector("[data-inventory-clear-all]")?.addEventListener("click", async () => {
    if (!window.confirm(`Clear every inventory slot for ${modal.playerName}?`)) return;
    modal.busy = true;
    modal.message = "Clearing inventory...";
    modal.messageTone = "neutral";
    renderPlayerInventoryModal();
    try {
      const payload = await api(
        `/api/servers/${encodeURIComponent(activeServerId())}/players/${encodeURIComponent(modal.playerName)}/inventory/clear`,
        { method: "POST", body: { clearAll: true } },
      );
      modal.inventory = payload.inventory;
      modal.message = "Inventory cleared.";
      modal.messageTone = "success";
      await refreshLogs();
    } catch (error) {
      modal.message = error.message ?? String(error);
      modal.messageTone = "error";
    } finally {
      modal.busy = false;
      renderPlayerInventoryModal();
    }
  });
  host.querySelectorAll("[data-inventory-clear-slot]").forEach((button) => {
    button.addEventListener("click", async () => {
      const slotId = Number(button.dataset.inventoryClearSlot);
      const slot = [...(modal.inventory?.armor ?? []), ...(modal.inventory?.main ?? []), ...(modal.inventory?.hotbar ?? []), modal.inventory?.offhand]
        .flat()
        .find((entry) => Number(entry?.slotId) === slotId);
      if (!slot?.item) return;
      if (!window.confirm(`Remove ${slot.item.displayName} from ${modal.playerName}'s ${slot.label}?`)) {
        return;
      }
      modal.busy = true;
      modal.message = `Clearing ${slot.label}...`;
      modal.messageTone = "neutral";
      renderPlayerInventoryModal();
      try {
        const payload = await api(
          `/api/servers/${encodeURIComponent(activeServerId())}/players/${encodeURIComponent(modal.playerName)}/inventory/clear`,
          { method: "POST", body: { slotId } },
        );
        modal.inventory = payload.inventory;
        modal.message = `${slot.label} cleared.`;
        modal.messageTone = "success";
        await refreshLogs();
      } catch (error) {
        modal.message = error.message ?? String(error);
        modal.messageTone = "error";
      } finally {
        modal.busy = false;
        renderPlayerInventoryModal();
      }
    });
  });
  host.querySelector("[data-inventory-search-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = event.currentTarget.querySelector('[name="query"]')?.value ?? "";
    await searchPlayerInventoryCatalog(query);
  });
  host.querySelector('[data-inventory-search-form] [name="query"]')?.addEventListener("input", (event) => {
    modal.catalogQueryDraft = event.currentTarget.value ?? "";
  });
  host.querySelector("[data-inventory-count]")?.addEventListener("input", (event) => {
    const numeric = Math.max(1, Math.min(9999, Number(event.currentTarget.value ?? 1) || 1));
    modal.addCount = numeric;
  });
  host.querySelectorAll("[data-inventory-select-item]").forEach((button) => {
    button.addEventListener("click", () => {
      modal.selectedItemId = button.dataset.inventorySelectItem;
      renderPlayerInventoryModal();
    });
  });
  host.querySelector("[data-inventory-add]")?.addEventListener("click", async () => {
    const item = selectedInventoryCatalogItem();
    if (!item) return;
    modal.busy = true;
    modal.message = `Adding ${item.displayName}...`;
    modal.messageTone = "neutral";
    renderPlayerInventoryModal();
    try {
      const payload = await api(
        `/api/servers/${encodeURIComponent(activeServerId())}/players/${encodeURIComponent(modal.playerName)}/inventory/give`,
        {
          method: "POST",
          body: {
            itemId: item.id,
            count: modal.addCount ?? 1,
          },
        },
      );
      modal.inventory = payload.inventory;
      modal.message = `Added ${modal.addCount ?? 1}x ${item.displayName}.`;
      modal.messageTone = "success";
      await refreshLogs();
    } catch (error) {
      modal.message = error.message ?? String(error);
      modal.messageTone = "error";
    } finally {
      modal.busy = false;
      renderPlayerInventoryModal();
    }
  });
  const newCatalog = host.querySelector(".rvm-catalog");
  if (newCatalog) {
    newCatalog.scrollTop = previousCatalogScrollTop;
  }
  const newLog = host.querySelector(".rvm-log");
  if (newLog) {
    newLog.scrollTop = previousLogScrollTop;
  }
}

function inventoryItemAssetName(itemId = "") {
  return String(itemId ?? "")
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, "");
}

function inventoryItemFallbackText(value, fallback = "?") {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function inventoryItemIconMarkup(item, fallbackLabel = "Item") {
  if (!item?.id) {
    return `<span class="rvm-slot-icon rvm-slot-icon-empty"><span class="rvm-slot-icon-fallback">${escapeHtml(inventoryItemFallbackText(fallbackLabel, "?"))}</span></span>`;
  }
  const assetName = inventoryItemAssetName(item.id);
  const primary = `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.8/assets/minecraft/textures/item/${assetName}.png`;
  const secondary = `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.8/assets/minecraft/textures/block/${assetName}.png`;
  return `<span class="rvm-slot-icon">
    <span class="rvm-slot-icon-fallback">${escapeHtml(inventoryItemFallbackText(item.displayName ?? item.id, fallbackLabel))}</span>
    <img class="rvm-slot-icon-img" src="${escapeHtml(primary)}" alt="${escapeHtml(item.displayName ?? item.id)}" onerror="if(!this.dataset.blockFallback){this.dataset.blockFallback='1';this.src='${escapeHtml(secondary)}';return;}this.style.display='none';" />
  </span>`;
}

function inventorySlotBadge(slot, kind = "main") {
  if (kind === "hotbar") {
    return `H${Math.max(1, Number(slot.slotId ?? 0) + 1)}`;
  }
  if (kind === "main") {
    return String(Math.max(1, Number(slot.slotId ?? 9) - 8));
  }
  return slot.label;
}

function inventorySlotMarkup(slot, kind = "main") {
  const item = slot.item;
  const itemName = item?.displayName ?? "Empty";
  const slotClasses = [
    "rvm-slot",
    `rvm-slot-${kind}`,
    slot.selected ? "is-selected" : "",
    item ? "has-item" : "is-empty",
  ].filter(Boolean).join(" ");
  const tooltip = item
    ? `${slot.label} - ${item.displayName} x${item.count} - ${item.id}`
    : `${slot.label} - Empty`;
  return `<div class="${slotClasses}" title="${escapeHtml(tooltip)}">
    <div class="rvm-slot-top">
      <span class="rvm-slot-tag">${escapeHtml(inventorySlotBadge(slot, kind))}</span>
      ${item ? `<button type="button" class="rvm-slot-clear" data-inventory-clear-slot="${slot.slotId}">Clear</button>` : ""}
    </div>
    <div class="rvm-slot-center">
      ${inventoryItemIconMarkup(item, slot.label)}
      ${item?.count > 1 ? `<span class="rvm-slot-count">x${escapeHtml(item.count)}</span>` : ""}
    </div>
    <div class="rvm-slot-name ${item ? "" : "is-empty"}">${escapeHtml(itemName)}</div>
    <div class="rvm-slot-meta">${item ? escapeHtml(item.id.replace(/^minecraft:/, "")) : "empty"}</div>
  </div>`;
}

function renderInventoryModalContent(modal) {
  const inventory = modal.inventory;
  const catalogResults = modal.catalog?.results ?? [];
  const selectedItem = selectedInventoryCatalogItem();
  const statusToneClass =
    modal.messageTone === "error"
      ? "rvm-status-error"
      : modal.messageTone === "success"
        ? "rvm-status-success"
        : "rvm-status-neutral";
  const playerInfo = inventory?.player ?? null;
  return `<style id="releu-player-inventory-modal-style">
    #releu-player-inventory-modal .rvm-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;overflow:auto;background:rgba(15,20,27,.96)}
    #releu-player-inventory-modal .rvm-shell{position:relative;isolation:isolate;width:min(1400px,100%);max-height:calc(100vh - 2rem);overflow:auto;border-radius:18px;border:1px solid #2b3642;background:rgb(var(--gray-900,17 24 32));color:#e2e4e9;box-shadow:0 28px 90px rgba(0,0,0,.55)}
    #releu-player-inventory-modal .rvm-shell::-webkit-scrollbar{width:8px}
    #releu-player-inventory-modal .rvm-shell::-webkit-scrollbar-thumb{background:rgba(148,163,184,.28);border-radius:999px}
    #releu-player-inventory-modal .rvm-header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding:1.25rem 1.5rem;border-bottom:1px solid rgba(255,255,255,.08)}
    #releu-player-inventory-modal .rvm-header-main{min-width:0;flex:1}
    #releu-player-inventory-modal .rvm-kicker{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#7a7f8e}
    #releu-player-inventory-modal .rvm-title{margin-top:.25rem;font-size:clamp(1.05rem,3.4vw,1.45rem);font-weight:700;line-height:1.08;color:#fff;overflow-wrap:anywhere}
    #releu-player-inventory-modal .rvm-header-copy{margin-top:.35rem;max-width:100%;font-size:.84rem;line-height:1.45;color:#8f96a3;overflow-wrap:anywhere}
    #releu-player-inventory-modal .rvm-header-actions{display:flex;gap:.5rem;flex-wrap:wrap}
    #releu-player-inventory-modal .rvm-btn{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;border-radius:8px;border:1px solid #2b3642;background:rgb(var(--gray-950,15 20 27));padding:.5rem .8rem;font-size:.8rem;font-weight:600;color:#e2e4e9;transition:border-color .12s ease,background .12s ease,color .12s ease}
    #releu-player-inventory-modal .rvm-btn:hover:not([disabled]){border-color:#475569;background:#1a2330;color:#fff}
    #releu-player-inventory-modal .rvm-btn[disabled]{cursor:default;opacity:.55}
    #releu-player-inventory-modal .rvm-btn-danger{background:rgba(240,106,106,.12);border-color:rgba(240,106,106,.24);color:#f4b1b1}
    #releu-player-inventory-modal .rvm-btn-danger:hover:not([disabled]){background:rgba(240,106,106,.2);border-color:rgba(240,106,106,.4);color:#fff}
    #releu-player-inventory-modal .rvm-btn-accent{background:rgb(var(--gray-950,15 20 27));border-color:#2b3642;color:#e5e7eb}
    #releu-player-inventory-modal .rvm-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:1rem;padding:1.25rem 1.5rem}
    #releu-player-inventory-modal .rvm-main{display:flex;flex-direction:column;gap:.875rem}
    #releu-player-inventory-modal .rvm-playerbar{display:flex;align-items:center;gap:.9rem;min-width:0;border:1px solid #2b3642;border-radius:14px;background:rgb(var(--gray-950,15 20 27));padding:.9rem 1rem}
    #releu-player-inventory-modal .rvm-avatar{width:42px;height:42px;border-radius:8px;background:rgb(var(--gray-950,15 20 27));border:1px solid #2b3642;overflow:hidden;flex-shrink:0}
    #releu-player-inventory-modal .rvm-avatar img{width:100%;height:100%;display:block;image-rendering:pixelated}
    #releu-player-inventory-modal .rvm-player-meta{min-width:0;flex:1}
    #releu-player-inventory-modal .rvm-player-name{font-size:.98rem;font-weight:700;line-height:1.15;color:#fff;overflow-wrap:anywhere}
    #releu-player-inventory-modal .rvm-player-uuid{margin-top:.15rem;max-width:100%;font-size:.7rem;color:#7a7f8e;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;line-height:1.4;overflow-wrap:anywhere;word-break:break-word}
    #releu-player-inventory-modal .rvm-tags{display:flex;gap:.4rem;min-width:0;flex-wrap:wrap}
    #releu-player-inventory-modal .rvm-tag{display:inline-flex;align-items:center;gap:.35rem;padding:.24rem .5rem;border-radius:999px;border:1px solid #2b3642;background:rgb(var(--gray-950,15 20 27));font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#d4d8de}
    #releu-player-inventory-modal .rvm-tag-dot{width:6px;height:6px;border-radius:999px;background:currentColor}
    #releu-player-inventory-modal .rvm-tag-online{color:#4ade80;border-color:rgba(74,222,128,.22);background:rgba(74,222,128,.1)}
    #releu-player-inventory-modal .rvm-tag-neutral{color:#cbd5e1}
    #releu-player-inventory-modal .rvm-stat{min-width:88px;text-align:right;flex-shrink:0}
    #releu-player-inventory-modal .rvm-stat-label{font-size:.63rem;letter-spacing:.08em;text-transform:uppercase;color:#7a7f8e}
    #releu-player-inventory-modal .rvm-stat-value{margin-top:.15rem;font-size:.9rem;font-weight:700;color:#fff}
    #releu-player-inventory-modal .rvm-board{border:1px solid #2b3642;border-radius:14px;background:rgb(var(--gray-900,17 24 32));padding:1rem}
    #releu-player-inventory-modal .rvm-board-meta{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:.9rem;font-size:.76rem;color:#8f96a3}
    #releu-player-inventory-modal .rvm-board-meta strong{color:#fff}
    #releu-player-inventory-modal .rvm-shell-grid{display:grid;grid-template-columns:84px minmax(0,1fr) 84px;gap:.8rem;align-items:start}
    #releu-player-inventory-modal .rvm-shell-col{display:flex;flex-direction:column;gap:.35rem}
    #releu-player-inventory-modal .rvm-section-label{margin-bottom:.15rem;font-size:.62rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#5f6573}
    #releu-player-inventory-modal .rvm-slot-stack{display:flex;flex-direction:column;gap:.55rem}
    #releu-player-inventory-modal .rvm-slot-grid{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:.35rem}
    #releu-player-inventory-modal .rvm-divider{height:1px;background:rgba(255,255,255,.08);margin:.15rem 0}
    #releu-player-inventory-modal .rvm-slot{display:flex;flex-direction:column;gap:.28rem;min-height:72px;padding:.38rem;border-radius:10px;border:1px solid #2b3642;background:rgb(var(--gray-950,15 20 27));transition:border-color .12s ease,background .12s ease}
    #releu-player-inventory-modal .rvm-slot-armor,#releu-player-inventory-modal .rvm-slot-offhand{min-height:78px}
    #releu-player-inventory-modal .rvm-slot.has-item:hover{border-color:rgba(255,255,255,.2)}
    #releu-player-inventory-modal .rvm-slot.is-selected{border-color:#64748b;background:#1a2330;box-shadow:0 0 0 1px rgba(148,163,184,.14)}
    #releu-player-inventory-modal .rvm-slot-top{display:flex;align-items:flex-start;justify-content:space-between;gap:.3rem}
    #releu-player-inventory-modal .rvm-slot-tag{font-size:.56rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#667085}
    #releu-player-inventory-modal .rvm-slot-clear{border:1px solid rgba(240,106,106,.28);background:rgba(240,106,106,.1);border-radius:4px;padding:.08rem .3rem;font-size:.52rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#f4b1b1}
    #releu-player-inventory-modal .rvm-slot-clear:hover{border-color:rgba(240,106,106,.45);background:rgba(240,106,106,.18);color:#fff}
    #releu-player-inventory-modal .rvm-slot-center{position:relative;display:flex;align-items:center;justify-content:center;min-height:32px}
    #releu-player-inventory-modal .rvm-slot-icon{position:relative;display:grid;place-items:center;width:30px;height:30px}
    #releu-player-inventory-modal .rvm-slot-icon-empty{opacity:.4}
    #releu-player-inventory-modal .rvm-slot-icon-fallback{display:grid;place-items:center;width:100%;height:100%;border-radius:6px;background:rgb(var(--gray-950,15 20 27));color:#9aa3b2;font-size:.62rem;font-weight:700;letter-spacing:.06em}
    #releu-player-inventory-modal .rvm-slot-icon-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
    #releu-player-inventory-modal .rvm-slot-count{position:absolute;right:-2px;bottom:-2px;color:#facc15;font-size:.62rem;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,.85)}
    #releu-player-inventory-modal .rvm-slot-name{font-size:.63rem;font-weight:700;color:#fff;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
    #releu-player-inventory-modal .rvm-slot-name.is-empty{color:#667085;font-weight:500;font-style:italic}
    #releu-player-inventory-modal .rvm-slot-meta{font-size:.55rem;color:#7a7f8e;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
    #releu-player-inventory-modal .rvm-side{display:flex;flex-direction:column;gap:.875rem}
    #releu-player-inventory-modal .rvm-card{border:1px solid #2b3642;border-radius:14px;background:rgb(var(--gray-900,17 24 32));padding:.95rem 1rem}
    #releu-player-inventory-modal .rvm-card-title{font-size:.62rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7a7f8e}
    #releu-player-inventory-modal .rvm-status{margin-top:.75rem;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:.7rem .8rem;font-size:.8rem;line-height:1.5}
    #releu-player-inventory-modal .rvm-status-neutral{background:rgb(var(--gray-950,15 20 27));color:#cbd5e1}
    #releu-player-inventory-modal .rvm-status-success{background:#16261f;border-color:rgba(62,207,142,.22);color:#d1fae5}
    #releu-player-inventory-modal .rvm-status-error{background:#2a1719;border-color:rgba(240,106,106,.22);color:#ffe4e6}
    #releu-player-inventory-modal .rvm-action-row{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.75rem}
    #releu-player-inventory-modal .rvm-field-label{display:block;margin-bottom:.32rem;font-size:.6rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7a7f8e}
    #releu-player-inventory-modal .rvm-input{width:100%;border:1px solid #2b3642;border-radius:8px;background:rgb(var(--gray-950,15 20 27));padding:.55rem .75rem;font-size:.82rem;color:#f8fafc;outline:none}
    #releu-player-inventory-modal .rvm-input::placeholder{color:#667085}
    #releu-player-inventory-modal .rvm-input:focus{border-color:#64748b}
    #releu-player-inventory-modal .rvm-search-row{display:flex;gap:.5rem;margin-top:.75rem}
    #releu-player-inventory-modal .rvm-search-row .rvm-input{flex:1}
    #releu-player-inventory-modal .rvm-add-row{display:grid;grid-template-columns:1fr auto;gap:.5rem;align-items:end;margin-top:.75rem}
    #releu-player-inventory-modal .rvm-selected{display:flex;align-items:center;gap:.55rem;margin-top:.75rem;padding:.65rem .75rem;border:1px solid rgba(148,163,184,.2);border-radius:10px;background:rgb(var(--gray-950,15 20 27));color:#e5e7eb;font-size:.76rem}
    #releu-player-inventory-modal .rvm-selected-dot{width:6px;height:6px;border-radius:999px;background:#94a3b8;flex-shrink:0}
    #releu-player-inventory-modal .rvm-catalog{display:flex;flex-direction:column;gap:.35rem;max-height:420px;overflow:auto;margin-top:.75rem;padding-right:.1rem}
    #releu-player-inventory-modal .rvm-catalog::-webkit-scrollbar{width:6px}
    #releu-player-inventory-modal .rvm-catalog::-webkit-scrollbar-thumb{background:rgba(148,163,184,.24);border-radius:999px}
    #releu-player-inventory-modal .rvm-catalog-item{display:flex;align-items:center;gap:.75rem;width:100%;padding:.65rem .75rem;border-radius:10px;border:1px solid #2b3642;background:rgb(var(--gray-950,15 20 27));text-align:left;transition:border-color .12s ease,background .12s ease}
    #releu-player-inventory-modal .rvm-catalog-item:hover{border-color:#475569;background:#1a2330}
    #releu-player-inventory-modal .rvm-catalog-item.is-selected{border-color:#64748b;background:#1a2330}
    #releu-player-inventory-modal .rvm-catalog-copy{min-width:0;flex:1}
    #releu-player-inventory-modal .rvm-catalog-name{font-size:.8rem;font-weight:700;color:#fff;line-height:1.25}
    #releu-player-inventory-modal .rvm-catalog-meta{margin-top:.15rem;font-size:.67rem;color:#7a7f8e;line-height:1.35}
    #releu-player-inventory-modal .rvm-catalog-chip{border:1px solid rgba(255,255,255,.08);border-radius:999px;padding:.22rem .45rem;font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#cbd5e1}
    #releu-player-inventory-modal .rvm-empty{border:1px dashed rgba(255,255,255,.12);border-radius:10px;padding:1rem;color:#8f96a3;font-size:.8rem;text-align:center}
    @media (max-width:1180px){#releu-player-inventory-modal .rvm-grid{grid-template-columns:1fr}#releu-player-inventory-modal .rvm-shell-grid{grid-template-columns:74px minmax(0,1fr) 74px}}
    @media (max-width:880px){#releu-player-inventory-modal .rvm-shell{max-height:calc(100vh - 1rem)}#releu-player-inventory-modal .rvm-header{padding:1rem}#releu-player-inventory-modal .rvm-grid{padding:1rem}#releu-player-inventory-modal .rvm-shell-grid{grid-template-columns:1fr}#releu-player-inventory-modal .rvm-search-row,#releu-player-inventory-modal .rvm-add-row{grid-template-columns:1fr;display:grid}#releu-player-inventory-modal .rvm-slot-grid{grid-template-columns:repeat(3,minmax(0,1fr))}#releu-player-inventory-modal .rvm-slot-col,#releu-player-inventory-modal .rvm-slot-stack{gap:.75rem}}
    @media (max-width:640px){#releu-player-inventory-modal .rvm-header{flex-direction:column;align-items:stretch}#releu-player-inventory-modal .rvm-header-actions{justify-content:flex-end}#releu-player-inventory-modal .rvm-playerbar{display:grid;grid-template-columns:42px minmax(0,1fr);align-items:start}#releu-player-inventory-modal .rvm-tags,#releu-player-inventory-modal .rvm-stat{grid-column:1 / -1}#releu-player-inventory-modal .rvm-stat{margin-top:.15rem;text-align:left}}
  </style>
  <div class="rvm-overlay">
    <div class="rvm-shell">
      <div class="rvm-header">
        <div class="rvm-header-main">
          <div class="rvm-kicker">Player Inventory</div>
          <div class="rvm-title">${escapeHtml(modal.playerName)}</div>
          <div class="rvm-header-copy">${inventory ? `${escapeHtml(playerInfo?.uuid ?? "UUID unknown")} - ${playerInfo?.online ? "Online" : "Offline"} - ${inventory.occupiedSlots}/${inventory.totalSlots} occupied` : "Loading inventory snapshot..."}</div>
        </div>
        <div class="rvm-header-actions">
          <button type="button" class="rvm-btn" data-inventory-close>Close</button>
        </div>
      </div>
      <div class="rvm-grid">
        <div class="rvm-main">
          <div class="rvm-playerbar">
            <div class="rvm-avatar"><img src="${escapeHtml(playerAvatar({ uuid: playerInfo?.uuid, name: modal.playerName }))}" alt="${escapeHtml(modal.playerName)}" /></div>
            <div class="rvm-player-meta">
              <div class="rvm-player-name">${escapeHtml(modal.playerName)}</div>
              <div class="rvm-player-uuid">${escapeHtml(playerInfo?.uuid ?? "UUID unknown")}</div>
            </div>
            <div class="rvm-tags">
              <span class="rvm-tag ${playerInfo?.online ? "rvm-tag-online" : "rvm-tag-neutral"}">${playerInfo?.online ? `<span class="rvm-tag-dot"></span>Online` : "Offline"}</span>
              ${playerInfo?.gamemode ? `<span class="rvm-tag rvm-tag-neutral">${escapeHtml(playerInfo.gamemode)}</span>` : ""}
            </div>
            <div class="rvm-stat">
              <div class="rvm-stat-label">Occupied</div>
              <div class="rvm-stat-value">${inventory ? `${escapeHtml(inventory.occupiedSlots)} / ${escapeHtml(inventory.totalSlots)}` : "..."}</div>
            </div>
          </div>
          <div class="rvm-board">
            <div class="rvm-board-meta">
              <span>${inventory?.source === "live-playerdata" ? "Live snapshot flushed from the running server." : "Saved snapshot from disk. If the player is online, this can lag until the next save."}</span>
              <span>Selected Hotbar Slot: <strong>${(inventory?.selectedHotbarSlot ?? 0) + 1}</strong></span>
            </div>
            ${modal.loading || !inventory ? `<div class="rvm-empty">Loading inventory...</div>` : `
              <div class="rvm-shell-grid">
                <div class="rvm-shell-col">
                  <div class="rvm-section-label">Armor</div>
                  <div class="rvm-slot-stack">${inventory.armor.map((slot) => inventorySlotMarkup(slot, "armor")).join("")}</div>
                </div>
                <div class="rvm-slot-stack">
                  <div>
                    <div class="rvm-section-label">Inventory</div>
                    <div class="rvm-slot-grid">${inventory.main.map((slot) => inventorySlotMarkup(slot, "main")).join("")}</div>
                  </div>
                  <div class="rvm-divider"></div>
                  <div>
                    <div class="rvm-section-label">Hotbar</div>
                    <div class="rvm-slot-grid">${inventory.hotbar.map((slot) => inventorySlotMarkup(slot, "hotbar")).join("")}</div>
                  </div>
                </div>
                <div class="rvm-shell-col">
                  <div class="rvm-section-label">Offhand</div>
                  <div class="rvm-slot-stack">${inventorySlotMarkup(inventory.offhand, "offhand")}</div>
                </div>
              </div>
            `}
          </div>
        </div>
        <aside class="rvm-side">
          <div class="rvm-card">
            <div class="rvm-card-title">Inventory Actions</div>
            <div class="rvm-status ${statusToneClass}">${escapeHtml(modal.message || "Use the item catalog to add items, or clear individual slots from the inventory view.")}</div>
            <div class="rvm-action-row">
              <button type="button" class="rvm-btn" data-inventory-refresh ${modal.busy ? "disabled" : ""}>Refresh</button>
              <button type="button" class="rvm-btn rvm-btn-danger" data-inventory-clear-all ${modal.busy ? "disabled" : ""}>Clear Inventory</button>
            </div>
          </div>
          <div class="rvm-card">
            <div class="rvm-card-title">Item Catalog</div>
            <form class="rvm-search-row" data-inventory-search-form>
              <input type="text" name="query" value="${escapeHtml(modal.catalogQueryDraft ?? modal.catalogQuery ?? "")}" placeholder="Search items..." class="rvm-input" />
              <button type="submit" class="rvm-btn">${modal.catalogLoading ? "Searching..." : "Search"}</button>
            </form>
            <div class="rvm-add-row">
              <label>
                <span class="rvm-field-label">Count</span>
                <input type="number" min="1" max="9999" value="${escapeHtml(modal.addCount ?? 1)}" data-inventory-count class="rvm-input" />
              </label>
              <button type="button" class="rvm-btn rvm-btn-accent" data-inventory-add ${selectedItem ? "" : "disabled"}>${modal.busy ? "Working..." : "Add Item"}</button>
            </div>
            <div class="rvm-selected">
              <span class="rvm-selected-dot"></span>
              <span>${selectedItem ? `${escapeHtml(selectedItem.displayName)} - ${escapeHtml(selectedItem.id)}` : "Select an item from the catalog results below."}</span>
            </div>
            <div class="rvm-catalog">
              ${catalogResults.length
                ? catalogResults.map((entry) => {
                  const selected = modal.selectedItemId === entry.id;
                  return `<button type="button" class="rvm-catalog-item ${selected ? "is-selected" : ""}" data-inventory-select-item="${escapeHtml(entry.id)}">
                    ${inventoryItemIconMarkup(entry, entry.displayName)}
                    <div class="rvm-catalog-copy">
                      <div class="rvm-catalog-name">${escapeHtml(entry.displayName)}</div>
                      <div class="rvm-catalog-meta">${escapeHtml(entry.id)} - Stack ${escapeHtml(entry.stackSize)}</div>
                    </div>
                    ${entry.maxDurability ? `<span class="rvm-catalog-chip">Dur ${escapeHtml(entry.maxDurability)}</span>` : ""}
                  </button>`;
                }).join("")
                : `<div class="rvm-empty">No catalog items matched that search.</div>`}
            </div>
          </div>
        </aside>
      </div>
    </div>
  </div>`;
}

function playersPageDraftKey(playerName) {
  return String(playerName ?? "").trim().toLowerCase();
}

function readPlayersPageRowDraft(playerName) {
  return APP_STATE.playersPage.rowDrafts?.[playersPageDraftKey(playerName)] ?? {};
}

function writePlayersPageRowDraft(playerName, patch = {}) {
  const key = playersPageDraftKey(playerName);
  if (!key) return;
  APP_STATE.playersPage.rowDrafts[key] = {
    ...(APP_STATE.playersPage.rowDrafts[key] ?? {}),
    ...patch,
  };
}

function buildPlayersPageRenderSignature(players, query) {
  return JSON.stringify({
    query,
    players: players.map((player) => ({
      name: player?.name ?? "",
      uuid: player?.uuid ?? "",
      online: Boolean(player?.online),
      op: Boolean(player?.op),
      whitelisted: Boolean(player?.whitelisted),
      banned: Boolean(player?.banned),
      gamemode: player?.gamemode ?? "",
      lastSeenAt: player?.lastSeenAt ?? "",
    })),
  });
}

function renderPlayerRow(player) {
  const draft = readPlayersPageRowDraft(player.name);
  const selectedGamemode = String(draft.gamemode ?? player.gamemode ?? "survival").trim().toLowerCase() || "survival";
  const actionReason = String(draft.reason ?? "");
  const flags = [
    player.online ? `<span class="ppl-flag ppl-flag-online">Online</span>` : "",
    player.op ? `<span class="ppl-flag ppl-flag-op">OP</span>` : "",
    player.whitelisted ? `<span class="ppl-flag ppl-flag-wl">Whitelist</span>` : "",
    player.banned ? `<span class="ppl-flag ppl-flag-banned">Banned</span>` : "",
  ].filter(Boolean).join("");
  const toggleBan = player.banned ? ["pardon", "Pardon"] : ["ban", "Ban"];
  return `<tr data-player-name="${escapeHtml(player.name)}"><td><span class="ppl-dot"><svg viewBox="0 0 8 8" fill="${player.online ? "rgb(34,197,94)" : "rgb(100,116,139)"}" xmlns="http://www.w3.org/2000/svg"><circle cx="4" cy="4" r="4"/></svg></span></td><td><div class="ppl-player-cell"><div class="ppl-avatar"><img src="${playerAvatar(player)}" alt="${escapeHtml(player.name)}" width="32" height="32" style="border-radius:6px"></div><div><div class="ppl-player-name">${escapeHtml(player.name)}</div><div class="ppl-player-uuid">${escapeHtml(player.uuid ?? "UUID unknown")}</div></div></div></td><td><div class="ppl-flags">${flags || `<span class="ppl-flag">Seen</span>`}</div></td><td><span class="ppl-lastseen">${escapeHtml(formatDate(player.lastSeenAt))}</span></td><td><div class="ppl-actions"><input type="text" class="ppl-action-input" placeholder="Reason shown to player" value="${escapeHtml(actionReason)}"><select class="ppl-select">${["survival", "creative", "adventure", "spectator"].map((mode) => `<option value="${mode}" ${selectedGamemode === mode ? "selected" : ""}>${mode}</option>`).join("")}</select><button class="ppl-action-btn" type="button" data-player-inventory>Inventory</button><button class="ppl-action-btn" type="button" data-player-action="gamemode">Gamemode</button><button class="ppl-action-btn" type="button" data-player-action="kick">Kick</button><button class="ppl-action-btn danger" type="button" data-player-action="${toggleBan[0]}">${toggleBan[1]}</button><button class="ppl-action-btn" type="button" data-player-action="${player.whitelisted ? "whitelist-remove" : "whitelist-add"}">${player.whitelisted ? "Unwhitelist" : "Whitelist"}</button><button class="ppl-action-btn" type="button" data-player-action="${player.op ? "deop" : "op"}">${player.op ? "Deop" : "OP"}</button></div></td></tr>`;
}

function patchPlayersPage() {
  const server = activeServer();
  if (!server) return;
  const serverId = activeServerId();
  if (APP_STATE.playersPage.serverId !== serverId) {
    APP_STATE.playersPage.serverId = serverId;
    APP_STATE.playersPage.search = "";
    APP_STATE.playersPage.rowDrafts = {};
    APP_STATE.playersPage.renderSignature = "";
  }
  const tbody = document.querySelector(".ppl-tbody");
  const searchInput = document.querySelector("[data-player-search-input]");
  const renderRows = () => {
    if (!tbody) return;
    const normalizedQuery = String(APP_STATE.playersPage.search ?? "").trim().toLowerCase();
    const filteredPlayers = (server.players ?? []).filter((player) => {
      if (!normalizedQuery) return true;
      const name = String(player?.name ?? "").toLowerCase();
      const uuid = String(player?.uuid ?? "").toLowerCase();
      return name.includes(normalizedQuery) || uuid.includes(normalizedQuery);
    });
    const nextSignature = buildPlayersPageRenderSignature(filteredPlayers, normalizedQuery);
    if (APP_STATE.playersPage.renderSignature === nextSignature) {
      return;
    }
    tbody.innerHTML = filteredPlayers.length
      ? filteredPlayers.map(renderPlayerRow).join("")
      : `<tr><td colspan="5" class="p-4 text-sm text-slate-400">${normalizedQuery ? "No players matched that search." : "No players tracked yet."}</td></tr>`;
    APP_STATE.playersPage.renderSignature = nextSignature;
  };

  if (searchInput) {
    if (searchInput.value !== APP_STATE.playersPage.search) {
      searchInput.value = APP_STATE.playersPage.search;
    }
    if (!searchInput.dataset.releuBound) {
      searchInput.dataset.releuBound = "true";
      searchInput.addEventListener("input", () => {
        APP_STATE.playersPage.search = searchInput.value;
        renderRows();
        patchPlayersPage();
      });
      searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
        }
      });
    }
  }

  renderRows();
  tbody?.querySelectorAll(".ppl-action-input").forEach((input) => {
    if (input.dataset.releuBound === "true") return;
    input.dataset.releuBound = "true";
    input.addEventListener("input", () => {
      const row = input.closest("tr");
      if (!row?.dataset.playerName) return;
      writePlayersPageRowDraft(row.dataset.playerName, { reason: input.value });
    });
  });
  tbody?.querySelectorAll(".ppl-select").forEach((select) => {
    if (select.dataset.releuBound === "true") return;
    select.dataset.releuBound = "true";
    const syncDraft = () => {
      const row = select.closest("tr");
      if (!row?.dataset.playerName) return;
      writePlayersPageRowDraft(row.dataset.playerName, { gamemode: select.value });
    };
    select.addEventListener("input", syncDraft);
    select.addEventListener("change", syncDraft);
  });
  tbody?.querySelectorAll("[data-player-action]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      try {
        writePlayersPageRowDraft(row?.dataset.playerName, {
          reason: row?.querySelector(".ppl-action-input")?.value ?? "",
          gamemode: row?.querySelector(".ppl-select")?.value ?? "survival",
        });
        setButtonBusy(button, true);
        await api(`/api/servers/${encodeURIComponent(activeServerId())}/players/${encodeURIComponent(row.dataset.playerName)}/action`, { method: "POST", body: { action: button.dataset.playerAction, mode: row.querySelector(".ppl-select")?.value ?? "survival", reason: row.querySelector(".ppl-action-input")?.value ?? "" } });
        await refreshState(activeServerId());
        await refreshLogs();
        APP_STATE.playersPage.renderSignature = "";
        patchPlayersPage();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  tbody?.querySelectorAll("[data-player-inventory]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      if (!row?.dataset.playerName) return;
      try {
        setButtonBusy(button, true, "Opening...");
        await openPlayerInventoryModal(row.dataset.playerName);
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
  injectWorldPageStyles();
  const worlds = server.worlds ?? [];
  const activeWorld = worlds.find((entry) => entry.isActive) ?? worlds[0] ?? null;
  const activeWorldName = activeWorld?.name ?? server.server?.properties?.["level-name"] ?? "world";
  const levelSeed = String(server.server?.properties?.["level-seed"] ?? "").trim();
  const section = document.querySelector(".fi-section-content");
  if (!section) return;

  const renderWorldCard = (world) => {
    const badges = [
      world.exists ? "Base" : "Base Missing",
      world.netherExists ? "Nether" : "No Nether",
      world.endExists ? "End" : "No End",
    ]
      .map((label) => `<span style="border:1px solid #2b3642;border-radius:999px;padding:.22rem .55rem;font-size:.64rem;color:#94a3b8;">${escapeHtml(label)}</span>`)
      .join("");
    return `<article class="pw-card" data-world-card="${escapeHtml(world.name)}">
      <div class="pw-card-head">
        <p class="pw-card-title">${escapeHtml(world.name)}</p>
        <p class="pw-card-sub">${world.isActive ? "Active world folder" : world.exists ? "Saved world folder" : "World slot"}</p>
      </div>
      <div class="pw-card-body">
        <p class="pw-desc">${escapeHtml(world.path)}</p>
        <div style="display:flex;flex-wrap:wrap;gap:.45rem;">${badges}</div>
        <div class="pw-desc">${world.isActive && !world.exists
          ? "This world name is active, but the folder is currently missing. Minecraft will generate a fresh world with this name on the next start."
          : `Last changed: ${escapeHtml(formatDate(world.lastModifiedAt))}`}</div>
        <div class="pw-actions" style="flex-direction:row;flex-wrap:wrap;">
          <button class="fi-btn fi-size-md fi-ac-btn-action" type="button" data-world-use="${escapeHtml(world.name)}">Use This World</button>
          <button class="fi-btn fi-size-md fi-ac-btn-action" type="button" data-world-regen="${escapeHtml(world.name)}">Regenerate</button>
          ${isDesktopApp() ? `<button class="fi-btn fi-size-md fi-ac-btn-action" type="button" data-world-open="${escapeHtml(world.path)}">Open Folder</button>` : ""}
        </div>
      </div>
    </article>`;
  };

  section.innerHTML = `
    <div class="pw-grid3">
      <div class="pw-card">
        <div class="pw-card-head">
          <p class="pw-card-title"><span class="releu-panel-title"><svg class="releu-panel-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>Active World</span></span></p>
          <p class="pw-card-sub">${escapeHtml(activeWorldName)}</p>
        </div>
        <div class="pw-card-body">
          <div class="pw-desc">Choose which saved world name the server should use on the next start.</div>
          <select id="releu-world-select" class="pw-input">${(worlds.length ? worlds : [{ name: activeWorldName, isActive: true }]).map((entry) => `<option value="${escapeHtml(entry.name)}" ${entry.isActive ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("")}</select>
          <input id="releu-world-seed" type="text" class="pw-input" placeholder="Seed for fresh generation (optional)" value="${escapeHtml(levelSeed)}">
          <div class="pw-hint">${activeWorld ? escapeHtml(activeWorld.path) : "No world detected yet."}</div>
          <div class="pw-actions" style="flex-direction:row;flex-wrap:wrap;">
            <button class="fi-btn fi-size-md fi-ac-btn-action" type="button" data-world-use-active>Use This World</button>
            <button class="fi-btn fi-size-md fi-ac-btn-action" type="button" data-world-regen-active>Regenerate Active World</button>
          </div>
        </div>
      </div>
      <div class="pw-card">
        <div class="pw-card-head">
          <p class="pw-card-title"><span class="releu-panel-title"><svg class="releu-panel-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Import A Zip</span></span></p>
          <p class="pw-card-sub">Upload world archive</p>
        </div>
        <div class="pw-card-body">
          <div class="pw-hint">Choose a world archive and import it as a server world.</div>
          <input type="file" accept=".zip,.mcworld" data-world-archive-file style="width:100%;font-size:.78rem;color:#cbd5e1;">
          <div class="pw-desc">Releu uses the selected archive name automatically. Just choose a <code>.zip</code> or <code>.mcworld</code> file and upload it.</div>
          <button class="fi-btn fi-size-md fi-ac-btn-action" type="button" data-world-upload>Upload World Archive</button>
        </div>
      </div>
      <div class="pw-card">
        <div class="pw-card-head">
          <p class="pw-card-title"><span class="releu-panel-title"><svg class="releu-panel-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h5l2 2h11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg><span>Use A Local World Folder</span></span></p>
          <p class="pw-card-sub">Import local folder</p>
        </div>
        <div class="pw-card-body">
          <div class="pw-hint">Import a world folder from disk without leaving the new UI.</div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
            <input type="text" class="pw-input" placeholder="C:\\Worlds\\MyWorld" data-world-folder-path style="flex:1 1 220px;">
            ${isDesktopApp() ? `<button class="fi-btn fi-size-md fi-ac-btn-action" type="button" data-world-browse-folder>Browse</button>` : ""}
          </div>
          <input type="text" class="pw-input" placeholder="local-import-01" data-world-folder-name>
          <div class="pw-desc">Releu copies the folder into this server and can make it the active world immediately.</div>
          <button class="fi-btn fi-size-md fi-ac-btn-action" type="button" data-world-import-folder>Import World Folder</button>
        </div>
      </div>
    </div>
    <div class="pw-grid2" data-world-library>
      ${worlds.length ? worlds.map(renderWorldCard).join("") : `<div class="pw-card"><div class="pw-card-body"><div class="pw-desc">No world folders were detected yet.</div></div></div>`}
    </div>
  `;

  const worldSelect = section.querySelector("#releu-world-select");
  const worldSeedInput = section.querySelector("#releu-world-seed");
  const archiveFileInput = section.querySelector("[data-world-archive-file]");
  const folderPathInput = section.querySelector("[data-world-folder-path]");
  const folderNameInput = section.querySelector("[data-world-folder-name]");
  const useActiveButton = section.querySelector("[data-world-use-active]");
  const regenActiveButton = section.querySelector("[data-world-regen-active]");
  const uploadButton = section.querySelector("[data-world-upload]");
  const browseFolderButton = section.querySelector("[data-world-browse-folder]");
  const importFolderButton = section.querySelector("[data-world-import-folder]");

  const regenerateWithConfirm = async (worldName, button) => {
    if (!window.confirm(`Regenerate "${worldName}"?\n\nReleu will keep the current world as a saved switchable world, then Minecraft will generate a fresh "${worldName}" on the next server start.`)) {
      return;
    }
    try {
      setButtonBusy(button, true, "Regenerating...");
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/worlds/regenerate`, {
        method: "POST",
        body: { name: worldName, seed: worldSeedInput?.value ?? "" },
      });
      await refreshState(activeServerId());
      await refreshLogs();
      showStatus(`Regenerated "${worldName}". The previous world was kept as a saved switchable world.`, "success");
      patchWorldsPage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(button, false);
    }
  };

  useActiveButton?.addEventListener("click", async () => {
    const worldName = worldSelect?.value ?? activeWorldName;
    try {
      setButtonBusy(useActiveButton, true);
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/worlds/select`, {
        method: "POST",
        body: { name: worldName, seed: worldSeedInput?.value ?? "" },
      });
      await refreshState(activeServerId());
      showStatus(`Selected "${worldName}" as the active world.`, "success");
      patchWorldsPage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(useActiveButton, false);
    }
  });

  regenActiveButton?.addEventListener("click", async () => {
    const worldName = worldSelect?.value ?? activeWorldName;
    await regenerateWithConfirm(worldName, regenActiveButton);
  });

  uploadButton?.addEventListener("click", async () => {
    const file = archiveFileInput?.files?.[0];
    if (!file) {
      showError(new Error("Choose a world archive first."));
      return;
    }
    try {
      setButtonBusy(uploadButton, true, "Uploading...");
      await apiBinary(
        `/api/servers/${encodeURIComponent(activeServerId())}/worlds/upload-archive`,
        await file.arrayBuffer(),
        {
          "Content-Type": "application/octet-stream",
          "X-File-Name": file.name,
        },
        {
          timeoutMs: 300000,
          timeoutMessage: "The world archive upload took too long and was cancelled.",
        },
      );
      if (archiveFileInput) archiveFileInput.value = "";
      await refreshState(activeServerId());
      await refreshLogs();
      showStatus(`Imported world archive "${file.name}".`, "success");
      patchWorldsPage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(uploadButton, false);
    }
  });

  browseFolderButton?.addEventListener("click", async () => {
    try {
      setButtonBusy(browseFolderButton, true, "Browsing...");
      const pickedPath = await pickLocalDirectory();
      if (pickedPath && folderPathInput) {
        folderPathInput.value = pickedPath;
      }
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(browseFolderButton, false);
    }
  });

  importFolderButton?.addEventListener("click", async () => {
    try {
      setButtonBusy(importFolderButton, true, "Importing...");
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/worlds/import-folder`, {
        method: "POST",
        body: {
          sourcePath: folderPathInput?.value ?? "",
          worldName: folderNameInput?.value ?? "",
        },
      });
      if (folderPathInput) folderPathInput.value = "";
      if (folderNameInput) folderNameInput.value = "";
      await refreshState(activeServerId());
      await refreshLogs();
      showStatus("Imported the world folder.", "success");
      patchWorldsPage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(importFolderButton, false);
    }
  });

  section.querySelectorAll("[data-world-use]").forEach((button) => {
    button.addEventListener("click", async () => {
      const worldName = button.dataset.worldUse ?? activeWorldName;
      try {
        setButtonBusy(button, true);
        await api(`/api/servers/${encodeURIComponent(activeServerId())}/worlds/select`, {
          method: "POST",
          body: { name: worldName },
        });
        await refreshState(activeServerId());
        showStatus(`Selected "${worldName}" as the active world.`, "success");
        patchWorldsPage();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });

  section.querySelectorAll("[data-world-regen]").forEach((button) => {
    button.addEventListener("click", async () => {
      await regenerateWithConfirm(button.dataset.worldRegen ?? activeWorldName, button);
    });
  });

  section.querySelectorAll("[data-world-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        setButtonBusy(button, true, "Opening...");
        await openLocalPath(button.dataset.worldOpen);
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
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

function injectBackupsPageStyles() {
  if (document.getElementById("releu-backups-style")) return;
  const style = document.createElement("style");
  style.id = "releu-backups-style";
  style.textContent = `
    .releu-backups-shell {
      display: grid;
      gap: 1.25rem;
    }
    .releu-backups-grid {
      display: grid;
      gap: 1.25rem;
      grid-template-columns: minmax(20rem, 26rem) minmax(0, 1fr);
      align-items: start;
    }
    @media (max-width: 1100px) {
      .releu-backups-grid {
        grid-template-columns: 1fr;
      }
    }
    .releu-backups-shell .fi-section {
      border: 1px solid oklch(0.274 0.006 286.033 / 60%);
      border-radius: 1rem;
      background: oklch(0.21 0.006 285.885);
      overflow: hidden;
    }
    .releu-backups-shell .fi-section-header {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid oklch(0.274 0.006 286.033 / 60%);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .releu-backups-shell .fi-section-heading {
      font-size: 0.9rem;
      font-weight: 600;
      color: oklch(0.985 0 0);
      line-height: 1.3;
    }
    .releu-backups-shell .fi-section-description {
      font-size: 0.8rem;
      color: oklch(0.705 0.015 286.067);
      margin-top: 0.2rem;
      line-height: 1.55;
    }
    .releu-backups-shell .fi-section-body {
      padding: 1.25rem;
      display: grid;
      gap: 1rem;
    }
    .releu-backups-shell .fi-field {
      display: grid;
      gap: 0.4rem;
    }
    .releu-backups-shell .fi-label {
      font-size: 0.78rem;
      font-weight: 600;
      color: oklch(0.985 0 0);
    }
    .releu-backups-shell .fi-input {
      width: 100%;
      background: oklch(0.21 0.006 285.885);
      border: 1px solid oklch(0.274 0.006 286.033 / 60%);
      border-radius: 0.5rem;
      color: oklch(0.985 0 0);
      padding: 0.55rem 0.75rem;
      font: inherit;
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .releu-backups-shell .fi-input:focus {
      border-color: oklch(0.546 0.245 262.881);
      box-shadow: 0 0 0 2px oklch(0.546 0.245 262.881 / 25%);
    }
    .releu-backups-shell .fi-checkbox-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      background: oklch(0.21 0.006 285.885);
      border: 1px solid oklch(0.274 0.006 286.033 / 60%);
      border-radius: 0.5rem;
      padding: 0.7rem 0.85rem;
      font-size: 0.875rem;
      color: oklch(0.92 0.004 286.32);
      cursor: default;
    }
    .releu-backups-shell .fi-checkbox-row input {
      width: 1rem;
      height: 1rem;
      accent-color: oklch(0.546 0.245 262.881);
      flex-shrink: 0;
    }
    .releu-backups-shell .fi-stats {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .releu-backups-shell .fi-stat {
      background: oklch(0.21 0.006 285.885);
      border: 1px solid oklch(0.274 0.006 286.033 / 60%);
      border-radius: 0.5rem;
      padding: 0.85rem 0.9rem;
    }
    .releu-backups-shell .fi-stat-label,
    .releu-backups-shell .fi-progress-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: oklch(0.705 0.015 286.067);
    }
    .releu-backups-shell .fi-stat-value {
      margin-top: 0.2rem;
      font-size: 0.95rem;
      font-weight: 700;
      color: oklch(0.985 0 0);
    }
    .releu-backups-shell .fi-progress {
      display: grid;
      gap: 0.45rem;
    }
    .releu-backups-shell .fi-progress-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .releu-backups-shell .fi-progress-val {
      font-size: 0.8rem;
      color: oklch(0.871 0.006 286.286);
    }
    .releu-backups-shell .fi-progress-track {
      width: 100%;
      height: 0.45rem;
      border-radius: 999px;
      overflow: hidden;
      background: oklch(0.274 0.006 286.033);
    }
    .releu-backups-shell .fi-progress-fill {
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, oklch(0.769 0.188 70.08), oklch(0.828 0.189 84.429));
      width: var(--releu-backups-usage, 0%);
    }
    .releu-backups-shell .fi-callout {
      background: oklch(0.769 0.188 70.08 / 8%);
      border: 1px solid oklch(0.769 0.188 70.08 / 25%);
      border-radius: 0.5rem;
      padding: 0.8rem 0.9rem;
      font-size: 0.82rem;
      line-height: 1.6;
      color: oklch(0.879 0.169 91.605);
      display: flex;
      gap: 0.65rem;
    }
    .releu-backups-shell .fi-callout svg {
      flex-shrink: 0;
      margin-top: 0.1rem;
      width: 1rem;
      height: 1rem;
    }
    .releu-backups-shell .fi-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
    }
    .releu-backups-shell .fi-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      border-radius: 0.5rem;
      padding: 0.5rem 0.875rem;
      font: inherit;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.12s, border-color 0.12s;
    }
    .releu-backups-shell .fi-btn svg {
      width: 0.9rem;
      height: 0.9rem;
    }
    .releu-backups-shell .fi-btn-primary {
      background: oklch(0.546 0.245 262.881);
      color: #fff;
      border-color: oklch(0.546 0.245 262.881);
    }
    .releu-backups-shell .fi-btn-secondary {
      background: transparent;
      color: oklch(0.92 0.004 286.32);
      border-color: oklch(0.274 0.006 286.033 / 60%);
    }
    .releu-backups-shell .fi-btn-secondary:hover {
      background: oklch(0.274 0.006 286.033 / 35%);
    }
    .releu-backups-shell .fi-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      border-radius: 999px;
      padding: 0.2rem 0.6rem;
      font-size: 0.72rem;
      font-weight: 600;
      background: oklch(0.274 0.006 286.033 / 45%);
      border: 1px solid oklch(0.274 0.006 286.033 / 60%);
      color: oklch(0.705 0.015 286.067);
    }
    .releu-backups-shell .fi-badge svg {
      width: 0.7rem;
      height: 0.7rem;
    }
    .releu-backups-shell .fi-table-wrap {
      overflow: auto;
      border-top: 1px solid oklch(0.274 0.006 286.033 / 60%);
      max-height: 72vh;
    }
    .releu-backups-shell .fi-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    .releu-backups-shell .fi-table thead tr {
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .releu-backups-shell .fi-table th {
      padding: 0.65rem 1rem;
      background: oklch(0.21 0.006 285.885);
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: oklch(0.705 0.015 286.067);
      white-space: nowrap;
    }
    .releu-backups-shell .fi-table td {
      padding: 0.75rem 1rem;
      text-align: left;
      vertical-align: middle;
      border-bottom: 1px solid oklch(0.274 0.006 286.033 / 40%);
      color: oklch(0.871 0.006 286.286);
    }
    .releu-backups-shell .fi-table tbody tr:last-child td {
      border-bottom: none;
    }
    .releu-backups-shell .fi-table tbody tr:hover td {
      background: oklch(0.21 0.006 285.885 / 60%);
    }
    .releu-backups-shell .fi-backup-name {
      font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace;
      font-size: 0.78rem;
      font-weight: 600;
      color: oklch(0.985 0 0);
      word-break: break-all;
      line-height: 1.4;
    }
    .releu-backups-shell .fi-backup-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      margin-top: 0.3rem;
      font-size: 0.68rem;
      font-weight: 600;
      color: oklch(0.705 0.015 286.067);
      font-family: Inter, system-ui, sans-serif;
    }
    .releu-backups-shell .fi-backup-tag.newest {
      color: oklch(0.792 0.209 151.711);
    }
    .releu-backups-shell .fi-backup-tag svg {
      width: 0.7rem;
      height: 0.7rem;
    }
    .releu-backups-shell .fi-row-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.4rem;
    }
    .releu-backups-shell .fi-size-cell {
      color: oklch(0.705 0.015 286.067);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .releu-backups-shell .fi-date-cell {
      color: oklch(0.705 0.015 286.067);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .releu-backups-shell .fi-empty {
      padding: 1.35rem 1rem;
      text-align: center;
      color: oklch(0.705 0.015 286.067);
      font-size: 0.92rem;
    }
  `;
  document.head.append(style);
}

function patchBackupsPage() {
  const server = activeServer();
  if (!server) return;
  injectBackupsPageStyles();
  const mount = document.querySelector(".fi-page-content");
  if (!mount) return;
  const backups = Array.isArray(server.backups?.recent) ? server.backups.recent : [];
  const totalBytes = Math.max(0, Number(server.backups?.totalBytes ?? 0) || 0);
  const maxStorageGb = Math.max(1, Number(server.backups?.maxStorageGb ?? 10) || 10);
  const maxStorageBytes = Math.max(
    totalBytes,
    Number(server.backups?.maxStorageBytes ?? Math.round(maxStorageGb * 1024 ** 3)) || Math.round(maxStorageGb * 1024 ** 3),
  );
  const usagePercent = maxStorageBytes > 0 ? Math.min(100, (totalBytes / maxStorageBytes) * 100) : 0;
  const nextBackupAt = server.backups?.nextBackupAt ? formatDate(server.backups.nextBackupAt) : "Disabled";
  const backupRows = backups.length
    ? backups.map((entry, index) => `
        <tr>
          <td>
            <div class="fi-backup-name">${escapeHtml(entry.name)}</div>
            <div class="fi-backup-tag${index === 0 ? " newest" : ""}">
              ${index === 0 ? `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              ` : ""}
              ${escapeHtml(index === 0 ? "Newest backup" : "Local snapshot")}
            </div>
          </td>
          <td class="fi-size-cell">${escapeHtml(formatBytes(entry.bytes ?? 0))}</td>
          <td class="fi-date-cell">${escapeHtml(formatDate(entry.createdAt))}</td>
          <td>
            <div class="fi-row-actions">
              <button type="button" class="fi-btn fi-btn-secondary fi-size-sm fi-ac-btn-action" data-releu-backup-revert="${escapeHtml(entry.name)}">Revert</button>
              ${isDesktopApp() ? `<button type="button" class="fi-btn fi-btn-secondary fi-size-sm fi-ac-btn-action" data-releu-backup-open-path="${escapeHtml(entry.path)}">Open Folder</button>` : ""}
            </div>
          </td>
        </tr>`)
        .join("")
    : `<tr><td colspan="4" class="fi-empty">No local backups have been created yet.</td></tr>`;

  mount.innerHTML = `
    <div class="releu-backups-shell">
      <div class="releu-backups-grid">
        <section class="fi-section">
          <div class="fi-section-header">
            <div>
              <div class="fi-section-heading">Local Backup Settings</div>
              <div class="fi-section-description">Set a total storage cap for local backups. Releu deletes the oldest backups first when the folder hits the limit.</div>
            </div>
          </div>
          <div class="fi-section-body">
            <form data-releu-backup-settings-form class="fi-section-body" style="padding:0;">
              <div class="fi-field">
                <label class="fi-label" for="releu-backups-enabled">Automatic Local Backups</label>
                <label class="fi-checkbox-row" for="releu-backups-enabled">
                  <input id="releu-backups-enabled" name="autoBackups" type="checkbox" ${server.backups?.enabled ? "checked" : ""}>
                  <span>${server.backups?.enabled ? "Enabled" : "Disabled"} — Releu creates scheduled local backups for this server.</span>
                </label>
              </div>
              <div class="fi-field">
                <label class="fi-label" for="releu-backup-interval">Backup Interval (minutes)</label>
                <input id="releu-backup-interval" name="backupIntervalMinutes" type="number" min="5" step="5" value="${escapeHtml(server.backups?.intervalMinutes ?? 60)}" class="fi-input">
              </div>
              <div class="fi-field">
                <label class="fi-label" for="releu-backup-max-storage">Max Total Backup Storage (GB)</label>
                <input id="releu-backup-max-storage" name="maxBackupStorageGb" type="number" min="1" step="1" value="${escapeHtml(maxStorageGb)}" class="fi-input">
              </div>
              <div class="fi-stats">
                <div class="fi-stat">
                  <div class="fi-stat-label">Current Usage</div>
                  <div class="fi-stat-value">${escapeHtml(formatBytes(totalBytes))}</div>
                </div>
                <div class="fi-stat">
                  <div class="fi-stat-label">Next Backup</div>
                  <div class="fi-stat-value">${escapeHtml(nextBackupAt)}</div>
                </div>
              </div>
              <div class="fi-progress">
                <div class="fi-progress-head">
                  <span class="fi-progress-label">Storage Usage</span>
                  <span class="fi-progress-val">${escapeHtml(formatBytes(totalBytes))} / ${escapeHtml(`${maxStorageGb} GB`)}</span>
                </div>
                <div class="fi-progress-track">
                  <div class="fi-progress-fill" style="--releu-backups-usage:${usagePercent}%;"></div>
                </div>
              </div>
              <div class="fi-callout">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>When you revert to a backup, Releu first creates a safety backup of the current state. The server must stay stopped during a revert.</span>
              </div>
              <div class="fi-actions">
                <button type="submit" class="fi-btn fi-btn-primary fi-size-md" data-releu-backup-save>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Save Backup Settings
                </button>
                <button type="button" class="fi-btn fi-btn-secondary fi-size-md fi-ac-btn-action" data-releu-backup-create>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Create Backup Now
                </button>
              </div>
            </form>
          </div>
        </section>
        <section class="fi-section">
          <div class="fi-section-header">
            <div>
              <div class="fi-section-heading">Backup History</div>
              <div class="fi-section-description">Revert replaces the current server files with the selected backup after three confirmations.</div>
            </div>
            <div class="fi-badge">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              ${escapeHtml(`${backups.length} backup${backups.length === 1 ? "" : "s"}`)}
            </div>
          </div>
          <div class="fi-table-wrap">
            <table class="fi-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody>${backupRows}</tbody>
            </table>
          </div>
        </section>
      </div>
    </div>`;

  const runCreateBackup = async (button) => {
    try {
      setButtonBusy(button, true, "Creating...");
      const payload = await api(`/api/servers/${encodeURIComponent(activeServerId())}/server/backup`, {
        method: "POST",
      });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      await refreshLogs();
      patchBackupsPage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(button, false);
    }
  };

  mount.querySelector("[data-releu-backup-settings-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const saveButton = form.querySelector("[data-releu-backup-save]");
    try {
      setButtonBusy(saveButton, true, "Saving...");
      const payload = await api(`/api/servers/${encodeURIComponent(activeServerId())}/settings/backups`, {
        method: "POST",
        body: {
          autoBackups: Boolean(form.elements.autoBackups?.checked),
          backupIntervalMinutes: Number(form.elements.backupIntervalMinutes?.value) || 60,
          maxBackupStorageGb: Number(form.elements.maxBackupStorageGb?.value) || maxStorageGb,
        },
      });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      patchBackupsPage();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(saveButton, false);
    }
  });

  mount.querySelector("[data-releu-backup-create]")?.addEventListener("click", async (event) => {
    await runCreateBackup(event.currentTarget);
  });

  mount.querySelectorAll("[data-releu-backup-open-path]").forEach((button) => {
    button.addEventListener("click", async () => {
      await openLocalPath(button.dataset.releuBackupOpenPath);
    });
  });

  mount.querySelectorAll("[data-releu-backup-revert]").forEach((button) => {
    button.addEventListener("click", async () => {
      const backupName = String(button.dataset.releuBackupRevert ?? "").trim();
      if (!backupName) return;
      if (!window.confirm(`Revert the current server to "${backupName}"?\n\nThis overwrites the live server files and worlds with the selected backup.`)) {
        return;
      }
      if (!window.confirm("This can permanently replace newer progress if you choose the wrong backup.\n\nAre you sure you want to continue?")) {
        return;
      }
      if (!window.confirm(`Final warning: Releu will create one safety backup, then revert this server to "${backupName}".\n\nProceed with the revert?`)) {
        return;
      }
      try {
        setButtonBusy(button, true, "Reverting...");
        const payload = await api(`/api/servers/${encodeURIComponent(activeServerId())}/backups/revert`, {
          method: "POST",
          body: {
            backupName,
          },
        });
        APP_STATE.state = payload.state ?? APP_STATE.state;
        await refreshLogs();
        patchBackupsPage();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });

  const headerCreateButton = document.querySelector(".fi-ac-icon-btn-action");
  if (headerCreateButton && !headerCreateButton.dataset.releuBackupsBound) {
    headerCreateButton.addEventListener("click", async (event) => {
      await runCreateBackup(event.currentTarget);
    });
    headerCreateButton.dataset.releuBackupsBound = "true";
  }
}

function patchBackupsPageLive() {
  const server = activeServer();
  if (!server) return;
  injectBackupsPageStyles();
  const mount = document.querySelector(".fi-page-content");
  if (!mount) return;

  if (APP_STATE.backupsPage.serverId !== server.id) {
    APP_STATE.backupsPage.serverId = server.id;
    APP_STATE.backupsPage.autoBackups = Boolean(server.backups?.enabled);
    APP_STATE.backupsPage.backupIntervalMinutes = Math.max(5, Number(server.backups?.intervalMinutes ?? 60) || 60);
    APP_STATE.backupsPage.maxBackupStorageGb = Math.max(1, Number(server.backups?.maxStorageGb ?? 10) || 10);
  }

  const backups = Array.isArray(server.backups?.recent) ? server.backups.recent : [];
  const totalBytes = Math.max(0, Number(server.backups?.totalBytes ?? 0) || 0);

  const getDraftState = () => {
    const autoBackups = Boolean(APP_STATE.backupsPage.autoBackups);
    const intervalMinutes = Math.max(
      5,
      Number(APP_STATE.backupsPage.backupIntervalMinutes ?? server.backups?.intervalMinutes ?? 60) || 60,
    );
    const maxStorageGb = Math.max(
      1,
      Number(APP_STATE.backupsPage.maxBackupStorageGb ?? server.backups?.maxStorageGb ?? 10) || 10,
    );
    const maxStorageBytes = Math.max(
      totalBytes,
      Number(server.backups?.maxStorageBytes ?? Math.round(maxStorageGb * 1024 ** 3)) || Math.round(maxStorageGb * 1024 ** 3),
    );
    const usagePercent = maxStorageBytes > 0 ? Math.min(100, (totalBytes / maxStorageBytes) * 100) : 0;
    const nextBackupAt = (() => {
      if (!autoBackups) return "Disabled";
      const anchor = Date.parse(server.backups?.lastBackupAt ?? server.createdAt ?? "");
      if (Number.isFinite(anchor)) {
        return formatDate(new Date(anchor + intervalMinutes * 60_000).toISOString());
      }
      return server.backups?.nextBackupAt ? formatDate(server.backups.nextBackupAt) : "Unknown";
    })();
    return { autoBackups, intervalMinutes, maxStorageGb, usagePercent, nextBackupAt };
  };

  const draft = getDraftState();
  const backupRows = backups.length
    ? backups
        .map((entry, index) => {
          const badgeLabel = index === 0 ? "Newest backup" : "Local snapshot";
          const badgeIcon = index === 0
            ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
            : "";
          const openFolderButton = isDesktopApp()
            ? `<button type="button" class="fi-btn fi-btn-secondary fi-size-sm fi-ac-btn-action" data-releu-backup-open-path="${escapeHtml(entry.path)}">Open Folder</button>`
            : "";
          return `
        <tr>
          <td>
            <div class="fi-backup-name">${escapeHtml(entry.name)}</div>
            <div class="fi-backup-tag${index === 0 ? " newest" : ""}">
              ${badgeIcon}
              ${escapeHtml(badgeLabel)}
            </div>
          </td>
          <td class="fi-size-cell">${escapeHtml(formatBytes(entry.bytes ?? 0))}</td>
          <td class="fi-date-cell">${escapeHtml(formatDate(entry.createdAt))}</td>
          <td>
            <div class="fi-row-actions">
              <button type="button" class="fi-btn fi-btn-secondary fi-size-sm fi-ac-btn-action" data-releu-backup-revert="${escapeHtml(entry.name)}">Revert</button>
              ${openFolderButton}
            </div>
          </td>
        </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="fi-empty">No local backups have been created yet.</td></tr>`;

  mount.innerHTML = `
    <div class="releu-backups-shell">
      <div class="releu-backups-grid">
        <section class="fi-section">
          <div class="fi-section-header">
            <div>
              <div class="fi-section-heading">Local Backup Settings</div>
              <div class="fi-section-description">Set a total storage cap for local backups. Releu deletes the oldest backups first when the folder hits the limit.</div>
            </div>
          </div>
          <div class="fi-section-body">
            <form data-releu-backup-settings-form class="fi-section-body" style="padding:0;">
              <div class="fi-field">
                <label class="fi-label" for="releu-backups-enabled">Automatic Local Backups</label>
                <label class="fi-checkbox-row" for="releu-backups-enabled">
                  <input id="releu-backups-enabled" name="autoBackups" type="checkbox" ${draft.autoBackups ? "checked" : ""}>
                  <span data-releu-backup-enabled-label>${draft.autoBackups ? "Enabled" : "Disabled"} - Releu creates scheduled local backups for this server.</span>
                </label>
              </div>
              <div class="fi-field">
                <label class="fi-label" for="releu-backup-interval">Backup Interval (minutes)</label>
                <input id="releu-backup-interval" name="backupIntervalMinutes" type="number" min="5" step="5" value="${escapeHtml(draft.intervalMinutes)}" class="fi-input">
              </div>
              <div class="fi-field">
                <label class="fi-label" for="releu-backup-max-storage">Max Total Backup Storage (GB)</label>
                <input id="releu-backup-max-storage" name="maxBackupStorageGb" type="number" min="1" step="1" value="${escapeHtml(draft.maxStorageGb)}" class="fi-input">
              </div>
              <div class="fi-stats">
                <div class="fi-stat">
                  <div class="fi-stat-label">Current Usage</div>
                  <div class="fi-stat-value">${escapeHtml(formatBytes(totalBytes))}</div>
                </div>
                <div class="fi-stat">
                  <div class="fi-stat-label">Next Backup</div>
                  <div class="fi-stat-value" data-releu-backup-next-value>${escapeHtml(draft.nextBackupAt)}</div>
                </div>
              </div>
              <div class="fi-progress">
                <div class="fi-progress-head">
                  <span class="fi-progress-label">Storage Usage</span>
                  <span class="fi-progress-val" data-releu-backup-usage-value>${escapeHtml(formatBytes(totalBytes))} / ${escapeHtml(`${draft.maxStorageGb} GB`)}</span>
                </div>
                <div class="fi-progress-track">
                  <div class="fi-progress-fill" data-releu-backup-usage-fill style="--releu-backups-usage:${draft.usagePercent}%;"></div>
                </div>
              </div>
              <div class="fi-callout">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>When you revert to a backup, Releu first creates a safety backup of the current state. The server must stay stopped during a revert.</span>
              </div>
              <div class="fi-actions">
                <button type="submit" class="fi-btn fi-btn-primary fi-size-md" data-releu-backup-save>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Save Backup Settings
                </button>
                <button type="button" class="fi-btn fi-btn-secondary fi-size-md fi-ac-btn-action" data-releu-backup-create>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Create Backup Now
                </button>
              </div>
            </form>
          </div>
        </section>
        <section class="fi-section">
          <div class="fi-section-header">
            <div>
              <div class="fi-section-heading">Backup History</div>
              <div class="fi-section-description">Revert replaces the current server files with the selected backup after three confirmations.</div>
            </div>
            <div class="fi-badge">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              ${escapeHtml(`${backups.length} backup${backups.length === 1 ? "" : "s"}`)}
            </div>
          </div>
          <div class="fi-table-wrap">
            <table class="fi-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody>${backupRows}</tbody>
            </table>
          </div>
        </section>
      </div>
    </div>`;

  const settingsForm = mount.querySelector("[data-releu-backup-settings-form]");
  const runCreateBackup = async (button) => {
    try {
      setButtonBusy(button, true, "Creating...");
      const payload = await api(`/api/servers/${encodeURIComponent(activeServerId())}/server/backup`, {
        method: "POST",
      });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      APP_STATE.backupsPage.serverId = "";
      await refreshLogs();
      patchBackupsPageLive();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(button, false);
    }
  };

  const updateBackupDraftPreview = () => {
    if (!settingsForm) return;
    APP_STATE.backupsPage.autoBackups = Boolean(settingsForm.elements.autoBackups?.checked);
    APP_STATE.backupsPage.backupIntervalMinutes = Math.max(5, Number(settingsForm.elements.backupIntervalMinutes?.value) || draft.intervalMinutes);
    APP_STATE.backupsPage.maxBackupStorageGb = Math.max(1, Number(settingsForm.elements.maxBackupStorageGb?.value) || draft.maxStorageGb);
    const nextDraft = getDraftState();

    const enabledLabel = mount.querySelector("[data-releu-backup-enabled-label]");
    if (enabledLabel) {
      enabledLabel.textContent = `${nextDraft.autoBackups ? "Enabled" : "Disabled"} - Releu creates scheduled local backups for this server.`;
    }
    const nextValue = mount.querySelector("[data-releu-backup-next-value]");
    if (nextValue) nextValue.textContent = nextDraft.nextBackupAt;
    const usageValue = mount.querySelector("[data-releu-backup-usage-value]");
    if (usageValue) usageValue.textContent = `${formatBytes(totalBytes)} / ${nextDraft.maxStorageGb} GB`;
    const usageFill = mount.querySelector("[data-releu-backup-usage-fill]");
    if (usageFill) usageFill.style.setProperty("--releu-backups-usage", `${nextDraft.usagePercent}%`);
  };

  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const saveButton = form.querySelector("[data-releu-backup-save]");
    try {
      setButtonBusy(saveButton, true, "Saving...");
      const payload = await api(`/api/servers/${encodeURIComponent(activeServerId())}/settings/backups`, {
        method: "POST",
        body: {
          autoBackups: Boolean(form.elements.autoBackups?.checked),
          backupIntervalMinutes: Number(form.elements.backupIntervalMinutes?.value) || 60,
          maxBackupStorageGb: Number(form.elements.maxBackupStorageGb?.value) || draft.maxStorageGb,
        },
      });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      APP_STATE.backupsPage.serverId = "";
      patchBackupsPageLive();
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(saveButton, false);
    }
  });

  settingsForm?.elements.autoBackups?.addEventListener("change", updateBackupDraftPreview);
  settingsForm?.elements.backupIntervalMinutes?.addEventListener("input", updateBackupDraftPreview);
  settingsForm?.elements.maxBackupStorageGb?.addEventListener("input", updateBackupDraftPreview);

  mount.querySelector("[data-releu-backup-create]")?.addEventListener("click", async (event) => {
    await runCreateBackup(event.currentTarget);
  });

  mount.querySelectorAll("[data-releu-backup-open-path]").forEach((button) => {
    button.addEventListener("click", async () => {
      await openLocalPath(button.dataset.releuBackupOpenPath);
    });
  });

  mount.querySelectorAll("[data-releu-backup-revert]").forEach((button) => {
    button.addEventListener("click", async () => {
      const backupName = String(button.dataset.releuBackupRevert ?? "").trim();
      if (!backupName) return;
      if (!window.confirm(`Revert the current server to "${backupName}"?\n\nThis overwrites the live server files and worlds with the selected backup.`)) return;
      if (!window.confirm("This can permanently replace newer progress if you choose the wrong backup.\n\nAre you sure you want to continue?")) return;
      if (!window.confirm(`Final warning: Releu will create one safety backup, then revert this server to "${backupName}".\n\nProceed with the revert?`)) return;
      try {
        setButtonBusy(button, true, "Reverting...");
        const payload = await api(`/api/servers/${encodeURIComponent(activeServerId())}/backups/revert`, {
          method: "POST",
          body: { backupName },
        });
        APP_STATE.state = payload.state ?? APP_STATE.state;
        APP_STATE.backupsPage.serverId = "";
        await refreshLogs();
        patchBackupsPageLive();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });

  const headerCreateButton = document.querySelector(".fi-ac-icon-btn-action");
  if (headerCreateButton && !headerCreateButton.dataset.releuBackupsBound) {
    headerCreateButton.addEventListener("click", async (event) => {
      await runCreateBackup(event.currentTarget);
    });
    headerCreateButton.dataset.releuBackupsBound = "true";
  }
}

function injectFilesPageStyles() {
  if (document.getElementById("releu-files-style")) return;
  const style = document.createElement("style");
  style.id = "releu-files-style";
  style.textContent = `
    .releu-files-shell {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1rem 0;
    }
    .releu-files-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 1rem;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 1rem;
      background: rgba(15, 20, 27, 0.92);
    }
    .releu-files-toolbar-copy {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 0;
    }
    .releu-files-toolbar-label {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #94a3b8;
    }
    .releu-files-toolbar-path {
      font-size: 0.95rem;
      font-weight: 600;
      color: #f8fafc;
      word-break: break-word;
    }
    .releu-files-toolbar-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }
    .releu-files-table-wrap {
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 1rem;
      background: rgb(var(--gray-900,17 24 32));
    }
    .releu-files-table {
      width: 100%;
    }
    .releu-files-table .fi-ta-header-cell,
    .releu-files-table .fi-ta-cell {
      vertical-align: middle;
    }
    .releu-files-empty {
      padding: 1.5rem;
      text-align: center;
      color: #94a3b8;
      font-size: 0.95rem;
    }
    .releu-files-name-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
      color: #e2e8f0;
      transition: color 150ms ease;
    }
    .releu-files-name-btn:hover {
      color: #ffffff;
    }
    .releu-files-name-copy {
      display: flex;
      flex-direction: column;
      gap: 0.12rem;
      min-width: 0;
      text-align: left;
    }
    .releu-files-name {
      font-weight: 600;
      color: inherit;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .releu-files-sub {
      font-size: 0.78rem;
      color: #94a3b8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .releu-files-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 0.75rem;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgb(var(--gray-950,15 20 27));
      color: #cbd5e1;
      flex-shrink: 0;
    }
    .releu-files-kind {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: capitalize;
      color: #cbd5e1;
    }
    .releu-files-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.5rem;
    }
    .releu-files-editor-backdrop {
      position: fixed;
      inset: 0;
      z-index: 9998;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      background: rgba(15, 20, 27, 0.82);
      backdrop-filter: blur(8px);
    }
    .releu-files-editor {
      width: min(78rem, 96vw);
      max-height: calc(100vh - 3rem);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 1.25rem;
      background: rgb(var(--gray-900,17 24 32));
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
    }
    .releu-files-editor-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 1.25rem 1.25rem 1rem;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .releu-files-editor-title {
      font-size: 1.15rem;
      font-weight: 700;
      color: #f8fafc;
      word-break: break-word;
    }
    .releu-files-editor-meta {
      margin-top: 0.3rem;
      font-size: 0.82rem;
      color: #94a3b8;
    }
    .releu-files-editor-body {
      padding: 1rem 1.25rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      overflow: auto;
    }
    .releu-files-editor-note {
      font-size: 0.88rem;
      color: #94a3b8;
    }
    .releu-files-editor-textarea {
      min-height: min(60vh, 36rem);
      width: 100%;
      resize: vertical;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 1rem;
      background: rgb(var(--gray-950,15 20 27));
      padding: 1rem;
      color: #e2e8f0;
      font: 400 0.92rem/1.55 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
      outline: none;
      white-space: pre;
    }
    .releu-files-editor-textarea:focus {
      border-color: rgba(148, 163, 184, 0.5);
    }
    .releu-files-editor-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }
  `;
  document.head.append(style);
}

function normalizeFilesBrowserPath(value) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
}

function filesDownloadHref(relativePath) {
  const params = new URLSearchParams();
  params.set("path", relativePath);
  return `/api/servers/${encodeURIComponent(activeServerId())}/files/download?${params.toString()}`;
}

function filesPathLabel(relativePath) {
  return relativePath ? `Server Root / ${relativePath}` : "Server Root";
}

function fileEntryIcon(entry) {
  if (entry?.type === "directory") {
    return `<svg class="fi-icon fi-size-md" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><path d="M3 10h18v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  }
  return `<svg class="fi-icon fi-size-md" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5a1 1 0 0 0 1 1h5"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l6 6v10a2 2 0 0 1-2 2z"/></svg>`;
}

async function loadFilesListing(pathValue = APP_STATE.filesBrowser.path, searchValue = APP_STATE.filesBrowser.search) {
  const normalizedPath = normalizeFilesBrowserPath(pathValue);
  const query = new URLSearchParams();
  if (normalizedPath) {
    query.set("path", normalizedPath);
  }
  const trimmedSearch = String(searchValue ?? "").trim();
  if (trimmedSearch) {
    query.set("search", trimmedSearch);
  }
  try {
    const payload = await api(
      `/api/servers/${encodeURIComponent(activeServerId())}/files?${query.toString()}`,
    );
    APP_STATE.filesBrowser.path = payload.files?.path ?? normalizedPath;
    APP_STATE.filesBrowser.search = trimmedSearch;
    APP_STATE.filesBrowser.listing = payload.files ?? null;
    return APP_STATE.filesBrowser.listing;
  } catch (error) {
    if (normalizedPath) {
      APP_STATE.filesBrowser.path = "";
      return loadFilesListing("", searchValue);
    }
    throw error;
  }
}

function renderFilesBrowserRows(listing) {
  const parentRow = listing.parentPath !== null
    ? `<tr class="fi-ta-row">
        <td class="fi-ta-cell">
          <button type="button" class="releu-files-name-btn" data-files-nav="${escapeHtml(listing.parentPath ?? "")}">
            <span class="releu-files-icon"><svg class="fi-icon fi-size-md" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></span>
            <span class="releu-files-name-copy">
              <span class="releu-files-name">..</span>
              <span class="releu-files-sub">Go up one folder</span>
            </span>
          </button>
        </td>
        <td class="fi-ta-cell"><span class="releu-files-kind">directory</span></td>
        <td class="fi-ta-cell text-slate-500">-</td>
        <td class="fi-ta-cell text-slate-400">${escapeHtml(formatDate(null))}</td>
        <td class="fi-ta-cell"><div class="releu-files-actions"></div></td>
      </tr>`
    : "";

  const entryRows = (listing.entries ?? []).map((entry) => {
    const primaryAction =
      entry.type === "directory"
        ? `<button type="button" class="releu-files-name-btn" data-files-nav="${escapeHtml(entry.path)}">`
        : entry.isTextEditable
          ? `<button type="button" class="releu-files-name-btn" data-files-edit="${escapeHtml(entry.path)}">`
          : `<a href="${escapeHtml(filesDownloadHref(entry.path))}" class="releu-files-name-btn">`;
    const primaryClose = entry.type === "directory" || entry.isTextEditable ? "</button>" : "</a>";
    const actionButtons = entry.type === "directory"
      ? `<button type="button" class="fi-btn fi-size-sm fi-ac-btn-action" data-files-nav="${escapeHtml(entry.path)}">Open</button>`
      : `${entry.isTextEditable ? `<button type="button" class="fi-btn fi-size-sm fi-ac-btn-action" data-files-edit="${escapeHtml(entry.path)}">Edit</button>` : ""}<a href="${escapeHtml(filesDownloadHref(entry.path))}" class="fi-btn fi-size-sm fi-ac-btn-action">Download</a>`;
    return `<tr class="fi-ta-row">
      <td class="fi-ta-cell">
        ${primaryAction}
          <span class="releu-files-icon">${fileEntryIcon(entry)}</span>
          <span class="releu-files-name-copy">
            <span class="releu-files-name">${escapeHtml(entry.name)}</span>
            <span class="releu-files-sub">${escapeHtml(entry.path)}</span>
          </span>
        ${primaryClose}
      </td>
      <td class="fi-ta-cell"><span class="releu-files-kind">${escapeHtml(entry.type)}</span></td>
      <td class="fi-ta-cell text-slate-300">${entry.type === "file" ? escapeHtml(formatBytes(entry.sizeBytes ?? 0)) : "-"}</td>
      <td class="fi-ta-cell text-slate-400">${escapeHtml(formatDate(entry.modifiedAt))}</td>
      <td class="fi-ta-cell">
        <div class="releu-files-actions">
          ${actionButtons}
          <button type="button" class="fi-btn fi-size-sm fi-ac-btn-action" data-files-delete="${escapeHtml(entry.path)}">Delete</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  if (!parentRow && !entryRows) {
    return `<tr><td colspan="5" class="releu-files-empty">This folder is empty.</td></tr>`;
  }
  return `${parentRow}${entryRows}`;
}

function renderFilesEditorModal() {
  const editor = APP_STATE.filesBrowser.editor;
  if (!editor) return "";
  const draft = editor.draft ?? editor.content ?? "";
  const saveLabel = editor.saving ? "Saving..." : "Save File";
  return `<div class="releu-files-editor-backdrop" data-files-close-editor>
    <div class="releu-files-editor" role="dialog" aria-modal="true" aria-label="Edit file" onclick="event.stopPropagation()">
      <div class="releu-files-editor-head">
        <div>
          <div class="releu-files-editor-title">${escapeHtml(editor.path)}</div>
          <div class="releu-files-editor-meta">${escapeHtml(formatBytes(editor.sizeBytes ?? 0))} • ${escapeHtml(formatDate(editor.modifiedAt))}</div>
        </div>
        <button type="button" class="fi-btn fi-size-sm fi-ac-btn-action" data-files-close-editor>Close</button>
      </div>
      <form class="releu-files-editor-body" data-files-editor-form>
        <div class="releu-files-editor-note">Edit the live server file directly from the new UI. Unsupported binary files stay download-only.</div>
        <textarea class="releu-files-editor-textarea" data-files-editor-textarea spellcheck="false">${escapeHtml(draft)}</textarea>
        <div class="releu-files-editor-actions">
          <button type="button" class="fi-btn fi-size-md fi-ac-btn-action" data-files-close-editor>Cancel</button>
          <button type="submit" class="fi-btn fi-btn-color-primary fi-size-md" data-files-save-editor ${editor.saving ? "disabled" : ""}>${escapeHtml(saveLabel)}</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderFilesBrowserContent(listing) {
  return `<div class="releu-files-shell">
    <div class="releu-files-toolbar">
      <div class="releu-files-toolbar-copy">
        <div class="releu-files-toolbar-label">File Manager</div>
        <div class="releu-files-toolbar-path">${escapeHtml(filesPathLabel(listing.path))}</div>
      </div>
      <div class="releu-files-toolbar-actions">
        <button type="button" class="fi-btn fi-size-sm fi-ac-btn-action" data-files-up ${listing.parentPath === null ? "disabled" : ""}>Up</button>
        <button type="button" class="fi-btn fi-size-sm fi-ac-btn-action" data-files-refresh>Refresh</button>
        <button type="button" class="fi-btn fi-size-sm fi-ac-btn-action" data-files-new-folder>New Folder</button>
        ${isDesktopApp() ? `<button type="button" class="fi-btn fi-size-sm fi-ac-btn-action" data-files-open-root>Open Server Folder</button>` : ""}
      </div>
    </div>
    <div class="releu-files-table-wrap">
      <table class="fi-ta-table releu-files-table">
        <thead>
          <tr>
            <th class="fi-ta-header-cell">Name</th>
            <th class="fi-ta-header-cell">Type</th>
            <th class="fi-ta-header-cell">Size</th>
            <th class="fi-ta-header-cell">Modified</th>
            <th class="fi-ta-header-cell">Actions</th>
          </tr>
        </thead>
        <tbody>${renderFilesBrowserRows(listing)}</tbody>
      </table>
    </div>
  </div>${renderFilesEditorModal()}`;
}

async function closeFilesEditor() {
  if (APP_STATE.filesBrowser.editor?.dirty && !window.confirm("Discard unsaved file changes?")) {
    return false;
  }
  APP_STATE.filesBrowser.editor = null;
  await patchFilesPage();
  return true;
}

async function patchFilesPage() {
  const server = activeServer();
  if (!server) return;
  injectFilesPageStyles();
  if (APP_STATE.filesBrowser.serverId !== activeServerId()) {
    APP_STATE.filesBrowser.serverId = activeServerId();
    APP_STATE.filesBrowser.path = "";
    APP_STATE.filesBrowser.search = "";
    APP_STATE.filesBrowser.listing = null;
    APP_STATE.filesBrowser.editor = null;
  }

  const tableContainer = document.querySelector(".fi-ta-content-ctn");
  const searchInput = document.querySelector(".fi-ta-search-field input");
  const uploadButton = document.querySelector('button[aria-label="File upload"]');
  const uploadInput = document.querySelector('input[type="file"][x-ref="fileInput"], input[type="file"].hidden');
  if (!tableContainer || !searchInput || !uploadButton || !uploadInput) return;

  document.querySelectorAll(".fi-ta-selection-indicator, .fi-pagination, .fi-ta-filter-indicators").forEach((node) => {
    node.style.display = "none";
  });
  document.querySelectorAll('button[aria-label="Upload u r l"], button[aria-label="Search"]').forEach((node) => {
    node.style.display = "none";
  });

  if (!searchInput.dataset.releuFilesBound) {
    searchInput.addEventListener("input", () => {
      APP_STATE.filesBrowser.search = searchInput.value.trim();
      if (APP_STATE.filesBrowser.searchTimer) {
        window.clearTimeout(APP_STATE.filesBrowser.searchTimer);
      }
      APP_STATE.filesBrowser.searchTimer = window.setTimeout(() => {
        loadFilesListing(APP_STATE.filesBrowser.path, APP_STATE.filesBrowser.search)
          .then(() => patchFilesPage())
          .catch(showError);
      }, 180);
    });
    searchInput.dataset.releuFilesBound = "true";
  }
  if (searchInput.value !== APP_STATE.filesBrowser.search) {
    searchInput.value = APP_STATE.filesBrowser.search;
  }

  if (!uploadButton.dataset.releuFilesBound) {
    uploadButton.addEventListener("click", (event) => {
      event.preventDefault();
      uploadInput.click();
    });
    uploadButton.dataset.releuFilesBound = "true";
  }

  if (!uploadInput.dataset.releuFilesBound) {
    uploadInput.addEventListener("change", async () => {
      const files = Array.from(uploadInput.files ?? []);
      if (!files.length) return;
      try {
        setButtonBusy(uploadButton, true, files.length > 1 ? "Uploading..." : "Uploading...");
        for (const file of files) {
          await apiBinary(
            `/api/servers/${encodeURIComponent(activeServerId())}/files/upload?path=${encodeURIComponent(APP_STATE.filesBrowser.path ?? "")}`,
            await file.arrayBuffer(),
            {
              "Content-Type": "application/octet-stream",
              "X-File-Name": file.name,
            },
            { timeoutMs: Math.max(30_000, Math.min(15 * 60_000, file.size * 4)) },
          );
        }
        await loadFilesListing(APP_STATE.filesBrowser.path, APP_STATE.filesBrowser.search);
        await patchFilesPage();
        showStatus(files.length === 1 ? `Uploaded ${files[0].name}.` : `Uploaded ${files.length} files.`, "success");
      } catch (error) {
        showError(error);
      } finally {
        uploadInput.value = "";
        setButtonBusy(uploadButton, false);
      }
    });
    uploadInput.dataset.releuFilesBound = "true";
  }

  if (!tableContainer.dataset.releuFilesBound) {
    tableContainer.addEventListener("click", async (event) => {
      const navButton = event.target.closest("[data-files-nav]");
      if (navButton) {
        APP_STATE.filesBrowser.path = navButton.dataset.filesNav ?? "";
        APP_STATE.filesBrowser.editor = null;
        await loadFilesListing(APP_STATE.filesBrowser.path, APP_STATE.filesBrowser.search);
        await patchFilesPage();
        return;
      }

      const upButton = event.target.closest("[data-files-up]");
      if (upButton) {
        const listing = APP_STATE.filesBrowser.listing;
        if (listing?.parentPath !== null) {
          APP_STATE.filesBrowser.path = listing?.parentPath ?? "";
          APP_STATE.filesBrowser.editor = null;
          await loadFilesListing(APP_STATE.filesBrowser.path, APP_STATE.filesBrowser.search);
          await patchFilesPage();
        }
        return;
      }

      const refreshButton = event.target.closest("[data-files-refresh]");
      if (refreshButton) {
        await loadFilesListing(APP_STATE.filesBrowser.path, APP_STATE.filesBrowser.search);
        await patchFilesPage();
        return;
      }

      const openRootButton = event.target.closest("[data-files-open-root]");
      if (openRootButton) {
        try {
          await openLocalPath(server.serverDir);
        } catch (error) {
          showError(error);
        }
        return;
      }

      const newFolderButton = event.target.closest("[data-files-new-folder]");
      if (newFolderButton) {
        const folderName = window.prompt("Folder name");
        if (!folderName) return;
        try {
          setButtonBusy(newFolderButton, true, "Creating...");
          const payload = await api(`/api/servers/${encodeURIComponent(activeServerId())}/files/folder`, {
            method: "POST",
            body: {
              path: APP_STATE.filesBrowser.path,
              name: folderName,
            },
          });
          APP_STATE.filesBrowser.listing = payload.files ?? APP_STATE.filesBrowser.listing;
          await patchFilesPage();
          showStatus(`Created folder ${folderName}.`, "success");
        } catch (error) {
          showError(error);
        } finally {
          setButtonBusy(newFolderButton, false);
        }
        return;
      }

      const deleteButton = event.target.closest("[data-files-delete]");
      if (deleteButton) {
        const targetPath = deleteButton.dataset.filesDelete ?? "";
        if (!targetPath) return;
        if (!window.confirm(`Delete ${targetPath}?`)) return;
        try {
          setButtonBusy(deleteButton, true, "Deleting...");
          const payload = await api(`/api/servers/${encodeURIComponent(activeServerId())}/files?path=${encodeURIComponent(targetPath)}`, {
            method: "DELETE",
          });
          APP_STATE.filesBrowser.editor =
            APP_STATE.filesBrowser.editor?.path === targetPath ? null : APP_STATE.filesBrowser.editor;
          APP_STATE.filesBrowser.listing = payload.files ?? APP_STATE.filesBrowser.listing;
          APP_STATE.filesBrowser.path = payload.files?.path ?? APP_STATE.filesBrowser.path;
          await patchFilesPage();
          showStatus(`Deleted ${targetPath}.`, "success");
        } catch (error) {
          showError(error);
        } finally {
          setButtonBusy(deleteButton, false);
        }
        return;
      }

      const editButton = event.target.closest("[data-files-edit]");
      if (editButton) {
        const targetPath = editButton.dataset.filesEdit ?? "";
        if (!targetPath) return;
        APP_STATE.filesBrowser.editor = {
          serverId: activeServerId(),
          path: targetPath,
          loading: true,
          draft: "",
          dirty: false,
          saving: false,
        };
        await patchFilesPage();
        try {
          const payload = await api(
            `/api/servers/${encodeURIComponent(activeServerId())}/files/read?path=${encodeURIComponent(targetPath)}`,
          );
          APP_STATE.filesBrowser.editor = {
            serverId: activeServerId(),
            path: payload.file?.path ?? targetPath,
            sizeBytes: payload.file?.sizeBytes ?? 0,
            modifiedAt: payload.file?.modifiedAt ?? null,
            content: payload.file?.content ?? "",
            draft: payload.file?.content ?? "",
            dirty: false,
            saving: false,
            loading: false,
          };
          await patchFilesPage();
        } catch (error) {
          APP_STATE.filesBrowser.editor = null;
          showError(error);
        }
        return;
      }

      const closeEditorButton = event.target.closest("[data-files-close-editor]");
      if (closeEditorButton) {
        await closeFilesEditor();
      }
    });

    tableContainer.addEventListener("input", (event) => {
      if (!event.target.matches("[data-files-editor-textarea]")) return;
      const editor = APP_STATE.filesBrowser.editor;
      if (!editor) return;
      const nextDraft = event.target.value;
      editor.draft = nextDraft;
      editor.dirty = nextDraft !== (editor.content ?? "");
    });

    tableContainer.addEventListener("submit", async (event) => {
      if (!event.target.matches("[data-files-editor-form]")) return;
      event.preventDefault();
      const editor = APP_STATE.filesBrowser.editor;
      if (!editor || editor.loading || editor.saving) return;
      try {
        editor.saving = true;
        await patchFilesPage();
        const payload = await api(`/api/servers/${encodeURIComponent(activeServerId())}/files/write`, {
          method: "POST",
          body: {
            path: editor.path,
            content: editor.draft ?? editor.content ?? "",
          },
        });
        APP_STATE.filesBrowser.editor = {
          serverId: activeServerId(),
          path: payload.file?.path ?? editor.path,
          sizeBytes: payload.file?.sizeBytes ?? 0,
          modifiedAt: payload.file?.modifiedAt ?? null,
          content: payload.file?.content ?? editor.draft ?? "",
          draft: payload.file?.content ?? editor.draft ?? "",
          dirty: false,
          saving: false,
          loading: false,
        };
        await loadFilesListing(APP_STATE.filesBrowser.path, APP_STATE.filesBrowser.search);
        await patchFilesPage();
        showStatus(`Saved ${editor.path}.`, "success");
      } catch (error) {
        if (APP_STATE.filesBrowser.editor) {
          APP_STATE.filesBrowser.editor.saving = false;
        }
        showError(error);
        await patchFilesPage();
      }
    });

    tableContainer.dataset.releuFilesBound = "true";
  }

  const editorHasFocus = document.activeElement?.matches?.("[data-files-editor-textarea]");
  const activelyEditing =
    Boolean(APP_STATE.filesBrowser.editor) &&
    (Boolean(APP_STATE.filesBrowser.editor?.dirty) || editorHasFocus);
  if (!activelyEditing) {
    await loadFilesListing(APP_STATE.filesBrowser.path, APP_STATE.filesBrowser.search);
  }

  const listing = APP_STATE.filesBrowser.listing ?? {
    path: "",
    parentPath: null,
    entries: [],
  };
  if (editorHasFocus && APP_STATE.filesBrowser.editor && tableContainer.querySelector(".releu-files-editor")) {
    return;
  }
  tableContainer.innerHTML = renderFilesBrowserContent(listing);
  const backdrop = tableContainer.querySelector(".releu-files-editor-backdrop");
  backdrop?.addEventListener("click", async (event) => {
    if (event.target !== backdrop) return;
    await closeFilesEditor();
  });
  tableContainer.querySelectorAll(".releu-files-editor [data-files-close-editor]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      await closeFilesEditor();
    });
  });
}

function patchMiscPage() {
  const server = activeServer();
  if (!server) return;
  const properties = server.server?.properties ?? {};
  const misc = server.misc ?? {};
  const form = document.querySelector("[data-releu-misc-form]");
  if (!form) return;
  const statusNode = form.querySelector("[data-misc-autosave-status]");
  const boolProp = (key, fallback = false) =>
    String(properties[key] ?? String(fallback)).toLowerCase() === "true";
  const numberProp = (key, fallback = 0) => {
    const value = Number.parseInt(String(properties[key] ?? fallback), 10);
    return Number.isFinite(value) ? value : fallback;
  };
  const paintStatus = (message, tone = "neutral") => {
    APP_STATE.miscSaveState = { message, tone };
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.style.color =
      tone === "error"
        ? "#fca5a5"
        : tone === "success"
          ? "#86efac"
          : tone === "saving"
            ? "#93c5fd"
            : "#94a3b8";
  };
  const syncSelect = (name, enabled) => {
    const input = form.elements[name];
    if (!input || input.dataset.releuDirty === "true" || document.activeElement === input) return;
    input.value = enabled ? "true" : "false";
  };
  const syncNumber = (name, value) => {
    const input = form.elements[name];
    if (!input || input.dataset.releuDirty === "true" || document.activeElement === input) return;
    input.value = String(value);
  };

  syncSelect("allowCrackedClients", !boolProp("online-mode", true));
  syncSelect("whitelist", boolProp("white-list", false));
  syncSelect("showPlayerCount", boolProp("enable-status", true));
  syncSelect("hideOnlinePlayers", boolProp("hide-online-players", false));
  syncSelect("allowProxyConnections", !boolProp("prevent-proxy-connections", false));
  syncSelect("commandBlocks", boolProp("enable-command-block", false));
  syncSelect("pauseWhenEmpty", numberProp("pause-when-empty-seconds", -1) > 0);
  syncSelect("pvp", boolProp("pvp", true));
  syncSelect("allowFlight", boolProp("allow-flight", false));
  syncSelect("keepInventory", Boolean(misc.keepInventory));
  syncSelect("sharedHealth", Boolean(misc.sharedHealth));
  syncSelect("hardcore", boolProp("hardcore", false));
  syncSelect("forceGamemode", boolProp("force-gamemode", false));
  syncSelect("generateStructures", boolProp("generate-structures", true));
  syncSelect("logPlayerIPs", boolProp("log-ips", true));
  syncSelect("allowNether", boolProp("allow-nether", true));
  syncSelect("allowEnd", boolProp("allow-end", true));
  syncNumber("maxPlayers", numberProp("max-players", 100));
  syncNumber("playerIdleTimeout", numberProp("player-idle-timeout", 0));
  syncNumber("spawnProtection", numberProp("spawn-protection", 0));

  paintStatus(
    APP_STATE.miscSaveState.message ||
      "Changes save automatically. Releu also checks server.properties for outside edits every second.",
    APP_STATE.miscSaveState.tone || "neutral",
  );

  if (form.dataset.releuBound === "true") return;
  form.dataset.releuBound = "true";

  const scheduleSubmit = (delay = 180) => {
    clearTimeout(APP_STATE.miscSaveTimer);
    APP_STATE.miscSaveTimer = window.setTimeout(() => form.requestSubmit(), delay);
  };
  const markDirty = (input) => {
    if (!input?.name) return;
    input.dataset.releuDirty = "true";
  };
  const wireAutosave = (input) => {
    if (!input || input.dataset.releuAutosaveBound === "true") return;
    input.dataset.releuAutosaveBound = "true";
    const handleDirtyInput = () => {
      markDirty(input);
      if (form.dataset.releuSaving === "true") {
        form.dataset.miscResubmit = "true";
        paintStatus("Saving the latest change...", "saving");
        return;
      }
      paintStatus("Saving changes...", "saving");
      scheduleSubmit(input.type === "number" ? 500 : 180);
    };
    input.addEventListener("input", handleDirtyInput);
    input.addEventListener("change", handleDirtyInput);
  };

  Array.from(form.querySelectorAll("select, input")).forEach(wireAutosave);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.releuSaving === "true") return;

    try {
      const currentAllowCrackedClients =
        String(activeServer()?.server?.properties?.["online-mode"] ?? "true").toLowerCase() !== "true";
      const nextAllowCrackedClients = form.elements.allowCrackedClients.value === "true";
      if (currentAllowCrackedClients !== nextAllowCrackedClients) {
        const proceed = window.confirm(
          "Warning: changing Allow Cracked Clients switches players to a different save slot / UUID, so their inventory can look missing in this mode.\n\nIf you switch it back later, the original save usually comes back.\n\nDo you want to continue?",
        );
        if (!proceed) {
          form.elements.allowCrackedClients.value = currentAllowCrackedClients ? "true" : "false";
          form.elements.allowCrackedClients.dataset.releuDirty = "false";
          paintStatus("Allow Cracked Clients change cancelled.", "neutral");
          return;
        }
      }

      const currentKeepInventory = Boolean(activeServer()?.misc?.keepInventory);
      const nextKeepInventory = form.elements.keepInventory.value === "true";
      if (currentKeepInventory !== nextKeepInventory) {
        const proceed = window.confirm(
          "Warning: changing Keep Inventory can sometimes make every user's inventory look missing or get lost, and sometimes nothing happens.\n\nThis usually depends on when player data gets saved, deaths, and world state.\n\nDo you want to continue?",
        );
        if (!proceed) {
          form.elements.keepInventory.value = currentKeepInventory ? "true" : "false";
          form.elements.keepInventory.dataset.releuDirty = "false";
          paintStatus("Keep Inventory change cancelled.", "neutral");
          return;
        }
      }

      form.dataset.releuSaving = "true";
      paintStatus("Saving changes...", "saving");
      await api(`/api/servers/${encodeURIComponent(activeServerId())}/settings/misc`, {
        method: "POST",
        body: {
          allowCrackedClients: form.elements.allowCrackedClients.value === "true",
          whitelist: form.elements.whitelist.value === "true",
          showPlayerCount: form.elements.showPlayerCount.value === "true",
          hideOnlinePlayers: form.elements.hideOnlinePlayers.value === "true",
          allowProxyConnections: form.elements.allowProxyConnections.value === "true",
          maxPlayers: Number.parseInt(form.elements.maxPlayers.value || "100", 10) || 100,
          commandBlocks: form.elements.commandBlocks.value === "true",
          playerIdleTimeout: Number.parseInt(form.elements.playerIdleTimeout.value || "0", 10) || 0,
          spawnProtection: Number.parseInt(form.elements.spawnProtection.value || "0", 10) || 0,
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
      await refreshState(activeServerId());
      Array.from(form.querySelectorAll("select, input")).forEach((input) => {
        input.dataset.releuDirty = "false";
      });
      paintStatus(`Saved automatically at ${new Date().toLocaleTimeString()}.`, "success");
    } catch (error) {
      paintStatus(error instanceof Error ? error.message : "Could not save misc settings.", "error");
      showError(error);
    } finally {
      form.dataset.releuSaving = "false";
      if (form.dataset.miscResubmit === "true") {
        form.dataset.miscResubmit = "false";
        paintStatus("Saving changes...", "saving");
        scheduleSubmit(0);
      }
    }
  });
}

const CLOUD_AUTH_FOCUS_SELECTOR =
  "[data-releu-cloud-device-label], [data-releu-cloud-account-username], [data-releu-cloud-account-password], [data-releu-cloud-target-restore-key]";

function readCloudDraftNodeValue(root, selector) {
  const node = root.querySelector?.(selector);
  if (!node) return undefined;
  if (node.dataset?.releuPlaceholderVisible === "true") return "";
  if ("value" in node) return node.value;
  return node.textContent ?? undefined;
}

function preserveCloudBackupDraft(root = document) {
  APP_STATE.cloudBackup.draft = {
    ...APP_STATE.cloudBackup.draft,
    deviceLabel:
      readCloudDraftNodeValue(root, "[data-releu-cloud-device-label]") ??
      APP_STATE.cloudBackup.draft.deviceLabel,
    accountUsername:
      readCloudDraftNodeValue(root, "[data-releu-cloud-account-username]") ??
      APP_STATE.cloudBackup.draft.accountUsername,
    accountPassword:
      readCloudDraftNodeValue(root, "[data-releu-cloud-account-password]") ??
      APP_STATE.cloudBackup.draft.accountPassword,
    targetRestoreKey:
      readCloudDraftNodeValue(root, "[data-releu-cloud-target-restore-key]") ??
      APP_STATE.cloudBackup.draft.targetRestoreKey,
  };
}

function maybeRefreshCloudBackupStatus(rerender) {
  const cloudAuthFocused = Boolean(document.activeElement?.matches?.(CLOUD_AUTH_FOCUS_SELECTOR));
  if (
    !cloudAuthFocused &&
    !APP_STATE.cloudBackup.loading &&
    (!APP_STATE.cloudBackup.status || Date.now() - APP_STATE.cloudBackup.lastFetchedAt > 15000)
  ) {
    refreshCloudBackupStatus()
      .then(() => rerender?.())
      .catch(() => {});
  }
}

function renderCloudBackupSection({ mount = document.querySelector(".fi-page-content"), state, serverId, rerender }) {
  if (!mount) return;
  preserveCloudBackupDraft(mount);
  let cloudSection = mount.querySelector("[data-releu-cloud-section]");
  if (!cloudSection) {
    cloudSection = document.createElement("section");
    cloudSection.className = "fi-section mt-6";
    cloudSection.dataset.releuCloudSection = "true";
    mount.append(cloudSection);
  }
  const rerenderPage = typeof rerender === "function" ? rerender : () => {};
  const cloud = APP_STATE.cloudBackup.status ?? {};
  const cloudProvider = cloud.provider ?? state.cloudBackupSettings?.provider ?? "website";
  const cloudAuthScreen = APP_STATE.cloudBackup.authScreen === "signup" ? "signup" : "login";
  const currentCloudPanel = APP_STATE.cloudBackup.currentPanel === "dashboard" ? "dashboard" : "auth";
  const cloudDraft = {
    deviceLabel:
      String(APP_STATE.cloudBackup.draft.deviceLabel ?? "").trim() ||
      String(cloud.deviceLabel ?? state.cloudBackupSettings?.deviceLabel ?? "").trim(),
    accountUsername:
      String(APP_STATE.cloudBackup.draft.accountUsername ?? "").trim() ||
      String(cloud.accountUsername ?? state.cloudBackupSettings?.accountUsername ?? "").trim(),
    accountPassword: String(APP_STATE.cloudBackup.draft.accountPassword ?? ""),
    targetRestoreKey:
      String(APP_STATE.cloudBackup.draft.targetRestoreKey ?? "").trim() ||
      String(cloud.targetRestoreKey ?? state.cloudBackupSettings?.targetRestoreKey ?? "").trim(),
  };
  const uploadLimitBytes =
    Number(cloud.uploadLimitBytes ?? (state.cloudBackupSettings?.uploadLimitMb ?? 50) * 1024 * 1024) ||
    0;
  const uploadLimitLabel = usingTailscaleCloud
    ? (cloud.uploadLimitLabel ?? "Remote server disk")
    : formatBytes(uploadLimitBytes);
  const cloudActivityPolicyText = usingTailscaleCloud
    ? "Rolling cloud backups are deleted automatically after 7 days with no upload, download, or restore activity."
    : "";
  cloudSection.innerHTML = `
    <header class="fi-section-header">
      <div>
        <h2 class="fi-section-header-heading">
          <span class="releu-panel-title">
            <svg class="releu-panel-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
            <span>Cloud Backup</span>
          </span>
        </h2>
        <p class="fi-section-header-description">${usingTailscaleCloud ? (cloudNeedsAuthGate ? "Page 1 of 2. Sign up or log in first. Releu hides every backup control until authentication succeeds." : "Page 2 of 2. You are signed in, so the cloud dashboard is unlocked.") : "Upload full server backups without exposing private cloud credentials in the public app."}</p>
      </div>
    </header>
    <div class="fi-section-content" style="display:grid;gap:1rem;">
      ${usingTailscaleCloud && cloudNeedsAuthGate ? `
        <div class="cb-auth-tabs">
          <button type="button" class="cb-auth-tab${cloudAuthScreen === "login" ? " is-active" : ""}" data-releu-cloud-auth-screen="login">Log In</button>
          <button type="button" class="cb-auth-tab${cloudAuthScreen === "signup" ? " is-active" : ""}" data-releu-cloud-auth-screen="signup">Sign Up</button>
        </div>
        <div class="cb-grid-2">
          <div style="display:grid;gap:1rem;">
            <label class="cb-field">
              <span class="cb-field-label">Device Label</span>
              <input class="cb-plain-input" data-releu-cloud-device-label type="text" value="${escapeHtml(cloudDraft.deviceLabel)}" placeholder="My desktop PC">
            </label>
            <label class="cb-field">
              <span class="cb-field-label">Cloud Username</span>
              <input class="cb-plain-input" data-releu-cloud-account-username type="text" value="${escapeHtml(cloudDraft.accountUsername)}" placeholder="alex">
            </label>
            <label class="cb-field">
              <span class="cb-field-label">Cloud Password</span>
              <input class="cb-plain-input" data-releu-cloud-account-password type="password" value="${escapeHtml(cloudDraft.accountPassword)}" placeholder="Log in to backup">
            </label>
          </div>
          <div style="display:grid;gap:1rem;align-content:start;">
            <div class="cb-status">
              ${cloudAuthScreen === "signup" ? "Create a cloud backup account first. Releu unlocks the actual backup dashboard only after sign-up succeeds." : "Log in first. Releu hides backup keys, upload, restore, and history until authentication succeeds."}
            </div>
            <div class="cb-chips">
              <div class="cb-chip">Connection: ${escapeHtml(cloud.functionReady ? "Ready" : APP_STATE.cloudBackup.loading ? "Checking..." : "Not Ready")}</div>
              <div class="cb-chip">${escapeHtml(cloudActivityPolicyText)}</div>
            </div>
            ${cloud.authError ? `<div class="cb-status" style="color:#fecaca;">${escapeHtml(cloud.authError)}</div>` : ""}
            ${cloud.functionError ? `<div class="cb-status" style="color:#fecaca;">${escapeHtml(cloud.functionError)}</div>` : ""}
            <div class="cb-actions">
              ${cloudAuthScreen === "signup"
                ? `<button type="button" class="cb-btn is-primary" data-releu-cloud-register>Create Account</button>`
                : `<button type="button" class="cb-btn is-primary" data-releu-cloud-login>Log In</button>`}
              <button type="button" class="cb-btn" data-releu-cloud-refresh>Refresh Status</button>
            </div>
          </div>
        </div>`
      : `
        <section class="fi-section fi-section-has-header">
          <header class="fi-section-header">
            <div class="fi-section-header-text-ctn">
              <h2 class="fi-section-header-heading">
                <span class="releu-panel-title">
                  <svg class="releu-panel-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.51-7.11"/><path d="M21 3v6h-6"/></svg>
                  <span>Cloud Controls</span>
                </span>
              </h2>
            </div>
          </header>
          <div class="fi-section-content">
            <div class="cb-grid-2">
              <div style="display:grid;gap:1rem;">
                <label style="display:flex;align-items:center;gap:.75rem;">
                  <input type="checkbox" data-releu-cloud-enabled ${state.cloudBackupSettings?.enabled ? "checked" : ""}>
                  <span>Enable cloud backup for this Releu install</span>
                </label>
                <label class="cb-field">
                  <span class="cb-field-label">Device Label</span>
                  <input class="cb-plain-input" data-releu-cloud-device-label type="text" value="${escapeHtml(cloudDraft.deviceLabel)}" placeholder="My desktop PC">
                </label>
                <div class="cb-input-wrp">
                  <div class="cb-input-prefix">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                    <span class="cb-input-prefix-label">My Backup Key</span>
                  </div>
                  <div class="cb-input-value" style="font-family:ui-monospace,monospace;font-size:.82rem;">${escapeHtml(cloud.restoreKey ?? "") || "Register or log in first"}</div>
                </div>
                <label class="cb-field">
                  <span class="cb-field-label">Shared Backup Key (Optional)</span>
                  <input class="cb-plain-input" data-releu-cloud-target-restore-key type="text" value="${escapeHtml(cloudDraft.targetRestoreKey)}" placeholder="Enter another user's key to upload or restore their backup space">
                </label>
              </div>
              <div style="display:grid;gap:1rem;align-content:start;">
                <div class="cb-chips">
                  <div class="cb-chip">Connection: ${escapeHtml(cloud.functionReady ? "Ready" : APP_STATE.cloudBackup.loading ? "Checking..." : "Not Ready")}</div>
                  <div class="cb-chip">Login: ${escapeHtml(cloud.loggedIn ? cloud.accountUsername || "account" : "Not logged in")}</div>
                  <div class="cb-chip">Upload limit: ${escapeHtml(uploadLimitLabel)}</div>
                  <div class="cb-chip">Cloud used: ${escapeHtml(formatBytes(cloud.usedBytes ?? 0))}</div>
                  <div class="cb-chip">Saved backups: ${escapeHtml(String(cloud.backupsCount ?? 0))}</div>
                  ${usingTailscaleCloud && cloud.usingSharedRestoreKey ? `<div class="cb-chip">Target key: Shared backup space</div>` : ""}
                </div>
                <div class="cb-status">
                  ${escapeHtml(cloudActivityPolicyText || "Cloud backup is ready. Upload, download, and restore actions are available now.")}
                  ${cloud.functionError ? `<div style="margin-top:.5rem;color:#fecaca;">${escapeHtml(cloud.functionError)}</div>` : ""}
                  ${cloud.authError ? `<div style="margin-top:.5rem;color:#fecaca;">${escapeHtml(cloud.authError)}</div>` : ""}
                  ${!cloud.functionError ? `<div style="margin-top:.5rem;">Latest backup: <span style="color:oklch(0.967 0.001 286.375);">${escapeHtml(cloud.latestBackup?.backup_name ?? "None yet")}</span></div>` : ""}
                </div>
                <div class="cb-actions">
                  <button type="button" class="cb-btn" data-releu-cloud-save>Save Settings</button>
                  ${cloud.loggedIn ? `<button type="button" class="cb-btn" data-releu-cloud-logout>Log Out</button>` : ""}
                  ${cloud.loggedIn ? `<button type="button" class="cb-btn" data-releu-cloud-rotate>Rotate Key</button>` : ""}
                  <button type="button" class="cb-btn is-primary" data-releu-cloud-upload ${!state.cloudBackupSettings?.enabled || !cloud.loggedIn ? "disabled" : ""}>Backup To Cloud Now</button>
                  <button type="button" class="cb-btn" data-releu-cloud-refresh>Refresh Status</button>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section class="fi-section fi-section-has-header">
          <header class="fi-section-header">
            <div class="fi-section-header-text-ctn">
              <h2 class="fi-section-header-heading">
                <span class="releu-panel-title">
                  <svg class="releu-panel-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4"/><polyline points="3 16 3 11 8 11"/></svg>
                  <span>Backup History</span>
                </span>
              </h2>
            </div>
          </header>
          <div class="fi-section-content">
            ${cloud.backups?.length
              ? cloud.backups.map((entry) => `
                <div class="cb-backup-row">
                  <div>
                    <div class="cb-backup-name">${escapeHtml(entry.backup_name ?? "Backup")}</div>
                    <div class="cb-backup-meta">${escapeHtml(formatDate(entry.created_at ?? entry.updated_at))} • ${escapeHtml(formatBytes(entry.size_bytes ?? 0))}</div>
                  </div>
                  <div class="cb-actions">
                    <button type="button" class="cb-btn" data-releu-cloud-download="${escapeHtml(entry.id)}">Download</button>
                    <button type="button" class="cb-btn" data-releu-cloud-restore="${escapeHtml(entry.id)}">Restore</button>
                  </div>
                </div>`).join("")
              : `<div class="cb-status">No cloud backups uploaded yet.</div>`}
          </div>
        </section>`}
    </div>`;
  const cloudEnabled = cloudSection.querySelector("[data-releu-cloud-enabled]");
  const cloudDeviceLabel = cloudSection.querySelector("[data-releu-cloud-device-label]");
  const cloudAccountUsername = cloudSection.querySelector("[data-releu-cloud-account-username]");
  const cloudAccountPassword = cloudSection.querySelector("[data-releu-cloud-account-password]");
  const cloudTargetRestoreKey = cloudSection.querySelector("[data-releu-cloud-target-restore-key]");
  const saveCloudButton = cloudSection.querySelector("[data-releu-cloud-save]");
  const registerCloudButton = cloudSection.querySelector("[data-releu-cloud-register]");
  const loginCloudButton = cloudSection.querySelector("[data-releu-cloud-login]");
  const logoutCloudButton = cloudSection.querySelector("[data-releu-cloud-logout]");
  const issueCloudButton = cloudSection.querySelector("[data-releu-cloud-issue]");
  const rotateCloudButton = cloudSection.querySelector("[data-releu-cloud-rotate]");
  const uploadCloudButton = cloudSection.querySelector("[data-releu-cloud-upload]");
  const refreshCloudButton = cloudSection.querySelector("[data-releu-cloud-refresh]");
  cloudSection.querySelectorAll("[data-releu-cloud-auth-screen]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", () => {
      APP_STATE.cloudBackup.authScreen = button.dataset.releuCloudAuthScreen === "signup" ? "signup" : "login";
      rerenderPage();
    });
  });
  if (saveCloudButton && !saveCloudButton.dataset.releuBound) saveCloudButton.addEventListener("click", async () => {
    try {
      setButtonBusy(saveCloudButton, true, "Saving...");
      const payload = await api("/api/cloud-backup/settings", {
        method: "POST",
        body: {
          enabled: Boolean(cloudEnabled?.checked),
          provider: cloudProvider,
          deviceLabel: cloudDeviceLabel?.value ?? "",
          targetRestoreKey: cloudTargetRestoreKey?.value ?? "",
        },
      });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      APP_STATE.cloudBackup.status = payload.status ?? APP_STATE.cloudBackup.status;
      APP_STATE.cloudBackup.lastFetchedAt = Date.now();
      APP_STATE.cloudBackup.draft.deviceLabel = cloudDeviceLabel?.value ?? APP_STATE.cloudBackup.draft.deviceLabel;
      APP_STATE.cloudBackup.draft.targetRestoreKey = cloudTargetRestoreKey?.value ?? "";
      rerenderPage();
      showStatus("Cloud backup settings saved.", "success");
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(saveCloudButton, false);
    }
  }), saveCloudButton.dataset.releuBound = "true";
  if (registerCloudButton && !registerCloudButton.dataset.releuBound) registerCloudButton.addEventListener("click", async () => {
    try {
      setButtonBusy(registerCloudButton, true, "Registering...");
      const payload = await api("/api/cloud-backup/register", {
        method: "POST",
        body: {
          username: cloudAccountUsername?.value ?? "",
          password: cloudAccountPassword?.value ?? "",
          deviceLabel: cloudDeviceLabel?.value ?? "",
        },
      });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      APP_STATE.cloudBackup.status = payload.cloudBackup ?? APP_STATE.cloudBackup.status;
      APP_STATE.cloudBackup.lastFetchedAt = Date.now();
      APP_STATE.cloudBackup.draft.accountUsername = cloudAccountUsername?.value ?? "";
      APP_STATE.cloudBackup.draft.accountPassword = "";
      rerenderPage();
      showStatus("Cloud backup account created.", "success");
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(registerCloudButton, false);
    }
  }), registerCloudButton.dataset.releuBound = "true";
  if (loginCloudButton && !loginCloudButton.dataset.releuBound) loginCloudButton.addEventListener("click", async () => {
    try {
      setButtonBusy(loginCloudButton, true, "Logging In...");
      const payload = await api("/api/cloud-backup/login", {
        method: "POST",
        body: {
          username: cloudAccountUsername?.value ?? "",
          password: cloudAccountPassword?.value ?? "",
          deviceLabel: cloudDeviceLabel?.value ?? "",
        },
      });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      APP_STATE.cloudBackup.status = payload.cloudBackup ?? APP_STATE.cloudBackup.status;
      APP_STATE.cloudBackup.lastFetchedAt = Date.now();
      APP_STATE.cloudBackup.draft.accountUsername = cloudAccountUsername?.value ?? "";
      APP_STATE.cloudBackup.draft.accountPassword = "";
      rerenderPage();
      showStatus("Cloud backup login saved.", "success");
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(loginCloudButton, false);
    }
  }), loginCloudButton.dataset.releuBound = "true";
  if (logoutCloudButton && !logoutCloudButton.dataset.releuBound) logoutCloudButton.addEventListener("click", async () => {
    try {
      setButtonBusy(logoutCloudButton, true, "Logging Out...");
      const payload = await api("/api/cloud-backup/logout", { method: "POST" });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      APP_STATE.cloudBackup.status = payload.cloudBackup ?? APP_STATE.cloudBackup.status;
      APP_STATE.cloudBackup.lastFetchedAt = Date.now();
      APP_STATE.cloudBackup.draft.accountPassword = "";
      rerenderPage();
      showStatus("Cloud backup login removed.", "success");
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(logoutCloudButton, false);
    }
  }), logoutCloudButton.dataset.releuBound = "true";
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
      rerenderPage();
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
      rerenderPage();
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
      rerenderPage();
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
      rerenderPage();
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
        rerenderPage();
        showStatus("Cloud backup restored.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
}

function patchCloudBackupPageLegacy() {
  const state = APP_STATE.state;
  const server = activeServer();
  if (!server) return;
  const serverId = activeServerId();
  preserveCloudBackupDraft(document);
  const mount = document.querySelector(".fi-page-content");
  if (!mount) return;
  const cloud = APP_STATE.cloudBackup.status ?? {};
  const cloudProvider = cloud.provider ?? state.cloudBackupSettings?.provider ?? "website";
  const cloudAuthScreen = APP_STATE.cloudBackup.authScreen === "signup" ? "signup" : "login";
  const currentCloudPanel = APP_STATE.cloudBackup.currentPanel === "dashboard" ? "dashboard" : "auth";
  const cloudDraft = {
    deviceLabel:
      String(APP_STATE.cloudBackup.draft.deviceLabel ?? "").trim() ||
      String(cloud.deviceLabel ?? state.cloudBackupSettings?.deviceLabel ?? "").trim(),
    accountUsername:
      String(APP_STATE.cloudBackup.draft.accountUsername ?? "").trim() ||
      String(cloud.accountUsername ?? state.cloudBackupSettings?.accountUsername ?? "").trim(),
    accountPassword: String(APP_STATE.cloudBackup.draft.accountPassword ?? ""),
    targetRestoreKey:
      String(APP_STATE.cloudBackup.draft.targetRestoreKey ?? "").trim() ||
      String(cloud.targetRestoreKey ?? state.cloudBackupSettings?.targetRestoreKey ?? "").trim(),
  };
  const uploadLimitBytes =
    Number(cloud.uploadLimitBytes ?? (state.cloudBackupSettings?.uploadLimitMb ?? 50) * 1024 * 1024) || 0;
  const uploadLimitLabel = usingTailscaleCloud
    ? (cloud.uploadLimitLabel ?? "Remote server disk")
    : formatBytes(uploadLimitBytes);
  const cloudActivityPolicyText = usingTailscaleCloud
    ? "Rolling cloud backups are deleted automatically after 7 days with no upload, download, or restore activity."
    : "";

  const pageMap = {
    Servers: "servers.html",
    Overview: "overview.html",
    Console: "console.html",
    Players: "players.html",
    Files: "files.html",
    Backups: "backups.html",
    "Cloud Backup": "cloud-backup.html",
    Worlds: "worlds.html",
    "Add-ons / Mods": "addons-mods.html",
    Software: "software.html",
    Misc: "misc.html",
    Settings: "settings.html",
  };
  document.querySelector(".fi-sidebar-header-logo-ctn a")?.setAttribute("href", buildLocalPageHref("servers.html", serverId));
  document.querySelectorAll(".fi-sidebar-item").forEach((item) => {
    const labelNode = item.querySelector(".fi-sidebar-item-label");
    const label = labelNode?.textContent?.trim();
    const anchor = item.querySelector("a.fi-sidebar-item-btn");
    const pageName = label ? pageMap[label] : null;
    if (!anchor || !pageName) return;
    anchor.setAttribute("href", buildLocalPageHref(pageName, serverId));
    item.classList.toggle("fi-active", PAGE === pageName);
  });

  const authPanel = mount.querySelector("#panel-auth");
  const dashboardPanel = mount.querySelector("#panel-dashboard");
  if (!authPanel || !dashboardPanel) return;
  authPanel.style.display = currentCloudPanel === "auth" ? "block" : "none";
  dashboardPanel.style.display = currentCloudPanel === "dashboard" ? "grid" : "none";

  const findWrap = (root, label) =>
    [...root.querySelectorAll(".cb-input-wrp")].find(
      (node) => node.querySelector(".cb-input-prefix-label")?.textContent?.trim().toLowerCase() === label.toLowerCase(),
    );
  const setFieldInput = (wrap, config) => {
    if (!wrap) return null;
    let input = wrap.querySelector("input[data-releu-cloud-field]");
    if (!input) {
      wrap.querySelector(".cb-input-value")?.remove();
      input = document.createElement("input");
      input.className = "cb-plain-input";
      input.dataset.releuCloudField = "true";
      wrap.append(input);
    }
    input.type = config.type ?? "text";
    input.value = config.value ?? "";
    input.placeholder = config.placeholder ?? "";
    input.readOnly = Boolean(config.readOnly);
    input.disabled = Boolean(config.disabled);
    if (config.mono) {
      input.style.fontFamily = "ui-monospace, monospace";
      input.style.fontSize = ".82rem";
    } else {
      input.style.fontFamily = "";
      input.style.fontSize = "";
    }
    Object.entries(config.dataset ?? {}).forEach(([key, value]) => {
      input.dataset[key] = value;
    });
    return input;
  };
  const setFieldText = (wrap, text, muted = false, mono = false) => {
    if (!wrap) return null;
    let value = wrap.querySelector(".cb-input-value");
    if (!value) {
      wrap.querySelector("input[data-releu-cloud-field]")?.remove();
      value = document.createElement("div");
      value.className = "cb-input-value";
      wrap.append(value);
    }
    value.textContent = text;
    value.style.color = muted ? "oklch(0.442 0.017 285.786)" : "";
    value.style.fontWeight = muted ? "400" : "";
    value.style.fontFamily = mono ? "ui-monospace, monospace" : "";
    value.style.fontSize = mono ? ".82rem" : "";
    return value;
  };
  const saveCloudSettings = async () => {
    const payload = await api("/api/cloud-backup/settings", {
      method: "POST",
      body: {
        enabled: Boolean(state.cloudBackupSettings?.enabled),
        provider: cloudProvider,
        deviceLabel: String(APP_STATE.cloudBackup.draft.deviceLabel ?? "").trim(),
        targetRestoreKey: String(APP_STATE.cloudBackup.draft.targetRestoreKey ?? "").trim(),
      },
    });
    APP_STATE.state = payload.state ?? APP_STATE.state;
    APP_STATE.cloudBackup.status = payload.status ?? APP_STATE.cloudBackup.status;
    APP_STATE.cloudBackup.lastFetchedAt = Date.now();
  };

  const authTabs = authPanel.querySelectorAll("[data-auth-tab]");
  authTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.authTab === cloudAuthScreen);
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", () => {
      APP_STATE.cloudBackup.authScreen = button.dataset.authTab === "signup" ? "signup" : "login";
      patchCloudBackupPage();
    });
  });
  setFieldInput(findWrap(authPanel, "Device Label"), {
    value: cloudDraft.deviceLabel,
    placeholder: "My desktop PC",
    dataset: { releuCloudDeviceLabel: "true" },
  });
  setFieldInput(findWrap(authPanel, "Cloud Username"), {
    value: cloudDraft.accountUsername,
    placeholder: "alex",
    dataset: { releuCloudAccountUsername: "true" },
  });
  setFieldInput(findWrap(authPanel, "Cloud Password"), {
    type: "password",
    value: cloudDraft.accountPassword,
    placeholder: "Log in to backup",
    dataset: { releuCloudAccountPassword: "true" },
  });
  const authStatus = authPanel.querySelector(".cb-status");
  if (authStatus) {
    authStatus.innerHTML = `<strong style="color:oklch(0.871 0.006 286.286);">Connection:</strong> ${escapeHtml(cloud.functionReady ? "Ready" : APP_STATE.cloudBackup.loading ? "Checking..." : "Not Ready")}<br>${escapeHtml(cloudAuthScreen === "signup" ? "Create a cloud account first. Releu keeps backup keys, upload, restore, and history hidden until sign-up succeeds." : "Before log in, Releu keeps backup key, shared key, upload, download, restore, and backup history hidden.")}${cloud.functionError ? `<br><span style="color:#fecaca;">${escapeHtml(cloud.functionError)}</span>` : ""}${cloud.authError ? `<br><span style="color:#fecaca;">${escapeHtml(cloud.authError)}</span>` : ""}`;
  }
  const authButtons = authPanel.querySelectorAll(".cb-actions .cb-btn");
  const signupAuthButton = authButtons[0];
  const loginAuthButton = authButtons[1];
  const refreshAuthButton = authButtons[2];
  const bindAuthAction = (button, mode) => {
    if (!button) return;
    button.textContent = mode === "signup" ? "Create Account" : "Log In";
    delete button.dataset.go;
    button.dataset.releuCloudAction = mode;
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      const deviceInput = authPanel.querySelector("[data-releu-cloud-device-label]");
      const userInput = authPanel.querySelector("[data-releu-cloud-account-username]");
      const passInput = authPanel.querySelector("[data-releu-cloud-account-password]");
      APP_STATE.cloudBackup.draft.deviceLabel = deviceInput?.value ?? "";
      APP_STATE.cloudBackup.draft.accountUsername = userInput?.value ?? "";
      APP_STATE.cloudBackup.draft.accountPassword = passInput?.value ?? "";
      try {
        setButtonBusy(button, true, mode === "signup" ? "Registering..." : "Logging In...");
        const payload = await api(mode === "signup" ? "/api/cloud-backup/register" : "/api/cloud-backup/login", {
          method: "POST",
          body: {
            username: userInput?.value ?? "",
            password: passInput?.value ?? "",
            deviceLabel: deviceInput?.value ?? "",
          },
        });
        APP_STATE.state = payload.state ?? APP_STATE.state;
        APP_STATE.cloudBackup.status = payload.cloudBackup ?? APP_STATE.cloudBackup.status;
        APP_STATE.cloudBackup.lastFetchedAt = Date.now();
        APP_STATE.cloudBackup.draft.accountPassword = "";
        APP_STATE.cloudBackup.authScreen = mode === "signup" ? "signup" : "login";
        APP_STATE.cloudBackup.currentPanel = "dashboard";
        if (typeof window.goTo === "function") window.goTo("dashboard");
        patchCloudBackupPage();
        showStatus(mode === "signup" ? "Cloud backup account created." : "Cloud backup login saved.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  };
  bindAuthAction(signupAuthButton, "signup");
  bindAuthAction(loginAuthButton, "login");
  if (refreshAuthButton && refreshAuthButton.dataset.releuBound !== "true") {
    refreshAuthButton.dataset.releuBound = "true";
    refreshAuthButton.addEventListener("click", async () => {
      try {
        setButtonBusy(refreshAuthButton, true, "Refreshing...");
        await refreshCloudBackupStatus(true);
        patchCloudBackupPage();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(refreshAuthButton, false);
      }
    });
  }
  authPanel.querySelectorAll("[data-releu-cloud-device-label],[data-releu-cloud-account-username],[data-releu-cloud-account-password]").forEach((input) => {
    if (input.dataset.releuDraftBound === "true") return;
    input.dataset.releuDraftBound = "true";
    input.addEventListener("input", () => {
      if (input.hasAttribute("data-releu-cloud-device-label")) APP_STATE.cloudBackup.draft.deviceLabel = input.value;
      if (input.hasAttribute("data-releu-cloud-account-username")) APP_STATE.cloudBackup.draft.accountUsername = input.value;
      if (input.hasAttribute("data-releu-cloud-account-password")) APP_STATE.cloudBackup.draft.accountPassword = input.value;
    });
  });

  setFieldInput(findWrap(dashboardPanel, "Device Label"), {
    value: cloudDraft.deviceLabel,
    placeholder: "My desktop PC",
    dataset: { releuCloudDeviceLabel: "true" },
  });
  setFieldText(findWrap(dashboardPanel, "My Backup Key"), cloud.restoreKey || "Not available", false, true);
  setFieldInput(findWrap(dashboardPanel, "Shared Backup Key (Optional)"), {
    value: cloudDraft.targetRestoreKey,
    placeholder: "Enter another user's key to upload or restore their backup space",
    dataset: { releuCloudTargetRestoreKey: "true" },
  });
  dashboardPanel.querySelectorAll("[data-releu-cloud-device-label],[data-releu-cloud-target-restore-key]").forEach((input) => {
    if (input.dataset.releuDraftBound === "true") return;
    input.dataset.releuDraftBound = "true";
    input.addEventListener("input", () => {
      if (input.hasAttribute("data-releu-cloud-device-label")) APP_STATE.cloudBackup.draft.deviceLabel = input.value;
      if (input.hasAttribute("data-releu-cloud-target-restore-key")) APP_STATE.cloudBackup.draft.targetRestoreKey = input.value;
    });
    input.addEventListener("blur", async () => {
      try {
        await saveCloudSettings();
      } catch (error) {
        showError(error);
      }
    });
  });
  const chips = dashboardPanel.querySelectorAll(".cb-chip");
  if (chips[0]) chips[0].textContent = `Connection: ${cloud.functionReady ? "Ready" : APP_STATE.cloudBackup.loading ? "Checking..." : "Not Ready"}`;
  if (chips[1]) chips[1].textContent = `Log In: ${cloud.loggedIn ? cloud.accountUsername || "account" : "Not logged in"}`;
  if (chips[2]) chips[2].textContent = `Upload limit: ${uploadLimitLabel}`;
  if (chips[3]) chips[3].textContent = `Cloud used: ${formatBytes(cloud.usedBytes ?? 0)}`;
  if (chips[4]) chips[4].textContent = `Saved backups: ${String(cloud.backupsCount ?? 0)}`;
  const dashboardStatus = dashboardPanel.querySelector(".cb-status");
  if (dashboardStatus) {
    dashboardStatus.innerHTML = `${escapeHtml(cloudActivityPolicyText || "Cloud backup is ready.")}${cloud.functionError ? `<div style="margin-top:.5rem;color:#fecaca;">${escapeHtml(cloud.functionError)}</div>` : ""}${cloud.authError ? `<div style="margin-top:.5rem;color:#fecaca;">${escapeHtml(cloud.authError)}</div>` : ""}${!cloud.functionError ? `<div style="margin-top:.5rem;">Latest backup: <span style="color:oklch(0.967 0.001 286.375);">${escapeHtml(cloud.latestBackup?.backup_name ?? "None yet")}</span></div>` : ""}`;
  }
  const dashboardButtons = dashboardPanel.querySelectorAll(".cb-actions .cb-btn");
  const uploadButton = dashboardButtons[0];
  const rotateButton = dashboardButtons[1];
  const logoutButton = dashboardButtons[2];
  if (uploadButton && uploadButton.dataset.releuBound !== "true") {
    uploadButton.dataset.releuBound = "true";
    uploadButton.addEventListener("click", async () => {
      try {
        APP_STATE.cloudBackup.draft.deviceLabel = dashboardPanel.querySelector("[data-releu-cloud-device-label]")?.value ?? APP_STATE.cloudBackup.draft.deviceLabel;
        APP_STATE.cloudBackup.draft.targetRestoreKey = dashboardPanel.querySelector("[data-releu-cloud-target-restore-key]")?.value ?? APP_STATE.cloudBackup.draft.targetRestoreKey;
        setButtonBusy(uploadButton, true, state.cloudBackupSettings?.enabled ? "Uploading..." : "Enabling...");
        if (!APP_STATE.state?.cloudBackupSettings?.enabled) {
          const settingsPayload = await api("/api/cloud-backup/settings", {
            method: "POST",
            body: {
              enabled: true,
              provider: cloudProvider,
              deviceLabel: APP_STATE.cloudBackup.draft.deviceLabel,
              targetRestoreKey: APP_STATE.cloudBackup.draft.targetRestoreKey,
            },
          });
          APP_STATE.state = settingsPayload.state ?? APP_STATE.state;
          APP_STATE.cloudBackup.status = settingsPayload.status ?? APP_STATE.cloudBackup.status;
        } else {
          await saveCloudSettings();
        }
        showStatus("Creating and uploading a full cloud backup...");
        const payload = await api(`/api/servers/${encodeURIComponent(serverId)}/cloud-backup/upload`, {
          method: "POST",
        });
        APP_STATE.state = payload.state ?? APP_STATE.state;
        APP_STATE.cloudBackup.status = payload.upload?.cloudBackup ?? APP_STATE.cloudBackup.status;
        APP_STATE.cloudBackup.lastFetchedAt = Date.now();
        patchCloudBackupPage();
        showStatus("Cloud backup uploaded.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(uploadButton, false);
      }
    });
  }
  if (rotateButton && rotateButton.dataset.releuBound !== "true") {
    rotateButton.dataset.releuBound = "true";
    rotateButton.addEventListener("click", async () => {
      try {
        setButtonBusy(rotateButton, true, "Rotating...");
        const payload = await api("/api/cloud-backup/rotate-key", { method: "POST" });
        APP_STATE.state = payload.state ?? APP_STATE.state;
        APP_STATE.cloudBackup.status = payload.cloudBackup ?? APP_STATE.cloudBackup.status;
        APP_STATE.cloudBackup.lastFetchedAt = Date.now();
        patchCloudBackupPage();
        showStatus("Cloud backup key rotated.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(rotateButton, false);
      }
    });
  }
  if (logoutButton && logoutButton.dataset.releuBound !== "true") {
    logoutButton.dataset.releuBound = "true";
    logoutButton.addEventListener("click", async () => {
      try {
        setButtonBusy(logoutButton, true, "Logging Out...");
        const payload = await api("/api/cloud-backup/logout", { method: "POST" });
        APP_STATE.state = payload.state ?? APP_STATE.state;
        APP_STATE.cloudBackup.status = payload.cloudBackup ?? APP_STATE.cloudBackup.status;
        APP_STATE.cloudBackup.lastFetchedAt = Date.now();
        APP_STATE.cloudBackup.draft.accountPassword = "";
        APP_STATE.cloudBackup.authScreen = "login";
        APP_STATE.cloudBackup.currentPanel = "auth";
        if (typeof window.goTo === "function") window.goTo("auth");
        patchCloudBackupPage();
        showStatus("Cloud backup login removed.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(logoutButton, false);
      }
    });
  }
  const historyContent = [...dashboardPanel.querySelectorAll(".fi-section-content")][1];
  if (historyContent) {
    historyContent.innerHTML = cloud.backups?.length
      ? cloud.backups
          .map(
            (entry) => `
          <div class="cb-backup-row">
            <div>
              <div class="cb-backup-name">${escapeHtml(entry.backup_name ?? "Backup")}</div>
              <div class="cb-backup-meta">${escapeHtml(formatDate(entry.created_at ?? entry.updated_at))} • ${escapeHtml(formatBytes(entry.size_bytes ?? 0))}</div>
            </div>
            <div class="cb-actions">
              <button type="button" class="cb-btn" data-releu-cloud-download="${escapeHtml(entry.id)}">Download</button>
              <button type="button" class="cb-btn" data-releu-cloud-restore="${escapeHtml(entry.id)}">Restore</button>
            </div>
          </div>`,
          )
          .join("")
      : `<div class="cb-status">No cloud backups uploaded yet.</div>`;
  }
  dashboardPanel.querySelectorAll("[data-releu-cloud-download]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      try {
        setButtonBusy(button, true, "Downloading...");
        await api(`/api/servers/${encodeURIComponent(serverId)}/cloud-backup/download`, {
          method: "POST",
          body: { backupId: button.dataset.releuCloudDownload },
        });
        showStatus("Cloud backup downloaded to the local Releu data folder.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  dashboardPanel.querySelectorAll("[data-releu-cloud-restore]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      if (!window.confirm("Restore this cloud backup onto the current server? The server must stay stopped during the restore.")) return;
      try {
        setButtonBusy(button, true, "Restoring...");
        await api(`/api/servers/${encodeURIComponent(serverId)}/cloud-backup/restore`, {
          method: "POST",
          body: { backupId: button.dataset.releuCloudRestore },
        });
        await refreshState(serverId);
        await refreshCloudBackupStatus(true);
        patchCloudBackupPage();
        showStatus("Cloud backup restored.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
}

function patchCloudBackupPage() {
  const state = APP_STATE.state;
  const server = activeServer();
  if (!server) return;
  const serverId = activeServerId();
  preserveCloudBackupDraft(document);
  maybeRefreshCloudBackupStatus(patchCloudBackupPage);
  const mount = document.querySelector(".fi-page-content");
  if (!mount) return;
  const cloud = APP_STATE.cloudBackup.status ?? {};
  const cloudProvider = cloud.provider ?? state.cloudBackupSettings?.provider ?? "website";
  const cloudAuthScreen = APP_STATE.cloudBackup.authScreen === "signup" ? "signup" : "login";
  const cloudDraft = {
    deviceLabel:
      String(APP_STATE.cloudBackup.draft.deviceLabel ?? "").trim() ||
      String(cloud.deviceLabel ?? state.cloudBackupSettings?.deviceLabel ?? "").trim(),
    accountUsername:
      String(APP_STATE.cloudBackup.draft.accountUsername ?? "").trim() ||
      String(cloud.accountUsername ?? state.cloudBackupSettings?.accountUsername ?? "").trim(),
    accountPassword: String(APP_STATE.cloudBackup.draft.accountPassword ?? ""),
    targetRestoreKey:
      String(APP_STATE.cloudBackup.draft.targetRestoreKey ?? "").trim() ||
      String(cloud.targetRestoreKey ?? state.cloudBackupSettings?.targetRestoreKey ?? "").trim(),
  };
  const uploadLimitBytes =
    Number(cloud.uploadLimitBytes ?? (state.cloudBackupSettings?.uploadLimitMb ?? 50) * 1024 * 1024) || 0;
  const uploadLimitLabel = cloud.uploadLimitLabel ?? formatBytes(uploadLimitBytes);
  const cloudActivityPolicyText = "Cloud backup is ready.";
  const pageMap = {
    Servers: "servers.html",
    Overview: "overview.html",
    Console: "console.html",
    Players: "players.html",
    Files: "files.html",
    Backups: "backups.html",
    "Cloud Backup": "cloud-backup.html",
    Worlds: "worlds.html",
    "Add-ons / Mods": "addons-mods.html",
    Software: "software.html",
    Misc: "misc.html",
    Settings: "settings.html",
  };
  document.querySelector(".fi-sidebar-header-logo-ctn a")?.setAttribute("href", buildLocalPageHref("servers.html", serverId));
  document.querySelectorAll(".fi-sidebar-item").forEach((item) => {
    const labelNode = item.querySelector(".fi-sidebar-item-label");
    const label = labelNode?.textContent?.trim();
    const anchor = item.querySelector("a.fi-sidebar-item-btn");
    const pageName = label ? pageMap[label] : null;
    if (!anchor || !pageName) return;
    anchor.setAttribute("href", buildLocalPageHref(pageName, serverId));
    item.classList.toggle("fi-active", PAGE === pageName);
  });

  const authPanel = mount.querySelector("#panel-auth");
  const dashboardPanel = mount.querySelector("#panel-dashboard");
  if (!authPanel || !dashboardPanel) return;
  APP_STATE.cloudBackup.currentPanel = "auth";
  authPanel.style.display = "block";
  dashboardPanel.style.display = "none";

  mount.style.position = "relative";
  mount.querySelectorAll(".cb-demo-panel, .fi-section").forEach((node) => {
    node.style.opacity = "0.42";
    node.style.filter = "grayscale(0.45)";
  });
  mount.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
    button.style.pointerEvents = "none";
    button.removeAttribute("data-go");
  });
  mount.querySelectorAll("[contenteditable], .cb-auth-tab").forEach((node) => {
    node.removeAttribute("contenteditable");
    node.removeAttribute("role");
    node.removeAttribute("tabindex");
    node.style.pointerEvents = "none";
  });

  let underDevelopmentNotice = mount.querySelector("[data-releu-cloud-under-development]");
  if (!underDevelopmentNotice) {
    underDevelopmentNotice = document.createElement("div");
    underDevelopmentNotice.dataset.releuCloudUnderDevelopment = "true";
    underDevelopmentNotice.style.position = "absolute";
    underDevelopmentNotice.style.inset = "1.5rem";
    underDevelopmentNotice.style.display = "flex";
    underDevelopmentNotice.style.alignItems = "center";
    underDevelopmentNotice.style.justifyContent = "center";
    underDevelopmentNotice.style.pointerEvents = "none";
    underDevelopmentNotice.style.zIndex = "20";
    underDevelopmentNotice.innerHTML = `
      <div style="max-width:34rem;width:100%;border:1px solid oklch(0.274 0.006 286.033);border-radius:1rem;background:rgba(11,13,16,.92);backdrop-filter:blur(10px);padding:1.25rem 1.4rem;box-shadow:0 16px 40px rgba(0,0,0,.35);text-align:center;">
        <div style="font-size:.74rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:oklch(0.552 0.016 285.938);">Under Development</div>
        <div style="margin-top:.55rem;font-size:1.2rem;font-weight:700;color:oklch(0.967 0.001 286.375);">Cloud Backup is temporarily disabled.</div>
        <div style="margin-top:.55rem;font-size:.92rem;line-height:1.6;color:oklch(0.708 0.01 286.286);">This section is being rebuilt for Windows, Linux, and macOS releases. The current Cloud UI is intentionally greyed out until that work is finished.</div>
      </div>`;
    mount.append(underDevelopmentNotice);
  }
  return;

  const findWrap = (root, label) =>
    [...root.querySelectorAll(".cb-input-wrp")].find(
      (node) => node.querySelector(".cb-input-prefix-label")?.textContent?.trim().toLowerCase() === label.toLowerCase(),
    );
  const normalizeCloudEditableText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const setFieldText = (wrap, text, muted = false, mono = false) => {
    const value = wrap?.querySelector(".cb-input-value");
    if (!value) return null;
    value.textContent = text;
    value.style.color = muted ? "oklch(0.442 0.017 285.786)" : "";
    value.style.fontWeight = muted ? "400" : "";
    value.style.fontFamily = mono ? "ui-monospace, monospace" : "";
    value.style.fontSize = mono ? ".82rem" : "";
    value.removeAttribute("contenteditable");
    value.removeAttribute("role");
    value.removeAttribute("tabindex");
    return value;
  };
  const saveCloudSettings = async () => {
    const payload = await api("/api/cloud-backup/settings", {
      method: "POST",
      body: {
        enabled: Boolean(APP_STATE.state?.cloudBackupSettings?.enabled),
        provider: cloudProvider,
        deviceLabel: String(APP_STATE.cloudBackup.draft.deviceLabel ?? "").trim(),
        targetRestoreKey: String(APP_STATE.cloudBackup.draft.targetRestoreKey ?? "").trim(),
      },
    });
    APP_STATE.state = payload.state ?? APP_STATE.state;
    APP_STATE.cloudBackup.status = payload.status ?? APP_STATE.cloudBackup.status;
    APP_STATE.cloudBackup.lastFetchedAt = Date.now();
  };
  const setEditableFieldText = (wrap, config) => {
    const value = wrap?.querySelector(".cb-input-value");
    if (!value) return null;
    const currentValue = normalizeCloudEditableText(config.value);
    const placeholder = String(config.placeholder ?? "");
    const isFocused = document.activeElement === value;
    const shouldMask = Boolean(config.mask);
    Object.entries(config.dataset ?? {}).forEach(([key, datasetValue]) => {
      value.dataset[key] = datasetValue;
    });
    value.dataset.releuCloudEditable = "true";
    value.dataset.releuPlaceholder = placeholder;
    value.contentEditable = "plaintext-only";
    value.setAttribute("role", "textbox");
    value.setAttribute("tabindex", "0");
    value.spellcheck = false;
    if (!isFocused) {
      value.textContent = currentValue || placeholder;
      value.dataset.releuPlaceholderVisible = currentValue ? "false" : "true";
    }
    value.style.color = currentValue ? "" : "oklch(0.442 0.017 285.786)";
    value.style.fontWeight = currentValue ? "600" : "400";
    value.style.fontFamily = config.mono ? "ui-monospace, monospace" : "";
    value.style.fontSize = config.mono ? ".82rem" : "";
    value.style.webkitTextSecurity = shouldMask && currentValue ? "disc" : "";
    if (value.dataset.releuEditableBound === "true") return value;
    value.dataset.releuEditableBound = "true";
    value.addEventListener("focus", () => {
      if (value.dataset.releuPlaceholderVisible === "true") {
        value.textContent = "";
        value.dataset.releuPlaceholderVisible = "false";
      }
      value.style.webkitTextSecurity = shouldMask ? "disc" : "";
    });
    value.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        value.blur();
      }
    });
    value.addEventListener("input", () => {
      const nextValue = normalizeCloudEditableText(value.textContent);
      value.dataset.releuPlaceholderVisible = nextValue ? "false" : "true";
      value.style.color = nextValue ? "" : "oklch(0.442 0.017 285.786)";
      value.style.fontWeight = nextValue ? "600" : "400";
      value.style.webkitTextSecurity = shouldMask && nextValue ? "disc" : "";
      if (value.hasAttribute("data-releu-cloud-device-label")) APP_STATE.cloudBackup.draft.deviceLabel = nextValue;
      if (value.hasAttribute("data-releu-cloud-account-username")) APP_STATE.cloudBackup.draft.accountUsername = nextValue;
      if (value.hasAttribute("data-releu-cloud-account-password")) APP_STATE.cloudBackup.draft.accountPassword = nextValue;
      if (value.hasAttribute("data-releu-cloud-target-restore-key")) APP_STATE.cloudBackup.draft.targetRestoreKey = nextValue;
    });
    value.addEventListener("blur", async () => {
      const nextValue = normalizeCloudEditableText(value.textContent);
      if (value.hasAttribute("data-releu-cloud-device-label")) APP_STATE.cloudBackup.draft.deviceLabel = nextValue;
      if (value.hasAttribute("data-releu-cloud-account-username")) APP_STATE.cloudBackup.draft.accountUsername = nextValue;
      if (value.hasAttribute("data-releu-cloud-account-password")) APP_STATE.cloudBackup.draft.accountPassword = nextValue;
      if (value.hasAttribute("data-releu-cloud-target-restore-key")) APP_STATE.cloudBackup.draft.targetRestoreKey = nextValue;
      value.textContent = nextValue || placeholder;
      value.dataset.releuPlaceholderVisible = nextValue ? "false" : "true";
      value.style.color = nextValue ? "" : "oklch(0.442 0.017 285.786)";
      value.style.fontWeight = nextValue ? "600" : "400";
      value.style.webkitTextSecurity = shouldMask && nextValue ? "disc" : "";
      try {
        await saveCloudSettings();
      } catch (error) {
        showError(error);
      }
    });
    return value;
  };

  const authTabs = authPanel.querySelectorAll("[data-auth-tab]");
  authTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.authTab === cloudAuthScreen);
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", () => {
      APP_STATE.cloudBackup.authScreen = button.dataset.authTab === "signup" ? "signup" : "login";
      patchCloudBackupPage();
    });
  });
  setEditableFieldText(findWrap(authPanel, "Device Label"), {
    value: cloudDraft.deviceLabel,
    placeholder: "My desktop PC",
    dataset: { releuCloudDeviceLabel: "true" },
  });
  setEditableFieldText(findWrap(authPanel, "Cloud Username"), {
    value: cloudDraft.accountUsername,
    placeholder: "alex",
    dataset: { releuCloudAccountUsername: "true" },
  });
  setEditableFieldText(findWrap(authPanel, "Cloud Password"), {
    value: cloudDraft.accountPassword,
    placeholder: "Log in to backup",
    mask: true,
    dataset: { releuCloudAccountPassword: "true" },
  });
  const authStatus = authPanel.querySelector(".cb-status");
  if (authStatus) {
    authStatus.innerHTML =
      `<strong style="color:oklch(0.871 0.006 286.286);">Connection:</strong> ${escapeHtml(cloud.functionReady ? "Ready" : APP_STATE.cloudBackup.loading ? "Checking..." : "Not Ready")}` +
      `<br>${escapeHtml(cloudAuthScreen === "signup" ? "Create a cloud account first. Releu keeps backup key, shared key, upload, download, restore, and backup history hidden until sign-up succeeds." : "Before log in, Releu keeps backup key, shared key, upload, download, restore, and backup history hidden.")}` +
      `${cloud.functionError ? `<br><span style="color:#fecaca;">${escapeHtml(cloud.functionError)}</span>` : ""}` +
      `${cloud.authError ? `<br><span style="color:#fecaca;">${escapeHtml(cloud.authError)}</span>` : ""}`;
  }
  const authButtons = authPanel.querySelectorAll(".cb-actions .cb-btn");
  const signupAuthButton = authButtons[0];
  const loginAuthButton = authButtons[1];
  const refreshAuthButton = authButtons[2];
  const bindAuthAction = (button, mode) => {
    if (!button) return;
    delete button.dataset.go;
    button.removeAttribute("data-go");
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      const deviceValue =
        normalizeCloudEditableText(authPanel.querySelector("[data-releu-cloud-device-label]")?.textContent) ||
        "";
      const usernameValue =
        normalizeCloudEditableText(authPanel.querySelector("[data-releu-cloud-account-username]")?.textContent) ||
        "";
      const passwordValue =
        normalizeCloudEditableText(authPanel.querySelector("[data-releu-cloud-account-password]")?.textContent) ||
        "";
      APP_STATE.cloudBackup.draft.deviceLabel = deviceValue;
      APP_STATE.cloudBackup.draft.accountUsername = usernameValue;
      APP_STATE.cloudBackup.draft.accountPassword = passwordValue;
      try {
        setButtonBusy(button, true, mode === "signup" ? "Registering..." : "Logging In...");
        const payload = await api(mode === "signup" ? "/api/cloud-backup/register" : "/api/cloud-backup/login", {
          method: "POST",
          body: {
            username: usernameValue,
            password: passwordValue,
            deviceLabel: deviceValue,
          },
        });
        APP_STATE.state = payload.state ?? APP_STATE.state;
        APP_STATE.cloudBackup.status = payload.cloudBackup ?? APP_STATE.cloudBackup.status;
        APP_STATE.cloudBackup.lastFetchedAt = Date.now();
        APP_STATE.cloudBackup.draft.accountPassword = "";
        APP_STATE.cloudBackup.authScreen = mode;
        APP_STATE.cloudBackup.currentPanel = "dashboard";
        if (typeof window.goTo === "function") window.goTo("dashboard");
        patchCloudBackupPage();
        showStatus(mode === "signup" ? "Cloud backup account created." : "Cloud backup login saved.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  };
  bindAuthAction(signupAuthButton, "signup");
  bindAuthAction(loginAuthButton, "login");
  if (refreshAuthButton) {
    delete refreshAuthButton.dataset.go;
    refreshAuthButton.removeAttribute("data-go");
  }
  if (refreshAuthButton && refreshAuthButton.dataset.releuBound !== "true") {
    refreshAuthButton.dataset.releuBound = "true";
    refreshAuthButton.addEventListener("click", async () => {
      try {
        setButtonBusy(refreshAuthButton, true, "Refreshing...");
        await refreshCloudBackupStatus(true);
        patchCloudBackupPage();
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(refreshAuthButton, false);
      }
    });
  }

  setEditableFieldText(findWrap(dashboardPanel, "Device Label"), {
    value: cloudDraft.deviceLabel,
    placeholder: "My desktop PC",
    dataset: { releuCloudDeviceLabel: "true" },
  });
  setFieldText(findWrap(dashboardPanel, "My Backup Key"), cloud.restoreKey || "Not available yet", !cloud.restoreKey, true);
  setEditableFieldText(findWrap(dashboardPanel, "Shared Backup Key (Optional)"), {
    value: cloudDraft.targetRestoreKey,
    placeholder: "Enter another user's key to upload or restore their backup space",
    dataset: { releuCloudTargetRestoreKey: "true" },
  });

  const chips = dashboardPanel.querySelectorAll(".cb-chip");
  if (chips[0]) chips[0].textContent = `Connection: ${cloud.functionReady ? "Ready" : APP_STATE.cloudBackup.loading ? "Checking..." : "Not Ready"}`;
  if (chips[1]) chips[1].textContent = `Log In: ${cloud.loggedIn ? cloud.accountUsername || "account" : "Not logged in"}`;
  if (chips[2]) chips[2].textContent = `Upload limit: ${uploadLimitLabel}`;
  if (chips[3]) chips[3].textContent = `Cloud used: ${formatBytes(cloud.usedBytes ?? 0)}`;
  if (chips[4]) chips[4].textContent = `Saved backups: ${String(cloud.backupsCount ?? 0)}`;

  const dashboardStatus = dashboardPanel.querySelector(".cb-status");
  if (dashboardStatus) {
    dashboardStatus.innerHTML =
      `${escapeHtml(cloudActivityPolicyText)}` +
      `${cloud.functionError ? `<div style="margin-top:.5rem;color:#fecaca;">${escapeHtml(cloud.functionError)}</div>` : ""}` +
      `${cloud.authError ? `<div style="margin-top:.5rem;color:#fecaca;">${escapeHtml(cloud.authError)}</div>` : ""}` +
      `${!cloud.functionError ? `<div style="margin-top:.5rem;">Latest backup: <span style="color:oklch(0.967 0.001 286.375);">${escapeHtml(cloud.latestBackup?.backup_name ?? "None yet")}</span></div>` : ""}`;
  }

  const primaryActionRow = dashboardPanel.querySelector(".fi-section .cb-actions");
  const dashboardButtons = primaryActionRow ? [...primaryActionRow.querySelectorAll(".cb-btn")] : [];
  const uploadButton = dashboardButtons[0];
  const rotateButton = dashboardButtons[1];
  const logoutButton = dashboardButtons[2];

  if (uploadButton && uploadButton.dataset.releuBound !== "true") {
    uploadButton.dataset.releuBound = "true";
    uploadButton.addEventListener("click", async () => {
      try {
        APP_STATE.cloudBackup.draft.deviceLabel =
          normalizeCloudEditableText(dashboardPanel.querySelector("[data-releu-cloud-device-label]")?.textContent) ||
          APP_STATE.cloudBackup.draft.deviceLabel;
        APP_STATE.cloudBackup.draft.targetRestoreKey =
          normalizeCloudEditableText(dashboardPanel.querySelector("[data-releu-cloud-target-restore-key]")?.textContent) ||
          "";
        setButtonBusy(uploadButton, true, APP_STATE.state?.cloudBackupSettings?.enabled ? "Uploading..." : "Enabling...");
        if (!APP_STATE.state?.cloudBackupSettings?.enabled) {
          const settingsPayload = await api("/api/cloud-backup/settings", {
            method: "POST",
            body: {
              enabled: true,
              provider: cloudProvider,
              deviceLabel: APP_STATE.cloudBackup.draft.deviceLabel,
              targetRestoreKey: APP_STATE.cloudBackup.draft.targetRestoreKey,
            },
          });
          APP_STATE.state = settingsPayload.state ?? APP_STATE.state;
          APP_STATE.cloudBackup.status = settingsPayload.status ?? APP_STATE.cloudBackup.status;
        } else {
          await saveCloudSettings();
        }
        showStatus("Creating and uploading a full cloud backup...");
        const payload = await api(`/api/servers/${encodeURIComponent(serverId)}/cloud-backup/upload`, {
          method: "POST",
        });
        APP_STATE.state = payload.state ?? APP_STATE.state;
        APP_STATE.cloudBackup.status = payload.upload?.cloudBackup ?? APP_STATE.cloudBackup.status;
        APP_STATE.cloudBackup.lastFetchedAt = Date.now();
        patchCloudBackupPage();
        showStatus("Cloud backup uploaded.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(uploadButton, false);
      }
    });
  }

  if (rotateButton && rotateButton.dataset.releuBound !== "true") {
    rotateButton.dataset.releuBound = "true";
    rotateButton.addEventListener("click", async () => {
      try {
        setButtonBusy(rotateButton, true, cloud.restoreKey ? "Rotating..." : "Generating...");
        const payload = await api(cloud.restoreKey ? "/api/cloud-backup/rotate-key" : "/api/cloud-backup/issue-key", {
          method: "POST",
          body: cloud.restoreKey
            ? undefined
            : {
                deviceLabel:
                  normalizeCloudEditableText(dashboardPanel.querySelector("[data-releu-cloud-device-label]")?.textContent) ||
                  APP_STATE.cloudBackup.draft.deviceLabel,
              },
        });
        APP_STATE.state = payload.state ?? APP_STATE.state;
        APP_STATE.cloudBackup.status = payload.cloudBackup ?? APP_STATE.cloudBackup.status;
        APP_STATE.cloudBackup.lastFetchedAt = Date.now();
        patchCloudBackupPage();
        showStatus(cloud.restoreKey ? "Cloud backup key rotated." : "Cloud backup key generated.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(rotateButton, false);
      }
    });
  }

  if (logoutButton) {
    delete logoutButton.dataset.go;
    logoutButton.removeAttribute("data-go");
  }
  if (logoutButton && logoutButton.dataset.releuBound !== "true") {
    logoutButton.dataset.releuBound = "true";
    logoutButton.addEventListener("click", async () => {
      if (!cloud.loggedIn) {
        try {
          setButtonBusy(logoutButton, true, "Refreshing...");
          await refreshCloudBackupStatus(true);
          patchCloudBackupPage();
          showStatus("Cloud backup status refreshed.", "success");
        } catch (error) {
          showError(error);
        } finally {
          setButtonBusy(logoutButton, false);
        }
        return;
      }
      try {
        setButtonBusy(logoutButton, true, "Logging Out...");
        const payload = await api("/api/cloud-backup/logout", { method: "POST" });
        APP_STATE.state = payload.state ?? APP_STATE.state;
        APP_STATE.cloudBackup.status = payload.cloudBackup ?? APP_STATE.cloudBackup.status;
        APP_STATE.cloudBackup.lastFetchedAt = Date.now();
        APP_STATE.cloudBackup.draft.accountPassword = "";
        APP_STATE.cloudBackup.authScreen = "login";
        APP_STATE.cloudBackup.currentPanel = "auth";
        if (typeof window.goTo === "function") window.goTo("auth");
        patchCloudBackupPage();
        showStatus("Cloud backup login removed.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(logoutButton, false);
      }
    });
  }

  const historyContent = [...dashboardPanel.querySelectorAll(".fi-section-content")][1];
  if (historyContent) {
    historyContent.innerHTML = cloud.backups?.length
      ? cloud.backups
          .map(
            (entry) => `
          <div class="cb-backup-row">
            <div>
              <div class="cb-backup-name">${escapeHtml(entry.backup_name ?? "Backup")}</div>
              <div class="cb-backup-meta">${escapeHtml(formatDate(entry.created_at ?? entry.updated_at))} - ${escapeHtml(formatBytes(entry.size_bytes ?? 0))}</div>
            </div>
            <div class="cb-actions">
              <button type="button" class="cb-btn" data-releu-cloud-download="${escapeHtml(entry.id)}">Download</button>
              <button type="button" class="cb-btn" data-releu-cloud-restore="${escapeHtml(entry.id)}">Restore</button>
            </div>
          </div>`,
          )
          .join("")
      : `<div class="cb-status">No cloud backups uploaded yet.</div>`;
  }

  dashboardPanel.querySelectorAll("[data-releu-cloud-download]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      try {
        setButtonBusy(button, true, "Downloading...");
        await api(`/api/servers/${encodeURIComponent(serverId)}/cloud-backup/download`, {
          method: "POST",
          body: { backupId: button.dataset.releuCloudDownload },
        });
        showStatus("Cloud backup downloaded to the local Releu data folder.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  dashboardPanel.querySelectorAll("[data-releu-cloud-restore]").forEach((button) => {
    if (button.dataset.releuBound === "true") return;
    button.dataset.releuBound = "true";
    button.addEventListener("click", async () => {
      if (!window.confirm("Restore this cloud backup onto the current server? The server must stay stopped during the restore.")) return;
      try {
        setButtonBusy(button, true, "Restoring...");
        await api(`/api/servers/${encodeURIComponent(serverId)}/cloud-backup/restore`, {
          method: "POST",
          body: { backupId: button.dataset.releuCloudRestore },
        });
        await refreshState(serverId);
        await refreshCloudBackupStatus(true);
        patchCloudBackupPage();
        showStatus("Cloud backup restored.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
}

function patchSettingsPage() {
  const state = APP_STATE.state;
  const server = activeServer();
  if (!server) return;
  const serverId = activeServerId();
  const properties = server.server?.properties ?? {};
  const boolProp = (key, fallback = false) => String(properties[key] ?? String(fallback)).toLowerCase() === "true";
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
  const liveMotd = String(server.server?.properties?.motd ?? "").trim();
  if (profileNameInput && document.activeElement !== profileNameInput && profileNameInput.dataset.releuDirty !== "true") {
    profileNameInput.value = server.name ?? "";
  }
  if (
    profileDescriptionInput &&
    document.activeElement !== profileDescriptionInput &&
    profileDescriptionInput.dataset.releuDirty !== "true"
  ) {
    profileDescriptionInput.value = liveMotd || server.description || "";
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
        "Releu server name saves automatically. Server Description also syncs to the Minecraft MOTD. Minecraft's multiplayer list name is still chosen on the client.",
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

  const setPlayitBadge = (valueNode, text, tone) => {
    if (!valueNode) return;
    const safeText = escapeHtml(text);
    if (tone === "green") {
      valueNode.innerHTML = `<span class="playit-badge playit-badge-green">● ${safeText}</span>`;
      return;
    }
    if (tone === "blue") {
      valueNode.innerHTML = `<span class="playit-badge playit-badge-blue">● ${safeText}</span>`;
      return;
    }
    valueNode.innerHTML =
      `<span class="playit-badge" style="color:#fca5a5;background:rgba(239,68,68,0.14);">● ${safeText}</span>`;
  };

  [
    ...document.querySelectorAll(".rounded-lg.border.border-\\[\\#2b3642\\]"),
    ...document.querySelectorAll(".playit-stat-card"),
  ].forEach((card) => {
    const label = card.querySelector("dt")?.textContent?.trim()?.toLowerCase();
    const value = card.querySelector("dd");
    if (!label || !value) return;
    if (label === "agent status") {
      setPlayitBadge(value, state.playit?.running ? "Connected" : "No", state.playit?.running ? "green" : "red");
      return;
    }
    if (label === "auto-start") {
      setPlayitBadge(value, state.playitSettings?.autoStart ? "Enabled" : "Disabled", "blue");
      return;
    }
    if (label === "public address") value.textContent = getPublicAddress(state, server) ?? "Run Server To Get Address";
    if (label === "tunnel target") value.textContent = state.playit?.recommendedTunnelTarget ?? `127.0.0.1:${server.server?.properties?.["server-port"] ?? 25565}`;
  });
  document.querySelector("[data-releu-server-properties]")?.remove();
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
  const playitSection = [...document.querySelectorAll(".fi-section")].find((section) =>
    /playit agent/i.test(section.querySelector(".fi-section-header-heading")?.textContent ?? ""),
  );
  const playitFooter = playitSection?.querySelector(".fi-section-footer .fi-sc");
  if (playitFooter) {
    const dashboardUrl = state.playit?.dashboardTunnelUrl || "https://playit.gg/account/tunnels";
    playitFooter.innerHTML = state.playit?.secretConfigured
      ? `
        <button type="button" class="fi-btn fi-size-md fi-ac-btn-action" data-releu-playit-open-dashboard>Open Dashboard</button>
        <button type="button" class="fi-btn fi-size-md fi-ac-btn-action" data-releu-playit-reset>Reset Agent</button>`
      : `
        <button type="button" class="fi-btn fi-size-md fi-ac-btn-action" data-releu-playit-connect>Connect Agent</button>`;
    playitFooter.dataset.releuDashboardUrl = dashboardUrl;
  }

  const buttons = [...document.querySelectorAll(".fi-section-footer .fi-btn")];
  const dashboardButton = buttons.find((button) => button.hasAttribute("data-releu-playit-open-dashboard") || /open dashboard/i.test(button.textContent));
  if (dashboardButton && !dashboardButton.dataset.releuBound) dashboardButton.addEventListener("click", () => {
    window.open(state.playit?.dashboardTunnelUrl || "https://playit.gg/account/tunnels", "_blank", "noopener,noreferrer");
  }), dashboardButton.dataset.releuBound = "true";
  const connectButton = buttons.find((button) => button.hasAttribute("data-releu-playit-connect") || /connect agent/i.test(button.textContent));
  if (connectButton && !connectButton.dataset.releuBound) connectButton.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, "Connecting...");
      const payload = await api("/api/playit/connect", { method: "POST" });
      APP_STATE.state = payload.state ?? APP_STATE.state;
      await refreshState(activeServerId());
      patchSettingsPage();
      if (payload.connect?.claimUrl) {
        window.open(payload.connect.claimUrl, "_blank", "noopener,noreferrer");
      } else if (APP_STATE.state?.playit?.dashboardTunnelUrl) {
        window.open(APP_STATE.state.playit.dashboardTunnelUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      showError(error);
    } finally {
      setButtonBusy(button, false);
    }
  }), connectButton.dataset.releuBound = "true";
  const resetButton = buttons.find((button) => button.hasAttribute("data-releu-playit-reset") || /reset agent/i.test(button.textContent));
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
  document.querySelector("[data-releu-cloud-section]")?.remove();
  document.querySelector("[data-releu-ui-section]")?.remove();
  document.querySelectorAll("[data-releu-desktop-section],[data-releu-dev-section]").forEach((node) => node.remove());
  const desktopSection = [...document.querySelectorAll(".fi-section")].find((section) =>
    /desktop app/i.test(section.querySelector(".fi-section-header-heading")?.textContent ?? ""),
  );
  const desktopSettings = currentDesktopSettings();
  const desktopKeepRunning = desktopSection?.querySelector(".desktop-checkbox");
  const desktopShortcutKeys = desktopSection?.querySelector(".desktop-shortcut-keys");
  const desktopShortcutDescription = desktopSection?.querySelector(".desktop-shortcut-description");
  const desktopButtons = desktopSection ? [...desktopSection.querySelectorAll("button.fi-btn")] : [];
  const saveDesktopButton = desktopButtons.find((button) => /save desktop settings/i.test(button.textContent ?? ""));
  const openQuickConsoleButton = desktopButtons.find((button) => /open quick console/i.test(button.textContent ?? ""));
  if (desktopKeepRunning) {
    desktopKeepRunning.checked = Boolean(desktopSettings.keepServerRunningOnClose);
  }
  if (desktopShortcutKeys) {
    const parts = normalizeShortcutString(desktopSettings.quickConsoleShortcut).split("+").filter(Boolean);
    desktopShortcutKeys.innerHTML = parts.map((part, index) => `${index ? "<span>+</span>" : ""}<kbd>${escapeHtml(part)}</kbd>`).join("");
  }
  if (desktopShortcutDescription) {
    desktopShortcutDescription.textContent = "Press this shortcut while Releu is focused to open a quick console window.";
  }
  if (saveDesktopButton && !saveDesktopButton.dataset.releuBound) {
    saveDesktopButton.dataset.releuBound = "true";
    saveDesktopButton.addEventListener("click", async () => {
      try {
        setButtonBusy(saveDesktopButton, true, "Saving...");
        const payload = await api("/api/settings/desktop", {
          method: "POST",
          body: {
            keepServerRunningOnClose: Boolean(desktopKeepRunning?.checked),
            quickConsoleShortcut: normalizeShortcutString(desktopSettings.quickConsoleShortcut),
          },
        });
        APP_STATE.state = payload.state ?? APP_STATE.state;
        await syncDesktopIntegration();
        patchSettingsPage();
        showStatus("Desktop settings saved.", "success");
      } catch (error) {
        showError(error);
      } finally {
        setButtonBusy(saveDesktopButton, false);
      }
    });
  }
  if (openQuickConsoleButton && !openQuickConsoleButton.dataset.releuBound) {
    openQuickConsoleButton.dataset.releuBound = "true";
    openQuickConsoleButton.addEventListener("click", async () => {
      try {
        await openDesktopQuickConsoleWindow(activeServerId());
      } catch (error) {
        showError(error);
      }
    });
  }
  const devSection = [...document.querySelectorAll(".fi-section")].find((section) =>
    /developer console/i.test(section.querySelector(".fi-section-header-heading")?.textContent ?? ""),
  );
  const devState = devSection?.querySelector(".dev-console-description");
  const devToggle = devSection ? [...devSection.querySelectorAll("button.fi-btn")].find((button) => /dev logs|enable|disable/i.test(button.textContent ?? "")) : null;
  if (devState) {
    devState.textContent = devConsoleLogsEnabled()
      ? "Developer logs are visible in the console."
      : "Only Minecraft server logs are visible in the console.";
  }
  if (devToggle) {
    devToggle.textContent = devConsoleLogsEnabled() ? "Disable Dev Logs" : "Enable Dev Logs";
    if (!devToggle.dataset.releuBound) {
      devToggle.dataset.releuBound = "true";
      devToggle.addEventListener("click", () => {
        setDevConsoleLogsEnabled(!devConsoleLogsEnabled());
        patchSettingsPage();
      });
    }
  }
}

async function patchPage() {
  if (PAGE === "servers.html") patchServersPageExactShell();
  if (PAGE === "create-server.html") patchCreateServerPage();
  if (PAGE === "overview.html") patchOverviewPage();
  if (PAGE === "console.html") patchConsolePage();
  if (PAGE === "players.html") patchPlayersPage();
  if (PAGE === "cloud-backup.html") patchCloudBackupPage();
  if (PAGE === "worlds.html") patchWorldsPage();
  if (PAGE === "software.html") patchSoftwarePage();
  if (PAGE === "addons-mods.html") patchAddonsPage();
  if (PAGE === "backups.html") patchBackupsPageLive();
  if (PAGE === "files.html") patchFilesPage();
  if (PAGE === "misc.html") patchMiscPage();
  if (PAGE === "settings.html") patchSettingsPage();
  APP_STATE.quickConsole.open = false;
  renderQuickConsoleOverlay();
}

async function pollCurrentPage() {
  if (document.visibilityState === "hidden") return;
  await refreshState(activeServerId());
  if (PAGE === "players.html") {
    patchPlayersPage();
    return;
  }
  await refreshLogs().catch(() => []);
  await patchPage();
}

async function boot() {
  injectReleaseChromeStyles();
  ensureQuickConsoleBinding();
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
    const refreshIntervalMs = PAGE === "misc.html" || PAGE === "players.html" ? 1000 : 4000;
    setInterval(async () => {
      try {
        await pollCurrentPage();
      } catch (error) {
        console.error(error);
      }
    }, refreshIntervalMs);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  boot().catch(showError);
});
