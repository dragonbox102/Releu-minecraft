import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { once } from "node:events";

import extractZip from "extract-zip";
import * as tar from "tar";

import { currentTimestamp, fileExists, paths, sanitizeLogLine } from "./config.js";
import {
  getJavaExecutableName,
  getMicrosoftJdkDownloadUrl,
  isMac,
  isWindows,
  withHiddenConsole,
} from "./platform.js";

const DOWNLOAD_USER_AGENT = "releu-minecraft/1.0";

const JAVA_EXECUTABLE_NAME = getJavaExecutableName();
const JAVA_ARCHIVE_EXTENSION = isWindows ? "zip" : "tar.gz";
const JAVA_DEPENDENCIES = [8, 17, 21, 25].map((major) => ({
  id: `java${major}`,
  name: `Microsoft OpenJDK ${major}`,
  major,
  requiredOnBootstrap: major >= 17,
  archivePath: path.join(paths.toolsDir, `microsoft-jdk-${major}.${JAVA_ARCHIVE_EXTENSION}`),
  installDir: path.join(paths.toolsDir, `microsoft-jdk-${major}`),
  downloadUrl: getMicrosoftJdkDownloadUrl(major),
}));

async function findJavaBinaryInDirectory(rootDir) {
  if (!(await fileExists(rootDir))) {
    return null;
  }

  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    const candidate = path.join(current.dir, "bin", JAVA_EXECUTABLE_NAME);
    if (await fileExists(candidate)) {
      return candidate;
    }

    if (current.depth >= 3) {
      continue;
    }

    const entries = await fsp.readdir(current.dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push({
          dir: path.join(current.dir, entry.name),
          depth: current.depth + 1,
        });
      }
    }
  }

  return null;
}

async function inspectJavaBinary(javaPath) {
  if (!javaPath) {
    return { version: null, major: null, raw: "" };
  }

  return new Promise((resolve) => {
    const child = spawn(javaPath, ["-version"], withHiddenConsole());

    let output = "";
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      const versionMatch =
        output.match(/version "([^"]+)"/i) ?? output.match(/openjdk ([^\s"]+)/i);
      const version = versionMatch?.[1] ?? null;
      const major = version ? Number(version.split(/[._+-]/)[0]) : null;
      resolve({
        version,
        major,
        raw: sanitizeLogLine(output),
      });
    };

    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });

    child.on("error", finish);
    child.on("exit", finish);
  });
}

