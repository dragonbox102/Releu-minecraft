import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { get, head, put } from "@vercel/blob";

import {
  currentTimestamp,
  defaultConfig,
  paths,
  readJsonFile,
  writeJsonFile,
} from "./config.js";

const storagePaths = {
  rootDir: path.join(paths.dataDir, "cloud-website"),
  accountsFile: path.join(paths.dataDir, "cloud-website", "accounts.json"),
  sessionsFile: path.join(paths.dataDir, "cloud-website", "sessions.json"),
  backupsFile: path.join(paths.dataDir, "cloud-website", "backups.json"),
  filesDir: path.join(paths.dataDir, "cloud-website", "files"),
  blobAccountsPath: "releu-cloud/accounts.json",
  blobSessionsPath: "releu-cloud/sessions.json",
  blobBackupsPath: "releu-cloud/backups.json",
};

function normalizeUsername(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "");
}

function normalizeRestoreKey(value) {
  return String(value ?? "").trim();
}

function normalizeDeviceLabel(value) {
  return String(value ?? "").trim().slice(0, 80);
}

function normalizeCloudApiBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/g, "");
}

function normalizeCloudBackupConfig(config = {}) {
  const merged = {
    ...defaultConfig.cloudBackup,
    ...(config ?? {}),
  };
  return {
    enabled: Boolean(merged.enabled),
    provider: "website",
    uploadLimitMb: Math.max(1, Number(merged.uploadLimitMb ?? 50) || 50),
    cloudApiBaseUrl: normalizeCloudApiBaseUrl(merged.cloudApiBaseUrl),
    restoreKey: normalizeRestoreKey(merged.restoreKey),
    targetRestoreKey: normalizeRestoreKey(merged.targetRestoreKey),
    deviceLabel: normalizeDeviceLabel(merged.deviceLabel),
    accountUsername: normalizeUsername(merged.accountUsername),
    sessionToken: String(merged.sessionToken ?? "").trim(),
  };
}

export function getCloudBackupConfig(config = null) {
  return normalizeCloudBackupConfig(config?.cloudBackup ?? config ?? {});
}

export function getPublicCloudBackupConfig(config = null) {
  const cloud = getCloudBackupConfig(config);
  return {
    enabled: cloud.enabled,
    provider: cloud.provider,
    uploadLimitMb: cloud.uploadLimitMb,
    restoreKey: cloud.restoreKey,
    targetRestoreKey: cloud.targetRestoreKey,
    deviceLabel: cloud.deviceLabel,
    accountUsername: cloud.accountUsername,
  };
}

function getCloudApiBaseUrl(config = null) {
  const cloud = getCloudBackupConfig(config);
  return (
    normalizeCloudApiBaseUrl(cloud.cloudApiBaseUrl) ||
    normalizeCloudApiBaseUrl(process.env.RELEU_CLOUD_API_BASE_URL)
  );
}

async function requestCloudApi(config, pathname, { method = "GET", body } = {}) {
  const baseUrl = getCloudApiBaseUrl(config);
  if (!baseUrl) {
    return null;
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(
      String(payload?.error ?? "").trim() || `Cloud website request failed (${response.status}).`,
    );
  }
  return payload;
}

function getBlobToken() {
  return String(
    process.env.BLOB_READ_WRITE_TOKEN ?? process.env.RELEU_VERCEL_BLOB_TOKEN ?? "",
  ).trim();
}

async function readPrivateBlobText(pathname) {
  const token = getBlobToken();
  if (!token) {
    return null;
  }
  const result = await get(pathname, {
    access: "private",
    token,
    useCache: false,
  }).catch(() => null);
  if (!result?.stream) {
    return null;
  }
  return new Response(result.stream).text();
}

async function readPrivateBlobJson(pathname, fallbackValue) {
  const text = await readPrivateBlobText(pathname);
  if (!text) {
    return structuredClone(fallbackValue);
  }
  try {
    return JSON.parse(text);
  } catch {
    return structuredClone(fallbackValue);
  }
}

async function writePrivateBlobJson(pathname, value) {
  const token = getBlobToken();
  if (!token) {
    throw new Error("Vercel Blob token is not configured.");
  }
  await put(pathname, `${JSON.stringify(value, null, 2)}\n`, {
    access: "private",
    token,
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
  });
}

async function ensureStorage() {
  await fs.mkdir(storagePaths.filesDir, { recursive: true });
}

async function loadAccounts() {
  if (getBlobToken()) {
    return readPrivateBlobJson(storagePaths.blobAccountsPath, []);
  }
  await ensureStorage();
  return readJsonFile(storagePaths.accountsFile, []);
}

