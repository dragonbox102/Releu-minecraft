const fs = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const mode = String(process.argv[2] ?? "").trim().toLowerCase();

const staleArtifacts = [
  path.join(projectRoot, "dist", "Releu-minecraft-pelican.exe"),
  path.join(projectRoot, "dist", "Releu-minecraft-pelican.zip"),
  path.join(projectRoot, "Releu-minecraft-pelican.exe"),
  path.join(projectRoot, "Releu-minecraft-pelican.zip"),
  path.join(projectRoot, "Releu-minecraft-portable.exe"),
  path.join(projectRoot, "Releu-minecraft-pelican-portable.exe"),
  path.join(projectRoot, "Releu-minecraft-mac.zip"),
  path.join(projectRoot, "Releu-minecraft-mac-arm64.zip"),
  path.join(projectRoot, "latest-linux.yml"),
  path.join(projectRoot, "latest-mac.yml"),
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
      console.warn(`Skipping locked release artifact: ${targetPath}`);
      return false;
    }
    throw error;
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

async function copyIfPresent(sourcePath, targetPath) {
  if (!(await fileExists(sourcePath))) {
    return;
  }

  const removed = await removeIfExists(targetPath);
  if (!removed) {
    return;
  }
  await fs.cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
  });
}

async function main() {
  for (const artifactPath of staleArtifacts) {
    await removeIfExists(artifactPath);
  }

  if (mode === "win") {
    await copyIfPresent(
      path.join(distDir, "Releu-minecraft.exe"),
      path.join(projectRoot, "Releu-minecraft.exe"),
    );
  }

  if (mode === "linux") {
    await copyIfPresent(
      path.join(distDir, "Releu-minecraft.AppImage"),
      path.join(projectRoot, "Releu-minecraft.AppImage"),
    );
    await copyIfPresent(
      path.join(distDir, "latest-linux.yml"),
      path.join(projectRoot, "latest-linux.yml"),
    );
  }

  if (mode === "mac") {
    await copyIfPresent(
      path.join(distDir, "Releu-minecraft-mac.zip"),
      path.join(projectRoot, "Releu-minecraft-mac.zip"),
    );
    await copyIfPresent(
      path.join(distDir, "Releu-minecraft-mac-arm64.zip"),
      path.join(projectRoot, "Releu-minecraft-mac-arm64.zip"),
    );
    await copyIfPresent(
      path.join(distDir, "latest-mac.yml"),
      path.join(projectRoot, "latest-mac.yml"),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
