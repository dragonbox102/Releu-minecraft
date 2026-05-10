const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  copyText(value) {
    return ipcRenderer.invoke("desktop:copy-text", value);
  },
  openPath(targetPath) {
    return ipcRenderer.invoke("desktop:open-path", targetPath);
  },
  pickDirectory() {
    return ipcRenderer.invoke("desktop:pick-directory");
  },
  applySettings(settings) {
    return ipcRenderer.invoke("desktop:update-settings", settings);
  },
  openQuickConsole(serverId) {
    return ipcRenderer.invoke("desktop:open-quick-console", serverId);
  },
  installAppUpdate(stagedPath) {
    return ipcRenderer.invoke("desktop:install-app-update", stagedPath);
  },
});
