import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";

const tailscaleCliCandidates = [
  process.env.TAILSCALE_CLI || "",
  "C:\\Program Files\\Tailscale\\tailscale.exe",
  "tailscale",
];

function currentTimestamp() {
  return new Date().toISOString();
}

function quotePosix(value) {
  return `'${String(value ?? "").replace(/'/g, `'\"'\"'`)}'`;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeAccountUsername(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw new Error("Cloud backup username is required.");
  }
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/.test(normalized)) {
    throw new Error(
      "Cloud backup username must be 3 to 32 characters and can only use letters, numbers, dots, dashes, or underscores.",
    );
  }
  return normalized;
}

function normalizePassword(value) {
  const password = String(value ?? "");
  if (password.length < 6) {
    throw new Error("Cloud backup password must be at least 6 characters.");
  }
  if (password.length > 200) {
    throw new Error("Cloud backup password is too long.");
  }
  return password;
}

function generateRestoreKey() {
  return `releu_${randomBytes(24).toString("base64url")}`;
}

function generateSessionToken() {
  return `releu_sess_${randomBytes(24).toString("base64url")}`;
}

function derivePasswordHash(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}

function hashSessionToken(token) {
  return createHash("sha256").update(String(token ?? ""), "utf8").digest("hex");
}

function isTimingSafeHexMatch(left, right) {
  const normalizedLeft = String(left ?? "").trim();
  const normalizedRight = String(right ?? "").trim();
  if (!normalizedLeft || !normalizedRight || normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(normalizedLeft, "hex"),
    Buffer.from(normalizedRight, "hex"),
  );
}

function parseRemoteJson(rawText, label) {
  const raw = String(rawText ?? "").trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`The remote ${label} file is invalid JSON.`);
  }
}

function getRemoteTarget(config) {
  const host = String(config?.tailscaleHost ?? "").trim();
  const user = String(config?.tailscaleUser ?? "").trim();
  if (!host || !user) {
    throw new Error("Tailscale host and Linux username are required.");
  }
  return `${user}@${host}`;
}

export function getTailscaleRemoteBaseDir(config) {
  const baseDir = String(config?.tailscaleRemoteDir ?? "").trim();
  if (!baseDir) {
    throw new Error("The linked Linux backup folder is not configured.");
  }
  return baseDir;
}

function getRemoteAuthRootDir(config) {
  return `${getTailscaleRemoteBaseDir(config).replace(/\/+$/g, "")}/.releu-auth`;
}

function getRemoteUsersDir(config) {
  return `${getRemoteAuthRootDir(config)}/users`;
}

function getRemoteAccountPath(config, username) {
  return `${getRemoteUsersDir(config)}/${normalizeAccountUsername(username)}.json`;
}

function getEffectiveRestoreKey(config) {
  const overrideKey = String(config?.targetRestoreKey ?? "").trim();
  if (overrideKey) {
    return overrideKey;
  }
  const ownKey = String(config?.restoreKey ?? "").trim();
  if (!ownKey) {
    throw new Error("Generate or sync a cloud backup restore key first.");
  }
  return ownKey;
}

function deriveRemoteScopeHash(config, serverId) {
  return createHash("sha256")
    .update(`${getEffectiveRestoreKey(config)}:${String(serverId ?? "").trim()}`, "utf8")
    .digest("hex");
}

function getRemoteServerDir(config, serverId) {
  const baseDir = getTailscaleRemoteBaseDir(config).replace(/\/+$/g, "");
  const scopeHash = deriveRemoteScopeHash(config, serverId);
  return `${baseDir}/.releu-store/${scopeHash.slice(0, 2)}/${scopeHash.slice(2, 4)}/${scopeHash}`;
}

function getLegacyRemoteArchivePath(config) {
  return `${getTailscaleRemoteBaseDir(config).replace(/\/+$/g, "")}/latest.zip`;
}

function getLegacyRemoteMetadataPath(config) {
  return `${getTailscaleRemoteBaseDir(config).replace(/\/+$/g, "")}/latest.json`;
}

function getRemoteArchivePath(config, serverId) {
  return `${getRemoteServerDir(config, serverId)}/latest.zip`;
}

