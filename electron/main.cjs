const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");

let panelRuntime = null;
let mainWindow = null;
let startupWindow = null;
let panelRuntimeClosePromise = null;
let updateRestartScheduled = false;
let keepWindowOpenOnClose = false;
let desktopSettings = {
  keepServerRunningOnClose: false,
  quickConsoleShortcut: "Ctrl+Shift+Space",
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();

function desktopStartupLog(message) {
  try {
    const targetPath = path.join(
      process.env.TEMP || process.env.TMP || app.getPath("temp"),
      "releu-desktop-startup.log",
    );
    fs.appendFileSync(
      targetPath,
      `${new Date().toISOString()} ${message}\n`,
      "utf8",
    );
  } catch {}
}

function normalizeDesktopSettings(payload = {}) {
  return {
    keepServerRunningOnClose: Boolean(payload.keepServerRunningOnClose),
    quickConsoleShortcut:
      String(payload.quickConsoleShortcut ?? desktopSettings.quickConsoleShortcut ?? "")
        .trim() || "Ctrl+Shift+Space",
  };
}

function applyDesktopSettings(payload = {}) {
  desktopSettings = normalizeDesktopSettings({
    ...desktopSettings,
    ...payload,
  });
  keepWindowOpenOnClose = desktopSettings.keepServerRunningOnClose;
  desktopStartupLog(
    `Applied desktop settings. keepRunning=${keepWindowOpenOnClose} shortcut=${desktopSettings.quickConsoleShortcut}`,
  );
  return desktopSettings;
}

async function loadPanelServer() {
  const moduleUrl = pathToFileURL(path.join(__dirname, "..", "src", "app.js")).href;
  desktopStartupLog(`Importing panel server module from ${moduleUrl}`);
  const module = await import(moduleUrl);
  desktopStartupLog("Panel server module imported.");
  return module.startPanelServer;
}

function closeStartupWindow() {
  if (!startupWindow || startupWindow.isDestroyed()) {
    startupWindow = null;
    return;
  }
  startupWindow.close();
  startupWindow = null;
}

function createStartupWindow() {
  if (startupWindow && !startupWindow.isDestroyed()) {
    return startupWindow;
  }

  const window = new BrowserWindow({
    width: 420,
    height: 180,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#0b0d10",
    title: "Opening Releu",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const splashHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Opening Releu</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0b0d10;
        color: #eef2f7;
        font-family: Inter, Segoe UI, system-ui, sans-serif;
      }
      .card {
        width: calc(100% - 32px);
        height: calc(100% - 32px);
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 18px;
        background: #17181b;
        display: grid;
        place-items: center;
        text-align: center;
        padding: 24px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 22px;
        font-weight: 700;
      }
      p {
        margin: 0;
        color: #94a3b8;
        font-size: 14px;
      }
      .dots {
        margin-top: 16px;
        display: inline-flex;
        gap: 8px;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #2563eb;
        animation: pulse 1.2s infinite ease-in-out;
      }
      .dot:nth-child(2) { animation-delay: 0.15s; }
      .dot:nth-child(3) { animation-delay: 0.3s; }
      @keyframes pulse {
        0%, 80%, 100% { opacity: 0.35; transform: scale(0.85); }
        40% { opacity: 1; transform: scale(1); }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div>
        <h1>Opening Releu...</h1>
        <p>Preparing the local panel. This can take a few seconds.</p>
        <div class="dots" aria-hidden="true">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    </div>
  </body>
</html>`;

  window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(splashHtml)}`);
  window.once("ready-to-show", () => {
    window.show();
  });
  window.on("closed", () => {
    if (startupWindow === window) {
      startupWindow = null;
    }
  });
  startupWindow = window;
  return window;
}

function createWindow(url) {
  desktopStartupLog(`Creating browser window for ${url}`);
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#000000",
    title: "Releu-minecraft",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl).catch(() => {});
    return { action: "deny" };
  });

  window.loadURL(url);
  window.webContents.once("did-finish-load", () => {
    desktopStartupLog(`Window finished loading ${url}`);
  });
  window.once("ready-to-show", () => {
    closeStartupWindow();
    window.show();
  });
  window.webContents.once("render-process-gone", (_event, details) => {
    desktopStartupLog(`Renderer exited: ${JSON.stringify(details)}`);
  });
  window.on("close", (event) => {
    if (keepWindowOpenOnClose && !updateRestartScheduled) {
      event.preventDefault();
      desktopStartupLog("Main window close intercepted; hiding window and keeping server runtime alive.");
      window.hide();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  return window;
}

function stripWrappingQuotes(value) {
  return String(value ?? "").trim().replace(/^"(.*)"$/, "$1");
}

function uniquePathList(values) {
  const seen = new Set();
  const results = [];
  for (const value of values) {
    const normalized = stripWrappingQuotes(value);
    if (!normalized) {
      continue;
    }
    const resolved = path.resolve(normalized);
    const key = resolved.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(resolved);
  }
  return results;
}

function firstExistingPath(candidates) {
  return (
    uniquePathList(candidates).find((candidatePath) => fs.existsSync(candidatePath)) ??
    null
  );
}

function resolveWindowsPortableExecutablePath() {
  const portableExecutableFile = stripWrappingQuotes(process.env.PORTABLE_EXECUTABLE_FILE);
  const portableExecutablePath = stripWrappingQuotes(process.env.PORTABLE_EXECUTABLE_PATH);
  const portableExecutableDir = stripWrappingQuotes(process.env.PORTABLE_EXECUTABLE_DIR);
  const portableExecutableAppFilename = stripWrappingQuotes(
    process.env.PORTABLE_EXECUTABLE_APP_FILENAME,
  );
  const portableExecutableBaseName = portableExecutableFile
    ? path.basename(portableExecutableFile)
    : "";
  const appFileWithExtension = portableExecutableAppFilename
    ? path.extname(portableExecutableAppFilename)
      ? portableExecutableAppFilename
      : `${portableExecutableAppFilename}.exe`
    : "";

  const candidates = [
    portableExecutableFile,
    portableExecutablePath,
    portableExecutableDir && portableExecutableBaseName
      ? path.join(portableExecutableDir, portableExecutableBaseName)
      : "",
    portableExecutableDir && appFileWithExtension
      ? path.join(portableExecutableDir, appFileWithExtension)
      : "",
    process.execPath,
  ];

  return firstExistingPath(candidates) ?? path.resolve(process.execPath);
}

function resolveLinuxPortableAppPath() {
  return firstExistingPath([process.env.APPIMAGE, process.execPath]) ?? path.resolve(process.execPath);
}

function buildUpdateLogPath(platformName) {
  return path.join(
    app.getPath("temp"),
    `releu-update-${platformName}-${Date.now()}.log`,
  );
}

function closePanelRuntimeOnce() {
  if (!panelRuntime) {
    return Promise.resolve();
  }

  if (!panelRuntimeClosePromise) {
    const runtimeToClose = panelRuntime;
    panelRuntime = null;
    panelRuntimeClosePromise = runtimeToClose.close().catch(() => {}).finally(() => {
      panelRuntimeClosePromise = null;
    });
  }

  return panelRuntimeClosePromise;
}

function scheduleWindowsPortableUpdate(targetExePath, resolvedStagedPath, updateLogPath) {
  const scriptPath = path.join(
    app.getPath("temp"),
    `releu-apply-update-${Date.now()}.ps1`,
  );
  const scriptBody = `
param(
  [string]$CurrentExe,
  [string]$StagedExe,
  [int]$ParentPid,
  [string]$LogPath
)

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message) {
  $Timestamp = [DateTime]::UtcNow.ToString("o")
  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "$Timestamp $Message"
}

Write-Log "Update helper started. CurrentExe=$CurrentExe StagedExe=$StagedExe ParentPid=$ParentPid"

if (-not (Test-Path -LiteralPath $StagedExe)) {
  throw "Staged update executable was not found."
}

for ($i = 0; $i -lt 240; $i++) {
  if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
    Write-Log "Parent process exited."
    break
  }
  Start-Sleep -Milliseconds 500
}

$Copied = $false
for ($i = 0; $i -lt 120; $i++) {
  try {
    $Handle = [System.IO.File]::Open(
      $CurrentExe,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None
    )
    $Handle.Close()
    [System.IO.File]::Copy($StagedExe, $CurrentExe, $true)
    $Copied = $true
    Write-Log "Copied staged update into place."
    break
  } catch {
    Write-Log ("Copy attempt {0} failed: {1}" -f ($i + 1), $_.Exception.Message)
    Start-Sleep -Milliseconds 500
  }
}

if (-not $Copied) {
  throw "Failed to replace the portable executable after repeated retries."
}

Remove-Item -LiteralPath $StagedExe -Force -ErrorAction SilentlyContinue
Write-Log "Removed staged update."
Start-Sleep -Milliseconds 750
Start-Process -FilePath $CurrentExe -WorkingDirectory (Split-Path -Parent $CurrentExe) | Out-Null
Write-Log "Restarted portable executable."
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
`.trim();

  fs.writeFileSync(scriptPath, scriptBody, "utf8");
  fs.writeFileSync(
    updateLogPath,
    `${new Date().toISOString()} Scheduling Windows update. target=${targetExePath} staged=${resolvedStagedPath} script=${scriptPath}\n`,
    "utf8",
  );

  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-CurrentExe",
      targetExePath,
      "-StagedExe",
      resolvedStagedPath,
      "-ParentPid",
      String(process.pid),
      "-LogPath",
      updateLogPath,
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );

  child.unref();
}

function scheduleLinuxPortableUpdate(targetAppPath, resolvedStagedPath, updateLogPath) {
  const scriptPath = path.join(
    app.getPath("temp"),
    `releu-apply-update-${Date.now()}.sh`,
  );
  const scriptBody = `
#!/usr/bin/env sh
set -eu

CURRENT_APP="$1"
STAGED_APP="$2"
PARENT_PID="$3"
LOG_PATH="$4"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >>"$LOG_PATH"
}

log "Update helper started. current=$CURRENT_APP staged=$STAGED_APP parent=$PARENT_PID"

i=0
while kill -0 "$PARENT_PID" 2>/dev/null && [ "$i" -lt 120 ]; do
  sleep 0.5
  i=$((i + 1))
done

i=0
while [ "$i" -lt 40 ]; do
  if cp "$STAGED_APP" "$CURRENT_APP" 2>/dev/null; then
    chmod +x "$CURRENT_APP" || true
    rm -f "$STAGED_APP"
    log "Copied staged update into place."
    nohup "$CURRENT_APP" >/dev/null 2>&1 &
    log "Restarted portable application."
    rm -f "$0"
    exit 0
  fi
  sleep 0.5
  i=$((i + 1))
done

exit 1
`.trim();

  fs.writeFileSync(scriptPath, scriptBody, {
    encoding: "utf8",
    mode: 0o700,
  });
  fs.writeFileSync(
    updateLogPath,
    `${new Date().toISOString()} Scheduling Linux update. target=${targetAppPath} staged=${resolvedStagedPath} script=${scriptPath}\n`,
    "utf8",
  );

  const child = spawn(
    "sh",
    [scriptPath, targetAppPath, resolvedStagedPath, String(process.pid), updateLogPath],
    {
      detached: true,
      stdio: "ignore",
    },
  );

  child.unref();
}

function schedulePortableUpdate(stagedPath) {
  if (!app.isPackaged) {
    throw new Error("App self-update is supported only in packaged builds.");
  }

  const rawStagedPath = String(stagedPath ?? "").trim();
  if (!rawStagedPath) {
    throw new Error("No staged update executable was provided.");
  }
  const resolvedStagedPath = path.resolve(rawStagedPath);

  if (process.platform === "win32") {
    const targetExePath = resolveWindowsPortableExecutablePath();
    const updateLogPath = buildUpdateLogPath("win32");
    scheduleWindowsPortableUpdate(targetExePath, resolvedStagedPath, updateLogPath);
    return;
  }

  if (process.platform === "linux") {
    const targetAppPath = resolveLinuxPortableAppPath();
    const updateLogPath = buildUpdateLogPath("linux");
    scheduleLinuxPortableUpdate(targetAppPath, resolvedStagedPath, updateLogPath);
    return;
  }

  throw new Error("App self-update is not supported on this platform.");
}

ipcMain.handle("desktop:copy-text", async (_event, value) => {
  clipboard.writeText(String(value ?? ""));
  return true;
});

ipcMain.handle("desktop:open-path", async (_event, targetPath) => {
  return shell.openPath(String(targetPath ?? ""));
});

ipcMain.handle("desktop:pick-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths?.[0] ?? null;
});