async function extractJavaArchive(archivePath, destinationPath) {
  await fsp.rm(destinationPath, { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(destinationPath, { recursive: true });

  if (archivePath.endsWith(".zip")) {
    await extractZip(archivePath, {
      dir: destinationPath,
    });
    return;
  }

  if (archivePath.endsWith(".tar.gz")) {
    await tar.x({
      cwd: destinationPath,
      file: archivePath,
      strict: true,
    });
    return;
  }

  throw new Error("Unsupported Java archive format.");
}

async function downloadToFile(url, destinationPath, onProgress = null) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": DOWNLOAD_USER_AGENT,
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Unable to download dependency (${response.status}).`);
  }

  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.download`;
  await fsp.rm(tempPath, { force: true }).catch(() => {});
  const output = fs.createWriteStream(tempPath);
  const totalBytes = Number(response.headers.get("content-length")) || null;
  const startedAt = Date.now();
  let downloadedBytes = 0;

  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      const buffer = Buffer.from(chunk);
      downloadedBytes += buffer.length;
      if (!output.write(buffer)) {
        await once(output, "drain");
      }

      if (onProgress) {
        const elapsedSeconds = Math.max(0.25, (Date.now() - startedAt) / 1000);
        onProgress({
          downloadedBytes,
          totalBytes,
          speedBytesPerSecond: downloadedBytes / elapsedSeconds,
        });
      }
    }

    await new Promise((resolve, reject) => {
      output.end((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await fsp.rm(destinationPath, { force: true }).catch(() => {});
    await fsp.rename(tempPath, destinationPath);
  } catch (error) {
    output.destroy();
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export class DependencyManager {
  constructor({ appendLog, playitManager }) {
    this.appendLog = appendLog;
    this.playitManager = playitManager;
    this.ensurePromise = null;
    this.state = {
      checkedAt: null,
      ensuredAt: null,
      running: false,
      stage: "idle",
      message: null,
      ready: false,
      missing: [],
      dependencies: {},
      currentDependencyId: null,
      currentLabel: null,
      currentTask: null,
      downloadedBytes: 0,
      totalBytes: null,
      speedBytesPerSecond: 0,
    };
  }

  snapshot() {
    return structuredClone(this.state);
  }

  getManagedJavaPath(major) {
    const target = this.state.dependencies[`java${Number(major)}`];
    return target?.present ? target.path : null;
  }

  getJavaDefinition(major) {
    return JAVA_DEPENDENCIES.find((entry) => entry.major === Number(major)) ?? null;
  }

  async check() {
    if (this.state.running) {
      return this.snapshot();
    }

    const dependencyState = {};

    for (const entry of JAVA_DEPENDENCIES) {
      const javaPath = await findJavaBinaryInDirectory(entry.installDir);
      const javaInfo = javaPath ? await inspectJavaBinary(javaPath) : { version: null, major: null };
      dependencyState[entry.id] = {
        id: entry.id,
        name: entry.name,
        type: "java",
        requiredOnBootstrap: entry.requiredOnBootstrap,
        present: Boolean(javaPath),
        path: javaPath,
        version: javaInfo.version,
        major: javaInfo.major,
      };
    }

    const playitBinaryPath = await this.playitManager.resolveInstalledBinaryPath();
    const playitPresent = Boolean(playitBinaryPath);
    const playitSnapshot = this.playitManager.snapshot();
    dependencyState.playit = {
      id: "playit",
      name: "playit.gg Agent",
      type: "playit",
      requiredOnBootstrap: !isMac,
      present: playitPresent,
      path: playitBinaryPath,
      version: playitSnapshot.version ?? null,
    };

    const missing = Object.values(dependencyState)
      .filter((entry) => entry.requiredOnBootstrap !== false && !entry.present)
      .map((entry) => entry.id);

    this.state = {
      ...this.state,
      checkedAt: currentTimestamp(),
      running: false,
      stage: missing.length ? "missing" : "ready",
      message: missing.length ? "Dependencies are missing." : "All dependencies are ready.",
      ready: missing.length === 0,
      missing,
      dependencies: dependencyState,
      currentDependencyId: null,
      currentLabel: null,
      currentTask: null,
      downloadedBytes: 0,
      totalBytes: null,
      speedBytesPerSecond: 0,
    };

    return this.snapshot();
  }

  async ensureAll() {
    if (this.ensurePromise) {
      return this.ensurePromise;
    }

    this.ensurePromise = this.runEnsureAll().finally(() => {
      this.ensurePromise = null;
    });
    return this.ensurePromise;
  }

  async ensureJavaMajor(major) {
    const definition = this.getJavaDefinition(major);
    if (!definition) {
      throw new Error(`Releu does not manage Java ${major}.`);
    }

    if (this.ensurePromise) {
      await this.ensurePromise;
    }

    await this.check();
    const current = this.state.dependencies[definition.id];
    if (current?.present) {
      return current;
    }

    this.state.running = true;
    this.state.stage = "downloading";

    try {
      this.updateActivity({
        dependencyId: definition.id,
        task: "prepare",
        label: `Preparing ${definition.name}`,
        downloadedBytes: 0,
        totalBytes: null,
        speedBytesPerSecond: 0,
      });
      this.appendLog("panel", `Installing ${definition.name}...`);
      await this.ensureJavaRuntime(definition);
    } finally {
      this.state.running = false;
    }

    await this.check();
    this.state.ensuredAt = currentTimestamp();
    return this.state.dependencies[definition.id];
  }

  async runEnsureAll() {
    await this.check();
    if (this.state.ready) {
      return this.snapshot();
    }

    this.state.running = true;
    this.state.stage = "downloading";

    try {
      for (const dependencyId of this.state.missing) {
        if (dependencyId === "playit") {
          this.updateActivity({
            dependencyId,
            task: "download",
            label: "Downloading playit.gg agent",
            downloadedBytes: 0,
            totalBytes: null,
            speedBytesPerSecond: 0,
          });
          this.appendLog("panel", "Downloading playit.gg agent...");
          await this.playitManager.installBinary((progress) => {
            this.updateActivity({
              dependencyId,
              task: "download",
              label: `Downloading ${progress.fileName}`,
              downloadedBytes: progress.downloadedBytes,
              totalBytes: progress.totalBytes,
              speedBytesPerSecond: progress.speedBytesPerSecond,
            });
          });
          continue;
        }

        const definition = JAVA_DEPENDENCIES.find((entry) => entry.id === dependencyId);
        if (!definition) {
          continue;
        }

        this.updateActivity({
          dependencyId,
          task: "prepare",
          label: `Preparing ${definition.name}`,
          downloadedBytes: 0,
          totalBytes: null,
          speedBytesPerSecond: 0,
        });
        this.appendLog("panel", `Installing ${definition.name}...`);
        await this.ensureJavaRuntime(definition);
      }
    } finally {
      this.state.running = false;
    }

    await this.check();
    this.state.ensuredAt = currentTimestamp();
    return this.snapshot();
  }

  updateActivity({
    dependencyId = null,
    task = null,
    label = null,
    downloadedBytes = 0,
    totalBytes = null,
    speedBytesPerSecond = 0,
  } = {}) {
    this.state.currentDependencyId = dependencyId;
    this.state.currentTask = task;
    this.state.currentLabel = label;
    this.state.downloadedBytes = downloadedBytes;
    this.state.totalBytes = totalBytes;
    this.state.speedBytesPerSecond = speedBytesPerSecond;
    this.state.message = label;
  }

  async ensureJavaRuntime(definition) {
    const attemptInstall = async (forceFreshArchive = false) => {
      if (forceFreshArchive) {
        await fsp.rm(definition.archivePath, { force: true }).catch(() => {});
        await fsp.rm(definition.installDir, { recursive: true, force: true }).catch(() => {});
      }

      if (!(await fileExists(definition.archivePath))) {
        this.appendLog("panel", `Downloading ${definition.name} archive...`);
        await downloadToFile(definition.downloadUrl, definition.archivePath, (progress) => {
          this.updateActivity({
            dependencyId: definition.id,
            task: "download",
            label: `Downloading ${path.basename(definition.archivePath)}`,
            downloadedBytes: progress.downloadedBytes,
            totalBytes: progress.totalBytes,
            speedBytesPerSecond: progress.speedBytesPerSecond,
          });
        });
      } else {
        this.appendLog("panel", `Using cached ${definition.name} archive.`);
      }

      this.updateActivity({
        dependencyId: definition.id,
        task: "extract",
        label: `Extracting ${path.basename(definition.archivePath)}`,
        downloadedBytes: 0,
        totalBytes: null,
        speedBytesPerSecond: 0,
      });
      await extractJavaArchive(definition.archivePath, definition.installDir);
      const javaPath = await findJavaBinaryInDirectory(definition.installDir);
      if (!javaPath) {
        throw new Error(
          `${definition.name} was extracted, but ${JAVA_EXECUTABLE_NAME} was not found.`,
        );
      }

      const javaInfo = await inspectJavaBinary(javaPath);
      this.updateActivity({
        dependencyId: definition.id,
        task: "finalize",
        label: `Installed ${definition.name}${javaInfo.version ? ` (${javaInfo.version})` : ""}`,
        downloadedBytes: 0,
        totalBytes: null,
        speedBytesPerSecond: 0,
      });
      this.appendLog(
        "panel",
        `Installed ${definition.name}${javaInfo.version ? ` (${javaInfo.version})` : ""}.`,
      );
      return {
        path: javaPath,
        version: javaInfo.version,
        major: javaInfo.major,
      };
    };

    try {
      return await attemptInstall(false);
    } catch (error) {
      this.appendLog(
        "panel",
        `Cached ${definition.name} archive failed validation. Re-downloading a clean copy...`,
      );
      return attemptInstall(true);
    }
  }
}