function getRemoteMetadataPath(config, serverId) {
  return `${getRemoteServerDir(config, serverId)}/latest.json`;
}

export async function resolveTailscaleCliPath() {
  for (const candidate of tailscaleCliCandidates) {
    const normalized = String(candidate ?? "").trim();
    if (!normalized) {
      continue;
    }
    if (normalized.toLowerCase() === "tailscale") {
      return normalized;
    }
    if (await fileExists(normalized)) {
      return normalized;
    }
  }
  throw new Error("Tailscale CLI is not installed on this PC.");
}

export async function runTailscaleSsh(config, remoteCommand, options = {}) {
  const cliPath = await resolveTailscaleCliPath();
  const target = getRemoteTarget(config);
  const child = spawn(cliPath, ["ssh", target, remoteCommand], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  if (options.stdinFilePath) {
    const stream = createReadStream(options.stdinFilePath);
    stream.pipe(child.stdin);
    await once(stream, "close");
  } else if (options.stdinBuffer) {
    child.stdin.end(options.stdinBuffer);
  } else {
    child.stdin.end();
  }

  const [exitCode] = await once(child, "close");
  if (exitCode !== 0) {
    throw new Error(
      (stderr || stdout || `Tailscale SSH command failed with exit code ${exitCode}.`).trim(),
    );
  }

  return {
    stdout,
    stderr,
  };
}

async function ensureRemoteAccountLayout(config) {
  const authRoot = getRemoteAuthRootDir(config);
  const usersDir = getRemoteUsersDir(config);
  await runTailscaleSsh(
    config,
    `umask 077 && mkdir -p ${quotePosix(authRoot)} ${quotePosix(usersDir)} && chmod 700 ${quotePosix(authRoot)} ${quotePosix(usersDir)}`,
  );
  return {
    authRoot,
    usersDir,
  };
}

async function readRemoteAccountRecord(config, username) {
  await ensureRemoteAccountLayout(config);
  const accountPath = getRemoteAccountPath(config, username);
  const response = await runTailscaleSsh(
    config,
    `if [ -f ${quotePosix(accountPath)} ]; then cat ${quotePosix(accountPath)}; fi`,
  );
  return parseRemoteJson(response.stdout, "cloud account");
}

async function writeRemoteJsonFile(config, remotePath, value) {
  await runTailscaleSsh(
    config,
    `umask 077 && mkdir -p ${quotePosix(remotePath.replace(/\/[^/]+$/g, ""))} && cat > ${quotePosix(`${remotePath}.tmp`)} && chmod 600 ${quotePosix(`${remotePath}.tmp`)} && mv ${quotePosix(`${remotePath}.tmp`)} ${quotePosix(remotePath)} && chmod 600 ${quotePosix(remotePath)}`,
    {
      stdinBuffer: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    },
  );
}

export async function registerTailscaleCloudAccount(config, payload = {}) {
  const username = normalizeAccountUsername(payload.username);
  const password = normalizePassword(payload.password);
  const existing = await readRemoteAccountRecord(config, username);
  if (existing) {
    throw new Error("That cloud backup username already exists.");
  }

  const now = currentTimestamp();
  const restoreKey = String(config?.restoreKey ?? "").trim() || generateRestoreKey();
  const sessionToken = generateSessionToken();
  const passwordSalt = randomBytes(16).toString("hex");
  const accountRecord = {
    format: "releu-tailscale-cloud-account-v1",
    username,
    restoreKey,
    passwordSalt,
    passwordHash: derivePasswordHash(password, passwordSalt),
    sessionHash: hashSessionToken(sessionToken),
    sessionIssuedAt: now,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    lastDeviceLabel: String(payload.deviceLabel ?? "").trim(),
  };

  await writeRemoteJsonFile(config, getRemoteAccountPath(config, username), accountRecord);
  return {
    username,
    restoreKey,
    sessionToken,
  };
}

export async function loginTailscaleCloudAccount(config, payload = {}) {
  const username = normalizeAccountUsername(payload.username);
  const password = normalizePassword(payload.password);
  const accountRecord = await readRemoteAccountRecord(config, username);
  if (!accountRecord) {
    throw new Error("Cloud backup account not found.");
  }

  const expectedHash = String(accountRecord.passwordHash ?? "").trim();
  const passwordSalt = String(accountRecord.passwordSalt ?? "").trim();
  const actualHash = derivePasswordHash(password, passwordSalt);
  if (!isTimingSafeHexMatch(expectedHash, actualHash)) {
    throw new Error("Cloud backup login failed. Check the username and password.");
  }

  const now = currentTimestamp();
  const sessionToken = generateSessionToken();
  const nextRecord = {
    ...accountRecord,
    restoreKey: String(accountRecord.restoreKey ?? "").trim() || generateRestoreKey(),
    sessionHash: hashSessionToken(sessionToken),
    sessionIssuedAt: now,
    updatedAt: now,
    lastLoginAt: now,
    lastDeviceLabel: String(payload.deviceLabel ?? accountRecord.lastDeviceLabel ?? "").trim(),
  };

  await writeRemoteJsonFile(config, getRemoteAccountPath(config, username), nextRecord);
  return {
    username,
    restoreKey: nextRecord.restoreKey,
    sessionToken,
  };
}

export async function logoutTailscaleCloudAccount(config, payload = {}) {
  const username = normalizeAccountUsername(payload.username ?? config?.accountUsername ?? "");
  const accountRecord = await readRemoteAccountRecord(config, username);
  if (!accountRecord) {
    return false;
  }
  const nextRecord = {
    ...accountRecord,
    sessionHash: "",
    sessionIssuedAt: null,
    updatedAt: currentTimestamp(),
  };
  await writeRemoteJsonFile(config, getRemoteAccountPath(config, username), nextRecord);
  return true;
}

export async function authenticateTailscaleCloudAccount(config) {
  const username = normalizeAccountUsername(config?.accountUsername ?? "");
  const sessionToken = String(config?.sessionToken ?? "").trim();
  if (!sessionToken) {
    throw new Error("Log in to cloud backup first.");
  }

  const accountRecord = await readRemoteAccountRecord(config, username);
  if (!accountRecord) {
    throw new Error("Cloud backup account not found.");
  }

  const expectedSessionHash = String(accountRecord.sessionHash ?? "").trim();
  if (!expectedSessionHash) {
    throw new Error("Cloud backup login expired. Log in again.");
  }

  const actualSessionHash = hashSessionToken(sessionToken);
  if (!isTimingSafeHexMatch(expectedSessionHash, actualSessionHash)) {
    throw new Error("Cloud backup login expired. Log in again.");
  }

  const restoreKey = String(accountRecord.restoreKey ?? "").trim();
  if (!restoreKey) {
    throw new Error("This cloud backup account does not have a restore key yet.");
  }

  return {
    username,
    restoreKey,
    targetRestoreKey: String(config?.targetRestoreKey ?? "").trim(),
    usingSharedRestoreKey: Boolean(String(config?.targetRestoreKey ?? "").trim()),
  };
}

export async function rotateTailscaleCloudRestoreKey(config) {
  const session = await authenticateTailscaleCloudAccount(config);
  const accountRecord = await readRemoteAccountRecord(config, session.username);
  if (!accountRecord) {
    throw new Error("Cloud backup account not found.");
  }
  const nextRestoreKey = generateRestoreKey();
  const nextRecord = {
    ...accountRecord,
    restoreKey: nextRestoreKey,
    updatedAt: currentTimestamp(),
  };
  await writeRemoteJsonFile(config, getRemoteAccountPath(config, session.username), nextRecord);
  return {
    username: session.username,
    restoreKey: nextRestoreKey,
  };
}

export async function checkTailscaleBackupTarget(config) {
  const remoteDir = getTailscaleRemoteBaseDir(config);
  const response = await runTailscaleSsh(
    config,
    `umask 077 && mkdir -p ${quotePosix(remoteDir)} && chmod 700 ${quotePosix(remoteDir)} && printf ready`,
  );
  return {
    ready: response.stdout.trim() === "ready",
    remoteDir,
    target: getRemoteTarget(config),
  };
}

async function ensureRemoteServerLayout(config, serverId) {
  const remoteDir = getRemoteServerDir(config, serverId);
  const remoteArchivePath = getRemoteArchivePath(config, serverId);
  const remoteMetadataPath = getRemoteMetadataPath(config, serverId);
  const legacyArchivePath = getLegacyRemoteArchivePath(config);
  const legacyMetadataPath = getLegacyRemoteMetadataPath(config);

  await runTailscaleSsh(
    config,
    `umask 077 && mkdir -p ${quotePosix(remoteDir)} && chmod 700 ${quotePosix(getTailscaleRemoteBaseDir(config))} ${quotePosix(remoteDir)} 2>/dev/null || chmod 700 ${quotePosix(remoteDir)} && if [ -f ${quotePosix(legacyArchivePath)} ] && [ ! -f ${quotePosix(remoteArchivePath)} ]; then mv ${quotePosix(legacyArchivePath)} ${quotePosix(remoteArchivePath)} && chmod 600 ${quotePosix(remoteArchivePath)}; fi && if [ -f ${quotePosix(legacyMetadataPath)} ] && [ ! -f ${quotePosix(remoteMetadataPath)} ]; then mv ${quotePosix(legacyMetadataPath)} ${quotePosix(remoteMetadataPath)} && chmod 600 ${quotePosix(remoteMetadataPath)}; fi`,
  );

  return {
    remoteDir,
    remoteArchivePath,
    remoteMetadataPath,
  };
}

export async function readRemoteBackupMetadata(config, serverId) {
  await ensureRemoteServerLayout(config, serverId);
  const metadataPath = getRemoteMetadataPath(config, serverId);
  try {
    const response = await runTailscaleSsh(
      config,
      `if [ -f ${quotePosix(metadataPath)} ]; then cat ${quotePosix(metadataPath)}; fi`,
    );
    return parseRemoteJson(response.stdout, "backup metadata");
  } catch (error) {
    throw new Error(`Unable to read remote backup metadata: ${error.message ?? error}`);
  }
}

export async function uploadRollingRemoteBackup(config, serverId, archivePath, metadata) {
  const { remoteDir, remoteArchivePath, remoteMetadataPath } = await ensureRemoteServerLayout(
    config,
    serverId,
  );

  await runTailscaleSsh(
    config,
    `umask 077 && mkdir -p ${quotePosix(remoteDir)} && chmod 700 ${quotePosix(remoteDir)} && cat > ${quotePosix(`${remoteArchivePath}.tmp`)} && chmod 600 ${quotePosix(`${remoteArchivePath}.tmp`)} && mv ${quotePosix(`${remoteArchivePath}.tmp`)} ${quotePosix(remoteArchivePath)} && chmod 600 ${quotePosix(remoteArchivePath)}`,
    {
      stdinFilePath: archivePath,
    },
  );

  await runTailscaleSsh(
    config,
    `umask 077 && mkdir -p ${quotePosix(remoteDir)} && chmod 700 ${quotePosix(remoteDir)} && cat > ${quotePosix(`${remoteMetadataPath}.tmp`)} && chmod 600 ${quotePosix(`${remoteMetadataPath}.tmp`)} && mv ${quotePosix(`${remoteMetadataPath}.tmp`)} ${quotePosix(remoteMetadataPath)} && chmod 600 ${quotePosix(remoteMetadataPath)}`,
    {
      stdinBuffer: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
    },
  );

  await runTailscaleSsh(
    config,
    `find ${quotePosix(remoteDir)} -mindepth 1 -maxdepth 1 ! -name latest.zip ! -name latest.json -exec rm -rf {} +`,
  );

  return {
    archivePath: remoteArchivePath,
    metadataPath: remoteMetadataPath,
  };
}

export async function downloadRollingRemoteBackup(config, serverId, localArchivePath) {
  await ensureRemoteServerLayout(config, serverId);
  const remoteArchivePath = getRemoteArchivePath(config, serverId);
  const cliPath = await resolveTailscaleCliPath();
  const target = getRemoteTarget(config);
  const child = spawn(cliPath, ["ssh", target, `cat ${quotePosix(remoteArchivePath)}`], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const output = createWriteStream(localArchivePath);
  child.stdout.pipe(output);

  await once(output, "close");
  const [exitCode] = await once(child, "close");
  if (exitCode !== 0) {
    throw new Error((stderr || `Unable to download remote backup (exit code ${exitCode}).`).trim());
  }
}
