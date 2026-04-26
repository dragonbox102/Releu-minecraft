import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  copyText(value) {
    return ipcRenderer.invoke("desktop:copy-text", value);
  },
  openPath(targetPath) {
    return ipcRenderer.invoke("desktop:open-path", targetPath);
  },
});