async function saveAccounts(accounts) {
  if (getBlobToken()) {
    await writePrivateBlobJson(storagePaths.blobAccountsPath, accounts);
    return;
  }
  await ensureStorage();
  await writeJsonFile(storagePaths.accountsFile, accounts);
}

async function loadSessions() {
  if (getBlobToken()) {
    return readPrivateBlobJson(storagePaths.blobSessionsPath, []);
  }
  await ensureStorage();
  return readJsonFile(storagePaths.sessionsFile, []);
}

async function saveSessions(sessions) {
  if (getBlobToken()) {
    await writePrivateBlobJson(storagePaths.blobSessionsPath, sessions);
    return;
  }
  await ensureStorage();
  await writeJsonFile(storagePaths.sessionsFile, sessions);
}

async function loadBackups() {
  if (getBlobToken()) {
    return readPrivateBlobJson(storagePaths.blobBackupsPath, []);
  }
  await ensureStorage();
  return readJsonFile(storagePaths.backupsFile, []);
}

async function saveBackups(backups) {
  if (getBlobToken()) {
    await writePrivateBlobJson(storagePaths.blobBackupsPath, backups);
    return;
  }
  await ensureStorage();
  await writeJsonFile(storagePaths.backupsFile, backups);
}

function createPasswordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password ?? ""), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const nextHash = crypto.scryptSync(String(password ?? ""), String(salt ?? ""), 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(nextHash, "hex"), Buffer.from(String(hash ?? ""), "hex"));
}

function generateRestoreKey() {
  return `releu_${crypto.randomBytes(24).toString("base64url")}`;
}

function hashRestoreKey(restoreKey) {
  return crypto.createHash("sha256").update(String(restoreKey ?? "")).digest("hex");
}

function createSessionToken() {
  return `rcs_${crypto.randomBytes(32).toString("base64url")}`;
}

function createAccountId() {
  return `rca_${crypto.randomBytes(12).toString("hex")}`;
}

function createBackupId() {
  return `rcb_${crypto.randomBytes(12).toString("hex")}`;
}

function sanitizeSegment(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function accountPublicInfo(account, restoreKey) {
  return {
    id: account.id,
    username: account.username,
    restoreKey,
    deviceLabel: account.deviceLabel ?? "",
    createdAt: account.createdAt,
    rotatedAt: account.rotatedAt ?? null,
    lastSeenAt: account.lastSeenAt ?? null,
  };
}

async function persistAccount(account) {
  const accounts = await loadAccounts();
  const nextAccounts = accounts.some((entry) => entry.id === account.id)
    ? accounts.map((entry) => (entry.id === account.id ? account : entry))
    : [...accounts, account];
  await saveAccounts(nextAccounts);
  return account;
}

async function persistSession(session) {
  const sessions = await loadSessions();
  const nextSessions = sessions.some((entry) => entry.token === session.token)
    ? sessions.map((entry) => (entry.token === session.token ? session : entry))
    : [...sessions, session];
  await saveSessions(nextSessions);
  return session;
}

async function findAccountByUsername(username) {
  const normalized = normalizeUsername(username);
  const accounts = await loadAccounts();
  return accounts.find((entry) => entry.username === normalized) ?? null;
}

async function findAccountByRestoreKey(restoreKey) {
  const normalized = normalizeRestoreKey(restoreKey);
  if (!normalized) {
    return null;
  }
  const restoreKeyHash = hashRestoreKey(normalized);
  const accounts = await loadAccounts();
  const account = accounts.find((entry) => entry.restoreKeyHash === restoreKeyHash) ?? null;
  return account ? { account, restoreKey: normalized } : null;
}

async function findSessionByToken(token) {
  const normalized = String(token ?? "").trim();
  if (!normalized) {
    return null;
  }
  const sessions = await loadSessions();
  return sessions.find((entry) => entry.token === normalized) ?? null;
}

async function getAuthenticatedAccount(config = {}) {
  const cloud = getCloudBackupConfig(config);
  const session = await findSessionByToken(cloud.sessionToken);
  if (!session) {
    throw new Error("Log in to cloud backup first.");
  }
  const accounts = await loadAccounts();
  const account = accounts.find((entry) => entry.id === session.accountId) ?? null;
  if (!account) {
    throw new Error("Cloud backup account no longer exists.");
  }
  if (cloud.accountUsername && account.username !== cloud.accountUsername) {
    throw new Error("Saved cloud backup login does not match this account.");
  }
  const now = currentTimestamp();
  const nextAccount = {
    ...account,
    lastSeenAt: now,
  };
  const nextSession = {
    ...session,
    lastSeenAt: now,
  };
  await persistAccount(nextAccount);
  await persistSession(nextSession);
  return nextAccount;
}

async function getBackupOwner(config = {}, options = {}) {
  const authenticatedAccount = await getAuthenticatedAccount(config);
  const cloud = getCloudBackupConfig(config);
  const targetRestoreKey = normalizeRestoreKey(
    options.targetRestoreKey ?? cloud.targetRestoreKey,
  );
  if (!targetRestoreKey) {
    return {
      authenticatedAccount,
      ownerAccount: authenticatedAccount,
      usingSharedRestoreKey: false,
    };
  }
  const resolved = await findAccountByRestoreKey(targetRestoreKey);
  if (!resolved?.account) {
    throw new Error("Shared backup key was not found.");
  }
  return {
    authenticatedAccount,
    ownerAccount: resolved.account,
    usingSharedRestoreKey: resolved.account.id !== authenticatedAccount.id,
  };
}

function validateCredentials(username, password) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedPassword = String(password ?? "");
  if (normalizedUsername.length < 3) {
    throw new Error("Cloud username must be at least 3 characters.");
  }
  if (normalizedPassword.length < 6) {
    throw new Error("Cloud password must be at least 6 characters.");
  }
  return {
    username: normalizedUsername,
    password: normalizedPassword,
  };
}

