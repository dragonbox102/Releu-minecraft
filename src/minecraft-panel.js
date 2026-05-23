import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import zlib from "node:zlib";
import { promisify } from "node:util";

import archiver from "archiver";
import extractZip from "extract-zip";
import minecraftData from "minecraft-data";
import nbt from "prismarine-nbt";

import {
  currentTimestamp,
  defaultServerProperties,
  ensureAppDirectories,
  fileExists,
  loadPanelConfig,
  paths,
  readJsonFile,
  sanitizeLogLine,
  savePanelConfig,
  slugTimestamp,
  writeJsonFile,
} from "./config.js";
import { DependencyManager } from "./dependency-manager.js";
import { PlayitManager } from "./playit.js";
import {
  ensureServerPropertyFile,
  readServerProperties,
  writeServerProperties,
} from "./properties.js";
import { AppUpdater } from "./updater.js";
import {
  downloadServerJar,
  fetchSoftwareVersions,
  getRequiredJavaMajor,
  resolveSoftwareVersion,
  serverSoftwareOptions,
} from "./server-software.js";
import {
  getDefaultCatalogProfileId,
  modCatalogProfiles,
  pluginCatalogProfiles,
  resourcePackCatalogProfiles,
  resolveCatalogInstall,
  searchCatalogProjects,
} from "./modrinth.js";
import {
  defaultServerConfig,
  ensureServerDirectories,
  ensureServerRegistry,
  getServerPaths,
  loadServerConfig,
  saveServerConfig,
  saveServerRegistry,
  slugifyServerId,
} from "./server-registry.js";
import {
  isLinux,
  isMac,
  isWindows,
  withHiddenConsole,
} from "./platform.js";
import {
  downloadWebsiteCloudBackupToFile,
  getCloudBackupConfig,
  getPublicCloudBackupConfig,
  getWebsiteCloudBackup,
  getWebsiteCloudHealth,
  issueWebsiteCloudBackupKey,
  listWebsiteCloudBackups,
  loginWebsiteCloudAccount,
  logoutWebsiteCloudAccount,
  registerWebsiteCloudAccount,
  rotateWebsiteCloudRestoreKey,
  storeWebsiteCloudBackup,
} from "./cloud-website.js";
import {
  buildRemoteAccessPreset,
  generateRemoteDeviceId,
  generateRemoteDeviceSecret,
  generateRemoteSlug,
  getPublicRemoteAccessConfig,
  hashRemoteSecret,
  normalizeRemoteAccessConfig,
  remoteAccessAllowsAction,
  remoteAccessAllowsSection,
} from "./remote-access.js";
import { RemoteAccessManager } from "./remote-access-manager.js";

const gzip = promisify(zlib.gzip);
const defaultInventoryTextureUrl =
  "https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.8/assets/minecraft/textures/gui/container/inventory.png";
const defaultItemCatalogVersion = "1.21.8";
const defaultInventoryCatalogSuggestions = [
  "stone",
  "dirt",
  "oak_planks",
  "cobblestone",
  "diamond",
  "diamond_sword",
  "diamond_pickaxe",
  "netherite_sword",
  "bread",
  "golden_apple",
  "torch",
  "ender_pearl",
  "elytra",
  "firework_rocket",
  "totem_of_undying",
  "obsidian",
  "iron_ingot",
  "redstone",
  "hopper",
  "shulker_box",
];
const armorInventorySlots = [
  { slotId: 103, key: "armor.head", label: "Head", commandSlot: "armor.head" },
  { slotId: 102, key: "armor.chest", label: "Chest", commandSlot: "armor.chest" },
  { slotId: 101, key: "armor.legs", label: "Legs", commandSlot: "armor.legs" },
  { slotId: 100, key: "armor.feet", label: "Feet", commandSlot: "armor.feet" },
];
const offhandInventorySlot = {
  slotId: 150,
  key: "weapon.offhand",
  label: "Offhand",
  commandSlot: "weapon.offhand",
};
const hotbarInventorySlots = Array.from({ length: 9 }, (_, index) => ({
  slotId: index,
  key: `hotbar.${index}`,
  label: `Hotbar ${index + 1}`,
  commandSlot: `hotbar.${index}`,
}));
const mainInventorySlots = Array.from({ length: 27 }, (_, index) => ({
  slotId: index + 9,
  key: `inventory.${index}`,
  label: `Inventory ${index + 1}`,
  commandSlot: `inventory.${index}`,
}));
const playerInventorySlots = [
  ...armorInventorySlots,
  offhandInventorySlot,
  ...mainInventorySlots,
  ...hotbarInventorySlots,
];
const inventorySlotById = new Map(playerInventorySlots.map((slot) => [slot.slotId, slot]));
const equipmentInventorySlots = [
  { equipmentKey: "head", definition: armorInventorySlots[0] },
  { equipmentKey: "chest", definition: armorInventorySlots[1] },
  { equipmentKey: "legs", definition: armorInventorySlots[2] },
  { equipmentKey: "feet", definition: armorInventorySlots[3] },
  { equipmentKey: "offhand", definition: offhandInventorySlot },
];

async function ensureJsonFile(targetPath, defaultValue) {
  if (await fileExists(targetPath)) {
    return;
  }
  await writeJsonFile(targetPath, defaultValue);
}

function parseMinecraftVersionParts(version) {
  const normalized = String(version ?? "").trim().split("-")[0];
  if (!normalized) {
    return [];
  }
  return normalized
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function usesModernGameruleIds(version) {
  const parts = parseMinecraftVersionParts(version);
  if (!parts.length) {
    return false;
  }
  if (String(version ?? "").trim().startsWith("26.")) {
    return true;
  }
  if (parts[0] !== 1 || parts.length < 3) {
    return false;
  }
  if (parts[1] > 21) {
    return true;
  }
  if (parts[1] < 21) {
    return false;
  }
  return parts[2] >= 11;
}

function getKeepInventoryGameruleId(version) {
  return usesModernGameruleIds(version) ? "minecraft:keep_inventory" : "keepInventory";
}

function hasCompatibleSharedHealthMod(context) {
  const installedMods = context.state?.installedAssets?.mods ?? [];
  return installedMods.some((entry) => {
    const slug = String(entry.projectSlug ?? "").trim().toLowerCase();
    const displayName = String(entry.displayName ?? entry.name ?? "").trim().toLowerCase();
    return slug === "sharedhealth" || slug === "shared-health" || displayName === "shared health";
  });
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeInventorySlotValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric === -106 ? 150 : numeric;
}

function serializeInventorySlotValue(slotId) {
  return slotId === 150 ? -106 : slotId;
}

function getInventorySlotDefinition(slotId) {
  return inventorySlotById.get(normalizeInventorySlotValue(slotId));
}

function inventoryItemCount(item) {
  const candidate =
    item?.count?.value ??
    item?.Count?.value ??
    item?.count ??
    item?.Count ??
    0;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? numeric : 0;
}

function inventoryItemId(item) {
  const candidate = item?.id?.value ?? item?.Id?.value ?? item?.id ?? item?.Id ?? "";
  return String(candidate).trim();
}

function inventoryItemComponents(item) {
  return item?.components?.value ?? item?.tag?.value ?? item?.components ?? item?.tag ?? null;
}

function inventoryItemSignature(item) {
  return JSON.stringify({
    id: inventoryItemId(item),
    components: inventoryItemComponents(item),
  });
}

function formatItemFallbackName(itemId) {
  return String(itemId ?? "")
    .replace(/^minecraft:/i, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function createEmptyInventorySlot(definition, extra = {}) {
  return {
    slotId: definition.slotId,
    key: definition.key,
    label: definition.label,
    commandSlot: definition.commandSlot,
    item: null,
    ...extra,
  };
}

function itemCatalogEntry(item) {
  if (!item?.name) {
    return null;
  }
  return {
    id: `minecraft:${item.name}`,
    name: item.name,
    displayName: item.displayName ?? formatItemFallbackName(item.name),
    stackSize: Number(item.stackSize ?? 64) || 64,
    maxDurability: Number(item.maxDurability ?? 0) || null,
  };
}

function scoreItemCatalogEntry(entry, query) {
  const normalizedQuery = String(query ?? "").trim().toLowerCase().replace(/^minecraft:/, "");
  if (!normalizedQuery) {
    return 0;
  }
  const id = entry.id.toLowerCase();
  const name = entry.name.toLowerCase();
  const displayName = entry.displayName.toLowerCase();
  if (id === `minecraft:${normalizedQuery}` || name === normalizedQuery) {
    return 1000;
  }
  if (name.startsWith(normalizedQuery)) {
    return 850;
  }
  if (displayName.startsWith(normalizedQuery)) {
    return 800;
  }
  if (name.includes(normalizedQuery)) {
    return 700;
  }
  if (displayName.includes(normalizedQuery)) {
    return 650;
  }
  return 0;
}

function buildInventoryItemView(rawItem, catalogEntry = null, slotIdOverride = null) {
  if (!rawItem) {
    return null;
  }
  const slotId = normalizeInventorySlotValue(
    slotIdOverride ?? rawItem?.Slot?.value ?? rawItem?.Slot,
  );
  return {
    slotId,
    id: inventoryItemId(rawItem),
    displayName:
      catalogEntry?.displayName ??
      formatItemFallbackName(inventoryItemId(rawItem)),
    count: inventoryItemCount(rawItem),
    stackSize: catalogEntry?.stackSize ?? 64,
    maxDurability: catalogEntry?.maxDurability ?? null,
    components: inventoryItemComponents(rawItem),
  };
}

function resolvePlayerEquipment(root = {}) {
  const directEquipment = root?.equipment;
  if (directEquipment && typeof directEquipment === "object" && !Array.isArray(directEquipment)) {
    return directEquipment;
  }

  const legacyEquipment = {};
  const armorItems = Array.isArray(root?.ArmorItems) ? root.ArmorItems : [];
  if (armorItems[3]) legacyEquipment.head = armorItems[3];
  if (armorItems[2]) legacyEquipment.chest = armorItems[2];
  if (armorItems[1]) legacyEquipment.legs = armorItems[1];
  if (armorItems[0]) legacyEquipment.feet = armorItems[0];

  const handItems = Array.isArray(root?.HandItems) ? root.HandItems : [];
  if (handItems[1]) legacyEquipment.offhand = handItems[1];

  return legacyEquipment;
}

function applyEquipmentInventoryItems(slotItems, equipment, itemCatalogById) {
  if (!equipment || typeof equipment !== "object") {
    return;
  }

  for (const { equipmentKey, definition } of equipmentInventorySlots) {
    const rawItem = equipment[equipmentKey];
    const itemId = inventoryItemId(rawItem);
    if (!itemId) {
      continue;
    }

    slotItems.set(
      definition.slotId,
      buildInventoryItemView(
        rawItem,
        itemCatalogById.get(itemId),
        definition.slotId,
      ),
    );
  }
}

function buildInventoryView(rawItems, selectedHotbarSlot, itemCatalogById, equipment = null) {
  const slotItems = new Map();
  for (const item of rawItems ?? []) {
    const slotId = normalizeInventorySlotValue(item?.Slot);
    const definition = getInventorySlotDefinition(slotId);
    if (!definition) {
      continue;
    }
    slotItems.set(
      definition.slotId,
      buildInventoryItemView(item, itemCatalogById.get(inventoryItemId(item))),
    );
  }
  applyEquipmentInventoryItems(slotItems, equipment, itemCatalogById);

  const withItems = (definitions) =>
    definitions.map((definition) =>
      createEmptyInventorySlot(definition, {
        item: slotItems.get(definition.slotId) ?? null,
        selected:
          definition.slotId >= 0 &&
          definition.slotId <= 8 &&
          definition.slotId === selectedHotbarSlot,
      })
    );

  return {
    armor: withItems(armorInventorySlots),
    offhand: createEmptyInventorySlot(offhandInventorySlot, {
      item: slotItems.get(offhandInventorySlot.slotId) ?? null,
    }),
    main: withItems(mainInventorySlots),
    hotbar: withItems(hotbarInventorySlots),
    occupiedSlots: Array.from(slotItems.values()).filter(Boolean).length,
    totalSlots: mainInventorySlots.length + hotbarInventorySlots.length + armorInventorySlots.length + 1,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createZipArchive(sourceDir, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(targetPath);
    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    output.on("close", () => {
      resolve({
        path: targetPath,
        sizeBytes: archive.pointer(),
      });
    });
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function copyDirectoryForBackup(sourceDir, targetDir) {
  await fs.cp(sourceDir, targetDir, {
    recursive: true,
    filter: (entry) => path.basename(entry) !== "session.lock",
  });
}

async function getDirectorySizeBytes(rootDir) {
  const stack = [rootDir];
  let totalBytes = 0;

  while (stack.length) {
    const currentDir = stack.pop();
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const targetPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(targetPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stats = await fs.stat(targetPath).catch(() => null);
      totalBytes += Number(stats?.size ?? 0) || 0;
    }
  }

  return totalBytes;
}

const cloudBackupManifestFormat = "releu-cloud-backup-manifest-v1";
const cloudBackupManifestSuffix = "__releu-manifest-v1";
const cloudBackupPartPattern = /^(.*)__releu-part-(\d+)-of-(\d+)$/i;
const singleCloudBackupIdPrefix = "single:";
const chunkedCloudBackupIdPrefix = "chunked:";

function formatChunkedBackupManifestName(baseName) {
  return `${baseName}${cloudBackupManifestSuffix}`;
}

function formatChunkedBackupPartName(baseName, partNumber, partCount) {
  return `${baseName}__releu-part-${String(partNumber).padStart(4, "0")}-of-${String(partCount).padStart(4, "0")}`;
}

function parseChunkedBackupEntry(entry) {
  const backupName = String(entry?.backup_name ?? "").trim();
  if (!backupName) {
    return { kind: "single", baseName: "" };
  }
  if (backupName.endsWith(cloudBackupManifestSuffix)) {
    return {
      kind: "manifest",
      baseName: backupName.slice(0, -cloudBackupManifestSuffix.length),
    };
  }

  const match = backupName.match(cloudBackupPartPattern);
  if (match) {
    return {
      kind: "part",
      baseName: String(match[1] ?? "").trim(),
      partNumber: Number(match[2] ?? 0) || 0,
      partCount: Number(match[3] ?? 0) || 0,
    };
  }

  return {
    kind: "single",
    baseName: backupName,
  };
}

function cloudBackupTimestampValue(entry) {
  const candidate = entry?.updated_at ?? entry?.created_at ?? null;
  const timestamp = Date.parse(candidate ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sha256HexForBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function sha256HexForFile(targetPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fsSync.createReadStream(targetPath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function readFileChunk(handle, position, length) {
  const buffer = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

async function uploadToSignedStorageUrlWithRetry(
  publicClient,
  bucket,
  objectPath,
  token,
  bytes,
  {
    attempts = 4,
    contentType = "application/zip",
  } = {},
) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { error } = await publicClient.storage
        .from(bucket)
        .uploadToSignedUrl(objectPath, token, bytes, {
          contentType,
          upsert: false,
        });
      if (!error) {
        return;
      }
      lastError = error;
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await wait(750 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Upload failed."));
}

function buildLogicalCloudBackups(entries) {
  const logical = [];
  const chunkGroups = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const parsed = parseChunkedBackupEntry(entry);
    if (parsed.kind === "single") {
      logical.push({
        ...entry,
        id: `${singleCloudBackupIdPrefix}${entry.id}`,
        logicalKind: "single",
      });
      continue;
    }

    const group = chunkGroups.get(parsed.baseName) ?? {
      baseName: parsed.baseName,
      manifest: null,
      parts: [],
    };
    if (parsed.kind === "manifest") {
      group.manifest = entry;
    } else {
      group.parts.push({
        ...entry,
        partNumber: parsed.partNumber,
        partCount: parsed.partCount,
      });
    }
    chunkGroups.set(parsed.baseName, group);
  }

  for (const group of chunkGroups.values()) {
    if (!group.manifest) {
      continue;
    }

    const orderedParts = [...group.parts].sort((left, right) => left.partNumber - right.partNumber);
    const latestEntry = [group.manifest, ...orderedParts]
      .filter(Boolean)
      .sort((left, right) => cloudBackupTimestampValue(right) - cloudBackupTimestampValue(left))[0];

    logical.push({
      id: `${chunkedCloudBackupIdPrefix}${group.manifest.id}`,
      backup_name: group.baseName,
      size_bytes: orderedParts.reduce(
        (total, entry) => total + Math.max(0, Number(entry?.size_bytes ?? 0) || 0),
        0,
      ),
      created_at: group.manifest.created_at ?? latestEntry?.created_at ?? null,
      updated_at: latestEntry?.updated_at ?? group.manifest.updated_at ?? null,
      status:
        group.manifest.status === "ready" &&
        orderedParts.length > 0 &&
        orderedParts.every((entry) => entry.status === "ready")
          ? "ready"
          : group.manifest.status,
      logicalKind: "chunked",
      partCount: orderedParts.length,
    });
  }

  return logical.sort((left, right) => cloudBackupTimestampValue(right) - cloudBackupTimestampValue(left));
}

function parseLogicalCloudBackupId(backupId) {
  const normalized = String(backupId ?? "").trim();
  if (!normalized) {
    return { kind: "single", id: "" };
  }
  if (normalized.startsWith(chunkedCloudBackupIdPrefix)) {
    return {
      kind: "chunked",
      id: normalized.slice(chunkedCloudBackupIdPrefix.length),
    };
  }
  if (normalized.startsWith(singleCloudBackupIdPrefix)) {
    return {
      kind: "single",
      id: normalized.slice(singleCloudBackupIdPrefix.length),
    };
  }
  return {
    kind: "single",
    id: normalized,
  };
}

const minecraftVersionSorter = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function normalizeComparableMinecraftVersion(version) {
  const normalized = String(version ?? "").trim().split("-")[0];
  if (!normalized) {
    return null;
  }

  if (/^\d+(?:\.\d+){2,3}$/i.test(normalized) && !normalized.startsWith("1.")) {
    const parts = normalized.split(".");
    const first = Number(parts[0]);
    if (first >= 26 && parts.length >= 3) {
      return parts.slice(0, 3).join(".");
    }
    if (parts.length >= 2) {
      return `1.${parts[0]}.${parts[1]}`;
    }
  }

  return normalized;
}

function isPotentialMinecraftDowngrade(currentVersion, nextVersion) {
  const current = normalizeComparableMinecraftVersion(currentVersion);
  const next = normalizeComparableMinecraftVersion(nextVersion);
  if (!current || !next || current === next) {
    return false;
  }
  return minecraftVersionSorter.compare(current, next) > 0;
}

function stripMinecraftLogPrefix(value) {
  return sanitizeLogLine(value)
    .replace(/^(?:\[[^\]]+\]\s*)+:\s*/i, "")
    .trim();
}

function normalizePlayerName(name) {
  return stripMinecraftLogPrefix(name);
}

function normalizeGamemode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["survival", "creative", "adventure", "spectator"].includes(normalized)
    ? normalized
    : null;
}

function playerKey(name) {
  return normalizePlayerName(name).toLowerCase();
}

function pickLinePayload(payload) {
  return stripMinecraftLogPrefix(payload);
}

function kindLabel(kind) {
  return kind === "mod" ? "mod" : "plugin";
}

function emptyAssetIndex() {
  return {
    plugin: {},
    mod: {},
  };
}

function normalizeAssetIndex(index) {
  return {
    plugin: { ...(index?.plugin ?? {}) },
    mod: { ...(index?.mod ?? {}) },
  };
}

function isNoisyPlayitLog(message) {
  const normalized = String(message ?? "").toLowerCase();
  return [
    "udp channel requires auth",
    "udp session details received",
    "tunnel running,",
    "send keepalive",
    "agent registered details",
    "reload_control_addr",
  ].some((pattern) => normalized.includes(pattern));
}

function sanitizeAssetFilename(fileName) {
  const normalized = path.basename(String(fileName ?? "").trim());
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("A valid file name is required.");
  }
  return normalized;
}

function parseFilenameFromDisposition(headerValue) {
  const raw = String(headerValue ?? "").trim();
  if (!raw) {
    return null;
  }

  const utfMatch = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1]);
  }

  const simpleMatch =
    raw.match(/filename\s*=\s*"([^"]+)"/i) ?? raw.match(/filename\s*=\s*([^;]+)/i);
  return simpleMatch?.[1]?.trim() ?? null;
}

function inferFilenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const candidate = parsed.pathname.split("/").filter(Boolean).at(-1);
    return candidate ? decodeURIComponent(candidate) : null;
  } catch {
    return null;
  }
}

function formatSoftwareName(software) {
  const match = serverSoftwareOptions.find((entry) => entry.id === software);
  if (match) {
    return match.name;
  }
  return software ? software[0].toUpperCase() + software.slice(1) : null;
}

function clampNumber(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.round(numeric)));
}

function ramStringToMb(value, fallback = 4096) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) {
    return fallback;
  }

  const match = raw.match(/^(\d+(?:\.\d+)?)([MGT])?$/);
  if (!match) {
    return fallback;
  }

  const numeric = Number(match[1]);
  const unit = match[2] ?? "M";
  if (unit === "G") {
    return Math.round(numeric * 1024);
  }
  if (unit === "T") {
    return Math.round(numeric * 1024 * 1024);
  }
  return Math.round(numeric);
}

function normalizeWorldName(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");

  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("A valid world name is required.");
  }

  return normalized;
}

function buildDeterministicUuidFromText(value) {
  const hash = crypto.createHash("sha1").update(String(value ?? "")).digest("hex");
  const base = hash.slice(0, 32).split("");
  if (base.length < 32) {
    throw new Error("Unable to derive a resource-pack-id.");
  }

  base[12] = "5";
  const variant = parseInt(base[16], 16);
  base[16] = ((variant & 0x3) | 0x8).toString(16);
  const normalized = base.join("");
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20, 32),
  ].join("-");
}

function ensureChildPath(parentDir, targetDir) {
  const parent = path.resolve(parentDir);
  const target = path.resolve(targetDir);
  if (target !== parent && !target.startsWith(`${parent}${path.sep}`)) {
    throw new Error("Resolved path is outside the server directory.");
  }
  return target;
}

function normalizeManagedRelativePath(value) {
  const normalized = String(value ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
  if (normalized.split("/").includes("..")) {
    throw new Error("Path cannot leave the server directory.");
  }
  return normalized;
}

function toPortableRelativePath(value) {
  return String(value ?? "").split(path.sep).join("/");
}

function normalizeManagedFileName(value, fallback = "new-file.txt") {
  const baseName = path.basename(String(value ?? "").trim());
  if (!baseName || baseName === "." || baseName === "..") {
    if (!fallback) {
      throw new Error("A valid file name is required.");
    }
    return fallback;
  }
  return baseName;
}

function isTextEditablePath(targetPath) {
  return /\.(txt|json|properties|ya?ml|xml|ini|cfg|conf|toml|md|log|csv|js|mjs|cjs|ts|mts|cts|java|gradle|mcmeta)$/i.test(
    String(targetPath ?? ""),
  );
}

function pathEqualsOrInside(targetPath, basePath) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(basePath);
  return (
    resolvedTarget === resolvedBase ||
    resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)
  );
}

function trimArchiveExtension(fileName) {
  return path.basename(String(fileName ?? "").trim()).replace(/\.(zip|mcworld)$/i, "");
}

const serverIconMimeByExt = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
});

function normalizeServerIconExtension(fileName) {
  const ext = path.extname(String(fileName ?? "").trim()).toLowerCase();
  if (!serverIconMimeByExt[ext]) {
    throw new Error("Server icon must be a PNG, JPG, WEBP, or GIF image.");
  }
  return ext;
}

