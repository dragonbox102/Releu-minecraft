const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const archiver = require("archiver");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const runtimeDir = path.join(distDir, "win-unpacked");
const launcherBuildDir = path.join(projectRoot, "build", "launcher");
const payloadZipPath = path.join(launcherBuildDir, "releu-runtime.zip");
const payloadManifestPath = path.join(launcherBuildDir, "payload-manifest.json");
const launcherProjectPath = path.join(projectRoot, "launcher", "ReleuLauncher.csproj");
const launcherPublishDir = path.join(projectRoot, "launcher", "bin", "Release", "net8.0-windows", "win-x64", "publish");
const finalExePath = path.join(distDir, "Releu-minecraft.exe");

async function ensureExists(targetPath, label) {
  try {
    await fs.access(targetPath);
  } catch {
    throw new Error(`${label} was not found at ${targetPath}`);
  }
}

async function recreateDirectory(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.mkdir(targetPath, { recursive: true });
}

async function createRuntimeZip(sourceDir, targetZipPath) {
  await fs.rm(targetZipPath, { force: true });
  await fs.mkdir(path.dirname(targetZipPath), { recursive: true });

  await new Promise((resolve, reject) => {
    const output = require("node:fs").createWriteStream(targetZipPath);
    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize().catch(reject);
  });
}

async function sha256OfFile(targetPath) {
  const hash = crypto.createHash("sha256");
  const stream = require("node:fs").createReadStream(targetPath);
  await new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex").toUpperCase();
}

function toAssemblyVersion(version) {
  const parts = String(version ?? "0.0.0")
    .split(".")
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isFinite(entry));
  while (parts.length < 4) {
    parts.push(0);
  }
  return parts.slice(0, 4).join(".");
}

async function run(command, args, workdir) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workdir,
      stdio: "inherit",
      shell: false,
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  await ensureExists(runtimeDir, "Electron runtime directory");
  await recreateDirectory(launcherBuildDir);

  await createRuntimeZip(runtimeDir, payloadZipPath);
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
  const version = String(packageJson.version ?? "0.0.0").trim() || "0.0.0";
  const payloadHash = await sha256OfFile(payloadZipPath);
  await fs.writeFile(
    payloadManifestPath,
    JSON.stringify(
      {
        version,
        sha256: payloadHash,
      },
      null,
      2,
    ),
    "utf8",
  );

  await run(
    "dotnet",
    [
      "publish",
      launcherProjectPath,
      "-c",
      "Release",
      "-r",
      "win-x64",
      "-p:PublishSingleFile=true",
      "-p:SelfContained=true",
      `-p:PayloadZipPath=${payloadZipPath}`,
      `-p:PayloadManifestPath=${payloadManifestPath}`,
      `-p:Version=${version}`,
      `-p:FileVersion=${toAssemblyVersion(version)}`,
      `-p:AssemblyVersion=${toAssemblyVersion(version)}`,
    ],
    projectRoot,
  );

  await ensureExists(path.join(launcherPublishDir, "ReleuLauncher.exe"), "Published launcher");
  await fs.rm(finalExePath, { force: true });
  await fs.copyFile(path.join(launcherPublishDir, "ReleuLauncher.exe"), finalExePath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