export async function registerWebsiteCloudAccount(config = {}, payload = {}) {
  const remotePayload = await requestCloudApi(config, "/api/cloud/register", {
    method: "POST",
    body: {
      username: payload.username,
      password: payload.password,
      deviceLabel: payload.deviceLabel,
    },
  });
  if (remotePayload) {
    return {
      account: remotePayload.account ?? null,
      sessionToken: String(remotePayload.sessionToken ?? "").trim(),
    };
  }

  const { username, password } = validateCredentials(payload.username, payload.password);
  const existing = await findAccountByUsername(username);
  if (existing) {
    throw new Error("That cloud username is already taken.");
  }

  const restoreKey = generateRestoreKey();
  const passwordHash = createPasswordHash(password);
  const now = currentTimestamp();
  const account = {
    id: createAccountId(),
    username,
    passwordSalt: passwordHash.salt,
    passwordHash: passwordHash.hash,
    restoreKey,
    restoreKeyHash: hashRestoreKey(restoreKey),
    deviceLabel: normalizeDeviceLabel(payload.deviceLabel),
    createdAt: now,
    updatedAt: now,
    rotatedAt: null,
    lastSeenAt: now,
  };
  await persistAccount(account);

  const sessionToken = createSessionToken();
  await persistSession({
    token: sessionToken,
    accountId: account.id,
    createdAt: now,
    lastSeenAt: now,
  });

  return {
    account: accountPublicInfo(account, restoreKey),
    sessionToken,
  };
}

export async function loginWebsiteCloudAccount(config = {}, payload = {}) {
  const remotePayload = await requestCloudApi(config, "/api/cloud/login", {
    method: "POST",
    body: {
      username: payload.username,
      password: payload.password,
      deviceLabel: payload.deviceLabel,
    },
  });
  if (remotePayload) {
    return {
      account: remotePayload.account ?? null,
      sessionToken: String(remotePayload.sessionToken ?? "").trim(),
    };
  }

  const username = normalizeUsername(payload.username);
  const password = String(payload.password ?? "");
  const account = await findAccountByUsername(username);
  if (!account || !verifyPassword(password, account.passwordSalt, account.passwordHash)) {
    throw new Error("Cloud username or password is incorrect.");
  }

  const restoreKey = normalizeRestoreKey(account.restoreKey);
  if (!restoreKey || hashRestoreKey(restoreKey) !== account.restoreKeyHash) {
    throw new Error("Cloud backup account restore key is corrupted.");
  }
  const nextAccount = {
    ...account,
    deviceLabel:
      normalizeDeviceLabel(payload.deviceLabel) || normalizeDeviceLabel(account.deviceLabel),
    lastSeenAt: currentTimestamp(),
    updatedAt: currentTimestamp(),
  };
  await persistAccount(nextAccount);

  const sessionToken = createSessionToken();
  await persistSession({
    token: sessionToken,
    accountId: nextAccount.id,
    createdAt: currentTimestamp(),
    lastSeenAt: currentTimestamp(),
  });

  return {
    account: accountPublicInfo(nextAccount, restoreKey),
    sessionToken,
  };
}

