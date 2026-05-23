import crypto from "node:crypto";

export const REMOTE_ACCESS_BASE_URL = "https://releu.lol";

export const REMOTE_ACCESS_SECTION_LABELS = Object.freeze({
  dashboard: "Dashboard",
  overview: "Overview",
  console: "Console",
  players: "Players",
  worlds: "Worlds",
  addons: "Add-ons",
  backups: "Backups",
  software: "Software",
  misc: "Misc",
  settings: "Settings",
});

export const REMOTE_ACCESS_ACTION_LABELS = Object.freeze({
  powerControls: "Power controls",
  consoleCommands: "Console commands",
  playerModeration: "Player moderation",
  serverCreateDelete: "Server create/delete",
  softwareChanges: "Software changes",
  worldImportDelete: "World import/delete",
  addonInstallRemove: "Add-on install/remove",
  backupCreate: "Backup create",
  backupRestoreDelete: "Backup restore/delete",
  settingsChanges: "Settings changes",
});

export const REMOTE_ACCESS_SECTION_IDS = Object.freeze(
  Object.keys(REMOTE_ACCESS_SECTION_LABELS),
);

export const REMOTE_ACCESS_ACTION_IDS = Object.freeze(
  Object.keys(REMOTE_ACCESS_ACTION_LABELS),
);

export function buildRemoteAccessSections() {
  return {
    dashboard: true,
    overview: true,
    console: true,
    players: true,
    worlds: true,
    addons: true,
    backups: true,
    software: true,
    misc: true,
    settings: true,
  };
}

export function buildRemoteAccessActions() {
  return {
    powerControls: false,
    consoleCommands: false,
    playerModeration: false,
    serverCreateDelete: false,
    softwareChanges: false,
    worldImportDelete: false,
    addonInstallRemove: false,
    backupCreate: false,
    backupRestoreDelete: false,
    settingsChanges: false,
  };
}

export function buildRemoteAccessPreset(mode = "view") {
  const sections = buildRemoteAccessSections();
  const actions = buildRemoteAccessActions();
  const normalized = normalizeRemoteAccessMode(mode);
  if (normalized === "operator") {
    actions.powerControls = true;
    actions.consoleCommands = true;
    actions.playerModeration = true;
    actions.backupCreate = true;
  } else if (normalized === "admin") {
    for (const actionId of REMOTE_ACCESS_ACTION_IDS) {
      actions[actionId] = true;
    }
  }
  return {
    mode: normalized,
    sections,
    actions,
  };
}

export function normalizeRemoteAccessMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "operator") return "operator";
  if (normalized === "admin") return "admin";
  if (normalized === "custom") return "custom";
  return "view";
}

function mergeBooleanShape(defaults, incoming = {}) {
  const output = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (Object.prototype.hasOwnProperty.call(incoming ?? {}, key)) {
      output[key] = Boolean(incoming[key]);
    }
  }
  return output;
}

export function normalizeRemoteAccessConfig(config = {}) {
  const defaults = {
    enabled: false,
    slug: "",
    passwordEnabled: false,
    passwordHash: "",
    passwordSalt: "",
    mode: "view",
    sections: buildRemoteAccessSections(),
    actions: buildRemoteAccessActions(),
    deviceId: "",
    deviceSecret: "",
    lastHeartbeatAt: "",
    lastPublishedAt: "",
  };
  const merged = {
    ...defaults,
    ...(config ?? {}),
  };
  merged.enabled = Boolean(merged.enabled);
  merged.slug = normalizeRemoteSlug(merged.slug);
  merged.passwordEnabled = Boolean(merged.passwordEnabled);
  merged.passwordHash = String(merged.passwordHash ?? "").trim();
  merged.passwordSalt = String(merged.passwordSalt ?? "").trim();
  merged.mode = normalizeRemoteAccessMode(merged.mode);
  merged.sections = mergeBooleanShape(
    buildRemoteAccessSections(),
    merged.sections,
  );
  merged.actions = mergeBooleanShape(
    buildRemoteAccessActions(),
    merged.actions,
  );
  merged.deviceId = String(merged.deviceId ?? "").trim();
  merged.deviceSecret = String(merged.deviceSecret ?? "").trim();
  merged.lastHeartbeatAt = String(merged.lastHeartbeatAt ?? "").trim();
  merged.lastPublishedAt = String(merged.lastPublishedAt ?? "").trim();

  if (merged.mode !== "custom") {
    const preset = buildRemoteAccessPreset(merged.mode);
    merged.sections = preset.sections;
    merged.actions = preset.actions;
  }

  if (!merged.passwordEnabled) {
    merged.passwordHash = "";
    merged.passwordSalt = "";
  }

  return merged;
}

export function getPublicRemoteAccessConfig(config = {}) {
  const remote = normalizeRemoteAccessConfig(config?.remoteAccess ?? config);
  return {
    enabled: remote.enabled,
    slug: remote.slug,
    passwordEnabled: remote.passwordEnabled,
    mode: remote.mode,
    sections: remote.sections,
    actions: remote.actions,
    deviceId: remote.deviceId,
    lastHeartbeatAt: remote.lastHeartbeatAt,
    lastPublishedAt: remote.lastPublishedAt,
    url: remote.slug ? buildRemoteAccessUrl(remote.slug) : "",
  };
}

export function normalizeRemoteSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
    .slice(0, 40);
}

export function generateRemoteSlug() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(10);
  let output = "";
  for (const byte of bytes) {
    output += alphabet[byte % alphabet.length];
  }
  return output;
}

export function generateRemoteDeviceId() {
  return `rrd_${crypto.randomBytes(12).toString("hex")}`;
}

export function generateRemoteDeviceSecret() {
  return `rrs_${crypto.randomBytes(24).toString("base64url")}`;
}

export function buildRemoteAccessUrl(slug, baseUrl = REMOTE_ACCESS_BASE_URL) {
  const normalizedSlug = normalizeRemoteSlug(slug);
  if (!normalizedSlug) return "";
  return `${String(baseUrl ?? REMOTE_ACCESS_BASE_URL).replace(/\/+$/g, "")}/${normalizedSlug}`;
}

export function hashRemoteSecret(value, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(value ?? ""), salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyRemoteSecret(value, salt, hash) {
  const nextHash = crypto.scryptSync(String(value ?? ""), String(salt ?? ""), 64).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(nextHash, "hex"),
    Buffer.from(String(hash ?? ""), "hex"),
  );
}

export function remoteAccessAllowsSection(remoteConfig, sectionId) {
  const remote = normalizeRemoteAccessConfig(remoteConfig);
  return Boolean(remote.sections?.[sectionId]);
}

export function remoteAccessAllowsAction(remoteConfig, actionId) {
  const remote = normalizeRemoteAccessConfig(remoteConfig);
  return Boolean(remote.actions?.[actionId]);
}