ipcMain.handle("desktop:update-settings", async (_event, payload) => {
  return applyDesktopSettings(payload);
});

ipcMain.handle("desktop:install-app-update", async (_event, stagedPath) => {
  schedulePortableUpdate(stagedPath);
  updateRestartScheduled = true;
  setImmediate(() => {
    closePanelRuntimeOnce().finally(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.destroy();
      }
      app.quit();
      setTimeout(() => {
        app.exit(0);
      }, 8000);
    });
  });
  return { scheduled: true };
});

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (startupWindow && !startupWindow.isDestroyed()) {
    startupWindow.show();
    startupWindow.focus();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  desktopStartupLog("Electron app ready.");
  createStartupWindow();
  if (app.isPackaged) {
    process.env.RELEU_DESKTOP_PACKAGED = "true";
    desktopStartupLog("Packaged desktop mode enabled.");
  }
  const startPanelServer = await loadPanelServer();
  desktopStartupLog("Starting embedded panel server.");
  panelRuntime = await startPanelServer();
  desktopStartupLog(`Embedded panel server started at ${panelRuntime?.url ?? "unknown"}.`);
  mainWindow = createWindow(panelRuntime.url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && panelRuntime) {
      desktopStartupLog("Recreating main window on activate.");
      mainWindow = createWindow(panelRuntime.url);
    }
  });
}).catch((error) => {
  desktopStartupLog(`Fatal desktop startup error: ${error?.stack || error?.message || String(error)}`);
  closeStartupWindow();
  console.error(error);
  app.quit();
});

app.on("window-all-closed", async () => {
  desktopStartupLog("All windows closed.");
  if (keepWindowOpenOnClose && !updateRestartScheduled) {
    desktopStartupLog("Keeping panel runtime alive with no visible windows.");
    return;
  }
  if (process.platform !== "darwin" || updateRestartScheduled) {
    await closePanelRuntimeOnce();
    desktopStartupLog("Closed embedded panel runtime.");
    app.quit();
  }
});
