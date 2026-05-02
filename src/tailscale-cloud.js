import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";

const tailscaleCliCandidates = [
  process.env.TAILSCALE_CLI || "",
  "C:\\Program Files\\Tailscale\\tailscale.exe",
  "tailscale",
];

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

function deriveRemoteScopeHash(config, serverId) {
  const restoreKey = String(config?.restoreKey ?? "").trim();
  if (!restoreKey) {
    throw new Error("Generate a cloud backup restore key first.");
  }
  return createHash("sha256")
    .update(`${restoreKey}:${String(serverId ?? "").trim()}`, "utf8")
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

export async function runTailscaleSsh(config, remoteCommand, options = {}) {
  const cliPath = await resolveTailscaleCliPath();
  const target = getRemoteTarget(config);
  const child = spawn(
    cliPath,
    ["ssh", target, remoteCommand],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );

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
    throw new Error((stderr || stdout || `Tailscale SSH command failed with exit code ${exitCode}.`).trim());
  }

  return {
    stdout,
    stderr,
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
    const raw = String(response.stdout ?? "").trim();
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
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
  const child = spawn(
    cliPath,
    ["ssh", target, `cat ${quotePosix(remoteArchivePath)}`],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

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
