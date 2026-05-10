const fs = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const runtimeSourceDir = path.join(projectRoot, "dist", "win-unpacked");
const runtimeEntries = [
  "locales",
  "resources",
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "d3dcompiler_47.dll",
  "dxcompiler.dll",
  "dxil.dll",
  "ffmpeg.dll",
  "icudtl.dat",
  "libEGL.dll",
  "libGLESv2.dll",
  "LICENSE.electron.txt",
  "LICENSES.chromium.html",
  "Releu-minecraft.exe",
  "resources.pak",
  "snapshot_blob.bin",
  "v8_context_snapshot.bin",
  "vk_swiftshader.dll",
  "vk_swiftshader_icd.json",
  "vulkan-1.dll",
];
const legacyStandaloneArtifacts = [
  path.join(projectRoot, "Releu-minecraft-pelican.exe"),
  path.join(projectRoot, "Releu-minecraft-portable.exe"),
  path.join(projectRoot, "Releu-minecraft-pelican-portable.exe"),
];

async function removeIfExists(targetPath) {
  try {
    await fs.rm(targetPath, {
      recursive: true,
      force: true,
    });
    return true;
  } catch (error) {
    if (error?.code === "EBUSY" || error?.code === "EPERM") {
      console.warn(`Skipping locked runtime path: ${targetPath}`);
      return false;
    }
    throw error;
  }
}

async function ensureExists(targetPath, label) {
  try {
    await fs.access(targetPath);
  } catch {
    throw new Error(`${label} was not found at ${targetPath}`);
  }
}

async function syncRuntimeToProjectRoot() {
  await ensureExists(runtimeSourceDir, "Electron runtime output");

  for (const entry of runtimeEntries) {
    const sourcePath = path.join(runtimeSourceDir, entry);
    const targetPath = path.join(projectRoot, entry);
    await ensureExists(sourcePath, `Runtime entry ${entry}`);
    const removed = await removeIfExists(targetPath);
    if (!removed) {
      continue;
    }
    await fs.cp(sourcePath, targetPath, {
      recursive: true,
      force: true,
    });
  }

  for (const legacyArtifact of legacyStandaloneArtifacts) {
    await removeIfExists(legacyArtifact);
  }
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

syncRuntimeToProjectRoot().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
