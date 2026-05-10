import os from "node:os";
import path from "node:path";

export const runtimePlatform = process.platform;
export const runtimeArch = process.arch;

export const isWindows = runtimePlatform === "win32";
export const isLinux = runtimePlatform === "linux";
export const isMac = runtimePlatform === "darwin";
export const isUnix = isLinux || isMac;

export function getAppDataHomeDir(appName = "Releu") {
  if (isWindows) {
    const baseDir =
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(baseDir, appName);
  }

  if (isLinux) {
    const baseDir =
      process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    return path.join(baseDir, appName);
  }

  if (isMac) {
    return path.join(os.homedir(), "Library", "Application Support", appName);
  }

  return path.join(os.homedir(), `.${String(appName).toLowerCase()}`);
}

export function getJavaExecutableName() {
  return isWindows ? "java.exe" : "java";
}

export function getPlayitBinaryName() {
  return isWindows ? "playit.exe" : "playit";
}

export function getDefaultUpdaterAssetName() {
  if (isWindows) {
    return "Releu-minecraft.exe";
  }

  if (isLinux) {
    return "Releu-minecraft.AppImage";
  }

  if (isMac) {
    return "Releu-minecraft-mac.zip";
  }

  return "Releu-minecraft";
}

export function withHiddenConsole(options = {}) {
  if (!isWindows) {
    return { ...options };
  }

  return {
    ...options,
    windowsHide: options.windowsHide ?? true,
  };
}

export function getPlayitAssetCandidates() {
  if (isWindows) {
    switch (runtimeArch) {
      case "x64":
        return [
          "playit-windows-x86_64-signed.exe",
          "playit-windows-x86_64.exe",
        ];
      case "ia32":
        return [
          "playit-windows-x86-signed.exe",
          "playit-windows-x86.exe",
        ];
      case "arm64":
        return [
          "playit-windows-x86_64-signed.exe",
          "playit-windows-x86_64.exe",
        ];
      default:
        return [];
    }
  }

  if (isLinux) {
    switch (runtimeArch) {
      case "x64":
        return ["playit-linux-amd64"];
      case "arm64":
        return ["playit-linux-aarch64"];
      case "arm":
        return ["playit-linux-armv7"];
      case "ia32":
        return ["playit-linux-i686"];
      default:
        return [];
    }
  }

  return [];
}

export function getMicrosoftJdkDownloadUrl(major) {
  const normalizedMajor = Number(major);
  if (!Number.isFinite(normalizedMajor)) {
    throw new Error(`Unsupported JDK major version: ${major}`);
  }

  if (isWindows) {
    if (runtimeArch === "x64") {
      return `https://aka.ms/download-jdk/microsoft-jdk-${normalizedMajor}-windows-x64.zip`;
    }

    if (runtimeArch === "arm64") {
      return `https://aka.ms/download-jdk/microsoft-jdk-${normalizedMajor}-windows-aarch64.zip`;
    }
  }

  if (isLinux) {
    if (runtimeArch === "x64") {
      return `https://aka.ms/download-jdk/microsoft-jdk-${normalizedMajor}-linux-x64.tar.gz`;
    }

    if (runtimeArch === "arm64") {
      return `https://aka.ms/download-jdk/microsoft-jdk-${normalizedMajor}-linux-aarch64.tar.gz`;
    }
  }

  if (isMac) {
    if (runtimeArch === "x64") {
      return `https://aka.ms/download-jdk/microsoft-jdk-${normalizedMajor}-macos-x64.tar.gz`;
    }

    if (runtimeArch === "arm64") {
      return `https://aka.ms/download-jdk/microsoft-jdk-${normalizedMajor}-macos-aarch64.tar.gz`;
    }
  }

  throw new Error(
    `Releu does not have a bundled JDK download for ${runtimePlatform}/${runtimeArch} yet.`,
  );
}
