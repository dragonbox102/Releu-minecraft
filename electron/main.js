import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { startPanelServer } from "../src/app.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { app, BrowserWindow, clipboard, ipcMain, shell } = require("electron");
let panelRuntime = null;
let mainWindow = null;

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: "#34414d",
    title: "Minecraft Panel",
    webPreferences: {
      preload: path.join(moduleDir, "preload.js"),
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

ipcMain.handle("desktop:copy-text", async (_event, value) => {
  clipboard.writeText(String(value ?? ""));
  return true;
});

ipcMain.handle("desktop:open-path", async (_event, targetPath) => {
  return shell.openPath(String(targetPath ?? ""));
});

app.whenReady().then(async () => {
  panelRuntime = await startPanelServer();
  mainWindow = createWindow(panelRuntime.url);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0 && panelRuntime) {
      mainWindow = createWindow(panelRuntime.url);
    }
  });
});

app.on("window-all-closed", async () => {
  if (process.platform !== "darwin") {
    if (panelRuntime) {
      await panelRuntime.close().catch(() => {});
    }
    app.quit();
  }
});