export async function logoutWebsiteCloudAccount(config = {}) {
  const remotePayload = await requestCloudApi(config, "/api/cloud/logout", {
    method: "POST",
    body: {
      accountUsername: getCloudBackupConfig(config).accountUsername,
      sessionToken: getCloudBackupConfig(config).sessionToken,
    },
  });
  if (remotePayload) {
    return Boolean(remotePayload.loggedOut ?? true);
  }

  const cloud = getCloudBackupConfig(config);
  if (!cloud.sessionToken) {
    return false;
  }
  const sessions = await loadSessions();
  const nextSessions = sessions.filter((entry) => entry.token !== cloud.sessionToken);
  if (nextSessions.length === sessions.length) {
    return false;
  }
  await saveSessions(nextSessions);
  return true;
}

export async function issueWebsiteCloudBackupKey(config = {}, payload = {}) {
  const remotePayload = await requestCloudApi(config, "/api/cloud/issue-key", {
    method: "POST",
    body: {
      accountUsername: getCloudBackupConfig(config).accountUsername,
      sessionToken: getCloudBackupConfig(config).sessionToken,
      deviceLabel: payload.deviceLabel,
    },
  });
  if (remotePayload) {
    return {
      restoreKey: String(remotePayload.restoreKey ?? "").trim(),
      account: remotePayload.account ?? null,
    };
  }

  const account = await getAuthenticatedAccount(config);
  const restoreKey = normalizeRestoreKey(account.restoreKey);
  if (!restoreKey || hashRestoreKey(restoreKey) !== account.restoreKeyHash) {
    throw new Error("Cloud backup account restore key is corrupted.");
  }
  const nextAccount = {
    ...account,
    deviceLabel:
      normalizeDeviceLabel(payload.deviceLabel) || normalizeDeviceLabel(account.deviceLabel),
    updatedAt: currentTimestamp(),
    lastSeenAt: currentTimestamp(),
  };
  await persistAccount(nextAccount);
  return {
    restoreKey,
    account: accountPublicInfo(nextAccount, restoreKey),
  };
}

export async function rotateWebsiteCloudRestoreKey(config = {}) {
  const remotePayload = await requestCloudApi(config, "/api/cloud/rotate-key", {
    method: "POST",
    body: {
      accountUsername: getCloudBackupConfig(config).accountUsername,
      sessionToken: getCloudBackupConfig(config).sessionToken,
    },
  });
  if (remotePayload) {
    return {
      restoreKey: String(remotePayload.restoreKey ?? "").trim(),
      account: remotePayload.account ?? null,
    };
  }

  const account = await getAuthenticatedAccount(config);
  const restoreKey = generateRestoreKey();
  const nextAccount = {
    ...account,
    restoreKey,
    restoreKeyHash: hashRestoreKey(restoreKey),
    updatedAt: currentTimestamp(),
    rotatedAt: currentTimestamp(),
    lastSeenAt: currentTimestamp(),
  };
  await persistAccount(nextAccount);
  return {
    restoreKey,
    account: accountPublicInfo(nextAccount, restoreKey),
  };
}

export async function getWebsiteCloudHealth(config = {}) {
  const remotePayload = await requestCloudApi(config, "/api/cloud/health");
  if (remotePayload) {
    return {
      provider: "website",
      uploadLimitBytes:
        Math.max(1, Number(remotePayload.uploadLimitBytes ?? 0) || 0) ||
        Math.max(1, Number(getCloudBackupConfig(config).uploadLimitMb ?? 50) || 50) * 1024 * 1024,
      storageMode: String(remotePayload.storageMode ?? "panel-website").trim() || "panel-website",
    };
  }

  const cloud = getCloudBackupConfig(config);
  return {
    provider: "website",
    uploadLimitBytes: Math.max(1, Number(cloud.uploadLimitMb ?? 50) || 50) * 1024 * 1024,
    storageMode: "panel-website",
  };
}

export async function listWebsiteCloudBackups(config = {}, options = {}) {
  const { authenticatedAccount, ownerAccount, usingSharedRestoreKey } = await getBackupOwner(
    config,
    options,
  );
  const requestedServerId = String(options.serverId ?? "").trim();
  const backups = await loadBackups();
  const visibleBackups = backups
    .filter((entry) => entry.accountId === ownerAccount.id)
    .filter((entry) => !requestedServerId || String(entry.serverId ?? "").trim() === requestedServerId)
    .sort((left, right) => Date.parse(right.created_at ?? right.createdAt ?? 0) - Date.parse(left.created_at ?? left.createdAt ?? 0));
  return {
    authenticatedAccount: accountPublicInfo(
      authenticatedAccount,
      normalizeRestoreKey(config?.restoreKey),
    ),
    ownerAccount: {
      id: ownerAccount.id,
      username: ownerAccount.username,
      deviceLabel: ownerAccount.deviceLabel ?? "",
      createdAt: ownerAccount.createdAt,
      rotatedAt: ownerAccount.rotatedAt ?? null,
    },
    usingSharedRestoreKey,
    backups: visibleBackups,
  };
}

