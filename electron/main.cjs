const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");

let panelRuntime = null;
let mainWindow = null;

async function loadPanelServer() {
  const moduleUrl = pathToFileURL(path.join(__dirname, "..", "src", "app.js")).href;
  const module = await import(moduleUrl);
  return module.startPanelServer;
}

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    autoHideMenuBar: true,
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
  return window;
}

function scheduleWindowsPortableUpdate(targetExePath, resolvedStagedPath) {
  const scriptPath = path.join(
    app.getPath("temp"),
    `releu-apply-update-${Date.now()}.ps1`,
  );
  const scriptBody = `
param(
  [string]$CurrentExe,
  [string]$StagedExe,
  [int]$ParentPid
)

$ErrorActionPreference = 'Stop'

for ($i = 0; $i -lt 120; $i++) {
  if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
    break
  }
  Start-Sleep -Milliseconds 500
}

for ($i = 0; $i -lt 40; $i++) {
  try {
    Copy-Item -LiteralPath $StagedExe -Destination $CurrentExe -Force
    break
  } catch {
    if ($i -eq 39) {
      throw
    }
    Start-Sleep -Milliseconds 500
  }
}

Remove-Item -LiteralPath $StagedExe -Force -ErrorAction SilentlyContinue
Start-Process -FilePath $CurrentExe
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
`.trim();

  fs.writeFileSync(scriptPath, scriptBody, "utf8");

  const child = spawn(
    "powershell",
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
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );

  child.unref();
}

function scheduleLinuxPortableUpdate(targetAppPath, resolvedStagedPath) {
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
    nohup "$CURRENT_APP" >/dev/null 2>&1 &
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

  const child = spawn(
    "sh",
    [scriptPath, targetAppPath, resolvedStagedPath, String(process.pid)],
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

  const resolvedStagedPath = path.resolve(String(stagedPath ?? "").trim());
  if (!resolvedStagedPath) {
    throw new Error("No staged update executable was provided.");
  }

  if (process.platform === "win32") {
    scheduleWindowsPortableUpdate(process.execPath, resolvedStagedPath);
    return;
  }

  if (process.platform === "linux") {
    const targetAppPath = path.resolve(process.env.APPIMAGE || process.execPath);
    scheduleLinuxPortableUpdate(targetAppPath, resolvedStagedPath);
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

ipcMain.handle("desktop:install-app-update", async (_event, stagedPath) => {
  schedulePortableUpdate(stagedPath);
  setImmediate(() => {
    app.exit(0);
  });
  return { scheduled: true };
});

app.whenReady().then(async () => {
  const startPanelServer = await loadPanelServer();
  panelRuntime = await startPanelServer();
  mainWindow = createWindow(panelRuntime.url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && panelRuntime) {
      mainWindow = createWindow(panelRuntime.url);
    }
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", async () => {
  if (process.platform !== "darwin") {
    if (panelRuntime) {
      await panelRuntime.close().catch(() => {});
    }
    app.quit();
  }
});