function hasPath(targetPath) {
  try {
    fsSync.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function parseBooleanInput(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return String(value).trim().toLowerCase() === "true";
}

function parseIntegerInput(value, fallback = 0, minimum = 0) {
  const numeric = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(minimum, numeric);
}

function normalizePauseWhenEmptySeconds(enabled, currentValue) {
  if (!enabled) {
    return "-1";
  }
  const currentSeconds = Number.parseInt(String(currentValue ?? "").trim(), 10);
  if (Number.isFinite(currentSeconds) && currentSeconds > 0) {
    return String(currentSeconds);
  }
  return "60";
}

async function readBukkitAllowEndSetting(context) {
  const bukkitConfigFile = path.join(context.paths.serverDir, "bukkit.yml");
  if (!hasPath(bukkitConfigFile)) {
    return null;
  }
  const content = await fs.readFile(bukkitConfigFile, "utf8").catch(() => null);
  if (content === null) {
    return null;
  }
  const match = content.match(/^[ \t]*allow-end:\s*(true|false)\s*$/im);
  if (!match?.[1]) {
    return true;
  }
  return match[1].toLowerCase() === "true";
}

async function writeBukkitAllowEndSetting(context, enabled) {
  const bukkitConfigFile = path.join(context.paths.serverDir, "bukkit.yml");
  const desiredValue = enabled ? "true" : "false";
  const existingContent = await fs.readFile(bukkitConfigFile, "utf8").catch(() => "");
  let nextContent = existingContent;

  if (/^[ \t]*allow-end:\s*(true|false)\s*$/im.test(existingContent)) {
    nextContent = existingContent.replace(
      /^[ \t]*allow-end:\s*(true|false)\s*$/im,
      `  allow-end: ${desiredValue}`,
    );
  } else if (/^settings:\s*$/im.test(existingContent)) {
    nextContent = existingContent.replace(
      /^settings:\s*$/im,
      `settings:\n  allow-end: ${desiredValue}`,
    );
  } else if (!existingContent.trim()) {
    nextContent = `settings:\n  allow-end: ${desiredValue}\n`;
  } else {
    nextContent = `${existingContent.trimEnd()}\n\nsettings:\n  allow-end: ${desiredValue}\n`;
  }

  await fs.writeFile(bukkitConfigFile, nextContent, "utf8");
}

export class MinecraftPanelService {
  constructor() {
    this.panelConfig = null;
    this.registry = null;
    this.activeServerId = null;
    this.serverContexts = new Map();
    this.logs = [];
    this.nextLogId = 1;
    this.versionsCache = new Map();
    this.itemCatalogCache = new Map();
    this.backupTimer = null;
    this.playitInitialized = false;
    this.playitInitPromise = null;

    this.playit = new PlayitManager({
      appendLog: (source, line, level = "info") => this.appendLog(null, source, line, level),
      getServerPort: () => this.getRecommendedTunnelPort(),
      getAgentName: () => this.panelConfig?.playit?.agentName ?? "Minecraft Panel Host",
      getDownloadUrlOverride: () =>
        String(this.panelConfig?.playit?.macDownloadUrl ?? "").trim() || null,
    });
    this.dependencies = new DependencyManager({
      appendLog: (source, line) => this.appendLog(null, source, line),
      playitManager: this.playit,
    });
    this.updater = new AppUpdater({
      appendLog: (source, line) => this.appendLog(null, source, line),
      getPanelConfig: () => this.panelConfig,
      hasRunningServers: () => this.hasRunningServers(),
    });
    this.remoteAccess = new RemoteAccessManager({
      panel: this,
      appendLog: (source, line, level = "info") => this.appendLog(null, source, line, level),
    });
  }

  async init() {
    await ensureAppDirectories();
    this.panelConfig = await loadPanelConfig();
    process.env.BLOB_READ_WRITE_TOKEN =
      String(this.panelConfig?.cloudBackup?.blobReadWriteToken ?? "").trim() ||
      process.env.BLOB_READ_WRITE_TOKEN ||
      "";
    process.env.RELEU_CLOUD_API_BASE_URL =
      String(this.panelConfig?.cloudBackup?.cloudApiBaseUrl ?? "").trim() ||
      process.env.RELEU_CLOUD_API_BASE_URL ||
      "";
    this.registry = await ensureServerRegistry({
      panelConfig: this.panelConfig,
    });

    for (const record of this.registry.servers) {
      await this.registerServer(record);
    }

    this.activeServerId =
      this.registry.activeServerId && this.serverContexts.has(this.registry.activeServerId)
        ? this.registry.activeServerId
        : this.registry.servers[0]?.id ?? null;

    if (this.activeServerId && this.registry.activeServerId !== this.activeServerId) {
      this.registry.activeServerId = this.activeServerId;
      this.registry = await saveServerRegistry(this.registry);
    }

    this.startBackupScheduler();
    await this.updater.init();
    this.updater.maybeCheckForUpdates().catch((error) => {
      this.appendLog(null, "panel", error.message ?? "Releu update check failed.", "warn");
    });
    await this.remoteAccess.syncConfig(this.panelConfig.remoteAccess);
    this.appendLog(
      null,
      "panel",
      `Panel initialized. Open http://${this.panelConfig.panel.host}:${this.panelConfig.panel.port}`,
    );
  }

  appendLog(serverId, source, line, level = "info") {
    const message = sanitizeLogLine(line);
    if (!message) {
      return;
    }

    if (source === "playit" && isNoisyPlayitLog(message)) {
      return;
    }

    this.logs.push({
      id: this.nextLogId++,
      serverId,
      source,
      level,
      message,
      timestamp: currentTimestamp(),
    });

    if (this.logs.length > 6000) {
      this.logs.splice(0, this.logs.length - 6000);
    }
  }

  buildContext(serverRecord, config) {
    const configProfileName = String(config.profile?.name ?? "").trim();
    const configProfileDescription = String(config.profile?.description ?? "").trim();
    const recordName = String(serverRecord.name ?? "").trim();
    const recordDescription = String(serverRecord.description ?? "").trim();

    if (!recordName && configProfileName) {
      serverRecord.name = configProfileName;
    }
    if (!recordDescription && configProfileDescription) {
      serverRecord.description = configProfileDescription;
    }

    config.profile = {
      ...config.profile,
      name: String(serverRecord.name ?? configProfileName).trim(),
      description: String(serverRecord.description ?? configProfileDescription).trim(),
    };

    const installMeta = config.install.installedVersion
      ? {
          software: config.install.installedSoftware,
          softwareName: formatSoftwareName(config.install.installedSoftware),
          version: config.install.installedVersion,
          build: config.install.installedBuild,
          downloadedTo: getServerPaths(serverRecord).serverJar,
        }
      : null;

    return {
      record: serverRecord,
      paths: getServerPaths(serverRecord),
      config,
      serverProcess: null,
      restartRequested: false,
      backupInProgress: false,
      onlinePlayers: new Set(),
      cachedProperties: structuredClone(defaultServerProperties),
      pendingSafeModeRecovery: false,
      pendingDowngradeWorldFailure: false,
      startingWithSafeMode: false,
      state: {
        serverStatus: "stopped",
        serverReady: false,
        serverPid: null,
        playerCount: 0,
        operation: {
          active: false,
          type: null,
          title: null,
          shortLabel: null,
          detail: null,
          startedAt: null,
        },
        resourceMetrics: {
          cpuPercent: 0,
          ramUsedMb: 0,
          ramLeftMb: ramStringToMb(config.launcher.maxRam, 4096),
          ramMaxMb: ramStringToMb(config.launcher.maxRam, 4096),
          ramMinMb: ramStringToMb(config.launcher.minRam, 2048),
          loadPercent: 0,
          sampledAt: null,
        },
        lastStartedAt: null,
        lastStoppedAt: null,
        lastExitCode: null,
        installMeta,
      },
    };
  }

  async registerServer(serverRecord) {
    const config = await loadServerConfig(serverRecord.id);
    const context = this.buildContext(serverRecord, config);
    await this.ensureServerFiles(context);
    this.serverContexts.set(serverRecord.id, context);
    return context;
  }

  async ensureServerFiles(context) {
    await ensureServerDirectories(context.record);
    context.cachedProperties = await ensureServerPropertyFile(context.paths);
    await ensureJsonFile(context.paths.opsFile, []);
    await ensureJsonFile(context.paths.whitelistFile, []);
    await ensureJsonFile(context.paths.bannedPlayersFile, []);
    await ensureJsonFile(context.paths.bannedIpsFile, []);
    await ensureJsonFile(context.paths.usercacheFile, []);
    await ensureJsonFile(context.paths.playerIndexFile, {});
    await ensureJsonFile(context.paths.assetIndexFile, emptyAssetIndex());

    if (!(await fileExists(context.paths.eulaFile))) {
      await fs.writeFile(context.paths.eulaFile, "eula=false\n", "utf8");
    }
  }

  getServerIconCandidates(context) {
    return Object.keys(serverIconMimeByExt).map((extension) => ({
      path: path.join(context.paths.dataDir, `server-icon${extension}`),
      extension,
      contentType: serverIconMimeByExt[extension],
    }));
  }

  async getServerIconInfo(serverId) {
    const context = this.getServerContext(serverId);
    for (const candidate of this.getServerIconCandidates(context)) {
      if (!(await fileExists(candidate.path))) {
        continue;
      }
      const stats = await fs.stat(candidate.path);
      if (candidate.extension === ".png") {
        const minecraftIconPath = path.join(context.paths.serverDir, "server-icon.png");
        let shouldSyncMinecraftIcon = !(await fileExists(minecraftIconPath));
        if (!shouldSyncMinecraftIcon) {
          try {
            const minecraftIconStats = await fs.stat(minecraftIconPath);
            shouldSyncMinecraftIcon = minecraftIconStats.mtimeMs + 1 < stats.mtimeMs;
          } catch {
            shouldSyncMinecraftIcon = true;
          }
        }
        if (shouldSyncMinecraftIcon) {
          await fs.copyFile(candidate.path, minecraftIconPath);
        }
      }
      return {
        ...candidate,
        updatedAt: stats.mtime.toISOString(),
        updatedAtMs: stats.mtimeMs,
      };
    }
    return null;
  }

  async uploadServerIcon(serverId, fileName, bytes) {
    const context = this.getServerContext(serverId);
    const extension = normalizeServerIconExtension(fileName);
    const targetPath = path.join(context.paths.dataDir, `server-icon${extension}`);
    const minecraftIconPath = path.join(context.paths.serverDir, "server-icon.png");
    await fs.mkdir(context.paths.dataDir, { recursive: true });
    await Promise.all(
      this.getServerIconCandidates(context)
        .filter((candidate) => candidate.path !== targetPath)
        .map((candidate) => fs.rm(candidate.path, { force: true })),
    );
    await fs.writeFile(targetPath, Buffer.from(bytes));
    if (extension === ".png") {
      await fs.writeFile(minecraftIconPath, Buffer.from(bytes));
    }
    context.record.updatedAt = currentTimestamp();
    this.registry.servers = this.registry.servers.map((entry) =>
      entry.id === serverId ? context.record : entry,
    );
    this.registry = await saveServerRegistry(this.registry);
    this.appendLog(serverId, "panel", "Updated server icon.");
    return this.getServerIconInfo(serverId);
  }

  getServerContext(serverId = this.activeServerId) {
    const context = this.serverContexts.get(serverId);
    if (!context) {
      throw new Error("The selected server does not exist.");
    }
    return context;
  }

  setServerOperation(context, operation = {}) {
    context.state.operation = {
      active: true,
      type: operation.type ?? "working",
      title: operation.title ?? "Working",
      shortLabel: operation.shortLabel ?? operation.title ?? "Working",
      detail: operation.detail ?? "Releu is working on this server.",
      startedAt: operation.startedAt ?? currentTimestamp(),
    };
  }

  clearServerOperation(context) {
    context.state.operation = {
      active: false,
      type: null,
      title: null,
      shortLabel: null,
      detail: null,
      startedAt: null,
    };
  }

  getRecommendedTunnelPort() {
    if (!this.activeServerId || !this.serverContexts.has(this.activeServerId)) {
      return 25565;
    }
    const context = this.getServerContext(this.activeServerId);
    return Number(context.cachedProperties["server-port"] ?? 25565);
  }

  hasRunningServers() {
    return Array.from(this.serverContexts.values()).some((context) => Boolean(context.serverProcess));
  }

  getHostResources() {
    const cpuCores = Math.max(1, os.cpus()?.length ?? 1);
    const totalMemoryMb = Math.max(1024, Math.floor(os.totalmem() / (1024 * 1024)));
    const recommendedMaxRamMb = Math.max(
      2048,
      Math.min(totalMemoryMb - 1024, Math.floor(totalMemoryMb * 0.75)),
    );

    return {
      cpuCores,
      totalMemoryMb,
      recommendedMaxRamMb,
      gpuSupported: false,
      gpuNote: "Minecraft Java servers do not use the GPU directly, so GPU allocation is stored only as a planning hint.",
    };
  }

  async ensurePlayitInitialized(force = false) {
    if (this.playitInitialized && !force) {
      return this.playit.snapshot();
    }

    if (this.playitInitPromise && !force) {
      return this.playitInitPromise;
    }

    this.playitInitPromise = this.playit
      .init()
      .then(() => {
        this.playitInitialized = true;
        return this.playit.snapshot();
      })
      .finally(() => {
        this.playitInitPromise = null;
      });

    return this.playitInitPromise;
  }

  getPreferredManagedJavaPath(version) {
    const requiredMajor = getRequiredJavaMajor(version);
    return this.dependencies.getManagedJavaPath(requiredMajor);
  }

  shouldAutoManageJavaPath(javaPath) {
    const normalized = String(javaPath ?? "").trim();
    if (!normalized || normalized.toLowerCase() === "java") {
      return true;
    }

    return pathEqualsOrInside(normalized, paths.toolsDir);
  }

  isForeignJavaPath(javaPath) {
    const normalized = String(javaPath ?? "").trim();
    if (!normalized) {
      return false;
    }

    if (isWindows) {
      return normalized.startsWith("/");
    }

    return /^[a-z]:[\\/]/i.test(normalized);
  }

  normalizeLauncherJavaPath(javaPath, version = null) {
    const normalized = String(javaPath ?? "").trim();
    const preferredJavaPath = this.getPreferredManagedJavaPath(version);

    if (!normalized || this.shouldAutoManageJavaPath(normalized)) {
      return preferredJavaPath || normalized || "java";
    }

    if (this.isForeignJavaPath(normalized)) {
      return preferredJavaPath || "java";
    }

    return normalized;
  }

  async shouldRepairJavaPath(javaPath) {
    const normalized = String(javaPath ?? "").trim();
    if (!normalized || this.shouldAutoManageJavaPath(normalized)) {
      return false;
    }

    if (this.isForeignJavaPath(normalized)) {
      return true;
    }

    return path.isAbsolute(normalized) && !(await fileExists(normalized));
  }

  async applyManagedJavaDefaults() {
    const dependencyState = this.dependencies.snapshot();
    if (!dependencyState.ready) {
      return dependencyState;
    }

    for (const context of this.serverContexts.values()) {
      const preferredJavaPath = this.getPreferredManagedJavaPath(
        context.config.install.installedVersion ??
          context.config.install.requestedVersion ??
          null,
      );

      if (!preferredJavaPath) {
        continue;
      }

      const shouldRepairJavaPath = await this.shouldRepairJavaPath(
        context.config.launcher.javaPath,
      );
      if (!shouldRepairJavaPath && !this.shouldAutoManageJavaPath(context.config.launcher.javaPath)) {
        continue;
      }

      const nextJavaPath = this.normalizeLauncherJavaPath(
        context.config.launcher.javaPath,
        context.config.install.installedVersion ??
          context.config.install.requestedVersion ??
          null,
      );
      if (context.config.launcher.javaPath === nextJavaPath) {
        continue;
      }

      context.config.launcher = {
        ...context.config.launcher,
        javaPath: nextJavaPath,
      };
      await this.saveContextConfig(context);
    }

    return dependencyState;
  }

  async getDependencyState() {
    return this.dependencies.check();
  }

  async ensureDependencies() {
    const dependencyState = await this.dependencies.ensureAll();
    await this.ensurePlayitInitialized(true);
    await this.applyManagedJavaDefaults();
    return dependencyState;
  }

  async readWindowsProcessMetrics(processId) {
    if (!processId || process.platform !== "win32") {
      return null;
    }

    const command = `
$sample = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess = ${Number(processId)}"
if (-not $sample) { exit 0 }
[pscustomobject]@{
  cpuPercent = [double]$sample.PercentProcessorTime
  ramBytes = [int64]$sample.WorkingSetPrivate
} | ConvertTo-Json -Compress
`.trim();

    return new Promise((resolve, reject) => {
      const child = spawn(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
        withHiddenConsole(),
      );

      let stdout = "";
      let stderr = "";
      let settled = false;

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });

      child.on("exit", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        if (code && code !== 0) {
          reject(new Error(sanitizeLogLine(stderr) || "Unable to read process metrics."));
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(trimmed));
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async readUnixProcessMetrics(processId) {
    if (!processId || (!isLinux && !isMac)) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const child = spawn(
        "ps",
        ["-p", String(Number(processId)), "-o", "%cpu=,rss="],
        withHiddenConsole(),
      );

      let stdout = "";
      let stderr = "";
      let settled = false;

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });

      child.on("exit", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        if (code && code !== 0) {
          reject(new Error(sanitizeLogLine(stderr) || "Unable to read process metrics.")); 
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve(null);
          return;
        }

        const [cpuToken, rssToken] = trimmed.split(/\s+/);
        const cpuPercent = Number(cpuToken);
        const rssKb = Number(rssToken);
        if (!Number.isFinite(cpuPercent) || !Number.isFinite(rssKb)) {
          resolve(null);
          return;
        }

        resolve({
          cpuPercent,
          ramBytes: rssKb * 1024,
        });
      });
    });
  }

  async readProcessMetrics(processId) {
    if (process.platform === "win32") {
      return this.readWindowsProcessMetrics(processId);
    }

    if (isLinux || isMac) {
      return this.readUnixProcessMetrics(processId);
    }

    return null;
  }

  async refreshServerMetrics(context) {
    const ramMaxMb = ramStringToMb(context.config.launcher.maxRam, 4096);
    const ramMinMb = ramStringToMb(context.config.launcher.minRam, 2048);
    const offlineMetrics = {
      cpuPercent: 0,
      ramUsedMb: 0,
      ramLeftMb: ramMaxMb,
      ramMaxMb,
      ramMinMb,
      loadPercent: 0,
      sampledAt: currentTimestamp(),
    };

    if (!context.serverProcess || !context.state.serverPid) {
      context.state.resourceMetrics = offlineMetrics;
      return context.state.resourceMetrics;
    }

    try {
      const sample = await this.readProcessMetrics(context.state.serverPid);
      if (!sample) {
        context.state.resourceMetrics = offlineMetrics;
        return context.state.resourceMetrics;
      }

      const hostCpuCores = Math.max(1, this.getHostResources().cpuCores);
      const rawCpu = Math.max(0, Number(sample.cpuPercent) || 0);
      const normalizedCpu = rawCpu > 100 ? rawCpu / hostCpuCores : rawCpu;
      const ramUsedMb = Math.max(0, Math.round((Number(sample.ramBytes) || 0) / (1024 * 1024)));
      const ramLeftMb = Math.max(0, ramMaxMb - ramUsedMb);
      const memoryLoadPercent = ramMaxMb > 0 ? (ramUsedMb / ramMaxMb) * 100 : 0;

      context.state.resourceMetrics = {
        cpuPercent: Math.round(Math.min(100, normalizedCpu) * 10) / 10,
        ramUsedMb,
        ramLeftMb,
        ramMaxMb,
        ramMinMb,
        loadPercent: Math.round(Math.max(normalizedCpu, memoryLoadPercent) * 10) / 10,
        sampledAt: currentTimestamp(),
      };
    } catch {
      context.state.resourceMetrics = {
        ...offlineMetrics,
        ramLeftMb: Math.max(0, ramMaxMb - (context.state.resourceMetrics?.ramUsedMb ?? 0)),
        ramUsedMb: context.state.resourceMetrics?.ramUsedMb ?? 0,
        sampledAt: currentTimestamp(),
      };
    }

    return context.state.resourceMetrics;
  }

  reconcileRuntimeState(context) {
    if (!context.serverProcess) {
      if (context.state.serverStatus === "starting" || context.state.serverStatus === "stopping") {
        context.state.serverStatus = "stopped";
      }
      context.state.serverReady = false;
      context.state.serverPid = null;
      return;
    }

    if (context.state.serverReady && context.state.serverStatus !== "stopping") {
      context.state.serverStatus = "running";
      return;
    }

    if (context.state.serverStatus === "stopped") {
      context.state.serverStatus = "starting";
    }
  }

  getServerGameVersion(serverId) {
    const context = this.getServerContext(serverId);
    return (
      context.config.install.installedVersion ??
      context.config.install.requestedVersion ??
      context.state.installMeta?.version ??
      null
    );
  }

  getCatalogProfiles(serverId) {
    const context = this.getServerContext(serverId);
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    return {
      pluginProfiles: pluginCatalogProfiles,
      modProfiles: modCatalogProfiles,
      resourcePackProfiles: resourcePackCatalogProfiles,
      defaults: {
        plugin: getDefaultCatalogProfileId("plugin", effectiveSoftware),
        mod: getDefaultCatalogProfileId("mod", effectiveSoftware),
        resourcepack: getDefaultCatalogProfileId("resourcepack", effectiveSoftware),
      },
    };
  }

  async getLogs(afterId = 0, serverId = this.activeServerId) {
    const threshold = Number(afterId || 0);
    return this.logs.filter((entry) => {
      if (entry.id <= threshold) {
        return false;
      }

      if (!serverId) {
        return true;
      }

      return entry.serverId === null || entry.serverId === serverId;
    });
  }

  async resolveInstallerArgFile(context, softwareId) {
    const argFileName = process.platform === "win32" ? "win_args.txt" : "unix_args.txt";
    const version = String(context.config.install.installedVersion ?? "").trim();
    const candidateBases =
      softwareId === "forge"
        ? [path.join(context.paths.serverDir, "libraries", "net", "minecraftforge", "forge")]
        : [path.join(context.paths.serverDir, "libraries", "net", "neoforged", "neoforge")];

    for (const baseDir of candidateBases) {
      if (version) {
        const directPath = path.join(baseDir, version, argFileName);
        if (await fileExists(directPath)) {
          return directPath;
        }
      }

      try {
        const entries = await fs.readdir(baseDir, { withFileTypes: true });
        const matches = entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(baseDir, entry.name, argFileName));
        for (const candidate of matches) {
          if (await fileExists(candidate)) {
            return candidate;
          }
        }
      } catch {
        // Ignore missing installer directories and fall back to jar discovery.
      }
    }

    return null;
  }

  async hasInstalledJar(context) {
    return Boolean(await this.resolveLaunchTarget(context));
  }

  async resolveInstalledJar(context) {
    if (await fileExists(context.paths.serverJar)) {
      return context.paths.serverJar;
    }

    if (await fileExists(context.paths.legacyServerJar)) {
      return context.paths.legacyServerJar;
    }

    const softwareId = this.getEffectiveServerSoftwareId(context);
    const jarPattern =
      softwareId === "neoforge" ? /^neoforge-.*(?:server|universal)?\.jar$/i : /^forge-.*(?:server|universal)?\.jar$/i;

    try {
      const rootEntries = await fs.readdir(context.paths.serverDir, { withFileTypes: true });
      const rootJar = rootEntries
        .filter((entry) => entry.isFile() && jarPattern.test(entry.name) && !entry.name.includes("-installer"))
        .map((entry) => path.join(context.paths.serverDir, entry.name))
        .at(0);
      if (rootJar) {
        return rootJar;
      }
    } catch {
      // Ignore root jar lookup errors.
    }

    const libraryBase =
      softwareId === "neoforge"
        ? path.join(context.paths.serverDir, "libraries", "net", "neoforged", "neoforge")
        : path.join(context.paths.serverDir, "libraries", "net", "minecraftforge", "forge");
    try {
      const versionDirs = await fs.readdir(libraryBase, { withFileTypes: true });
      for (const entry of versionDirs.filter((value) => value.isDirectory())) {
        const candidateDir = path.join(libraryBase, entry.name);
        const files = await fs.readdir(candidateDir, { withFileTypes: true });
        const match = files
          .filter((file) => file.isFile() && jarPattern.test(file.name) && !file.name.includes("-installer"))
          .map((file) => path.join(candidateDir, file.name))
          .at(0);
        if (match) {
          return match;
        }
      }
    } catch {
      // Ignore library jar lookup errors.
    }

    return null;
  }

  async resolveLaunchTarget(context) {
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    if (effectiveSoftware === "forge" || effectiveSoftware === "neoforge") {
      const argFile = await this.resolveInstallerArgFile(context, effectiveSoftware);
      if (argFile) {
        return {
          mode: "argfile",
          argFile,
          softwareId: effectiveSoftware,
        };
      }
    }

    const jarPath = await this.resolveInstalledJar(context);
    if (jarPath) {
      return {
        mode: "jar",
        jarPath,
        softwareId: effectiveSoftware,
      };
    }

    return null;
  }

  getNextBackupAt(context) {
    const intervalMinutes = Math.max(
      5,
      Number(context.config.backups.intervalMinutes ?? 60) || 60,
    );

    if (!context.config.backups.enabled) {
      return null;
    }

    const anchor =
      Date.parse(
        context.config.backups.lastBackupAt ?? context.record.createdAt ?? currentTimestamp(),
      ) || Date.now();
    return new Date(anchor + intervalMinutes * 60_000).toISOString();
  }

  normalizeBackupMaxStorageGb(value) {
    return Math.max(
      1,
      Number(value ?? defaultServerConfig.backups.maxStorageGb ?? 10) ||
        Number(defaultServerConfig.backups.maxStorageGb ?? 10) ||
        10,
    );
  }

  getBackupMaxStorageBytes(context) {
    return Math.round(this.normalizeBackupMaxStorageGb(context.config.backups.maxStorageGb) * 1024 ** 3);
  }

  async listBackups(serverId, limit = Number.POSITIVE_INFINITY) {
    const context = this.getServerContext(serverId);
    try {
      const entries = await fs.readdir(context.paths.backupsDir, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => right.name.localeCompare(left.name))
        .slice(0, Number.isFinite(limit) ? limit : undefined);

      const backups = [];
      for (const entry of directories) {
        const target = path.join(context.paths.backupsDir, entry.name);
        const stats = await fs.stat(target);
        const bytes = await getDirectorySizeBytes(target);
        backups.push({
          name: entry.name,
          path: target,
          createdAt: stats.birthtime?.toISOString?.() ?? stats.mtime.toISOString(),
          bytes,
        });
      }
      return backups;
    } catch {
      return [];
    }
  }

  async getBackupStorageSummary(context, backups = null) {
    const entries = backups ?? (await this.listBackups(context.record.id));
    const maxStorageGb = this.normalizeBackupMaxStorageGb(context.config.backups.maxStorageGb);
    const maxStorageBytes = Math.round(maxStorageGb * 1024 ** 3);
    const totalBytes = entries.reduce((sum, entry) => sum + (Number(entry.bytes ?? 0) || 0), 0);
    return {
      totalBytes,
      totalCount: entries.length,
      maxStorageGb,
      maxStorageBytes,
      overLimit: totalBytes > maxStorageBytes,
    };
  }

  async enforceBackupStorageLimit(context, { preserveBackupNames = [] } = {}) {
    const backups = await this.listBackups(context.record.id);
    if (!backups.length) {
      return {
        removed: [],
        ...(await this.getBackupStorageSummary(context, backups)),
      };
    }

    const preserveNames = new Set(
      [backups[0]?.name, ...preserveBackupNames].filter(Boolean).map((value) => String(value)),
    );
    const maxStorageBytes = this.getBackupMaxStorageBytes(context);
    let totalBytes = backups.reduce((sum, entry) => sum + (Number(entry.bytes ?? 0) || 0), 0);
    const pruneCandidates = [...backups].sort((left, right) => left.name.localeCompare(right.name));
    const removed = [];

    for (const entry of pruneCandidates) {
      if (totalBytes <= maxStorageBytes) {
        break;
      }

      if (preserveNames.has(entry.name)) {
        continue;
      }

      await fs.rm(entry.path, { recursive: true, force: true }).catch(() => {});
      totalBytes -= Number(entry.bytes ?? 0) || 0;
      removed.push(entry);
    }

    if (removed.length) {
      const removedNames = removed.map((entry) => entry.name).join(", ");
      this.appendLog(
        context.record.id,
        "panel",
        `Deleted older backups to stay within the ${this.normalizeBackupMaxStorageGb(context.config.backups.maxStorageGb)} GB limit: ${removedNames}.`,
      );
    }

    if (totalBytes > maxStorageBytes) {
      this.appendLog(
        context.record.id,
        "panel",
        `The newest backup alone is larger than the ${this.normalizeBackupMaxStorageGb(context.config.backups.maxStorageGb)} GB local backup limit, so Releu kept it and could not trim usage below the cap.`,
        "warn",
      );
    }

    const remainingBackups = await this.listBackups(context.record.id);
    const latestBackup = remainingBackups[0] ?? null;
    context.config.backups.lastBackupPath = latestBackup?.path ?? null;
    await this.saveContextConfig(context);
    return {
      removed,
      ...(await this.getBackupStorageSummary(context, remainingBackups)),
    };
  }

  async serializeServerSummary(context) {
    const metrics = await this.refreshServerMetrics(context);
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    const iconInfo = await this.getServerIconInfo(context.record.id);
    const recentBackups = await this.listBackups(context.record.id, 6);
    const backupStorage = await this.getBackupStorageSummary(context);
    const liveDescription = String(
      context.cachedProperties?.motd ?? context.record.description ?? "",
    ).trim();
    return {
      id: context.record.id,
      name: context.record.name,
      description: liveDescription,
      iconUrl: iconInfo
        ? `/api/servers/${encodeURIComponent(context.record.id)}/icon?v=${encodeURIComponent(String(iconInfo.updatedAtMs))}`
        : null,
      status: context.state.serverStatus,
      ready: context.state.serverReady,
      pid: context.state.serverPid,
      playerCount: context.state.playerCount,
      operation: context.state.operation,
      metrics,
      port: Number(context.cachedProperties["server-port"] ?? 25565),
      serverDir: context.paths.serverDir,
      jarInstalled: await this.hasInstalledJar(context),
      lastStartedAt: context.state.lastStartedAt,
      lastStoppedAt: context.state.lastStoppedAt,
      install: {
        ...context.config.install,
        installedSoftware: effectiveSoftware,
      },
      launcher: {
        ...context.config.launcher,
      },
      backups: {
        ...context.config.backups,
        nextBackupAt: this.getNextBackupAt(context),
        maxStorageGb: this.normalizeBackupMaxStorageGb(context.config.backups.maxStorageGb),
        totalBytes: backupStorage.totalBytes,
        totalCount: backupStorage.totalCount,
        maxStorageBytes: backupStorage.maxStorageBytes,
        overLimit: backupStorage.overLimit,
        recent: recentBackups,
      },
      misc: {
        ...context.config.misc,
      },
    };
  }

  async serializeActiveServer(context) {
    context.cachedProperties = await readServerProperties(context.paths);
    const bukkitAllowEnd = await readBukkitAllowEndSetting(context);
    if (bukkitAllowEnd !== null) {
      context.cachedProperties["allow-end"] = String(bukkitAllowEnd);
    }
    const jarInstalled = await this.hasInstalledJar(context);
    const metrics = await this.refreshServerMetrics(context);
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    const iconInfo = await this.getServerIconInfo(context.record.id);
    const allBackups = await this.listBackups(context.record.id);
    const backupStorage = await this.getBackupStorageSummary(context, allBackups);
    const liveDescription = String(
      context.cachedProperties?.motd ?? context.record.description ?? "",
    ).trim();
    return {
      id: context.record.id,
      name: context.record.name,
      description: liveDescription,
      iconUrl: iconInfo
        ? `/api/servers/${encodeURIComponent(context.record.id)}/icon?v=${encodeURIComponent(String(iconInfo.updatedAtMs))}`
        : null,
      serverDir: context.paths.serverDir,
      dataDir: context.paths.dataDir,
      setupComplete: jarInstalled,
      launcher: context.config.launcher,
      install: {
        ...context.config.install,
        installedSoftware: effectiveSoftware,
      },
      backups: {
        ...context.config.backups,
        nextBackupAt: this.getNextBackupAt(context),
        maxStorageGb: this.normalizeBackupMaxStorageGb(context.config.backups.maxStorageGb),
        totalBytes: backupStorage.totalBytes,
        totalCount: backupStorage.totalCount,
        maxStorageBytes: backupStorage.maxStorageBytes,
        overLimit: backupStorage.overLimit,
        recent: allBackups,
      },
      misc: {
        ...context.config.misc,
      },
      catalog: {
        ...this.getCatalogProfiles(context.record.id),
        gameVersion: this.getServerGameVersion(context.record.id),
      },
      server: {
        status: context.state.serverStatus,
        ready: context.state.serverReady,
        pid: context.state.serverPid,
        playerCount: context.state.playerCount,
        operation: context.state.operation,
        metrics,
        jarInstalled,
        eulaAccepted: await this.readEula(context.record.id),
        properties: context.cachedProperties,
        lastStartedAt: context.state.lastStartedAt,
        lastStoppedAt: context.state.lastStoppedAt,
        lastExitCode: context.state.lastExitCode,
        installMeta: context.state.installMeta,
      },
      players: await this.getPlayers(context.record.id),
      plugins: await this.listAssets(context.record.id, "plugin"),
      mods: await this.listAssets(context.record.id, "mod"),
      worlds: await this.listWorlds(context.record.id),
    };
  }

  async getState(serverId = this.activeServerId) {
    const context = this.getServerContext(serverId);
    this.reconcileRuntimeState(context);
    await this.syncDetectedInstalledSoftware(context);
    await this.ensurePlayitInitialized();
    const playitSnapshot = this.playit.snapshot();
    const hasPublicPlayitTunnel = playitSnapshot.tunnels.some((entry) => entry.publicAddress);
    const shouldForceTunnelRefresh =
      playitSnapshot.secretConfigured &&
      !hasPublicPlayitTunnel &&
      Number(playitSnapshot.configuredTunnelCount ?? 0) > 0;
    const shouldRefreshTunnelStatus =
      playitSnapshot.secretConfigured &&
      (!playitSnapshot.lastRefreshAt ||
        shouldForceTunnelRefresh ||
        playitSnapshot.needsWebSetup ||
        (Number(playitSnapshot.configuredTunnelCount ?? 0) === 0 &&
          !playitSnapshot.checkingTunnelStatus));
    if (shouldRefreshTunnelStatus) {
      this.playit.refreshTunnels({
        force: !playitSnapshot.lastRefreshAt || shouldForceTunnelRefresh,
      }).catch(() => {});
    }
    this.updater.maybeCheckForUpdates().catch(() => {});

    return {
      panel: this.panelConfig.panel,
      uiSettings: this.panelConfig.ui,
      playitSettings: this.panelConfig.playit,
      updaterSettings: this.panelConfig.updater,
      desktopSettings: this.panelConfig.desktop,
      cloudBackupSettings: getPublicCloudBackupConfig(this.panelConfig),
      remoteAccess: this.remoteAccess.snapshot(),
      host: this.getHostResources(),
      dependencies: this.dependencies.snapshot(),
      softwareOptions: serverSoftwareOptions,
      activeServerId: this.activeServerId,
      servers: await Promise.all(
        this.registry.servers.map((serverRecord) =>
          this.serializeServerSummary(this.getServerContext(serverRecord.id)),
        ),
      ),
      activeServer: await this.serializeActiveServer(context),
      playit: this.playit.snapshot(),
      appUpdate: this.updater.snapshot(),
    };
  }

  sanitizeRemoteServerSummary(server) {
    if (!server) {
      return null;
    }
    return {
      id: server.id,
      name: server.name,
      description: server.description,
      status: server.status,
      ready: server.ready,
      playerCount: server.playerCount,
      operation: server.operation,
      metrics: server.metrics,
      port: server.port,
      jarInstalled: server.jarInstalled,
      lastStartedAt: server.lastStartedAt,
      lastStoppedAt: server.lastStoppedAt,
      install: server.install,
      launcher: {
        minRam: server.launcher?.minRam,
        maxRam: server.launcher?.maxRam,
        cpuCores: server.launcher?.cpuCores,
        gpuShare: server.launcher?.gpuShare,
      },
      backups: server.backups,
      misc: server.misc,
    };
  }

  sanitizeRemoteActiveServer(server) {
    if (!server) {
      return null;
    }
    return {
      id: server.id,
      name: server.name,
      description: server.description,
      setupComplete: server.setupComplete,
      launcher: {
        minRam: server.launcher?.minRam,
        maxRam: server.launcher?.maxRam,
        cpuCores: server.launcher?.cpuCores,
        gpuShare: server.launcher?.gpuShare,
      },
      install: server.install,
      backups: server.backups,
      misc: server.misc,
      catalog: server.catalog,
      server: server.server,
      players: server.players,
      plugins: server.plugins,
      mods: server.mods,
      worlds: server.worlds,
    };
  }

  async buildRemoteAccessSnapshot() {
    const state = await this.getState(this.activeServerId);
    const activeServerId = state.activeServerId ?? state.activeServer?.id ?? null;
    const logEntries = await this.getLogs(0, activeServerId);
    return {
      generatedAt: currentTimestamp(),
      remoteAccess: this.remoteAccess.snapshot(),
      host: {
        cpuCores: state.host?.cpuCores ?? 0,
        totalMemoryMb: state.host?.totalMemoryMb ?? 0,
        freeMemoryMb: state.host?.freeMemoryMb ?? 0,
        platform: state.host?.platform ?? "",
        hostname: state.host?.hostname ?? "",
      },
      playit: state.playit,
      softwareOptions: state.softwareOptions,
      activeServerId,
      servers: Array.isArray(state.servers)
        ? state.servers.map((server) => this.sanitizeRemoteServerSummary(server))
        : [],
      activeServer: this.sanitizeRemoteActiveServer(state.activeServer),
      logs: logEntries.slice(-200),
    };
  }

  getRemoteAccessState() {
    return this.remoteAccess.snapshot();
  }

  async setupRemoteAccess(payload = {}) {
    const nextConfig = normalizeRemoteAccessConfig({
      ...this.panelConfig.remoteAccess,
      enabled: true,
      slug: String(payload.slug ?? this.panelConfig.remoteAccess?.slug ?? "").trim() || generateRemoteSlug(),
      passwordEnabled: Boolean(payload.passwordEnabled),
      mode:
        String(payload.mode ?? "").trim().toLowerCase() === "custom"
          ? "custom"
          : String(payload.mode ?? this.panelConfig.remoteAccess?.mode ?? "view").trim().toLowerCase(),
      sections:
        String(payload.mode ?? "").trim().toLowerCase() === "custom"
          ? { ...(payload.sections ?? this.panelConfig.remoteAccess?.sections ?? {}) }
          : buildRemoteAccessPreset(payload.mode ?? this.panelConfig.remoteAccess?.mode ?? "view").sections,
      actions:
        String(payload.mode ?? "").trim().toLowerCase() === "custom"
          ? { ...(payload.actions ?? this.panelConfig.remoteAccess?.actions ?? {}) }
          : buildRemoteAccessPreset(payload.mode ?? this.panelConfig.remoteAccess?.mode ?? "view").actions,
      deviceId: String(this.panelConfig.remoteAccess?.deviceId ?? "").trim() || generateRemoteDeviceId(),
      deviceSecret:
        String(this.panelConfig.remoteAccess?.deviceSecret ?? "").trim() || generateRemoteDeviceSecret(),
      lastHeartbeatAt: "",
      lastPublishedAt: "",
    });

    if (nextConfig.passwordEnabled) {
      const password = String(payload.password ?? "").trim();
      if (password.length < 6) {
        throw new Error("Remote Access password must be at least 6 characters.");
      }
      const hashedPassword = hashRemoteSecret(password);
      nextConfig.passwordHash = hashedPassword.hash;
      nextConfig.passwordSalt = hashedPassword.salt;
    } else {
      nextConfig.passwordHash = "";
      nextConfig.passwordSalt = "";
    }

    this.panelConfig.remoteAccess = nextConfig;
    this.panelConfig = await savePanelConfig(this.panelConfig);
    await this.remoteAccess.syncConfig(this.panelConfig.remoteAccess);
    this.appendLog(null, "panel", `Enabled Remote Access at ${this.remoteAccess.snapshot().url}.`);
    return this.getState(this.activeServerId);
  }

  async regenerateRemoteAccess() {
    let nextSlug = generateRemoteSlug();
    const currentSlug = String(this.panelConfig.remoteAccess?.slug ?? "").trim().toLowerCase();
    while (nextSlug === currentSlug) {
      nextSlug = generateRemoteSlug();
    }
    this.panelConfig.remoteAccess = normalizeRemoteAccessConfig({
      ...this.panelConfig.remoteAccess,
      enabled: true,
      slug: nextSlug,
      lastHeartbeatAt: "",
      lastPublishedAt: "",
    });
    this.panelConfig = await savePanelConfig(this.panelConfig);
    await this.remoteAccess.syncConfig(this.panelConfig.remoteAccess);
    this.appendLog(null, "panel", `Regenerated Remote Access link: ${this.remoteAccess.snapshot().url}.`);
    return this.getState(this.activeServerId);
  }

  async disableRemoteAccess() {
    this.panelConfig.remoteAccess = normalizeRemoteAccessConfig({
      ...this.panelConfig.remoteAccess,
      enabled: false,
      lastHeartbeatAt: "",
      lastPublishedAt: "",
    });
    this.panelConfig = await savePanelConfig(this.panelConfig);
    await this.remoteAccess.syncConfig(this.panelConfig.remoteAccess);
    this.appendLog(null, "panel", "Disabled Remote Access.");
    return this.getState(this.activeServerId);
  }

  assertRemoteSection(sectionId) {
    if (!remoteAccessAllowsSection(this.panelConfig.remoteAccess, sectionId)) {
      throw new Error("That remote panel section is not allowed for this link.");
    }
  }

  assertRemoteAction(actionId) {
    if (!remoteAccessAllowsAction(this.panelConfig.remoteAccess, actionId)) {
      throw new Error("That remote panel action is not allowed for this link.");
    }
  }

  async executeRemoteAccessCommand(type, payload = {}) {
    const serverId = String(payload.serverId ?? this.activeServerId ?? "").trim() || this.activeServerId;
    switch (String(type ?? "").trim()) {
      case "selectServer":
        return this.selectServer(String(payload.serverId ?? "").trim());
      case "createServer":
        this.assertRemoteAction("serverCreateDelete");
        return this.createServer(payload);
      case "deleteServer":
        this.assertRemoteAction("serverCreateDelete");
        return this.deleteServer(String(payload.serverId ?? "").trim());
      case "updateServerProfile":
        this.assertRemoteAction("settingsChanges");
        return this.updateServerProfile(serverId, payload);
      case "startServer":
        this.assertRemoteAction("powerControls");
        return this.startServer(serverId);
      case "stopServer":
        this.assertRemoteAction("powerControls");
        return this.stopServer(serverId);
      case "restartServer":
        this.assertRemoteAction("powerControls");
        return this.restartServer(serverId);
      case "killServer":
        this.assertRemoteAction("powerControls");
        return this.forceKillServer(serverId);
      case "sendCommand":
        this.assertRemoteAction("consoleCommands");
        return this.sendCommand(serverId, payload.command);
      case "playerAction":
        this.assertRemoteAction("playerModeration");
        return this.applyPlayerAction(serverId, payload.playerName, payload.action, payload);
      case "listManagedFiles":
        this.assertRemoteSection("misc");
        return this.listManagedFiles(serverId, payload);
      case "readManagedTextFile":
        this.assertRemoteSection("misc");
        return this.readManagedTextFile(serverId, String(payload.path ?? ""));
      case "downloadManagedFile":
        this.assertRemoteSection("misc");
        return this.downloadManagedFile(serverId, String(payload.path ?? ""));
      case "createManagedFolder":
        this.assertRemoteAction("settingsChanges");
        return this.createManagedFolder(serverId, payload);
      case "uploadManagedFile":
        this.assertRemoteAction("settingsChanges");
        return this.uploadManagedFile(
          serverId,
          String(payload.path ?? ""),
          String(payload.fileName ?? "upload.bin"),
          Buffer.from(String(payload.contentBase64 ?? ""), "base64"),
        );
      case "writeManagedTextFile":
        this.assertRemoteAction("settingsChanges");
        return this.writeManagedTextFile(serverId, payload);
      case "deleteManagedPath":
        this.assertRemoteAction("settingsChanges");
        return this.deleteManagedPath(serverId, String(payload.path ?? ""));
      case "searchInventoryCatalog":
        this.assertRemoteSection("players");
        return this.searchInventoryCatalog(serverId, payload);
      case "getPlayerInventory":
        this.assertRemoteSection("players");
        return this.getPlayerInventory(serverId, payload.playerName, {
          refreshLiveData: Boolean(payload.refreshLiveData),
        });
      case "givePlayerInventoryItem":
        this.assertRemoteAction("playerModeration");
        return this.givePlayerInventoryItem(serverId, payload.playerName, payload);
      case "clearPlayerInventory":
        this.assertRemoteAction("playerModeration");
        return this.clearPlayerInventory(serverId, payload.playerName, payload);
      case "backupCreate":
        this.assertRemoteAction("backupCreate");
        return this.createBackup(serverId, "remote-access");
      case "cloudBackupStatus":
        this.assertRemoteSection("backups");
        return this.getCloudBackupStatus(serverId);
      case "updateCloudBackupSettings":
        this.assertRemoteAction("settingsChanges");
        return this.updateCloudBackupSettings(payload);
      case "issueCloudBackupKey":
        this.assertRemoteAction("settingsChanges");
        return this.issueCloudBackupKey(payload);
      case "rotateCloudBackupKey":
        this.assertRemoteAction("settingsChanges");
        return this.rotateCloudBackupKey();
      case "registerCloudBackupAccount":
        this.assertRemoteAction("settingsChanges");
        return this.registerCloudBackupAccount(payload);
      case "loginCloudBackupAccount":
        this.assertRemoteAction("settingsChanges");
        return this.loginCloudBackupAccount(payload);
      case "logoutCloudBackupAccount":
        this.assertRemoteAction("settingsChanges");
        return this.logoutCloudBackupAccount();
      case "uploadCloudBackup":
        this.assertRemoteAction("backupCreate");
        return this.uploadCloudBackup(serverId);
      case "downloadCloudBackup":
        this.assertRemoteAction("backupRestoreDelete");
        return this.downloadCloudBackup(serverId, payload.backupId);
      case "restoreCloudBackup":
        this.assertRemoteAction("backupRestoreDelete");
        return this.restoreCloudBackup(serverId, payload.backupId);
      case "updateBackupSettings":
        this.assertRemoteAction("settingsChanges");
        return this.updateBackupSettings(serverId, payload);
      case "backupRevert":
        this.assertRemoteAction("backupRestoreDelete");
        return this.restoreLocalBackup(serverId, String(payload.backupName ?? "").trim());
      case "worldSelect":
        this.assertRemoteAction("worldImportDelete");
        return this.setActiveWorld(serverId, payload);
      case "worldRegenerate":
        this.assertRemoteAction("worldImportDelete");
        return this.regenerateWorld(serverId, payload);
      case "importWorldArchive":
        this.assertRemoteAction("worldImportDelete");
        return this.importWorldArchive(
          serverId,
          String(payload.fileName ?? "world.zip"),
          Buffer.from(String(payload.contentBase64 ?? ""), "base64"),
          {
            worldName: payload.worldName,
          },
        );
      case "catalogSearch":
        this.assertRemoteSection("addons");
        return this.searchCatalog(serverId, payload);
      case "catalogInstall":
        this.assertRemoteAction("addonInstallRemove");
        return this.installCatalogProject(serverId, payload);
      case "installAssetFromUrl":
        this.assertRemoteAction("addonInstallRemove");
        return this.installAssetFromUrl(serverId, payload.kind, payload.url, {
          source: "url",
        });
      case "removeAsset":
        this.assertRemoteAction("addonInstallRemove");
        return this.removeAsset(serverId, payload.kind, payload.fileName);
      case "softwareVersions":
        this.assertRemoteSection("software");
        return this.getSoftwareVersions(String(payload.software ?? "purpur"));
      case "softwareInstall":
        this.assertRemoteAction("softwareChanges");
        return this.installServerSoftware(serverId, payload);
      case "updateRuntimeSettings":
        this.assertRemoteAction("settingsChanges");
        return this.updateRuntimeSettings(serverId, payload);
      case "updateServerProperties":
        this.assertRemoteAction("settingsChanges");
        return this.updateServerProperties(serverId, payload);
      case "updateMiscSettings":
        this.assertRemoteAction("settingsChanges");
        return this.updateMiscSettings(serverId, payload);
      default:
        throw new Error("Unsupported remote panel command.");
    }
  }

  async readEula(serverId) {
    const context = this.getServerContext(serverId);
    try {
      const content = await fs.readFile(context.paths.eulaFile, "utf8");
      return content.includes("eula=true");
    } catch {
      return false;
    }
  }

  async setEula(serverId, accepted) {
    const context = this.getServerContext(serverId);
    const value = accepted ? "true" : "false";
    await fs.writeFile(context.paths.eulaFile, `eula=${value}\n`, "utf8");
    this.appendLog(serverId, "panel", `Minecraft EULA set to ${value}.`);
    return this.readEula(serverId);
  }

  async saveContextConfig(context) {
    context.config = await saveServerConfig(context.record.id, context.config);
    return context.config;
  }

  async assertUniquePort(port, excludingServerId = null) {
    const normalizedPort = Number(port);
    if (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535) {
      throw new Error("Server port must be a number between 1 and 65535.");
    }

    for (const [serverId, context] of this.serverContexts.entries()) {
      if (serverId === excludingServerId) {
        continue;
      }

      const currentPort = Number(context.cachedProperties["server-port"] ?? 25565);
      if (currentPort === normalizedPort) {
        throw new Error(`Port ${normalizedPort} is already assigned to "${context.record.name}".`);
      }
    }
  }

  findSuggestedPort(startPort = 25565) {
    const usedPorts = new Set(
      Array.from(this.serverContexts.values()).map((context) =>
        Number(context.cachedProperties["server-port"] ?? 25565),
      ),
    );

    let candidate = Number(startPort) || 25565;
    while (usedPorts.has(candidate)) {
      candidate += 1;
    }
    return candidate;
  }

  findAvailableServerId(baseValue) {
    const baseId = slugifyServerId(baseValue);
    let candidate = baseId;
    let suffix = 2;
    while (this.serverContexts.has(candidate)) {
      candidate = `${baseId}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  async createServer(payload = {}) {
    const name = String(payload.name ?? "").trim();
    if (!name) {
      throw new Error("Server name is required.");
    }

    const serverId = this.findAvailableServerId(name);

    const port = Number(payload.port) || this.findSuggestedPort();
    await this.assertUniquePort(port);

    const now = currentTimestamp();
    const record = {
      id: serverId,
      name,
      description: String(payload.description ?? "").trim(),
      serverDir: path.join(paths.managedServersRootDir, serverId),
      createdAt: now,
      updatedAt: now,
    };

    const sourceConfig = structuredClone(
      this.activeServerId
        ? this.getServerContext(this.activeServerId).config
        : defaultServerConfig,
    );

    const config = {
      ...sourceConfig,
      launcher: {
        ...sourceConfig.launcher,
        javaPath: this.normalizeLauncherJavaPath(
          payload.javaPath ??
            sourceConfig.launcher.javaPath ??
            "java",
          payload.version ?? sourceConfig.install.requestedVersion ?? "latest",
        ),
        minRam: String(payload.minRam ?? sourceConfig.launcher.minRam ?? "2G").trim() || "2G",
        maxRam: String(payload.maxRam ?? sourceConfig.launcher.maxRam ?? "4G").trim() || "4G",
        cpuCores: clampNumber(
          payload.cpuCores ?? sourceConfig.launcher.cpuCores ?? 0,
          0,
          this.getHostResources().cpuCores,
          0,
        ),
        gpuShare: clampNumber(
          payload.gpuShare ?? sourceConfig.launcher.gpuShare ?? 0,
          0,
          100,
          0,
        ),
      },
      install: {
        ...sourceConfig.install,
        software: String(payload.software ?? sourceConfig.install.software ?? "purpur"),
        requestedVersion: String(
          payload.version ?? sourceConfig.install.requestedVersion ?? "latest",
        ),
        installedSoftware: null,
        installedVersion: null,
        installedBuild: null,
      },
      profile: {
        ...sourceConfig.profile,
        name,
        description: String(payload.description ?? "").trim(),
      },
      backups: {
        enabled: Boolean(payload.autoBackups ?? true),
        intervalMinutes: Math.max(5, Number(payload.backupIntervalMinutes ?? 60) || 60),
        maxStorageGb: this.normalizeBackupMaxStorageGb(
          payload.maxBackupStorageGb ??
            sourceConfig.backups?.maxStorageGb ??
            defaultServerConfig.backups.maxStorageGb,
        ),
        lastBackupAt: null,
        lastBackupPath: null,
      },
    };

    this.registry.servers.push(record);
    this.registry.activeServerId = serverId;
    this.registry = await saveServerRegistry(this.registry);
    await saveServerConfig(serverId, config);

    const context = this.buildContext(record, config);
    await this.ensureServerFiles(context);
    this.serverContexts.set(serverId, context);
    this.activeServerId = serverId;

    await this.updateServerProperties(serverId, {
      motd: `Hosted by Local Minecraft Panel - ${name}`,
      "server-port": String(port),
      "level-name": slugifyServerId(payload.levelName || name),
    });

    if (payload.acceptEula !== false) {
      await this.setEula(serverId, true);
    }

    if (Boolean(payload.installNow ?? true)) {
      await this.installServerSoftware(serverId, {
        software: config.install.software,
        requestedVersion: config.install.requestedVersion,
        acceptEula: payload.acceptEula !== false,
      });
    }

    this.appendLog(serverId, "panel", `Created server "${name}" at ${record.serverDir}.`);
    return this.getState(serverId);
  }

  async deleteServer(serverId) {
    if (!this.serverContexts.has(serverId)) {
      throw new Error("The selected server does not exist.");
    }

    if (this.registry.servers.length <= 1) {
      throw new Error("You must keep at least one server in the panel.");
    }

    const context = this.getServerContext(serverId);
    if (context.serverProcess) {
      throw new Error("Stop the server before deleting it.");
    }

    const removableServerRoots = [
      paths.managedServersRootDir,
      paths.serversDir,
      paths.legacyServerDir,
    ];

    const resolvedServerDir = path.resolve(context.paths.serverDir);
    const canRemoveServerDir = removableServerRoots.some((basePath) =>
      pathEqualsOrInside(resolvedServerDir, basePath),
    );

    if (!canRemoveServerDir) {
      throw new Error("This server folder is outside the allowed removable locations.");
    }

    this.serverContexts.delete(serverId);
    this.registry.servers = this.registry.servers.filter((entry) => entry.id !== serverId);

    const fallbackServerId = this.registry.servers[0]?.id ?? null;
    this.activeServerId = this.activeServerId === serverId ? fallbackServerId : this.activeServerId;
    this.registry.activeServerId = this.activeServerId;
    this.registry = await saveServerRegistry(this.registry);

    await Promise.all([
      fs.rm(context.paths.serverDir, { recursive: true, force: true }),
      fs.rm(context.paths.dataDir, { recursive: true, force: true }),
      fs.rm(context.paths.backupsDir, { recursive: true, force: true }),
    ]);

    this.appendLog(
      this.activeServerId,
      "panel",
      `Deleted server "${context.record.name}" and removed its local files.`,
      "warn",
    );

    return this.getState(this.activeServerId);
  }

  async selectServer(serverId) {
    this.getServerContext(serverId);
    this.activeServerId = serverId;
    this.registry.activeServerId = serverId;
    this.registry = await saveServerRegistry(this.registry);
    return this.getState(serverId);
  }

  async updatePlayitSettings(payload) {
    this.panelConfig.playit = {
      ...this.panelConfig.playit,
      autoStart: true,
      agentName:
        String(payload.agentName ?? this.panelConfig.playit.agentName).trim() ||
        this.panelConfig.playit.agentName,
      macDownloadUrl: String(
        payload.macDownloadUrl ?? this.panelConfig.playit.macDownloadUrl ?? "",
      ).trim(),
    };

    this.panelConfig = await savePanelConfig(this.panelConfig);
    this.appendLog(null, "panel", "Updated global playit settings.");
    return this.panelConfig;
  }

  async updateUiSettings(payload = {}) {
    const current = this.panelConfig.ui ?? {};
    const requestedVariant = String(
      payload.variant ?? current.variant ?? "classic",
    )
      .trim()
      .toLowerCase();
    this.panelConfig.ui = {
      ...current,
      variant:
        requestedVariant === "pelican-blueprint"
          ? "pelican-blueprint"
          : "classic",
      hasChosenVariant: Boolean(
        payload.hasChosenVariant ?? current.hasChosenVariant ?? false,
      ),
    };

    this.panelConfig = await savePanelConfig(this.panelConfig);
    this.appendLog(
      null,
      "panel",
      `Updated preferred Releu UI to ${
        this.panelConfig.ui.variant === "pelican-blueprint" ? "Pelican-based New UI" : "Legacy UI"
      }.`,
    );
    return this.panelConfig.ui;
  }

  async updateUpdaterSettings(payload) {
    this.panelConfig.updater = {
      ...this.panelConfig.updater,
      enabled: true,
      autoInstall: true,
      checkIntervalHours: Math.max(
        1,
        Number(payload.checkIntervalHours ?? this.panelConfig.updater.checkIntervalHours ?? 6) || 6,
      ),
      allowPrerelease: Boolean(
        payload.allowPrerelease ?? this.panelConfig.updater.allowPrerelease,
      ),
    };

    this.panelConfig = await savePanelConfig(this.panelConfig);
    this.updater.syncConfig();
    this.appendLog(null, "panel", "Updated Releu app update settings.");
    return this.panelConfig;
  }

  async updateDesktopSettings(payload = {}) {
    const current = this.panelConfig.desktop ?? {};
    this.panelConfig.desktop = {
      ...current,
      keepServerRunningOnClose: Boolean(
        payload.keepServerRunningOnClose ?? current.keepServerRunningOnClose,
      ),
      quickConsoleShortcut:
        String(
          payload.quickConsoleShortcut ?? current.quickConsoleShortcut ?? "",
        ).trim() || current.quickConsoleShortcut || "Ctrl+Shift+Space",
    };

    this.panelConfig = await savePanelConfig(this.panelConfig);
    this.appendLog(null, "panel", "Updated desktop app behavior settings.");
    return this.panelConfig.desktop;
  }

  async updateCloudBackupSettings(payload = {}) {
    const current = getCloudBackupConfig(this.panelConfig);
    this.panelConfig.cloudBackup = {
      ...this.panelConfig.cloudBackup,
      enabled: Boolean(payload.enabled ?? current.enabled),
      provider: "website",
      deviceLabel:
        String(payload.deviceLabel ?? current.deviceLabel ?? "").trim().slice(0, 80) ||
        os.hostname(),
      targetRestoreKey:
        String(payload.targetRestoreKey ?? current.targetRestoreKey ?? "").trim().slice(0, 160),
    };

    this.panelConfig = await savePanelConfig(this.panelConfig);
    this.appendLog(null, "panel", "Updated cloud backup settings.");
    return getPublicCloudBackupConfig(this.panelConfig);
  }

  async getCloudBackupStatus(serverId = this.activeServerId) {
    const cloud = getCloudBackupConfig(this.panelConfig);
    const status = {
      ...getPublicCloudBackupConfig(this.panelConfig),
      configured: true,
      restoreKeyPresent: false,
      restoreKey: "",
      deviceLabel: cloud.deviceLabel || os.hostname(),
      loggedIn: false,
      accountUsername: cloud.accountUsername,
      targetRestoreKey: cloud.targetRestoreKey,
      usingSharedRestoreKey: Boolean(cloud.targetRestoreKey),
      authError: null,
      uploadLimitBytes: Math.max(1, Number(cloud.uploadLimitMb ?? 50) || 50) * 1024 * 1024,
      uploadLimitLabel: "Panel website storage",
      backups: [],
      backupsCount: 0,
      usedBytes: 0,
      latestBackup: null,
      functionReady: false,
      functionError: null,
      targetLabel: "Connected to the panel website",
    };

    try {
      const health = await getWebsiteCloudHealth(this.panelConfig);
      status.functionReady = true;
      if (Number.isFinite(Number(health?.uploadLimitBytes))) {
        status.uploadLimitBytes = Number(health.uploadLimitBytes);
      }
    } catch (error) {
      status.functionError = error.message ?? "Cloud backup website check failed.";
      return status;
    }

    if (!cloud.accountUsername || !cloud.sessionToken) {
      return status;
    }

    try {
      const listing = await listWebsiteCloudBackups(this.panelConfig, { serverId });
      const rawBackups = Array.isArray(listing?.backups) ? listing.backups : [];
      status.loggedIn = true;
      status.accountUsername =
        String(listing?.authenticatedAccount?.username ?? cloud.accountUsername).trim() ||
        cloud.accountUsername;
      status.restoreKey = String(listing?.authenticatedAccount?.restoreKey ?? cloud.restoreKey).trim();
      status.restoreKeyPresent = Boolean(status.restoreKey);
      status.deviceLabel =
        String(listing?.authenticatedAccount?.deviceLabel ?? status.deviceLabel).trim() ||
        status.deviceLabel;
      status.usingSharedRestoreKey = Boolean(listing?.usingSharedRestoreKey);
      status.targetLabel = status.usingSharedRestoreKey
        ? `Using shared backup key from ${listing?.ownerAccount?.username ?? "another account"}`
        : "Connected to the panel website";
      status.backups = buildLogicalCloudBackups(rawBackups);
      status.backupsCount = status.backups.length;
      status.usedBytes = rawBackups.reduce(
        (total, entry) => total + Math.max(0, Number(entry?.size_bytes ?? 0) || 0),
        0,
      );
      status.latestBackup = status.backups[0] ?? null;
    } catch (error) {
      status.authError = error.message ?? "Cloud backup login failed.";
    }

    return status;
  }

  async issueCloudBackupKey(payload = {}) {
    const deviceLabel =
      String(payload.deviceLabel ?? this.panelConfig.cloudBackup.deviceLabel ?? "")
        .trim()
        .slice(0, 80) || os.hostname();
    const result = await issueWebsiteCloudBackupKey(this.panelConfig, { deviceLabel });

    this.panelConfig.cloudBackup = {
      ...this.panelConfig.cloudBackup,
      enabled: true,
      provider: "website",
      deviceLabel,
      restoreKey: String(result.restoreKey ?? "").trim(),
    };
    this.panelConfig = await savePanelConfig(this.panelConfig);
    this.appendLog(null, "panel", "Synced the website cloud backup restore key.");
    return this.getCloudBackupStatus();
  }

  async rotateCloudBackupKey() {
    const current = getCloudBackupConfig(this.panelConfig);
    if (!current.sessionToken || !current.accountUsername) {
      throw new Error("Log in to cloud backup first.");
    }
    const result = await rotateWebsiteCloudRestoreKey(this.panelConfig);

    this.panelConfig.cloudBackup = {
      ...this.panelConfig.cloudBackup,
      provider: "website",
      restoreKey: String(result.restoreKey ?? "").trim(),
      targetRestoreKey:
        this.panelConfig.cloudBackup.targetRestoreKey === current.restoreKey
          ? ""
          : this.panelConfig.cloudBackup.targetRestoreKey,
    };
    this.panelConfig = await savePanelConfig(this.panelConfig);
    this.appendLog(null, "panel", "Rotated the website cloud backup restore key.");
    return this.getCloudBackupStatus();
  }

  async registerCloudBackupAccount(payload = {}) {
    const deviceLabel =
      String(payload.deviceLabel ?? this.panelConfig.cloudBackup.deviceLabel ?? "")
        .trim()
        .slice(0, 80) || os.hostname();
    const result = await registerWebsiteCloudAccount(this.panelConfig, {
      username: payload.username,
      password: payload.password,
      deviceLabel,
    });

    this.panelConfig.cloudBackup = {
      ...this.panelConfig.cloudBackup,
      enabled: true,
      provider: "website",
      deviceLabel,
      accountUsername: String(result.account?.username ?? "").trim().toLowerCase(),
      sessionToken: String(result.sessionToken ?? "").trim(),
      restoreKey: String(result.account?.restoreKey ?? "").trim(),
    };
    this.panelConfig = await savePanelConfig(this.panelConfig);
    this.appendLog(
      null,
      "panel",
      `Created website cloud account ${result.account?.username ?? "account"}.`,
    );
    return this.getCloudBackupStatus();
  }

  async loginCloudBackupAccount(payload = {}) {
    const deviceLabel =
      String(payload.deviceLabel ?? this.panelConfig.cloudBackup.deviceLabel ?? "")
        .trim()
        .slice(0, 80) || os.hostname();
    const result = await loginWebsiteCloudAccount(this.panelConfig, {
      username: payload.username,
      password: payload.password,
      deviceLabel,
    });

    this.panelConfig.cloudBackup = {
      ...this.panelConfig.cloudBackup,
      enabled: true,
      provider: "website",
      deviceLabel,
      accountUsername: String(result.account?.username ?? "").trim().toLowerCase(),
      sessionToken: String(result.sessionToken ?? "").trim(),
      restoreKey: String(result.account?.restoreKey ?? "").trim(),
    };
    this.panelConfig = await savePanelConfig(this.panelConfig);
    this.appendLog(
      null,
      "panel",
      `Logged into website cloud account ${result.account?.username ?? "account"}.`,
    );
    return this.getCloudBackupStatus();
  }

  async logoutCloudBackupAccount() {
    await logoutWebsiteCloudAccount(this.panelConfig).catch(() => false);
    this.panelConfig.cloudBackup = {
      ...this.panelConfig.cloudBackup,
      provider: "website",
      sessionToken: "",
    };
    this.panelConfig = await savePanelConfig(this.panelConfig);
    this.appendLog(null, "panel", "Logged out of the website cloud account.");
    return this.getCloudBackupStatus();
  }

  async listRawCloudBackups(serverId = this.activeServerId) {
    const cloud = getCloudBackupConfig(this.panelConfig);
    if (!cloud.sessionToken || !cloud.accountUsername) {
      return [];
    }
    const listing = await listWebsiteCloudBackups(this.panelConfig, { serverId });
    return Array.isArray(listing?.backups) ? listing.backups : [];
  }

  async resolveCloudBackupSelection(backupId, serverId = this.activeServerId) {
    const rawBackups = await this.listRawCloudBackups(serverId);
    const parsedId = parseLogicalCloudBackupId(backupId);
    if (!parsedId.id) {
      throw new Error("Choose a cloud backup first.");
    }

    const entry = rawBackups.find((candidate) => candidate.id === parsedId.id) ?? null;
    if (!entry) {
      throw new Error("The selected cloud backup no longer exists.");
    }
    return {
      kind: "single",
      entry,
      logicalBackup: {
        ...entry,
        id: `${singleCloudBackupIdPrefix}${entry.id}`,
        logicalKind: "single",
      },
    };
  }

  async uploadCloudBackup(serverId) {
    const context = this.getServerContext(serverId);
    const cloud = getCloudBackupConfig(this.panelConfig);
    if (!cloud.enabled) {
      throw new Error("Enable cloud backup first.");
    }
    if (!cloud.sessionToken || !cloud.accountUsername) {
      throw new Error("Log in to cloud backup first.");
    }

    const cloudStatus = await this.getCloudBackupStatus(serverId);
    if (!cloudStatus.functionReady) {
      throw new Error(cloudStatus.functionError || "Cloud backup website is not ready yet.");
    }
    if (!cloudStatus.loggedIn) {
      throw new Error(cloudStatus.authError || "Log in to cloud backup first.");
    }

    const backupDir = await this.createBackup(serverId, "cloud upload");
    const zipPath = path.join(context.paths.backupsDir, `${path.basename(backupDir)}.zip`);
    try {
      const archive = await createZipArchive(backupDir, zipPath);
      const archiveSha256 = await sha256HexForFile(zipPath);
      const uploaded = await storeWebsiteCloudBackup(this.panelConfig, {
        serverId: context.record.id,
        serverName: context.record.name,
        backupName: path.basename(backupDir),
        sourceArchivePath: zipPath,
        sizeBytes: archive.sizeBytes,
        sha256: archiveSha256,
      });

      this.appendLog(
        serverId,
        "panel",
        `Uploaded cloud backup ${path.basename(backupDir)} to the website storage.`,
      );

      return {
        backupName: path.basename(backupDir),
        sizeBytes: archive.sizeBytes,
        uploaded,
        cloudBackup: await this.getCloudBackupStatus(serverId),
      };
    } finally {
      await fs.rm(zipPath, { force: true }).catch(() => {});
    }
  }

  async downloadCloudBackup(serverId, backupId) {
    const context = this.getServerContext(serverId);
    const cloud = getCloudBackupConfig(this.panelConfig);
    if (!cloud.enabled) {
      throw new Error("Enable cloud backup first.");
    }
    if (!cloud.sessionToken || !cloud.accountUsername) {
      throw new Error("Log in to cloud backup first.");
    }
    if (!String(backupId ?? "").trim()) {
      throw new Error("Choose a cloud backup first.");
    }

    const cloudStatus = await this.getCloudBackupStatus(serverId);
    if (!cloudStatus.functionReady) {
      throw new Error(cloudStatus.functionError || "Cloud backup website is not ready yet.");
    }
    if (!cloudStatus.loggedIn) {
      throw new Error(cloudStatus.authError || "Log in to cloud backup first.");
    }

    const selection = await this.resolveCloudBackupSelection(backupId, serverId);
    const backupName =
      String(selection.logicalBackup?.backup_name ?? backupId).trim() || String(backupId);
    const safeArchiveName = sanitizeAssetFilename(`${backupName}.zip`);
    const tempRoot = path.join(context.paths.dataDir, "cloud-backup-downloads", slugTimestamp());
    const archivePath = path.join(tempRoot, safeArchiveName);
    await fs.mkdir(tempRoot, { recursive: true });

    const backup = await getWebsiteCloudBackup(this.panelConfig, selection.entry.id, { serverId });
    await downloadWebsiteCloudBackupToFile(backup, archivePath);

    const expectedSize = Math.max(
      0,
      Number(backup.sizeBytes ?? backup.size_bytes ?? selection.logicalBackup?.size_bytes ?? 0) || 0,
    );
    if (expectedSize) {
      const archiveStats = await fs.stat(archivePath);
      if (archiveStats.size !== expectedSize) {
        throw new Error("The downloaded cloud backup size does not match the stored metadata.");
      }
    }

    const expectedSha256 = String(backup.sha256 ?? "").trim().toLowerCase();
    if (expectedSha256) {
      const archiveSha256 = await sha256HexForFile(archivePath);
      if (archiveSha256 !== expectedSha256) {
        throw new Error("The downloaded cloud backup failed integrity verification.");
      }
    }

    this.appendLog(
      serverId,
      "panel",
      `Downloaded cloud backup ${backupName} from the website storage.`,
    );

    return {
      archivePath,
      tempRoot,
      backup: selection.logicalBackup,
    };
  }

  async restoreBackupDirectory(serverId, sourceDir, { backupLabel = "selected backup", safetyReason = "pre-restore" } = {}) {
    const context = this.getServerContext(serverId);
    if (context.serverProcess) {
      throw new Error("Stop the server before restoring a backup.");
    }

    const knownFileTargets = new Map([
      ["server.properties", context.paths.serverPropertiesFile],
      ["eula.txt", context.paths.eulaFile],
      ["ops.json", context.paths.opsFile],
      ["whitelist.json", context.paths.whitelistFile],
      ["banned-players.json", context.paths.bannedPlayersFile],
      ["banned-ips.json", context.paths.bannedIpsFile],
      ["usercache.json", context.paths.usercacheFile],
      ["config.json", context.paths.configFile],
      ["asset-index.json", context.paths.assetIndexFile],
      ["player-index.json", context.paths.playerIndexFile],
      ["server-icon.png", path.join(context.paths.dataDir, "server-icon.png")],
    ]);

    if (await this.serverHasBackupContent(context)) {
      await this.createBackup(serverId, safetyReason);
    }

    const entries = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const backupDir = ensureChildPath(sourceDir, path.join(sourceDir, entry.name));
      const targetDir =
        entry.name === "plugins" ||
        entry.name === "mods" ||
        entry.name === "config" ||
        entry.name === "defaultconfigs" ||
        (await fileExists(path.join(backupDir, "level.dat"))) ||
        /_(nether|the_end)$/i.test(entry.name)
          ? ensureChildPath(context.paths.serverDir, path.join(context.paths.serverDir, entry.name))
          : null;
      if (!targetDir) {
        continue;
      }

      await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
      await fs.cp(backupDir, targetDir, { recursive: true });
    }

    for (const [fileName, targetPath] of knownFileTargets.entries()) {
      const sourceFile = ensureChildPath(sourceDir, path.join(sourceDir, fileName));
      if (!(await fileExists(sourceFile))) {
        continue;
      }
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourceFile, targetPath);
    }

    const rootFiles = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
    for (const entry of rootFiles) {
      if (!entry.isFile() || !/\.jar$/i.test(entry.name)) {
        continue;
      }
      await fs.copyFile(
        ensureChildPath(sourceDir, path.join(sourceDir, entry.name)),
        ensureChildPath(context.paths.serverDir, path.join(context.paths.serverDir, entry.name)),
      );
    }

    const restoredProfilePath = ensureChildPath(sourceDir, path.join(sourceDir, "server-profile.json"));
    if (await fileExists(restoredProfilePath)) {
      const restoredProfile = await readJsonFile(restoredProfilePath, null);
      if (restoredProfile && typeof restoredProfile === "object") {
        context.record.name =
          String(restoredProfile.name ?? context.record.name).trim() || context.record.name;
        context.record.description = String(
          restoredProfile.description ?? context.record.description ?? "",
        ).trim();
        context.record.updatedAt = currentTimestamp();
        this.registry.servers = this.registry.servers.map((entry) =>
          entry.id === serverId ? context.record : entry,
        );
        this.registry = await saveServerRegistry(this.registry);
      }
    }

    const restoredServerIcon = path.join(context.paths.dataDir, "server-icon.png");
    if (await fileExists(restoredServerIcon)) {
      await fs.copyFile(
        restoredServerIcon,
        path.join(context.paths.serverDir, "server-icon.png"),
      );
    }

    context.config = await loadServerConfig(serverId);
    context.cachedProperties = await ensureServerPropertyFile(context.paths);
    const effectiveSoftware = context.config.install.installedSoftware ?? context.config.install.software;
    context.state.installMeta = context.config.install.installedVersion
      ? {
          software: effectiveSoftware,
          softwareName: formatSoftwareName(effectiveSoftware),
          version: context.config.install.installedVersion,
          build: context.config.install.installedBuild,
          downloadedTo: (await this.resolveInstalledJar(context)) ?? context.paths.serverJar,
        }
      : null;
    this.appendLog(serverId, "panel", `Restored backup ${backupLabel}.`);
    return {
      restored: {
        name: backupLabel,
      },
    };
  }

  async restoreLocalBackup(serverId, backupName) {
    const context = this.getServerContext(serverId);
    const safeName = path.basename(String(backupName ?? "").trim());
    if (!safeName || safeName === "." || safeName === "..") {
      throw new Error("Choose a backup first.");
    }

    const backupDir = ensureChildPath(
      context.paths.backupsDir,
      path.join(context.paths.backupsDir, safeName),
    );
    const stats = await fs.stat(backupDir).catch(() => null);
    if (!stats?.isDirectory()) {
      throw new Error("The selected backup folder no longer exists.");
    }

    const restored = await this.restoreBackupDirectory(serverId, backupDir, {
      backupLabel: safeName,
      safetyReason: "pre-local-revert",
    });
    return {
      ...restored,
      backups: await this.listBackups(serverId),
    };
  }

  async restoreCloudBackup(serverId, backupId) {
    const download = await this.downloadCloudBackup(serverId, backupId);
    const extractDir = path.join(download.tempRoot, "extracted");

    try {
      await this.extractArchiveToDirectory(download.archivePath, extractDir);
      const restored = await this.restoreBackupDirectory(serverId, extractDir, {
        backupLabel: download.backup?.backup_name ?? String(backupId),
        safetyReason: "pre-cloud-restore",
      });
      return {
        ...restored,
        restored: download.backup ?? { id: backupId },
        cloudBackup: await this.getCloudBackupStatus(serverId),
      };
    } finally {
      await fs.rm(download.tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async checkForAppUpdate() {
    return this.updater.checkForUpdates();
  }

  async markAppUpdateApplying() {
    return this.updater.markApplying();
  }

  async connectPlayit() {
    await this.ensurePlayitInitialized();

    if (!this.playit.snapshot().installed) {
      await this.playit.installBinary();
    }

    if (!this.playit.snapshot().secretConfigured) {
      const playitState = await this.playit.generateClaim(this.panelConfig.playit.agentName);
      this.appendLog(null, "panel", "Generated playit claim link for one-click linking.");
      return {
        action: "claim",
        claimUrl: playitState.claimUrl,
        playit: playitState,
      };
    }

    const playitState = await this.playit.startAgent();
    if (!playitState.secretConfigured) {
      const relinkState = await this.playit.generateClaim(this.panelConfig.playit.agentName);
      this.appendLog(
        null,
        "panel",
        "Saved playit link was invalid. Generated a fresh playit claim link.",
      );
      return {
        action: "claim",
        claimUrl: relinkState.claimUrl,
        playit: relinkState,
      };
    }
    this.appendLog(null, "panel", "Started playit agent from simplified connect flow.");
    return {
      action: playitState.needsWebSetup ? "dashboard" : "started",
      claimUrl: null,
      playit: playitState,
    };
  }

  async updateRuntimeSettings(serverId, payload) {
    const context = this.getServerContext(serverId);
    const hostResources = this.getHostResources();
    context.config.launcher = {
      ...context.config.launcher,
      javaPath: this.normalizeLauncherJavaPath(
        payload.javaPath ?? context.config.launcher.javaPath,
        context.config.install.installedVersion ??
          context.config.install.requestedVersion ??
          null,
      ),
      minRam: String(payload.minRam ?? context.config.launcher.minRam).trim() || "2G",
      maxRam: String(payload.maxRam ?? context.config.launcher.maxRam).trim() || "4G",
      cpuCores: clampNumber(
        payload.cpuCores ?? context.config.launcher.cpuCores ?? 0,
        0,
        hostResources.cpuCores,
        0,
      ),
      gpuShare: clampNumber(
        payload.gpuShare ?? context.config.launcher.gpuShare ?? 0,
        0,
        100,
        0,
      ),
    };

    await this.saveContextConfig(context);
    this.appendLog(serverId, "panel", "Updated server runtime settings.");
    return context.config;
  }

  async updateServerProfile(serverId, payload) {
    const context = this.getServerContext(serverId);
    const nextName = String(payload.name ?? context.record.name).trim();
    if (!nextName) {
      throw new Error("Server name cannot be empty.");
    }
    const nextDescription = String(
      payload.description ?? context.record.description ?? "",
    ).trim();

    context.record.name = nextName;
    context.record.description = nextDescription;
    context.record.updatedAt = currentTimestamp();
    context.config.profile = {
      ...context.config.profile,
      name: nextName,
      description: nextDescription,
    };
    context.config.backups = {
      ...context.config.backups,
      enabled: Boolean(payload.autoBackups ?? context.config.backups.enabled),
      intervalMinutes: Math.max(
        5,
        Number(payload.backupIntervalMinutes ?? context.config.backups.intervalMinutes ?? 60) ||
          60,
      ),
      maxStorageGb: this.normalizeBackupMaxStorageGb(
        payload.maxBackupStorageGb ?? context.config.backups.maxStorageGb,
      ),
    };

    const nextProperties = await readServerProperties(context.paths);
    nextProperties.motd = nextDescription;
    context.cachedProperties = await writeServerProperties(context.paths, nextProperties);

    await this.saveContextConfig(context);
    this.registry.servers = this.registry.servers.map((entry) =>
      entry.id === serverId ? context.record : entry,
    );
    this.registry = await saveServerRegistry(this.registry);
    await this.enforceBackupStorageLimit(context);
    this.appendLog(
      serverId,
      "panel",
      "Saved server profile, backup schedule, and synced the Minecraft MOTD.",
    );
    return this.getState(serverId);
  }

  async updateBackupSettings(serverId, payload = {}) {
    const context = this.getServerContext(serverId);
    context.config.backups = {
      ...context.config.backups,
      enabled: Boolean(payload.autoBackups ?? context.config.backups.enabled),
      intervalMinutes: Math.max(
        5,
        Number(payload.backupIntervalMinutes ?? context.config.backups.intervalMinutes ?? 60) ||
          60,
      ),
      maxStorageGb: this.normalizeBackupMaxStorageGb(
        payload.maxBackupStorageGb ?? context.config.backups.maxStorageGb,
      ),
    };

    await this.saveContextConfig(context);
    const backupStorage = await this.enforceBackupStorageLimit(context);
    this.appendLog(
      serverId,
      "panel",
      `Saved local backup settings. Limit: ${context.config.backups.maxStorageGb} GB, interval: ${context.config.backups.intervalMinutes} minutes, auto backups ${context.config.backups.enabled ? "enabled" : "disabled"}.`,
    );
    return {
      backups: {
        ...context.config.backups,
        totalBytes: backupStorage.totalBytes,
        totalCount: backupStorage.totalCount,
        maxStorageBytes: backupStorage.maxStorageBytes,
        overLimit: backupStorage.overLimit,
      },
    };
  }

  async installServerSoftware(
    serverId,
    { software, requestedVersion = "latest", acceptEula = true } = {},
  ) {
    const context = this.getServerContext(serverId);
    const selectedSoftware = software ?? context.config.install.software ?? "purpur";
    const selectedVersion = requestedVersion ?? "latest";
    const resolvedVersion = await resolveSoftwareVersion(selectedSoftware, selectedVersion);
    const installedVersion =
      context.config.install.installedVersion ?? context.state.installMeta?.version ?? null;
    const worldHasContent = await this.serverHasBackupContent(context);
    if (
      installedVersion &&
      worldHasContent &&
      isPotentialMinecraftDowngrade(installedVersion, resolvedVersion)
    ) {
      throw new Error(
        `This server already has world data from Minecraft ${installedVersion}. Releu will not downgrade that world to ${resolvedVersion} because Minecraft world data is not safely reversible. Create a new server, restore an older backup, or regenerate the world before switching to an older version.`,
      );
    }

    const requiredJavaMajor = getRequiredJavaMajor(resolvedVersion);

    const shouldRepairJavaPath = await this.shouldRepairJavaPath(context.config.launcher.javaPath);
    if (this.shouldAutoManageJavaPath(context.config.launcher.javaPath) || shouldRepairJavaPath) {
      await this.dependencies.ensureJavaMajor(requiredJavaMajor).catch(() => null);
    }

    const installerJavaPath = this.normalizeLauncherJavaPath(
      context.config.launcher.javaPath,
      resolvedVersion,
    );
    this.setServerOperation(context, {
      type: "install",
      title: "Installing Server Software",
      shortLabel: "Installing",
      detail: `Downloading ${selectedSoftware} ${resolvedVersion}.`,
    });

    try {
      if (installedVersion && installedVersion !== resolvedVersion && worldHasContent) {
        await this.createBackup(serverId, "pre-install-version-change");
      }
      this.appendLog(serverId, "panel", `Downloading ${selectedSoftware} (${resolvedVersion})...`);
      const installMeta = await downloadServerJar({
        software: selectedSoftware,
        requestedVersion: resolvedVersion,
        destinationPath: context.paths.serverJar,
        javaPath: installerJavaPath,
      });

      this.setServerOperation(context, {
        type: "install",
        title: "Finalizing Server Install",
        shortLabel: "Finalizing",
        detail: `Saving ${installMeta.softwareName} ${installMeta.version} and updating launcher defaults.`,
      });

      context.state.installMeta = installMeta;
      context.config.install = {
        software: selectedSoftware,
        requestedVersion: resolvedVersion,
        installedSoftware: installMeta.software,
        installedVersion: installMeta.version,
        installedBuild: installMeta.build,
      };

      const preferredJavaPath = this.getPreferredManagedJavaPath(installMeta.version);
      if (
        preferredJavaPath &&
        (this.shouldAutoManageJavaPath(context.config.launcher.javaPath) || shouldRepairJavaPath)
      ) {
        context.config.launcher = {
          ...context.config.launcher,
          javaPath: preferredJavaPath,
        };
      } else if (shouldRepairJavaPath) {
        context.config.launcher = {
          ...context.config.launcher,
          javaPath: "java",
        };
      }

      await this.saveContextConfig(context);
      context.cachedProperties = await ensureServerPropertyFile(context.paths);
      if (acceptEula) {
        await this.setEula(serverId, true);
      }

      this.appendLog(
        serverId,
        "panel",
        `Installed ${installMeta.softwareName} ${installMeta.version} build ${installMeta.build}.`,
      );
      return installMeta;
    } finally {
      this.clearServerOperation(context);
    }
  }

  async getSoftwareVersions(software = "purpur") {
    if (this.versionsCache.has(software)) {
      return this.versionsCache.get(software);
    }

    const versions = await fetchSoftwareVersions(software);
    this.versionsCache.set(software, versions);
    return versions;
  }

  async updateServerProperties(serverId, changes) {
    const context = this.getServerContext(serverId);
    const next = await readServerProperties(context.paths);

    const requestedPort =
      changes?.["server-port"] !== undefined && changes?.["server-port"] !== null
        ? Number(changes["server-port"])
        : Number(next["server-port"] ?? 25565);
    await this.assertUniquePort(requestedPort, serverId);

    for (const [key, value] of Object.entries(changes ?? {})) {
      if (value === undefined || value === null) {
        continue;
      }
      next[key] = String(value);
    }

    if (
      Object.prototype.hasOwnProperty.call(changes ?? {}, "resource-pack") ||
      Object.prototype.hasOwnProperty.call(changes ?? {}, "resource-pack-sha1")
    ) {
      const resourcePackUrl = String(next["resource-pack"] ?? "").trim();
      const resourcePackSha1 = String(next["resource-pack-sha1"] ?? "").trim().toLowerCase();

      if (!resourcePackUrl) {
        next["resource-pack-id"] = "";
      } else {
        const resourcePackIdentitySource = resourcePackSha1 || resourcePackUrl;
        next["resource-pack-id"] = buildDeterministicUuidFromText(resourcePackIdentitySource);
      }
    }

    context.cachedProperties = await writeServerProperties(context.paths, next);
    if (Object.prototype.hasOwnProperty.call(changes ?? {}, "motd")) {
      const nextDescription = String(next.motd ?? "").trim();
      context.record.description = nextDescription;
      context.record.updatedAt = currentTimestamp();
      context.config.profile = {
        ...context.config.profile,
        description: nextDescription,
      };
      await this.saveContextConfig(context);
      this.registry.servers = this.registry.servers.map((entry) =>
        entry.id === serverId ? context.record : entry,
      );
      this.registry = await saveServerRegistry(this.registry);
    }
    this.appendLog(serverId, "panel", "Saved server.properties changes.");
    return context.cachedProperties;
  }

  async applyConfiguredMiscSettings(serverId) {
    const context = this.getServerContext(serverId);
    if (!context.state.serverReady || context.state.serverStatus !== "running") {
      return false;
    }

    const keepInventoryEnabled = Boolean(context.config.misc?.keepInventory);
    const keepInventoryRule = getKeepInventoryGameruleId(
      context.state.install?.installedVersion ?? context.config.install?.installedVersion ?? context.config.install?.requestedVersion,
    );
    await this.sendCommand(
      serverId,
      `gamerule ${keepInventoryRule} ${keepInventoryEnabled ? "true" : "false"}`,
    );
    this.appendLog(
      serverId,
      "panel",
      `Applied ${keepInventoryRule}=${keepInventoryEnabled ? "true" : "false"} from Misc settings.`,
    );

    const sharedHealthEnabled = Boolean(context.config.misc?.sharedHealth);
    if (sharedHealthEnabled) {
      if (hasCompatibleSharedHealthMod(context)) {
        this.appendLog(
          serverId,
          "panel",
          "A compatible shared-health mod is installed. Releu only saves the preference right now; mod-specific shared-health gamerules still need to be configured for that mod.",
        );
      } else {
        this.appendLog(
          serverId,
          "panel",
          "Shared Health is only a Releu preference right now. No compatible shared-health mod was detected on this server.",
        );
      }
    }
    return true;
  }

  async updateMiscSettings(serverId, payload) {
    const context = this.getServerContext(serverId);
    const currentProperties = await readServerProperties(context.paths);
    const allowCrackedClients = parseBooleanInput(
      payload.allowCrackedClients,
      String(currentProperties["online-mode"] ?? "true").toLowerCase() !== "true",
    );
    const previousKeepInventory = Boolean(context.config.misc?.keepInventory);
    const previousSharedHealth = Boolean(context.config.misc?.sharedHealth);

    const whitelist = parseBooleanInput(
      payload.whitelist,
      String(currentProperties["white-list"] ?? "false").toLowerCase() === "true",
    );
    const commandBlocks = parseBooleanInput(
      payload.commandBlocks,
      String(currentProperties["enable-command-block"] ?? "false").toLowerCase() === "true",
    );
    const pvp = parseBooleanInput(
      payload.pvp,
      String(currentProperties.pvp ?? "true").toLowerCase() === "true",
    );
    const allowFlight = parseBooleanInput(
      payload.allowFlight,
      String(currentProperties["allow-flight"] ?? "false").toLowerCase() === "true",
    );
    const hardcore = parseBooleanInput(
      payload.hardcore,
      String(currentProperties.hardcore ?? "false").toLowerCase() === "true",
    );
    const forceGamemode = parseBooleanInput(
      payload.forceGamemode,
      String(currentProperties["force-gamemode"] ?? "false").toLowerCase() === "true",
    );
    const generateStructures = parseBooleanInput(
      payload.generateStructures,
      String(currentProperties["generate-structures"] ?? "true").toLowerCase() === "true",
    );
    const logPlayerIPs = parseBooleanInput(
      payload.logPlayerIPs,
      String(currentProperties["log-ips"] ?? "true").toLowerCase() === "true",
    );
    const allowNether = parseBooleanInput(
      payload.allowNether,
      String(currentProperties["allow-nether"] ?? "true").toLowerCase() === "true",
    );
    const allowEnd = parseBooleanInput(
      payload.allowEnd,
      String(currentProperties["allow-end"] ?? "true").toLowerCase() === "true",
    );
    const showPlayerCount = parseBooleanInput(
      payload.showPlayerCount,
      String(currentProperties["enable-status"] ?? "true").toLowerCase() === "true",
    );
    const hideOnlinePlayers = parseBooleanInput(
      payload.hideOnlinePlayers,
      String(currentProperties["hide-online-players"] ?? "false").toLowerCase() === "true",
    );
    const allowProxyConnections = parseBooleanInput(
      payload.allowProxyConnections,
      String(currentProperties["prevent-proxy-connections"] ?? "false").toLowerCase() !== "true",
    );
    const pauseWhenEmpty = parseBooleanInput(
      payload.pauseWhenEmpty,
      Number.parseInt(String(currentProperties["pause-when-empty-seconds"] ?? "-1"), 10) > 0,
    );
    const playerIdleTimeout = parseIntegerInput(
      payload.playerIdleTimeout,
      parseIntegerInput(currentProperties["player-idle-timeout"], 0, 0),
      0,
    );
    const spawnProtection = parseIntegerInput(
      payload.spawnProtection,
      parseIntegerInput(currentProperties["spawn-protection"], 0, 0),
      0,
    );
    const maxPlayers = parseIntegerInput(
      payload.maxPlayers,
      parseIntegerInput(currentProperties["max-players"], 100, 1),
      1,
    );
    const nextKeepInventory = parseBooleanInput(payload.keepInventory, previousKeepInventory);
    const nextSharedHealth = parseBooleanInput(payload.sharedHealth, previousSharedHealth);
    await this.updateServerProperties(serverId, {
      "online-mode": !allowCrackedClients,
      "white-list": whitelist,
      pvp,
      "allow-flight": allowFlight,
      "enable-command-block": commandBlocks,
      "player-idle-timeout": playerIdleTimeout,
      "spawn-protection": spawnProtection,
      "enable-status": showPlayerCount,
      "hide-online-players": hideOnlinePlayers,
      "allow-nether": allowNether,
      "allow-end": allowEnd,
      "force-gamemode": forceGamemode,
      "generate-structures": generateStructures,
      "log-ips": logPlayerIPs,
      "pause-when-empty-seconds": normalizePauseWhenEmptySeconds(
        pauseWhenEmpty,
        currentProperties["pause-when-empty-seconds"],
      ),
      "prevent-proxy-connections": !allowProxyConnections,
      "max-players": maxPlayers,
      hardcore,
    });

    if (hasPath(path.join(context.paths.serverDir, "bukkit.yml"))) {
      await writeBukkitAllowEndSetting(context, allowEnd);
      context.cachedProperties["allow-end"] = String(allowEnd);
    }

    context.config.misc = {
      ...context.config.misc,
      keepInventory: nextKeepInventory,
      sharedHealth: nextSharedHealth,
    };
    await this.saveContextConfig(context);

    if (
      (previousKeepInventory !== nextKeepInventory || previousSharedHealth !== nextSharedHealth) &&
      context.state.serverReady &&
      context.state.serverStatus === "running"
    ) {
      await this.applyConfiguredMiscSettings(serverId);
    } else if (previousKeepInventory !== nextKeepInventory) {
      this.appendLog(
        serverId,
        "panel",
        "Saved keep inventory preference. Releu will apply it the next time the server is running.",
      );
    }

    if (previousSharedHealth !== nextSharedHealth) {
      this.appendLog(
        serverId,
        "panel",
        nextSharedHealth
          ? hasCompatibleSharedHealthMod(context)
            ? "Saved shared health preference. A compatible shared-health mod was detected, but Releu does not yet auto-configure that mod's own gamerules."
            : "Saved shared health preference, but no compatible shared-health mod is installed on this server."
          : "Saved shared health preference: disabled.",
      );
    }

    return this.getState(serverId);
  }

  async inspectJavaRuntime(javaPath) {
    return new Promise((resolve, reject) => {
      const child = spawn(javaPath, ["-version"], withHiddenConsole());

      let output = "";
      let settled = false;

      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });

      child.on("exit", () => {
        if (settled) {
          return;
        }
        settled = true;
        const versionMatch =
          output.match(/version "([^"]+)"/i) ?? output.match(/openjdk ([^\s"]+)/i);
        const version = versionMatch?.[1] ?? null;
        const major = version ? Number(version.split(/[._+-]/)[0]) : null;
        resolve({
          raw: sanitizeLogLine(output),
          version,
          major,
        });
      });
    });
  }

  async startServer(serverId, options = {}) {
    const context = this.getServerContext(serverId);
    if (context.serverProcess) {
      return this.getState(serverId);
    }

    const safeMode = Boolean(options.safeMode);

    await this.syncDetectedInstalledSoftware(context);

    const launchTarget = await this.resolveLaunchTarget(context);
    if (!launchTarget) {
      throw new Error("No server runtime is installed yet.");
    }

    if (!(await this.readEula(serverId))) {
      throw new Error("You must accept the Minecraft EULA before starting the server.");
    }

    await this.validateServerStartup(context);

    const installedVersion =
      context.config.install.installedVersion ?? context.state.installMeta?.version ?? null;
    const installedSoftwareLabel =
      context.state.installMeta?.softwareName ??
      formatSoftwareName(context.config.install.installedSoftware) ??
      "This server";
    const requiredJavaMajor = getRequiredJavaMajor(installedVersion);

    const shouldRepairJavaPath = await this.shouldRepairJavaPath(context.config.launcher.javaPath);
    if (this.shouldAutoManageJavaPath(context.config.launcher.javaPath) || shouldRepairJavaPath) {
      await this.dependencies.ensureJavaMajor(requiredJavaMajor).catch(() => null);
      const nextJavaPath = this.normalizeLauncherJavaPath(
        context.config.launcher.javaPath,
        installedVersion,
      );
      if (nextJavaPath && context.config.launcher.javaPath !== nextJavaPath) {
        context.config.launcher = {
          ...context.config.launcher,
          javaPath: nextJavaPath,
        };
        await this.saveContextConfig(context);
      }
    }

    const launchJavaPath =
      String(context.config.launcher.javaPath ?? "").trim() || "java";
    const javaRuntime = await this.inspectJavaRuntime(launchJavaPath);
    if (!javaRuntime.major) {
      throw new Error(
        `Could not determine the Java version for "${launchJavaPath}".`,
      );
    }

    if (javaRuntime.major < requiredJavaMajor) {
      throw new Error(
        `${installedSoftwareLabel} ${installedVersion ?? ""}`.trim() +
          ` requires Java ${requiredJavaMajor} or newer. Current launcher is ${javaRuntime.version}. Update the Java path in the selected server settings.`,
      );
    }

    context.cachedProperties = await readServerProperties(context.paths);
    context.pendingSafeModeRecovery = false;
    context.pendingDowngradeWorldFailure = false;
    context.startingWithSafeMode = safeMode;
    const args = [
      `-Xms${context.config.launcher.minRam}`,
      `-Xmx${context.config.launcher.maxRam}`,
    ];

    if (Number(context.config.launcher.cpuCores) > 0) {
      args.push(`-XX:ActiveProcessorCount=${Number(context.config.launcher.cpuCores)}`);
    }

    if (launchTarget.mode === "argfile") {
      const relativeArgsPath = path
        .relative(context.paths.serverDir, launchTarget.argFile)
        .replaceAll("\\", "/");
      args.push(`@${relativeArgsPath}`);
      if (safeMode) {
        args.push("--safeMode");
      }
      args.push("nogui");
    } else {
      args.push("-jar", path.basename(launchTarget.jarPath));
      if (safeMode) {
        args.push("--safeMode");
      }
      args.push("--nogui");
    }

    const child = spawn(launchJavaPath, args, {
      cwd: context.paths.serverDir,
      ...withHiddenConsole(),
    });

    context.serverProcess = child;
    context.state.serverStatus = "starting";
    context.state.serverReady = false;
    context.state.serverPid = child.pid;
    context.state.resourceMetrics = await this.refreshServerMetrics(context);
    context.state.lastStartedAt = currentTimestamp();
    context.state.lastExitCode = null;
    this.appendLog(
      serverId,
      "panel",
      `Starting Minecraft server with ${launchJavaPath}${safeMode ? " in safe mode" : ""}.`,
    );

    const handleOutput = (source, chunk) => {
      for (const rawLine of String(chunk).split(/\r?\n/)) {
        const cleaned = sanitizeLogLine(rawLine);
        if (!cleaned) {
          continue;
        }

        this.appendLog(serverId, source, cleaned);
        this.handleServerLine(serverId, cleaned);
      }
    };

    child.stdout.on("data", (chunk) => handleOutput("server", chunk));
    child.stderr.on("data", (chunk) => handleOutput("server", chunk));

    child.on("error", (error) => {
      this.appendLog(serverId, "panel", error.message, "error");
    });

    child.on("exit", async (code) => {
      const shouldRetryInSafeMode =
        context.pendingSafeModeRecovery && !context.startingWithSafeMode && !context.restartRequested;
      context.serverProcess = null;
      context.state.serverStatus = "stopped";
      context.state.serverReady = false;
      context.state.serverPid = null;
      context.state.lastStoppedAt = currentTimestamp();
      context.state.lastExitCode = code;
      context.onlinePlayers.clear();
      context.state.playerCount = 0;
      await this.refreshServerMetrics(context);
      this.appendLog(
        serverId,
        "panel",
        `Minecraft server exited with code ${code ?? "unknown"}.`,
      );

      if (shouldRetryInSafeMode) {
        context.pendingSafeModeRecovery = false;
        this.appendLog(
          serverId,
          "panel",
          "Detected a datapack or worldgen startup failure. Retrying once with --safeMode.",
          "warn",
        );
        await this.startServer(serverId, { safeMode: true });
        return;
      }

      if (context.pendingDowngradeWorldFailure) {
        this.appendLog(
          serverId,
          "panel",
          `This world appears to have been opened in a newer Minecraft version than ${installedVersion ?? "the currently installed server"}. Restore an older backup, switch back to a matching newer version, or regenerate the world before starting again.`,
          "error",
        );
      }

      if (context.restartRequested) {
        context.restartRequested = false;
        await this.startServer(serverId);
      }
    });

    await this.ensurePlayitInitialized();
    if (this.playit.snapshot().secretConfigured) {
      try {
        await this.playit.startAgent();
      } catch (error) {
        this.appendLog(serverId, "playit", error.message, "warn");
      }
    }

    return this.getState(serverId);
  }

  async stopServer(serverId) {
    const context = this.getServerContext(serverId);
    if (!context.serverProcess) {
      return this.getState(serverId);
    }

    context.state.serverStatus = "stopping";
    await this.sendCommand(serverId, "stop");
    return this.getState(serverId);
  }

  async restartServer(serverId) {
    const context = this.getServerContext(serverId);
    if (!context.serverProcess) {
      return this.startServer(serverId);
    }

    context.restartRequested = true;
    await this.stopServer(serverId);
    return this.getState(serverId);
  }

  async forceKillServer(serverId) {
    const context = this.getServerContext(serverId);
    if (!context.serverProcess) {
      return this.getState(serverId);
    }

    context.restartRequested = false;
    context.serverProcess.kill();
    context.serverProcess = null;
    context.state.serverStatus = "stopped";
    context.state.serverReady = false;
    context.state.serverPid = null;
    context.onlinePlayers.clear();
    context.state.playerCount = 0;
    await this.refreshServerMetrics(context);
    this.appendLog(serverId, "panel", "Force-killed the Minecraft server process.", "warn");
    return this.getState(serverId);
  }

  async sendCommand(serverId, command) {
    const context = this.getServerContext(serverId);
    const normalized = String(command ?? "").trim();
    if (!normalized) {
      throw new Error("A command is required.");
    }

    if (!context.serverProcess?.stdin) {
      throw new Error("The selected Minecraft server is not running.");
    }

    context.serverProcess.stdin.write(`${normalized}\n`);
    this.appendLog(serverId, "panel", `> ${normalized}`);
    return true;
  }

  handleServerLine(serverId, line) {
    const context = this.getServerContext(serverId);
    const payload = pickLinePayload(line);

    if (payload.includes("Done (") && payload.includes("For help")) {
      context.state.serverStatus = "running";
      context.state.serverReady = true;
      this.markInstalledAssetsLoaded(serverId).catch(() => {});
      this.applyConfiguredMiscSettings(serverId).catch(() => {});
      if (this.playit.snapshot().secretConfigured) {
        this.playit.refreshTunnels({ force: true }).catch(() => {});
      }
    }

    const uuidMatch = payload.match(/^UUID of player (.+?) is ([0-9a-f-]+)$/i);
    if (uuidMatch) {
      this.rememberPlayer(serverId, uuidMatch[1], { uuid: uuidMatch[2] }).catch(() => {});
    }

    const joinedMatch = payload.match(/^(.+?) joined the game$/);
    if (joinedMatch) {
      const player = normalizePlayerName(joinedMatch[1]);
      context.onlinePlayers.add(player);
      context.state.playerCount = context.onlinePlayers.size;
      this.rememberPlayer(serverId, player, { lastSeenAt: currentTimestamp() }).catch(() => {});
    }

    const leftMatch = payload.match(/^(.+?) left the game$/);
    if (leftMatch) {
      const player = normalizePlayerName(leftMatch[1]);
      context.onlinePlayers.delete(player);
      context.state.playerCount = context.onlinePlayers.size;
      this.rememberPlayer(serverId, player, { lastSeenAt: currentTimestamp() }).catch(
        () => {},
      );
    }

    const gamemodeMatch =
      payload.match(/^Set (.+?)'s game mode to (.+?) Mode$/i) ??
      payload.match(/^Set game mode of (.+?) to (.+?)$/i) ??
      payload.match(/^Set gamemode of (.+?) to (.+?)$/i);
    if (gamemodeMatch) {
      const player = normalizePlayerName(gamemodeMatch[1]);
      const gamemode = normalizeGamemode(gamemodeMatch[2]);
      if (gamemode) {
        this.rememberPlayer(serverId, player, {
          gamemode,
          lastSeenAt: currentTimestamp(),
        }).catch(() => {});
      }
    }

    if (
      payload.includes("Failed to load datapacks, can't proceed with server load") ||
      payload.includes("No key dimensions in MapLike[{}]; No key seed in MapLike[{}]")
    ) {
      context.pendingSafeModeRecovery = true;
    }

    if (payload.includes("Server attempted to load chunk saved with newer version of minecraft")) {
      context.pendingDowngradeWorldFailure = true;
    }
  }

  async serverHasBackupContent(context) {
    if (await this.hasInstalledJar(context)) {
      return true;
    }

    if (await fileExists(context.paths.serverPropertiesFile)) {
      return true;
    }

    const levelName = context.cachedProperties["level-name"] || "world";
    for (const worldName of [levelName, `${levelName}_nether`, `${levelName}_the_end`, "world"]) {
      if (await fileExists(path.join(context.paths.serverDir, worldName))) {
        return true;
      }
    }

    return false;
  }

  async createBackup(serverId, reason = "manual") {
    const context = this.getServerContext(serverId);
    if (context.backupInProgress) {
      throw new Error("A backup is already running for this server.");
    }

    if (!(await this.serverHasBackupContent(context))) {
      throw new Error("There is no server data to back up yet.");
    }

    context.cachedProperties = await readServerProperties(context.paths);
    const levelName = context.cachedProperties["level-name"] || "world";
    const backupName = `${slugTimestamp()}-${levelName}`;
    const targetDir = path.join(context.paths.backupsDir, backupName);
    const candidateWorlds = new Set([
      levelName,
      "world",
      `${levelName}_nether`,
      `${levelName}_the_end`,
    ]);

    context.backupInProgress = true;
    let saveDisabled = false;

    try {
      if (context.serverProcess) {
        await this.sendCommand(serverId, "save-off");
        saveDisabled = true;
        await wait(350);
        await this.sendCommand(serverId, "save-all flush");
        await wait(1400);
      }

      await fs.mkdir(targetDir, { recursive: true });

      for (const worldName of candidateWorlds) {
        const source = path.join(context.paths.serverDir, worldName);
        if (await fileExists(source)) {
          await copyDirectoryForBackup(source, path.join(targetDir, worldName));
        }
      }

      for (const filePath of [
        context.paths.serverPropertiesFile,
        context.paths.eulaFile,
        context.paths.opsFile,
        context.paths.whitelistFile,
        context.paths.bannedPlayersFile,
        context.paths.bannedIpsFile,
        context.paths.usercacheFile,
        context.paths.configFile,
        context.paths.assetIndexFile,
        context.paths.playerIndexFile,
      ]) {
        if (await fileExists(filePath)) {
          await fs.copyFile(filePath, path.join(targetDir, path.basename(filePath)));
        }
      }

      const installedJar = await this.resolveInstalledJar(context);
      if (installedJar) {
        await fs.copyFile(installedJar, path.join(targetDir, path.basename(installedJar)));
      }

      if (await fileExists(context.paths.pluginsDir)) {
        await copyDirectoryForBackup(context.paths.pluginsDir, path.join(targetDir, "plugins"));
      }

      if (await fileExists(context.paths.modsDir)) {
        await copyDirectoryForBackup(context.paths.modsDir, path.join(targetDir, "mods"));
      }

      for (const optionalDir of ["config", "defaultconfigs"]) {
        const sourceDir = path.join(context.paths.serverDir, optionalDir);
        if (await fileExists(sourceDir)) {
          await copyDirectoryForBackup(sourceDir, path.join(targetDir, optionalDir));
        }
      }

      const icon = await this.getServerIconInfo(serverId);
      if (icon?.path && (await fileExists(icon.path))) {
        await fs.copyFile(icon.path, path.join(targetDir, "server-icon.png"));
      }

      await writeJsonFile(path.join(targetDir, "server-profile.json"), {
        id: context.record.id,
        name: context.record.name,
        description: context.record.description ?? "",
        backedUpAt: currentTimestamp(),
      });
    } finally {
      if (saveDisabled && context.serverProcess) {
        try {
          await this.sendCommand(serverId, "save-on");
        } catch {
          // Ignore cleanup failures after the backup copy finished.
        }
      }
      context.backupInProgress = false;
    }

    context.config.backups.lastBackupAt = currentTimestamp();
    context.config.backups.lastBackupPath = targetDir;
    await this.saveContextConfig(context);
    await this.enforceBackupStorageLimit(context, {
      preserveBackupNames: [backupName],
    });
    this.appendLog(serverId, "panel", `Created ${reason} backup: ${targetDir}`);
    return targetDir;
  }

  async listWorlds(serverId) {
    const context = this.getServerContext(serverId);
    context.cachedProperties = await readServerProperties(context.paths);

    const activeWorldName = context.cachedProperties["level-name"] || "world";
    const names = new Set([activeWorldName, "world"]);
    const entries = await fs.readdir(context.paths.serverDir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const levelDatPath = path.join(context.paths.serverDir, entry.name, "level.dat");
      if (await fileExists(levelDatPath)) {
        names.add(entry.name);
      }
    }

    const worlds = [];
    for (const worldName of names) {
      const basePath = ensureChildPath(context.paths.serverDir, path.join(context.paths.serverDir, worldName));
      const netherPath = ensureChildPath(
        context.paths.serverDir,
        path.join(context.paths.serverDir, `${worldName}_nether`),
      );
      const endPath = ensureChildPath(
        context.paths.serverDir,
        path.join(context.paths.serverDir, `${worldName}_the_end`),
      );

      const exists = await fileExists(basePath);
      const netherExists = await fileExists(netherPath);
      const endExists = await fileExists(endPath);
      const stats = exists ? await fs.stat(basePath) : null;

      worlds.push({
        name: worldName,
        path: basePath,
        isActive: worldName === activeWorldName,
        exists,
        netherExists,
        endExists,
        lastModifiedAt: stats?.mtime?.toISOString?.() ?? null,
      });
    }

    worlds.sort((left, right) => {
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }
      if (left.exists !== right.exists) {
        return left.exists ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    return worlds;
  }

  async setActiveWorld(serverId, payload = {}) {
    const context = this.getServerContext(serverId);
    if (context.serverProcess) {
      throw new Error("Stop the server before switching the active world.");
    }

    const worldName = normalizeWorldName(payload.name);
    const nextProperties = {
      "level-name": worldName,
    };
    if (Object.hasOwn(payload, "seed") || Object.hasOwn(payload, "levelSeed")) {
      nextProperties["level-seed"] = String(payload.seed ?? payload.levelSeed ?? "").trim();
    }
    await this.updateServerProperties(serverId, nextProperties);
    this.appendLog(serverId, "panel", `Selected world "${worldName}" as the active server world.`);
    return this.getState(serverId);
  }

  async buildArchivedWorldName(context, worldName, suffix = "pre-regen") {
    const baseName = normalizeWorldName(`${worldName}-${suffix}-${slugTimestamp()}`);
    let candidate = baseName;
    let attempt = 2;

    while (
      await fileExists(path.join(context.paths.serverDir, candidate)) ||
      await fileExists(path.join(context.paths.serverDir, `${candidate}_nether`)) ||
      await fileExists(path.join(context.paths.serverDir, `${candidate}_the_end`))
    ) {
      candidate = normalizeWorldName(`${baseName}-${attempt}`);
      attempt += 1;
    }

    return candidate;
  }

  async archiveWorldFamily(context, worldName, suffix = "pre-regen") {
    const archiveName = await this.buildArchivedWorldName(context, worldName, suffix);
    const folderPairs = [
      [worldName, archiveName],
      [`${worldName}_nether`, `${archiveName}_nether`],
      [`${worldName}_the_end`, `${archiveName}_the_end`],
    ];

    let movedAny = false;
    for (const [fromName, toName] of folderPairs) {
      const sourceDir = ensureChildPath(
        context.paths.serverDir,
        path.join(context.paths.serverDir, fromName),
      );
      if (!(await fileExists(sourceDir))) {
        continue;
      }
      const targetDir = ensureChildPath(
        context.paths.serverDir,
        path.join(context.paths.serverDir, toName),
      );
      await fs.rename(sourceDir, targetDir);
      movedAny = true;
    }

    return movedAny ? archiveName : null;
  }

  async regenerateWorld(serverId, payload = {}) {
    const context = this.getServerContext(serverId);
    if (context.serverProcess) {
      throw new Error("Stop the server before regenerating a world.");
    }

    context.cachedProperties = await readServerProperties(context.paths);
    const worldName = normalizeWorldName(
      payload.name ?? context.cachedProperties["level-name"] ?? "world",
    );

    const nextProperties = {
      "level-name": worldName,
    };
    if (Object.hasOwn(payload, "seed") || Object.hasOwn(payload, "levelSeed")) {
      nextProperties["level-seed"] = String(payload.seed ?? payload.levelSeed ?? "").trim();
    }
    await this.updateServerProperties(serverId, nextProperties);

    const archivedWorldName = await this.archiveWorldFamily(context, worldName);
    if (archivedWorldName) {
      this.appendLog(
        serverId,
        "panel",
        `Archived the previous "${worldName}" world as "${archivedWorldName}" before regeneration.`,
      );
    }

    this.appendLog(
      serverId,
      "panel",
      `Prepared world "${worldName}" for regeneration. It will generate on the next server start.`,
    );
    return this.getState(serverId);
  }

  async resolveWorldImportRoot(sourcePath) {
    const sourceDir = path.resolve(String(sourcePath ?? "").trim());
    if (!sourceDir) {
      throw new Error("A source world path is required.");
    }

    const stats = await fs.stat(sourceDir).catch(() => null);
    if (!stats?.isDirectory()) {
      throw new Error("The selected world source must be a folder.");
    }

    if (await fileExists(path.join(sourceDir, "level.dat"))) {
      return {
        rootDir: sourceDir,
        sourceName: path.basename(sourceDir),
        siblingBaseDir: path.dirname(sourceDir),
      };
    }

    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidateDir = path.join(sourceDir, entry.name);
      if (await fileExists(path.join(candidateDir, "level.dat"))) {
        candidates.push(candidateDir);
      }
    }

    if (candidates.length !== 1) {
      throw new Error(
        "Choose a world folder directly, or a folder that contains exactly one world folder with level.dat.",
      );
    }

    return {
      rootDir: candidates[0],
      sourceName: path.basename(candidates[0]),
      siblingBaseDir: sourceDir,
    };
  }

  async extractArchiveToDirectory(archivePath, targetDir) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(targetDir, { recursive: true });
    await extractZip(archivePath, {
      dir: targetDir,
    });
    return true;
  }

  async importResolvedWorld(serverId, sourcePath, payload = {}) {
    const context = this.getServerContext(serverId);
    if (context.serverProcess) {
      throw new Error("Stop the server before importing a world.");
    }

    const resolvedSource = path.resolve(String(sourcePath ?? "").trim());
    if (!resolvedSource) {
      throw new Error("A valid world source path is required.");
    }

    const serverDir = path.resolve(context.paths.serverDir);
    if (
      resolvedSource === serverDir ||
      resolvedSource.startsWith(`${serverDir}${path.sep}`)
    ) {
      throw new Error("Choose a world source outside this server folder.");
    }

    const { rootDir, sourceName, siblingBaseDir } = await this.resolveWorldImportRoot(
      resolvedSource,
    );
    const targetWorldName = normalizeWorldName(payload.worldName || sourceName);
    const targetPaths = [
      ensureChildPath(context.paths.serverDir, path.join(context.paths.serverDir, targetWorldName)),
      ensureChildPath(
        context.paths.serverDir,
        path.join(context.paths.serverDir, `${targetWorldName}_nether`),
      ),
      ensureChildPath(
        context.paths.serverDir,
        path.join(context.paths.serverDir, `${targetWorldName}_the_end`),
      ),
    ];

    const shouldBackup =
      (await fileExists(targetPaths[0])) ||
      (await fileExists(targetPaths[1])) ||
      (await fileExists(targetPaths[2]));
    if (shouldBackup && (await this.serverHasBackupContent(context))) {
      await this.createBackup(serverId, "pre-world-import");
    }

    for (const targetPath of targetPaths) {
      if (await fileExists(targetPath)) {
        await fs.rm(targetPath, { recursive: true, force: true });
      }
    }

    await fs.cp(rootDir, targetPaths[0], { recursive: true });

    const companionTargets = [
      ["_nether", targetPaths[1]],
      ["_the_end", targetPaths[2]],
    ];
    for (const [suffix, targetPath] of companionTargets) {
      const sourceCompanion = path.join(siblingBaseDir, `${sourceName}${suffix}`);
      if (await fileExists(sourceCompanion)) {
        await fs.cp(sourceCompanion, targetPath, { recursive: true });
      }
    }

    if (payload.activate !== false) {
      await this.updateServerProperties(serverId, {
        "level-name": targetWorldName,
      });
    }

    this.appendLog(
      serverId,
      "panel",
      `Imported world "${targetWorldName}" from ${resolvedSource}.`,
    );
    return {
      worldName: targetWorldName,
      sourcePath: resolvedSource,
      activated: payload.activate !== false,
    };
  }

  async importWorldFolder(serverId, payload = {}) {
    const sourcePath = String(payload.sourcePath ?? "").trim();
    if (!sourcePath) {
      throw new Error("A local world folder path is required.");
    }

    await this.importResolvedWorld(serverId, sourcePath, payload);
    return this.getState(serverId);
  }

  async importWorldArchive(serverId, fileName, bytes, payload = {}) {
    const safeName = sanitizeAssetFilename(fileName);
    if (!/\.(zip|mcworld)$/i.test(safeName)) {
      throw new Error("World upload must be a .zip or .mcworld archive.");
    }

    const context = this.getServerContext(serverId);
    const tempRoot = path.join(context.paths.dataDir, "imports", slugTimestamp());
    const archivePath = path.join(tempRoot, safeName);
    const extractDir = path.join(tempRoot, "extracted");

    await fs.mkdir(extractDir, { recursive: true });
    await fs.writeFile(archivePath, Buffer.from(bytes));

    try {
      await this.extractArchiveToDirectory(archivePath, extractDir);
      await this.importResolvedWorld(serverId, extractDir, {
        ...payload,
        worldName: payload.worldName || trimArchiveExtension(safeName),
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }

    return this.getState(serverId);
  }

  startBackupScheduler() {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
    }

    this.backupTimer = setInterval(() => {
      this.runScheduledBackups().catch((error) => {
        this.appendLog(null, "panel", error.message ?? "Scheduled backup failed.", "error");
      });
    }, 60_000);
  }

  async shutdown() {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
    }

    await this.playit.stopAgent().catch(() => {});
    await this.remoteAccess.shutdown().catch(() => {});
  }

  async runScheduledBackups() {
    for (const [serverId, context] of this.serverContexts.entries()) {
      if (!context.config.backups.enabled || context.backupInProgress) {
        continue;
      }

      const intervalMs =
        Math.max(5, Number(context.config.backups.intervalMinutes ?? 60) || 60) * 60_000;
      const lastBackupTime =
        Date.parse(context.config.backups.lastBackupAt ?? context.record.createdAt ?? currentTimestamp()) ||
        0;

      if (Date.now() - lastBackupTime < intervalMs) {
        continue;
      }

      if (!(await this.serverHasBackupContent(context))) {
        continue;
      }

      try {
        await this.createBackup(serverId, "scheduled");
      } catch (error) {
        this.appendLog(serverId, "panel", error.message, "error");
      }
    }
  }

  async loadPlayerIndex(serverId) {
    const context = this.getServerContext(serverId);
    return readJsonFile(context.paths.playerIndexFile, {});
  }

  async savePlayerIndex(serverId, index) {
    const context = this.getServerContext(serverId);
    await writeJsonFile(context.paths.playerIndexFile, index);
  }

  async loadAssetIndex(serverId) {
    const context = this.getServerContext(serverId);
    const index = normalizeAssetIndex(
      await readJsonFile(context.paths.assetIndexFile, emptyAssetIndex()),
    );
    await writeJsonFile(context.paths.assetIndexFile, index);
    return index;
  }

  async saveAssetIndex(serverId, index) {
    const context = this.getServerContext(serverId);
    const normalized = normalizeAssetIndex(index);
    await writeJsonFile(context.paths.assetIndexFile, normalized);
    return normalized;
  }

  getServerSoftwareOption(context) {
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    return (
      serverSoftwareOptions.find(
        (entry) =>
          entry.id === effectiveSoftware,
      ) ?? null
    );
  }

  getDetectedServerSoftwareId(context) {
    const serverDir = context.paths.serverDir;
    if (
      hasPath(path.join(serverDir, "libraries", "net", "neoforged", "neoforge")) ||
      hasPath(path.join(serverDir, "neoforge.mods.toml"))
    ) {
      return "neoforge";
    }

    if (
      hasPath(path.join(serverDir, "libraries", "net", "minecraftforge", "forge")) ||
      hasPath(path.join(serverDir, "forge-server-launcher.jar"))
    ) {
      return "forge";
    }

    if (
      hasPath(path.join(serverDir, ".fabric", "server")) ||
      hasPath(path.join(serverDir, "libraries", "net", "fabricmc", "fabric-loader"))
    ) {
      return "fabric";
    }

    if (hasPath(path.join(serverDir, "purpur.yml"))) {
      return "purpur";
    }

    if (
      hasPath(path.join(serverDir, "paper.yml")) ||
      hasPath(path.join(serverDir, "paper-global.yml")) ||
      hasPath(path.join(serverDir, "config", "paper-global.yml"))
    ) {
      return "paper";
    }

    return null;
  }

  serverLooksLikeSoftware(context, softwareId) {
    const serverDir = context.paths.serverDir;
    switch (softwareId) {
      case "purpur":
        return hasPath(path.join(serverDir, "purpur.yml"));
      case "paper":
        return (
          !hasPath(path.join(serverDir, "purpur.yml")) &&
          (
            hasPath(path.join(serverDir, "paper.yml")) ||
            hasPath(path.join(serverDir, "paper-global.yml")) ||
            hasPath(path.join(serverDir, "config", "paper-global.yml"))
          )
        );
      case "fabric":
        return (
          hasPath(path.join(serverDir, ".fabric", "server")) ||
          hasPath(path.join(serverDir, "libraries", "net", "fabricmc", "fabric-loader"))
        );
      case "forge":
        return (
          hasPath(path.join(serverDir, "forge-server-launcher.jar")) ||
          hasPath(path.join(serverDir, "libraries", "net", "minecraftforge", "forge"))
        );
      case "neoforge":
        return (
          hasPath(path.join(serverDir, "neoforge.mods.toml")) ||
          hasPath(path.join(serverDir, "libraries", "net", "neoforged", "neoforge"))
        );
      default:
        return false;
    }
  }

  getEffectiveServerSoftwareId(context) {
    return (
      context.config.install.installedSoftware ??
      this.getDetectedServerSoftwareId(context) ??
      context.config.install.software ??
      "vanilla"
    );
  }

  async syncDetectedInstalledSoftware(context) {
    const detectedSoftware = this.getDetectedServerSoftwareId(context);
    if (!detectedSoftware) {
      return context.config.install.installedSoftware ?? null;
    }

    const configuredInstalledSoftware = String(
      context.config.install.installedSoftware ?? "",
    ).trim();
    const requestedSoftware = String(context.config.install.software ?? "").trim();
    const requestedVersion = String(context.config.install.requestedVersion ?? "").trim();
    const installedVersion = String(context.config.install.installedVersion ?? "").trim();
    const requestedMatchesInstalledVersion =
      Boolean(requestedVersion) &&
      Boolean(installedVersion) &&
      requestedVersion === installedVersion;

    if (
      configuredInstalledSoftware &&
      requestedSoftware &&
      configuredInstalledSoftware !== requestedSoftware &&
      requestedMatchesInstalledVersion &&
      (
        detectedSoftware === requestedSoftware ||
        this.serverLooksLikeSoftware(context, requestedSoftware)
      )
    ) {
      context.config.install = {
        ...context.config.install,
        installedSoftware: requestedSoftware,
      };
      await this.saveContextConfig(context);
      this.appendLog(
        context.record.id,
        "panel",
        `Releu corrected this server profile from stale ${formatSoftwareName(configuredInstalledSoftware) ?? configuredInstalledSoftware} markers to ${formatSoftwareName(requestedSoftware) ?? requestedSoftware}.`,
      );
      return requestedSoftware;
    }

    if (configuredInstalledSoftware) {
      return configuredInstalledSoftware;
    }

    context.config.install = {
      ...context.config.install,
      installedSoftware: detectedSoftware,
    };
    await this.saveContextConfig(context);
    this.appendLog(
      context.record.id,
      "panel",
      `Releu detected ${formatSoftwareName(detectedSoftware) ?? detectedSoftware} server files and updated this server profile automatically.`,
    );
    return detectedSoftware;
  }

  assertAssetCompatibility(context, kind, options = {}) {
    const label = kindLabel(kind);
    const softwareId = this.getEffectiveServerSoftwareId(context);
    const softwareOption = this.getServerSoftwareOption(context);
    const softwareName = softwareOption?.name ?? formatSoftwareName(softwareId) ?? softwareId;

    if (label === "plugin" && !softwareOption?.supportsPlugins) {
      throw new Error(
        `${softwareName} does not load plugins. Switch this server to Paper or Purpur before installing plugin add-ons.`,
      );
    }

    if (label === "mod" && !softwareOption?.supportsMods) {
      throw new Error(
        `${softwareName} does not load mods. Switch this server to Fabric, Forge, or NeoForge before installing mod add-ons.`,
      );
    }

    const profileId = String(options.profileId ?? "").trim().toLowerCase();
    if (!profileId) {
      return;
    }

    if (label === "mod" && profileId !== softwareId) {
      throw new Error(
        `This server is using ${softwareName}. ${profileId.toUpperCase()} mods will not load here.`,
      );
    }

    if (
      label === "plugin" &&
      softwareId === "paper" &&
      !["paper", "spigot", "bukkit", "auto"].includes(profileId)
    ) {
      throw new Error("This Paper server can only install Paper, Spigot, or Bukkit plugins.");
    }

    if (
      label === "plugin" &&
      softwareId === "purpur" &&
      !["purpur", "paper", "spigot", "bukkit", "auto"].includes(profileId)
    ) {
      throw new Error("This Purpur server can only install Purpur, Paper, Spigot, or Bukkit plugins.");
    }
  }

  async rememberInstalledAsset(serverId, kind, fileName, metadata = {}) {
    const label = kindLabel(kind);
    const safeName = sanitizeAssetFilename(fileName);
    const index = await this.loadAssetIndex(serverId);
    index[label][safeName] = {
      ...(index[label][safeName] ?? {}),
      fileName: safeName,
      displayName: metadata.displayName ?? metadata.projectTitle ?? safeName,
      kind: label,
      source: metadata.source ?? index[label][safeName]?.source ?? "upload",
      iconUrl: metadata.iconUrl ?? index[label][safeName]?.iconUrl ?? null,
      projectId: metadata.projectId ?? index[label][safeName]?.projectId ?? null,
      projectSlug: metadata.projectSlug ?? index[label][safeName]?.projectSlug ?? null,
      versionId: metadata.versionId ?? index[label][safeName]?.versionId ?? null,
      versionNumber: metadata.versionNumber ?? index[label][safeName]?.versionNumber ?? null,
      versionName: metadata.versionName ?? index[label][safeName]?.versionName ?? null,
      profileId: metadata.profileId ?? index[label][safeName]?.profileId ?? null,
      clientSide: metadata.clientSide ?? index[label][safeName]?.clientSide ?? "unknown",
      serverSide: metadata.serverSide ?? index[label][safeName]?.serverSide ?? "unknown",
      gameVersions: metadata.gameVersions ?? index[label][safeName]?.gameVersions ?? [],
      loaders: metadata.loaders ?? index[label][safeName]?.loaders ?? [],
      dependencyOf: metadata.dependencyOf ?? index[label][safeName]?.dependencyOf ?? null,
      installedAt: metadata.installedAt ?? currentTimestamp(),
      restartRequired: metadata.restartRequired ?? true,
      restartReason:
        metadata.restartReason ??
        "Restart the Minecraft server before this add-on will appear in game.",
      addedFromUrl: metadata.addedFromUrl ?? index[label][safeName]?.addedFromUrl ?? null,
    };
    await this.saveAssetIndex(serverId, index);
    return index[label][safeName];
  }

  async forgetInstalledAsset(serverId, kind, fileName) {
    const label = kindLabel(kind);
    const safeName = sanitizeAssetFilename(fileName);
    const index = await this.loadAssetIndex(serverId);
    delete index[label][safeName];
    await this.saveAssetIndex(serverId, index);
  }

  async markInstalledAssetsLoaded(serverId) {
    const index = await this.loadAssetIndex(serverId);
    let changed = false;
    for (const kind of ["plugin", "mod"]) {
      for (const entry of Object.values(index[kind])) {
        if (!entry.restartRequired) {
          continue;
        }
        entry.restartRequired = false;
        entry.restartReason = null;
        entry.loadedAt = currentTimestamp();
        changed = true;
      }
    }
    if (changed) {
      await this.saveAssetIndex(serverId, index);
    }
  }

  async listAssetFileNames(context, kind) {
    try {
      const entries = await fs.readdir(this.getAssetDirectory(context, kind), {
        withFileTypes: true,
      });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  resolveManagedServerPath(serverId, relativePath = "") {
    const context = this.getServerContext(serverId);
    const normalized = normalizeManagedRelativePath(relativePath);
    return {
      context,
      relativePath: normalized,
      absolutePath: ensureChildPath(
        context.paths.serverDir,
        path.join(context.paths.serverDir, normalized),
      ),
    };
  }

  async listManagedFiles(serverId, options = {}) {
    const { context, relativePath, absolutePath } = this.resolveManagedServerPath(
      serverId,
      options.path ?? "",
    );
    const search = String(options.search ?? "").trim().toLowerCase();
    const stats = await fs.stat(absolutePath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
      throw new Error("That folder does not exist.");
    }

    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    const listed = await Promise.all(
      entries.map(async (entry) => {
        const entryAbsolutePath = ensureChildPath(
          context.paths.serverDir,
          path.join(absolutePath, entry.name),
        );
        const entryRelativePath = toPortableRelativePath(
          path.relative(context.paths.serverDir, entryAbsolutePath),
        );
        const entryStats = await fs.stat(entryAbsolutePath);
        return {
          name: entry.name,
          path: entryRelativePath,
          type: entry.isDirectory() ? "directory" : "file",
          sizeBytes: entry.isDirectory() ? null : entryStats.size,
          modifiedAt: entryStats.mtime.toISOString(),
          isTextEditable: entry.isFile() && isTextEditablePath(entry.name),
        };
      }),
    );

    const filtered = listed
      .filter((entry) => (!search ? true : entry.name.toLowerCase().includes(search)))
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === "directory" ? -1 : 1;
        }
        return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      });

    const parentPath = relativePath.includes("/")
      ? relativePath.split("/").slice(0, -1).join("/")
      : relativePath
        ? ""
        : null;

    return {
      path: relativePath,
      absolutePath,
      parentPath,
      entries: filtered,
    };
  }

  async createManagedFolder(serverId, payload = {}) {
    const parent = this.resolveManagedServerPath(serverId, payload.path ?? "");
    const folderName = normalizeManagedFileName(payload.name, "");
    const targetPath = ensureChildPath(
      parent.context.paths.serverDir,
      path.join(parent.absolutePath, folderName),
    );
    await fs.mkdir(targetPath, { recursive: false });
    this.appendLog(serverId, "panel", `Created folder ${path.relative(parent.context.paths.serverDir, targetPath)}.`);
    return this.listManagedFiles(serverId, { path: parent.relativePath });
  }

  async uploadManagedFile(serverId, relativeDir, fileName, bytes) {
    const targetDir = this.resolveManagedServerPath(serverId, relativeDir ?? "");
    const safeFileName = normalizeManagedFileName(fileName);
    await fs.mkdir(targetDir.absolutePath, { recursive: true });
    const targetPath = ensureChildPath(
      targetDir.context.paths.serverDir,
      path.join(targetDir.absolutePath, safeFileName),
    );
    await fs.writeFile(targetPath, Buffer.from(bytes));
    this.appendLog(serverId, "panel", `Uploaded file ${path.relative(targetDir.context.paths.serverDir, targetPath)}.`);
    return {
      file: {
        name: safeFileName,
        path: toPortableRelativePath(path.relative(targetDir.context.paths.serverDir, targetPath)),
      },
      listing: await this.listManagedFiles(serverId, { path: targetDir.relativePath }),
    };
  }

  async deleteManagedPath(serverId, relativePath) {
    const target = this.resolveManagedServerPath(serverId, relativePath);
    if (!target.relativePath) {
      throw new Error("The server root cannot be deleted.");
    }
    const stats = await fs.stat(target.absolutePath).catch(() => null);
    if (!stats) {
      throw new Error("That file no longer exists.");
    }
    await fs.rm(target.absolutePath, { recursive: true, force: true });
    this.appendLog(serverId, "panel", `Deleted ${target.relativePath}.`);
    return this.listManagedFiles(serverId, { path: target.relativePath.includes("/") ? target.relativePath.split("/").slice(0, -1).join("/") : "" });
  }

  async readManagedTextFile(serverId, relativePath) {
    const target = this.resolveManagedServerPath(serverId, relativePath);
    const stats = await fs.stat(target.absolutePath).catch(() => null);
    if (!stats || !stats.isFile()) {
      throw new Error("That file does not exist.");
    }
    if (!isTextEditablePath(target.relativePath)) {
      throw new Error("This file type is not editable in Releu.");
    }
    if (stats.size > 2 * 1024 * 1024) {
      throw new Error("This file is too large to edit in the panel.");
    }
    return {
      path: target.relativePath,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      content: await fs.readFile(target.absolutePath, "utf8"),
    };
  }

  async downloadManagedFile(serverId, relativePath) {
    const target = this.resolveManagedServerPath(serverId, relativePath);
    const stats = await fs.stat(target.absolutePath).catch(() => null);
    if (!stats || !stats.isFile()) {
      throw new Error("That file does not exist.");
    }
    if (stats.size > 16 * 1024 * 1024) {
      throw new Error("This file is too large to download through Remote Access.");
    }
    const bytes = await fs.readFile(target.absolutePath);
    return {
      path: target.relativePath,
      fileName: path.basename(target.absolutePath),
      sizeBytes: stats.size,
      mimeType: "application/octet-stream",
      contentBase64: Buffer.from(bytes).toString("base64"),
    };
  }

  async writeManagedTextFile(serverId, payload = {}) {
    const target = this.resolveManagedServerPath(serverId, payload.path ?? "");
    const stats = await fs.stat(target.absolutePath).catch(() => null);
    if (!stats || !stats.isFile()) {
      throw new Error("That file does not exist.");
    }
    if (!isTextEditablePath(target.relativePath)) {
      throw new Error("This file type is not editable in Releu.");
    }
    await fs.writeFile(target.absolutePath, String(payload.content ?? ""), "utf8");
    this.appendLog(serverId, "panel", `Saved ${target.relativePath}.`);
    return this.readManagedTextFile(serverId, target.relativePath);
  }

  async ensureKnownModDependencies(serverId, context) {
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    if (effectiveSoftware !== "fabric") {
      return;
    }

    const modFiles = await this.listAssetFileNames(context, "mod");
    const normalizedFiles = modFiles.map((entry) => entry.toLowerCase());
    if (!normalizedFiles.some((entry) => entry.includes("geyser-fabric"))) {
      return;
    }
    if (normalizedFiles.some((entry) => entry.includes("fabric-api"))) {
      return;
    }

    const selection = await resolveCatalogInstall({
      projectId: "fabric-api",
      kind: "mod",
      profileId: "fabric",
      serverSoftware: "fabric",
      gameVersion: this.getServerGameVersion(serverId),
    });

    await this.installAssetFromUrl(serverId, "mod", selection.fileUrl, {
      displayName: selection.projectTitle ?? selection.fileName,
      source: "catalog",
      iconUrl: selection.iconUrl,
      projectId: selection.projectId,
      projectSlug: selection.projectSlug,
      versionId: selection.versionId,
      versionNumber: selection.versionNumber,
      versionName: selection.versionName,
      profileId: selection.profile?.id ?? "fabric",
      gameVersions: selection.gameVersions,
      loaders: selection.loaders,
      dependencyOf: "geyser-fabric",
    });

    this.appendLog(
      serverId,
      "panel",
      "Installed required Fabric API dependency automatically for Geyser-Fabric.",
    );
  }

  async validateServerStartup(context) {
    const serverId = context.record.id;
    const effectiveSoftware = this.getEffectiveServerSoftwareId(context);
    const softwareOption =
      serverSoftwareOptions.find((entry) => entry.id === effectiveSoftware) ?? null;
    const softwareName =
      softwareOption?.name ?? formatSoftwareName(effectiveSoftware) ?? effectiveSoftware;
    const modFiles = await this.listAssetFileNames(context, "mod");
    const pluginFiles = await this.listAssetFileNames(context, "plugin");

    if (modFiles.length && !softwareOption?.supportsMods) {
      throw new Error(
        `${softwareName} does not load mods, but this server folder still has ${modFiles.length} mod file(s). Switch the server to Fabric, Forge, or NeoForge, or remove those mods before starting.`,
      );
    }

    if (pluginFiles.length && !softwareOption?.supportsPlugins) {
      throw new Error(
        `${softwareName} does not load plugins, but this server folder still has ${pluginFiles.length} plugin file(s). Switch the server to Paper or Purpur before starting.`,
      );
    }

    await this.ensureKnownModDependencies(serverId, context);
  }

  async rememberPlayer(serverId, name, updates = {}) {
    const normalized = normalizePlayerName(name);
    if (!normalized) {
      return null;
    }

    const index = await this.loadPlayerIndex(serverId);
    const key = playerKey(normalized);
    index[key] = {
      name: normalized,
      uuid: updates.uuid ?? index[key]?.uuid ?? null,
      lastSeenAt: updates.lastSeenAt ?? index[key]?.lastSeenAt ?? null,
      gamemode: updates.gamemode ?? index[key]?.gamemode ?? null,
    };
    await this.savePlayerIndex(serverId, index);
    return index[key];
  }

  async registerPlayer(serverId, payload) {
    const name = normalizePlayerName(payload.name);
    const uuid = String(payload.uuid ?? "").trim() || null;
    if (!name) {
      throw new Error("Player name is required.");
    }

    return this.rememberPlayer(serverId, name, {
      uuid,
      lastSeenAt: currentTimestamp(),
    });
  }

  async readListFile(targetPath) {
    return readJsonFile(targetPath, []);
  }

  async choosePreferredPlayerUuid(serverId, currentUuid, candidateUuid) {
    const current = String(currentUuid ?? "").trim() || null;
    const candidate = String(candidateUuid ?? "").trim() || null;
    if (!candidate) {
      return current;
    }
    if (!current || current === candidate) {
      return candidate;
    }

    const currentPath = await this.resolvePlayerDataFile(serverId, current);
    const candidatePath = await this.resolvePlayerDataFile(serverId, candidate);
    if (candidatePath && !currentPath) {
      return candidate;
    }
    if (currentPath && !candidatePath) {
      return current;
    }
    if (candidatePath && currentPath) {
      const [currentStats, candidateStats] = await Promise.all([
        fs.stat(currentPath).catch(() => null),
        fs.stat(candidatePath).catch(() => null),
      ]);
      const currentMtime = currentStats?.mtimeMs ?? 0;
      const candidateMtime = candidateStats?.mtimeMs ?? 0;
      if (candidateMtime > currentMtime) {
        return candidate;
      }
    }
    return current;
  }

  async getPlayers(serverId) {
    const context = this.getServerContext(serverId);
    const index = await this.loadPlayerIndex(serverId);
    const usercache = await this.readListFile(context.paths.usercacheFile);
    const whitelist = await this.readListFile(context.paths.whitelistFile);
    const ops = await this.readListFile(context.paths.opsFile);
    const bannedPlayers = await this.readListFile(context.paths.bannedPlayersFile);
    const players = new Map();

    const ensurePlayer = async (name, extra = {}) => {
      const normalized = normalizePlayerName(name);
      if (!normalized) {
        return null;
      }

      const key = playerKey(normalized);
      if (!players.has(key)) {
        players.set(key, {
          name: normalized,
          uuid: null,
          lastSeenAt: null,
          gamemode: null,
          online: false,
          whitelisted: false,
          op: false,
          banned: false,
          banReason: null,
        });
      }

      const existing = players.get(key);
      const preferredUuid = Object.prototype.hasOwnProperty.call(extra, "uuid")
        ? await this.choosePreferredPlayerUuid(serverId, existing.uuid, extra.uuid)
        : existing.uuid;
      players.set(key, {
        ...existing,
        ...extra,
        uuid: preferredUuid,
        name: normalized,
      });

      return players.get(key);
    };

    for (const value of Object.values(index)) {
      await ensurePlayer(value.name, value);
    }

    for (const entry of usercache) {
      await ensurePlayer(entry.name, {
        uuid: entry.uuid ?? null,
      });
    }

    for (const entry of whitelist) {
      await ensurePlayer(entry.name, {
        uuid: entry.uuid ?? null,
        whitelisted: true,
      });
    }

    for (const entry of ops) {
      await ensurePlayer(entry.name, {
        uuid: entry.uuid ?? null,
        op: true,
      });
    }

    for (const entry of bannedPlayers) {
      await ensurePlayer(entry.name, {
        uuid: entry.uuid ?? null,
        banned: true,
        banReason: entry.reason ?? "Banned",
      });
    }

    for (const name of context.onlinePlayers) {
      await ensurePlayer(name, { online: true });
    }

    return Array.from(players.values()).sort((left, right) => {
      if (left.online !== right.online) {
        return left.online ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  }

  resolveInventoryCatalogVersion(serverId) {
    const requested = String(this.getServerGameVersion(serverId) ?? "").trim();
    const latestKnown = minecraftData.versions.pc.find((entry) =>
      /^1\.21\.\d+$/.test(String(entry.minecraftVersion ?? ""))
    )?.minecraftVersion;
    const candidates = [
      requested,
      requested.startsWith("26.1") ? defaultItemCatalogVersion : null,
      defaultItemCatalogVersion,
      latestKnown ?? null,
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        const dataset = minecraftData(candidate);
        if (dataset?.itemsArray?.length) {
          return candidate;
        }
      } catch {
        // Try the next candidate.
      }
    }

    return defaultItemCatalogVersion;
  }

  getInventoryCatalog(serverId) {
    const version = this.resolveInventoryCatalogVersion(serverId);
    const cached = this.itemCatalogCache.get(version);
    if (cached) {
      return cached;
    }

    const dataset = minecraftData(version);
    const entries = (dataset.itemsArray ?? [])
      .map(itemCatalogEntry)
      .filter(Boolean)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    const catalog = { version, entries, byId, byName };
    this.itemCatalogCache.set(version, catalog);
    return catalog;
  }

  async searchInventoryCatalog(serverId, payload = {}) {
    const query = String(payload.query ?? "").trim();
    const pageSize = Math.max(1, Math.min(40, Number(payload.limit ?? 24) || 24));
    const page = Math.max(1, Number(payload.page ?? 1) || 1);
    const catalog = this.getInventoryCatalog(serverId);

    let filtered = [];
    if (!query) {
      filtered = defaultInventoryCatalogSuggestions
        .map((name) => catalog.byName.get(name))
        .filter(Boolean);
    } else {
      filtered = catalog.entries
        .map((entry) => ({
          entry,
          score: scoreItemCatalogEntry(entry, query),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) =>
          right.score - left.score ||
          left.entry.displayName.localeCompare(right.entry.displayName)
        )
        .map((candidate) => candidate.entry);
    }

    const totalHits = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalHits / pageSize));
    const sliceStart = (Math.min(page, totalPages) - 1) * pageSize;
    return {
      query,
      page: Math.min(page, totalPages),
      pageSize,
      totalHits,
      totalPages,
      version: catalog.version,
      results: filtered.slice(sliceStart, sliceStart + pageSize),
    };
  }

  async flushPlayerDataToDisk(serverId) {
    const context = this.getServerContext(serverId);
    if (!context.serverProcess) {
      return;
    }
    await this.sendCommand(serverId, "save-all flush");
    await wait(500);
  }

  async waitForPlayerDataRefresh(targetPath, previousMtimeMs, timeoutMs = 3000) {
    if (!targetPath) {
      return null;
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const stats = await fs.stat(targetPath).catch(() => null);
      if (stats && (previousMtimeMs === null || stats.mtimeMs > previousMtimeMs)) {
        return stats;
      }
      await wait(150);
    }
    return await fs.stat(targetPath).catch(() => null);
  }

  getActiveWorldDirectory(context) {
    const levelName = String(context.cachedProperties["level-name"] ?? "world").trim() || "world";
    return path.join(context.paths.serverDir, levelName);
  }

  async resolvePlayerDataFile(serverId, uuid) {
    const context = this.getServerContext(serverId);
    context.cachedProperties = await readServerProperties(context.paths);
    const worldDir = this.getActiveWorldDirectory(context);
    const candidates = [
      path.join(worldDir, "players", "data", `${uuid}.dat`),
      path.join(worldDir, "playerdata", `${uuid}.dat`),
    ];
    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  async readPlayerDataRoot(targetPath) {
    const parsed = await nbt.parse(await fs.readFile(targetPath));
    return parsed.parsed ?? parsed;
  }

  async writePlayerDataRoot(targetPath, root) {
    const encoded = nbt.writeUncompressed(root);
    const compressed = await gzip(encoded);
    await fs.writeFile(targetPath, compressed);
  }

  findFirstAvailableInventorySlot(rawItems) {
    const occupied = new Set(
      (rawItems ?? [])
        .map((item) => normalizeInventorySlotValue(item?.Slot?.value ?? item?.Slot))
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= 35),
    );
    for (let slotId = 0; slotId <= 35; slotId += 1) {
      if (!occupied.has(slotId)) {
        return slotId;
      }
    }
    return null;
  }

  async getPlayerInventory(serverId, name, { refreshLiveData = true } = {}) {
    const context = this.getServerContext(serverId);
    const players = await this.getPlayers(serverId);
    const normalized = normalizePlayerName(name);
    const player =
      players.find((entry) => playerKey(entry.name) === playerKey(normalized)) ?? null;
    if (!player) {
      throw new Error("Player was not found.");
    }
    if (!player.uuid) {
      throw new Error("This player has no known UUID yet, so Releu cannot open their saved inventory.");
    }

    let playerDataPath = await this.resolvePlayerDataFile(serverId, player.uuid);
    const previousStats = playerDataPath
      ? await fs.stat(playerDataPath).catch(() => null)
      : null;
    const usedLiveRefresh = Boolean(refreshLiveData && context.serverProcess && player.online);

    if (usedLiveRefresh) {
      await this.flushPlayerDataToDisk(serverId);
      if (!playerDataPath) {
        playerDataPath = await this.resolvePlayerDataFile(serverId, player.uuid);
      }
      await this.waitForPlayerDataRefresh(
        playerDataPath,
        previousStats?.mtimeMs ?? null,
      );
    }

    if (!playerDataPath) {
      playerDataPath = await this.resolvePlayerDataFile(serverId, player.uuid);
    }
    if (!playerDataPath) {
      throw new Error("No saved inventory file was found for this player yet.");
    }

    const finalStats = await fs.stat(playerDataPath).catch(() => null);
    const root = await this.readPlayerDataRoot(playerDataPath);
    const simplified = nbt.simplify(root);
    const inventoryItems = Array.isArray(simplified.Inventory) ? simplified.Inventory : [];
    const equipment = resolvePlayerEquipment(simplified);
    const selectedHotbarSlot = Number(simplified.SelectedItemSlot ?? 0) || 0;
    const catalog = this.getInventoryCatalog(serverId);
    const layout = buildInventoryView(
      inventoryItems,
      selectedHotbarSlot,
      catalog.byId,
      equipment,
    );

    return {
      player: {
        name: player.name,
        uuid: player.uuid,
        online: Boolean(player.online),
        gamemode: player.gamemode ?? null,
      },
      selectedHotbarSlot,
      occupiedSlots: layout.occupiedSlots,
      totalSlots: layout.totalSlots,
      armor: layout.armor,
      offhand: layout.offhand,
      main: layout.main,
      hotbar: layout.hotbar,
      storagePath: playerDataPath,
      snapshotAt: finalStats?.mtime?.toISOString?.() ?? currentTimestamp(),
      source: usedLiveRefresh ? "live-playerdata" : "saved-playerdata",
      textureUrl: defaultInventoryTextureUrl,
      canEditOffline: !player.online,
      canEditOnline: Boolean(context.serverProcess && player.online),
    };
  }

  async givePlayerInventoryItem(serverId, name, payload = {}) {
    const context = this.getServerContext(serverId);
    const players = await this.getPlayers(serverId);
    const normalized = normalizePlayerName(name);
    const player =
      players.find((entry) => playerKey(entry.name) === playerKey(normalized)) ?? null;
    if (!player) {
      throw new Error("Player was not found.");
    }

    const requestedItemId = String(payload.itemId ?? "").trim();
    if (!requestedItemId) {
      throw new Error("Item ID is required.");
    }

    const normalizedItemId = requestedItemId.startsWith("minecraft:")
      ? requestedItemId
      : `minecraft:${requestedItemId.replace(/^minecraft:/i, "")}`;
    const count = Math.max(1, Math.min(9999, Number(payload.count ?? 1) || 1));
    const catalog = this.getInventoryCatalog(serverId);
    const catalogEntry =
      catalog.byId.get(normalizedItemId) ??
      catalog.byName.get(normalizedItemId.replace(/^minecraft:/i, ""));
    if (!catalogEntry) {
      throw new Error("That item is not in the vanilla Minecraft item catalog.");
    }

    if (context.serverProcess && player.online) {
      await this.sendCommand(serverId, `give ${player.name} ${catalogEntry.id} ${count}`);
      await this.flushPlayerDataToDisk(serverId);
      this.appendLog(
        serverId,
        "panel",
        `Gave ${count}x ${catalogEntry.displayName} to ${player.name}.`,
      );
      return this.getPlayerInventory(serverId, player.name, { refreshLiveData: true });
    }

    if (!player.uuid) {
      throw new Error("This player has no known UUID yet, so Releu cannot edit their saved inventory.");
    }

    const playerDataPath = await this.resolvePlayerDataFile(serverId, player.uuid);
    if (!playerDataPath) {
      throw new Error("No saved inventory file was found for this player yet.");
    }

    const root = await this.readPlayerDataRoot(playerDataPath);
    if (!root.value.Inventory) {
      root.value.Inventory = {
        type: "list",
        value: {
          type: "compound",
          value: [],
        },
      };
    }
    const inventoryTag = root.value.Inventory;
    const rawItems = Array.isArray(inventoryTag?.value?.value) ? inventoryTag.value.value : [];
    const draftItems = rawItems.map((item) => structuredClone(item));
    const stackSize = Math.max(1, catalogEntry.stackSize || 64);
    let remaining = count;

    for (const item of draftItems) {
      const slotId = normalizeInventorySlotValue(item?.Slot?.value);
      if (!(slotId >= 0 && slotId <= 35)) {
        continue;
      }
      if (inventoryItemId(item) !== catalogEntry.id) {
        continue;
      }
      if (inventoryItemComponents(item)) {
        continue;
      }
      const currentCount = inventoryItemCount(item);
      const roomLeft = stackSize - currentCount;
      if (roomLeft <= 0) {
        continue;
      }
      const adding = Math.min(roomLeft, remaining);
      item.count.value = currentCount + adding;
      remaining -= adding;
      if (remaining <= 0) {
        break;
      }
    }

    while (remaining > 0) {
      const slotId = this.findFirstAvailableInventorySlot(draftItems);
      if (slotId === null) {
        throw new Error("This player has no free inventory slots left.");
      }
      const adding = Math.min(stackSize, remaining);
      draftItems.push({
        Slot: { type: "byte", value: serializeInventorySlotValue(slotId) },
        id: { type: "string", value: catalogEntry.id },
        count: { type: "int", value: adding },
      });
      remaining -= adding;
    }

    inventoryTag.value.value = draftItems;
    await this.writePlayerDataRoot(playerDataPath, root);
    this.appendLog(
      serverId,
      "panel",
      `Added ${count}x ${catalogEntry.displayName} to ${player.name}'s saved inventory.`,
    );
    return this.getPlayerInventory(serverId, player.name, { refreshLiveData: false });
  }

  async clearPlayerInventory(serverId, name, payload = {}) {
    const context = this.getServerContext(serverId);
    const players = await this.getPlayers(serverId);
    const normalized = normalizePlayerName(name);
    const player =
      players.find((entry) => playerKey(entry.name) === playerKey(normalized)) ?? null;
    if (!player) {
      throw new Error("Player was not found.");
    }

    const clearAll = Boolean(payload.clearAll);
    const slotId = payload.slotId === undefined || payload.slotId === null
      ? null
      : normalizeInventorySlotValue(payload.slotId);

    if (!clearAll && slotId === null) {
      throw new Error("A slot ID is required unless you are clearing the whole inventory.");
    }

    if (context.serverProcess && player.online) {
      if (clearAll) {
        await this.sendCommand(serverId, `clear ${player.name}`);
      } else {
        const definition = getInventorySlotDefinition(slotId);
        if (!definition?.commandSlot) {
          throw new Error("That inventory slot cannot be cleared from a live player.");
        }
        await this.sendCommand(
          serverId,
          `item replace entity ${player.name} ${definition.commandSlot} with minecraft:air`,
        );
      }
      await this.flushPlayerDataToDisk(serverId);
      this.appendLog(
        serverId,
        "panel",
        clearAll
          ? `Cleared ${player.name}'s live inventory.`
          : `Cleared ${player.name}'s ${getInventorySlotDefinition(slotId)?.label ?? "inventory slot"}.`,
      );
      return this.getPlayerInventory(serverId, player.name, { refreshLiveData: true });
    }

    if (!player.uuid) {
      throw new Error("This player has no known UUID yet, so Releu cannot edit their saved inventory.");
    }

    const playerDataPath = await this.resolvePlayerDataFile(serverId, player.uuid);
    if (!playerDataPath) {
      throw new Error("No saved inventory file was found for this player yet.");
    }

    const root = await this.readPlayerDataRoot(playerDataPath);
    if (!root.value.Inventory) {
      root.value.Inventory = {
        type: "list",
        value: {
          type: "compound",
          value: [],
        },
      };
    }
    const inventoryTag = root.value.Inventory;
    const rawItems = Array.isArray(inventoryTag?.value?.value) ? inventoryTag.value.value : [];

    inventoryTag.value.value = clearAll
      ? []
      : rawItems.filter((item) => normalizeInventorySlotValue(item?.Slot?.value) !== slotId);

    await this.writePlayerDataRoot(playerDataPath, root);
    this.appendLog(
      serverId,
      "panel",
      clearAll
        ? `Cleared ${player.name}'s saved inventory.`
        : `Removed the item in ${getInventorySlotDefinition(slotId)?.label ?? "that slot"} from ${player.name}'s saved inventory.`,
    );
    return this.getPlayerInventory(serverId, player.name, { refreshLiveData: false });
  }

  async resolvePlayerIdentity(serverId, name) {
    const normalized = normalizePlayerName(name);
    if (!normalized) {
      throw new Error("Player name is required.");
    }

    const players = await this.getPlayers(serverId);
    const match = players.find((entry) => playerKey(entry.name) === playerKey(normalized));
    if (!match) {
      return {
        name: normalized,
        uuid: null,
      };
    }

    return {
      name: match.name,
      uuid: match.uuid,
    };
  }

  async mutatePlayerList(serverId, targetPath, name, addEntry) {
    const identity = await this.resolvePlayerIdentity(serverId, name);
    if (!identity.uuid) {
      throw new Error(
        "This player has no known UUID yet. Let them join once, or add the UUID manually in the panel first.",
      );
    }

    const entries = await this.readListFile(targetPath);
    const filtered = entries.filter((entry) => playerKey(entry.name) !== playerKey(identity.name));
    if (addEntry) {
      filtered.push(addEntry(identity));
    }
    await writeJsonFile(targetPath, filtered);
  }

  async applyPlayerAction(serverId, name, action, payload = {}) {
    const context = this.getServerContext(serverId);
    const normalized = normalizePlayerName(name);
    if (!normalized) {
      throw new Error("Player name is required.");
    }

    const requiresRunningServer = new Set(["kick", "gamemode", "heal", "feed", "teleport"]);
    const prefersLiveIdentity = new Set([
      "op",
      "deop",
      "whitelist-add",
      "whitelist-remove",
      "ban",
      "pardon",
      "kick",
      "gamemode",
      "heal",
      "feed",
      "teleport",
    ]);

    if (requiresRunningServer.has(action) && !context.serverProcess) {
      throw new Error(`Player action "${action}" requires the server to be running.`);
    }

    const identity = context.serverProcess && prefersLiveIdentity.has(action)
      ? await this.resolvePlayerIdentity(serverId, normalized)
      : requiresRunningServer.has(action)
        ? await this.resolvePlayerIdentity(serverId, normalized)
        : { name: normalized, uuid: null };
    const liveCommandTarget = identity.name ?? normalized;

    switch (action) {
      case "op":
        if (context.serverProcess) {
          await this.sendCommand(serverId, `op ${liveCommandTarget}`);
        } else {
          await this.mutatePlayerList(serverId, context.paths.opsFile, normalized, (identity) => ({
            uuid: identity.uuid,
            name: identity.name,
            level: 4,
            bypassesPlayerLimit: false,
          }));
        }
        break;
      case "deop":
        if (context.serverProcess) {
          await this.sendCommand(serverId, `deop ${liveCommandTarget}`);
        } else {
          await this.mutatePlayerList(serverId, context.paths.opsFile, normalized, null);
        }
        break;
      case "whitelist-add":
        if (context.serverProcess) {
          await this.sendCommand(serverId, `whitelist add ${liveCommandTarget}`);
        } else {
          await this.mutatePlayerList(
            serverId,
            context.paths.whitelistFile,
            normalized,
            (identity) => ({
              uuid: identity.uuid,
              name: identity.name,
            }),
          );
        }
        break;
      case "whitelist-remove":
        if (context.serverProcess) {
          await this.sendCommand(serverId, `whitelist remove ${liveCommandTarget}`);
        } else {
          await this.mutatePlayerList(serverId, context.paths.whitelistFile, normalized, null);
        }
        break;
      case "ban":
        if (context.serverProcess) {
          const reason = String(payload.reason ?? "Banned from panel").trim();
          await this.sendCommand(serverId, `ban ${liveCommandTarget} ${reason}`);
        } else {
          await this.mutatePlayerList(
            serverId,
            context.paths.bannedPlayersFile,
            normalized,
            (identity) => ({
              uuid: identity.uuid,
              name: identity.name,
              created: new Date().toUTCString(),
              source: "Local Minecraft Panel",
              expires: "forever",
              reason: String(payload.reason ?? "Banned from panel").trim(),
            }),
          );
        }
        break;
      case "pardon":
        if (context.serverProcess) {
          await this.sendCommand(serverId, `pardon ${liveCommandTarget}`);
        } else {
          await this.mutatePlayerList(serverId, context.paths.bannedPlayersFile, normalized, null);
        }
        break;
      case "kick":
        {
          const offlineMode =
            String(context.cachedProperties["online-mode"] ?? "true").toLowerCase() !== "true";
          const fallbackReason = offlineMode
            ? "This server uses cracked/offline mode, so your skin and inventory can change because offline mode uses a different save slot / UUID. Switching back usually restores the original save."
            : "Removed by panel";
          const reason = String(payload.reason ?? "").trim() || fallbackReason;
        await this.sendCommand(
          serverId,
          `kick ${liveCommandTarget} ${reason}`,
        );
        }
        break;
      case "gamemode":
        {
          const mode = normalizeGamemode(payload.mode) ?? "survival";
          await this.sendCommand(serverId, `gamemode ${mode} ${liveCommandTarget}`);
        }
        break;
      case "heal":
        await this.sendCommand(
          serverId,
          `effect give ${liveCommandTarget} minecraft:instant_health 1 1 true`,
        );
        break;
      case "feed":
        await this.sendCommand(
          serverId,
          `effect give ${liveCommandTarget} minecraft:saturation 1 1 true`,
        );
        break;
      case "teleport":
        if (!String(payload.destination ?? "").trim()) {
          throw new Error("Teleport destination is required.");
        }
        await this.sendCommand(
          serverId,
          `tp ${liveCommandTarget} ${String(payload.destination).trim()}`,
        );
        break;
      default:
        throw new Error(`Unsupported player action: ${action}`);
    }

    if (requiresRunningServer.has(action)) {
      this.appendLog(
        serverId,
        "panel",
        `Sent player action "${action}" for ${normalized}. Waiting for server output to confirm it.`,
      );
    } else {
      this.appendLog(serverId, "panel", `Player action "${action}" applied to ${normalized}.`);
    }
    return this.getPlayers(serverId);
  }

  async searchCatalog(serverId, payload = {}) {
    const context = this.getServerContext(serverId);
    const requestedKind = String(payload.kind ?? "").trim().toLowerCase();
    const kind = ["plugin", "mod", "resourcepack"].includes(requestedKind)
      ? requestedKind
      : "plugin";
    if (kind !== "resourcepack") {
      this.assertAssetCompatibility(context, kind, {
        profileId: String(payload.profileId ?? "").trim() || null,
      });
    }
    const gameVersion =
      String(payload.gameVersion ?? this.getServerGameVersion(serverId) ?? "").trim() || null;

    const result = await searchCatalogProjects({
      kind,
      query: payload.query,
      profileId: String(payload.profileId ?? "").trim() || null,
      serverSoftware: this.getEffectiveServerSoftwareId(context),
      gameVersion,
      limit: Math.max(1, Math.min(24, Number(payload.limit ?? 12) || 12)),
      page: Math.max(1, Number(payload.page ?? 1) || 1),
      index: String(payload.index ?? "relevance"),
    });

    this.appendLog(
      serverId,
      "panel",
      `Catalog search returned ${result.results.length} ${kind} result(s).`,
    );
    return {
      kind,
      gameVersion,
      profile: result.profile,
      page: result.page,
      pageSize: result.pageSize,
      totalHits: result.totalHits,
      totalPages: result.totalPages,
      results: result.results,
    };
  }

  async installCatalogProject(serverId, payload = {}) {
    const context = this.getServerContext(serverId);
    const requestedKind = String(payload.kind ?? "").trim().toLowerCase();
    const kind = ["plugin", "mod", "resourcepack"].includes(requestedKind)
      ? requestedKind
      : "plugin";
    const projectId = String(payload.projectId ?? "").trim();
    if (!projectId) {
      throw new Error("A catalog project ID is required.");
    }

    if (kind !== "resourcepack") {
      this.assertAssetCompatibility(context, kind, {
        profileId: String(payload.profileId ?? "").trim() || null,
      });
    }

    const gameVersion =
      String(payload.gameVersion ?? this.getServerGameVersion(serverId) ?? "").trim() || null;

    if (kind === "resourcepack") {
      const selection = await resolveCatalogInstall({
        projectId,
        kind,
        profileId: String(payload.profileId ?? "").trim() || null,
        serverSoftware: this.getEffectiveServerSoftwareId(context),
        gameVersion,
        versionId: String(payload.versionId ?? "").trim() || null,
      });

      await this.updateServerProperties(serverId, {
        "resource-pack": selection.fileUrl,
        "resource-pack-sha1": selection.fileSha1 ?? "",
      });

      this.appendLog(
        serverId,
        "panel",
        `Configured resource pack ${selection.projectTitle ?? selection.fileName} in server.properties. Restart the server to apply it to joining players.`,
      );
      if (
        /fresh animations|better animations?|connected textures|continuity|optifine|entity texture features|entity model features|custom entity model|ctm|etf|emf/i.test(
          `${selection.projectTitle ?? ""} ${selection.fileName ?? ""}`,
        )
      ) {
        this.appendLog(
          serverId,
          "panel",
          "That resource pack reaches players through server.properties, but some packs still need client-side support such as Continuity or OptiFine for connected textures, or ETF/EMF for custom entity models and Fresh Animations.",
          "warn",
        );
      }
      return {
        installedTo: "server.properties",
        selection,
        installed: [
          {
            installedTo: "server.properties",
            selection,
          },
        ],
      };
    }

    const visited = new Set();
    const installChain = [];

    const installProject = async (targetProjectId, dependencyOf = null) => {
      const visitKey = `${kind}:${targetProjectId}`;
      if (visited.has(visitKey)) {
        return null;
      }
      visited.add(visitKey);

      const selection = await resolveCatalogInstall({
        projectId: targetProjectId,
        kind,
        profileId: String(payload.profileId ?? "").trim() || null,
        serverSoftware: this.getEffectiveServerSoftwareId(context),
        gameVersion,
        versionId:
          dependencyOf || targetProjectId !== projectId
            ? null
            : String(payload.versionId ?? "").trim() || null,
      });

      this.assertAssetCompatibility(context, kind, {
        profileId: selection.profile?.id ?? payload.profileId ?? null,
      });

      for (const dependency of selection.dependencies ?? []) {
        if (dependency.type !== "required" || !dependency.projectId) {
          continue;
        }
        await installProject(dependency.projectId, selection.projectTitle ?? selection.fileName);
      }

      const installedTo = await this.installAssetFromUrl(serverId, kind, selection.fileUrl, {
        displayName: selection.projectTitle ?? selection.fileName,
        source: "catalog",
        iconUrl: selection.iconUrl,
        projectId: selection.projectId,
        projectSlug: selection.projectSlug,
        versionId: selection.versionId,
        versionNumber: selection.versionNumber,
        versionName: selection.versionName,
        profileId: selection.profile?.id ?? null,
        clientSide: selection.clientSide ?? "unknown",
        serverSide: selection.serverSide ?? "unknown",
        gameVersions: selection.gameVersions,
        loaders: selection.loaders,
        dependencyOf,
      });

      installChain.push({
        installedTo,
        selection,
      });
      return selection;
    };

    const selection = await installProject(projectId, null);
    const installedTo =
      installChain.find((entry) => entry.selection.projectId === projectId)?.installedTo ?? null;

    this.appendLog(
      serverId,
      "panel",
      `Installed ${installChain.length} ${kind} add-on file(s). Restart the server before they will appear in game.`,
    );
    return {
      installedTo,
      selection,
      installed: installChain,
    };
  }

  getAssetDirectory(context, kind) {
    if (kind === "plugin") {
      return context.paths.pluginsDir;
    }

    if (kind === "mod") {
      return context.paths.modsDir;
    }

    throw new Error("Asset kind must be either plugin or mod.");
  }

  async listAssets(serverId, kind) {
    const context = this.getServerContext(serverId);
    const label = kindLabel(kind);
    const targetDir = this.getAssetDirectory(context, label);
    const assetIndex = await this.loadAssetIndex(serverId);
    try {
      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile())
        .sort((left, right) => left.name.localeCompare(right.name));
      const output = [];
      for (const entry of files) {
        const filePath = path.join(targetDir, entry.name);
        const stats = await fs.stat(filePath);
        const meta = assetIndex[label][entry.name] ?? {};
        output.push({
          name: entry.name,
          displayName: meta.displayName ?? entry.name,
          iconUrl: meta.iconUrl ?? null,
          source: meta.source ?? "upload",
          versionNumber: meta.versionNumber ?? null,
          versionName: meta.versionName ?? null,
          projectId: meta.projectId ?? null,
          projectSlug: meta.projectSlug ?? null,
          clientSide: meta.clientSide ?? "unknown",
          serverSide: meta.serverSide ?? "unknown",
          loaders: meta.loaders ?? [],
          gameVersions: meta.gameVersions ?? [],
          dependencyOf: meta.dependencyOf ?? null,
          restartRequired: Boolean(meta.restartRequired),
          restartReason: meta.restartReason ?? null,
          installedAt: meta.installedAt ?? stats.birthtime?.toISOString?.() ?? stats.mtime.toISOString(),
          size: stats.size,
          updatedAt: stats.mtime.toISOString(),
          path: filePath,
        });
      }
      return output;
    } catch {
      return [];
    }
  }

  async installAssetUpload(serverId, kind, fileName, bytes, metadata = {}) {
    const context = this.getServerContext(serverId);
    const label = kindLabel(kind);
    this.assertAssetCompatibility(context, label, metadata);
    const safeName = sanitizeAssetFilename(fileName);
    const targetDir = this.getAssetDirectory(context, label);
    const targetPath = path.join(targetDir, safeName);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetPath, Buffer.from(bytes));
    await this.rememberInstalledAsset(serverId, label, safeName, {
      ...metadata,
      installedAt: currentTimestamp(),
      restartRequired: true,
      restartReason: "Restart the Minecraft server before this add-on will appear in game.",
    });
    this.appendLog(
      serverId,
      "panel",
      `Installed ${label} file ${safeName}. Restart the server before it will appear in game.`,
    );
    return targetPath;
  }

  async installAssetFromUrl(serverId, kind, url, metadata = {}) {
    const normalizedUrl = String(url ?? "").trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      throw new Error("Asset URL must start with http:// or https://");
    }

    const response = await fetch(normalizedUrl, {
      headers: {
        "User-Agent": "localhost-minecraft-panel/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Unable to download ${kind} file (${response.status}).`);
    }

    const fileName =
      parseFilenameFromDisposition(response.headers.get("content-disposition")) ??
      inferFilenameFromUrl(normalizedUrl) ??
      `${kind}.jar`;

    return this.installAssetUpload(serverId, kind, fileName, await response.arrayBuffer(), {
      ...metadata,
      addedFromUrl: normalizedUrl,
      source: metadata.source ?? "url",
    });
  }

  async removeAsset(serverId, kind, fileName) {
    const context = this.getServerContext(serverId);
    const label = kindLabel(kind);
    const safeName = sanitizeAssetFilename(fileName);
    const targetPath = path.join(this.getAssetDirectory(context, label), safeName);
    await fs.rm(targetPath, { force: true });
    await this.forgetInstalledAsset(serverId, label, safeName);
    this.appendLog(serverId, "panel", `Removed ${label} file ${safeName}.`);
    return this.listAssets(serverId, label);
  }
}