export async function storeWebsiteCloudBackup(config = {}, payload = {}) {
  const { ownerAccount, usingSharedRestoreKey } = await getBackupOwner(config, payload);
  const sourceArchivePath = String(payload.sourceArchivePath ?? "").trim();
  const serverId = String(payload.serverId ?? "").trim();
  const backupName = String(payload.backupName ?? "").trim();
  const serverName = String(payload.serverName ?? "").trim();
  const sizeBytes = Math.max(0, Number(payload.sizeBytes ?? 0) || 0);
  const sha256 = String(payload.sha256 ?? "").trim().toLowerCase();
  if (!sourceArchivePath) {
    throw new Error("Cloud backup archive path is missing.");
  }
  if (!serverId || !backupName || !serverName) {
    throw new Error("Cloud backup details are incomplete.");
  }
  if (sizeBytes <= 0) {
    throw new Error("Cloud backup archive is empty.");
  }

  const backupId = createBackupId();
  const serverSegment = sanitizeSegment(serverId, "server");
  const fileName = `${Date.now()}-${sanitizeSegment(backupName, "backup")}.zip`;
  let targetPath = "";
  let blobPath = "";
  const blobToken = getBlobToken();
  if (blobToken) {
    blobPath = `releu-cloud/backups/${ownerAccount.id}/${serverSegment}/${fileName}`;
    await put(blobPath, fsSync.createReadStream(sourceArchivePath), {
      access: "private",
      token: blobToken,
      multipart: true,
      addRandomSuffix: false,
      contentType: "application/zip",
    });
  } else {
    const targetDir = path.join(storagePaths.filesDir, ownerAccount.id, serverSegment);
    targetPath = path.join(targetDir, fileName);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(sourceArchivePath, targetPath);
  }

  const now = currentTimestamp();
  const backupRecord = {
    id: backupId,
    accountId: ownerAccount.id,
    server_id: serverId,
    serverId,
    server_name: serverName,
    serverName,
    backup_name: backupName,
    backupName,
    size_bytes: sizeBytes,
    sizeBytes,
    sha256,
    file_path: targetPath,
    filePath: targetPath,
    blob_path: blobPath,
    blobPath,
    status: "ready",
    created_at: now,
    createdAt: now,
    updated_at: now,
    updatedAt: now,
    logicalKind: usingSharedRestoreKey ? "shared" : "single",
  };

  const backups = await loadBackups();
  backups.push(backupRecord);
  await saveBackups(backups);
  return backupRecord;
}

export async function getWebsiteCloudBackup(config = {}, backupId, options = {}) {
  const { ownerAccount } = await getBackupOwner(config, options);
  const normalizedBackupId = String(backupId ?? "").trim();
  if (!normalizedBackupId) {
    throw new Error("Choose a cloud backup first.");
  }
  const backups = await loadBackups();
  const backup = backups.find(
    (entry) => entry.id === normalizedBackupId && entry.accountId === ownerAccount.id,
  );
  if (!backup) {
    throw new Error("The selected cloud backup no longer exists.");
  }
  const blobPath = String(backup.blobPath ?? backup.blob_path ?? "").trim();
  if (blobPath && getBlobToken()) {
    const blobMeta = await head(blobPath, {
      token: getBlobToken(),
    }).catch(() => null);
    if (!blobMeta) {
      throw new Error("The stored cloud backup file is missing.");
    }
    return backup;
  }
  if (!(await fs.stat(String(backup.filePath ?? backup.file_path ?? "")).catch(() => null))) {
    throw new Error("The stored cloud backup file is missing.");
  }
  return backup;
}

export async function downloadWebsiteCloudBackupToFile(backup, targetPath) {
  const blobPath = String(backup?.blobPath ?? backup?.blob_path ?? "").trim();
  if (blobPath && getBlobToken()) {
    const result = await get(blobPath, {
      access: "private",
      token: getBlobToken(),
      useCache: false,
    });
    if (!result?.stream) {
      throw new Error("The stored cloud backup file is missing.");
    }
    const arrayBuffer = await new Response(result.stream).arrayBuffer();
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, Buffer.from(arrayBuffer));
    return targetPath;
  }
  const sourcePath = String(backup?.filePath ?? backup?.file_path ?? "").trim();
  if (!sourcePath) {
    throw new Error("The stored cloud backup file is missing.");
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  return targetPath;
}
