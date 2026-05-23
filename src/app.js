import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { paths } from "./config.js";
import { MinecraftPanelService } from "./minecraft-panel.js";

const panel = new MinecraftPanelService();
let activeRuntime = null;

function asyncRoute(handler) {
  return async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      response.status(400).json({
        ok: false,
        error: error.message ?? "Unexpected error.",
      });
    }
  };
}

function sendOk(response, data) {
  response.json({
    ok: true,
    ...data,
  });
}

function firstAvailableServerId() {
  return (
    panel.activeServerId ||
    panel.registry?.servers?.[0]?.id ||
    Array.from(panel.serverContexts?.keys?.() ?? [])[0] ||
    null
  );
}

function resolveServerId(request) {
  const requestedServerId = String(
    request.params.serverId ?? request.query.serverId ?? panel.activeServerId ?? "",
  ).trim();
  if (requestedServerId && panel.serverContexts?.has(requestedServerId)) {
    return requestedServerId;
  }

  const activeServerId = String(panel.activeServerId ?? "").trim();
  if (activeServerId && panel.serverContexts?.has(activeServerId)) {
    return activeServerId;
  }

  return firstAvailableServerId();
}

function mapPelicanSectionToPage(section) {
  const normalized = String(section ?? "").trim().toLowerCase();
  if (!normalized) return "overview.html";
  if (normalized === "console") return "console.html";
  if (normalized === "files") return "files.html";
  if (normalized === "backups") return "backups.html";
  if (normalized === "cloud" || normalized === "cloud-backup" || normalized === "cloudbackup") return "cloud-backup.html";
  if (normalized === "settings") return "settings.html";
  if (normalized === "players") return "players.html";
  if (normalized === "worlds") return "worlds.html";
  if (normalized === "software") return "software.html";
  if (normalized === "create" || normalized === "new" || normalized === "install") return "create-server.html";
  if (normalized === "extensions" || normalized === "addons" || normalized === "mods" || normalized === "add-ons") return "addons-mods.html";
  return "overview.html";
}

export async function startPanelServer() {
  if (activeRuntime) {
    return activeRuntime;
  }

  await panel.init();

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(paths.publicDir));
  app.get("/server/:serverId", (request, response) => {
    response.redirect(
      302,
      `/pelican-demo/overview.html?serverId=${encodeURIComponent(request.params.serverId)}`,
    );
  });
  app.get("/server/:serverId/:section", (request, response) => {
    const page = mapPelicanSectionToPage(request.params.section);
    response.redirect(
      302,
      `/pelican-demo/${page}?serverId=${encodeURIComponent(request.params.serverId)}`,
    );
  });
  app.all("/livewire/update", (_request, response) => {
    response.status(200).json({
      ok: true,
      effects: {},
      serverMemo: {},
    });
  });

  app.get(
    "/api/dependencies/state",
    asyncRoute(async (_request, response) => {
      sendOk(response, {
        dependencies: await panel.getDependencyState(),
      });
    }),
  );

  app.post(
    "/api/dependencies/ensure",
    asyncRoute(async (_request, response) => {
      sendOk(response, {
        dependencies: await panel.ensureDependencies(),
      });
    }),
  );

  app.get(
    "/api/state",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        state: await panel.getState(resolveServerId(request)),
      });
    }),
  );

  app.get(
    "/api/logs",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        entries: await panel.getLogs(request.query.after ?? 0, resolveServerId(request)),
      });
    }),
  );

  app.get(
    "/api/software/versions",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        versions: await panel.getSoftwareVersions(String(request.query.software ?? "purpur")),
      });
    }),
  );

  app.get(
    "/api/cloud-backup/config",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        cloudBackup: (await panel.getState(resolveServerId(request))).cloudBackupSettings,
      });
    }),
  );

  app.get(
    "/api/cloud-backup/status",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        cloudBackup: await panel.getCloudBackupStatus(resolveServerId(request)),
      });
    }),
  );

  app.post(
    "/api/cloud-backup/settings",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        cloudBackup: await panel.updateCloudBackupSettings(request.body ?? {}),
        status: await panel.getCloudBackupStatus(resolveServerId(request)),
        state: await panel.getState(resolveServerId(request)),
      });
    }),
  );

  app.post(
    "/api/cloud-backup/issue-key",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        cloudBackup: await panel.issueCloudBackupKey(request.body ?? {}),
        state: await panel.getState(resolveServerId(request)),
      });
    }),
  );

  app.post(
    "/api/cloud-backup/rotate-key",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        cloudBackup: await panel.rotateCloudBackupKey(),
        state: await panel.getState(resolveServerId(request)),
      });
    }),
  );

  app.post(
    "/api/cloud-backup/register",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        cloudBackup: await panel.registerCloudBackupAccount(request.body ?? {}),
        state: await panel.getState(resolveServerId(request)),
      });
    }),
  );

  app.post(
    "/api/cloud-backup/login",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        cloudBackup: await panel.loginCloudBackupAccount(request.body ?? {}),
        state: await panel.getState(resolveServerId(request)),
      });
    }),
  );

  app.post(
    "/api/cloud-backup/logout",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        cloudBackup: await panel.logoutCloudBackupAccount(),
        state: await panel.getState(resolveServerId(request)),
      });
    }),
  );

  app.get(
    "/api/remote-access",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        remoteAccess: panel.getRemoteAccessState(),
        state: await panel.getState(resolveServerId(request)),
      });
    }),
  );

  app.post(
    "/api/remote-access/setup",
    asyncRoute(async (request, response) => {
      const state = await panel.setupRemoteAccess(request.body ?? {});
      sendOk(response, {
        remoteAccess: panel.getRemoteAccessState(),
        state,
      });
    }),
  );

  app.post(
    "/api/remote-access/regenerate",
    asyncRoute(async (request, response) => {
      const state = await panel.regenerateRemoteAccess();
      sendOk(response, {
        remoteAccess: panel.getRemoteAccessState(),
        state,
      });
    }),
  );

  app.post(
    "/api/remote-access/disable",
    asyncRoute(async (request, response) => {
      const state = await panel.disableRemoteAccess();
      sendOk(response, {
        remoteAccess: panel.getRemoteAccessState(),
        state,
      });
    }),
  );

  app.post(
    "/api/servers",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        state: await panel.createServer(request.body ?? {}),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/select",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        state: await panel.selectServer(request.params.serverId),
      });
    }),
  );

  app.get(
    "/api/servers/:serverId/icon",
    asyncRoute(async (request, response) => {
      const icon = await panel.getServerIconInfo(request.params.serverId);
      if (!icon) {
        response.status(404).end();
        return;
      }
      response.setHeader("Content-Type", icon.contentType);
      response.setHeader("Cache-Control", "no-cache");
      response.send(await fs.readFile(icon.path));
    }),
  );

  app.post(
    "/api/servers/:serverId/icon",
    express.raw({ limit: "8mb", type: "application/octet-stream" }),
    asyncRoute(async (request, response) => {
      const fileName =
        request.headers["x-file-name"] ??
        request.query.fileName ??
        "server-icon.png";
      sendOk(response, {
        icon: await panel.uploadServerIcon(
          request.params.serverId,
          String(fileName),
          request.body,
        ),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/delete",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        state: await panel.deleteServer(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/settings/profile",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        state: await panel.updateServerProfile(request.params.serverId, request.body ?? {}),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/settings/runtime",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        config: await panel.updateRuntimeSettings(request.params.serverId, request.body ?? {}),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/settings/playit",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        config: await panel.updatePlayitSettings(request.body ?? {}),
        state: await panel.getState(panel.activeServerId),
      });
    }),
  );

  app.post(
    "/api/settings/ui",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        config: await panel.updateUiSettings(request.body ?? {}),
        state: await panel.getState(resolveServerId(request)),
      });
    }),
  );

  app.post(
    "/api/settings/updater",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        config: await panel.updateUpdaterSettings(request.body ?? {}),
        state: await panel.getState(panel.activeServerId),
      });
    }),
  );

  app.post(
    "/api/settings/desktop",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        config: await panel.updateDesktopSettings(request.body ?? {}),
        state: await panel.getState(resolveServerId(request)),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/settings/server-properties",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        properties: await panel.updateServerProperties(request.params.serverId, request.body ?? {}),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/settings/misc",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        misc: await panel.updateMiscSettings(request.params.serverId, request.body ?? {}),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/settings/eula",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        accepted: await panel.setEula(request.params.serverId, Boolean(request.body.accepted)),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/install/server",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        install: await panel.installServerSoftware(request.params.serverId, {
          software: request.body.software ?? "purpur",
          requestedVersion: request.body.version ?? "latest",
          acceptEula: Boolean(request.body.acceptEula),
        }),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/server/start",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        state: await panel.startServer(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/server/stop",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        state: await panel.stopServer(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/server/restart",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        state: await panel.restartServer(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/server/kill",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        state: await panel.forceKillServer(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/server/command",
    asyncRoute(async (request, response) => {
      await panel.sendCommand(request.params.serverId, request.body.command);
      sendOk(response, {
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/server/backup",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        backupPath: await panel.createBackup(request.params.serverId),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/settings/backups",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        backups: await panel.updateBackupSettings(request.params.serverId, request.body ?? {}),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/backups/revert",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        restore: await panel.restoreLocalBackup(
          request.params.serverId,
          request.body.backupName,
        ),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/cloud-backup/upload",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        upload: await panel.uploadCloudBackup(request.params.serverId),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/cloud-backup/download",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        download: await panel.downloadCloudBackup(
          request.params.serverId,
          request.body.backupId,
        ),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/cloud-backup/restore",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        restore: await panel.restoreCloudBackup(
          request.params.serverId,
          request.body.backupId,
        ),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.get(
    "/api/servers/:serverId/players",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        players: await panel.getPlayers(request.params.serverId),
      });
    }),
  );

  app.get(
    "/api/servers/:serverId/worlds",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        worlds: await panel.listWorlds(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/worlds/select",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        state: await panel.setActiveWorld(request.params.serverId, request.body ?? {}),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/worlds/regenerate",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        state: await panel.regenerateWorld(request.params.serverId, request.body ?? {}),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/worlds/import-folder",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        state: await panel.importWorldFolder(request.params.serverId, request.body ?? {}),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/worlds/upload-archive",
    express.raw({ limit: "512mb", type: "application/octet-stream" }),
    asyncRoute(async (request, response) => {
      const fileName =
        request.headers["x-file-name"] ??
        request.query.fileName ??
        "world.zip";

      sendOk(response, {
        state: await panel.importWorldArchive(
          request.params.serverId,
          String(fileName),
          request.body,
          {
            worldName: request.query.worldName,
          },
        ),
      });
    }),
  );

  app.get(
    "/api/servers/:serverId/files",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        files: await panel.listManagedFiles(request.params.serverId, request.query ?? {}),
      });
    }),
  );

  app.get(
    "/api/servers/:serverId/files/download",
    asyncRoute(async (request, response) => {
      const file = await panel.resolveManagedServerPath(
        request.params.serverId,
        request.query.path ?? "",
      );
      const stats = await fs.stat(file.absolutePath).catch(() => null);
      if (!stats?.isFile()) {
        throw new Error("That file does not exist.");
      }
      response.download(file.absolutePath, path.basename(file.absolutePath));
    }),
  );

  app.get(
    "/api/servers/:serverId/files/read",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        file: await panel.readManagedTextFile(
          request.params.serverId,
          request.query.path ?? "",
        ),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/files/write",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        file: await panel.writeManagedTextFile(request.params.serverId, request.body ?? {}),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/files/folder",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        files: await panel.createManagedFolder(request.params.serverId, request.body ?? {}),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/files/upload",
    express.raw({ limit: "256mb", type: "application/octet-stream" }),
    asyncRoute(async (request, response) => {
      const fileName =
        request.headers["x-file-name"] ??
        request.query.fileName ??
        "upload.bin";
      sendOk(response, {
        upload: await panel.uploadManagedFile(
          request.params.serverId,
          request.query.path ?? "",
          String(fileName),
          request.body,
        ),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.delete(
    "/api/servers/:serverId/files",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        files: await panel.deleteManagedPath(
          request.params.serverId,
          request.query.path ?? "",
        ),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/players/register",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        player: await panel.registerPlayer(request.params.serverId, request.body ?? {}),
        players: await panel.getPlayers(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/players/:name/action",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        players: await panel.applyPlayerAction(
          request.params.serverId,
          request.params.name,
          request.body.action,
          request.body,
        ),
      });
    }),
  );

  app.get(
    "/api/servers/:serverId/items/catalog",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        catalog: await panel.searchInventoryCatalog(request.params.serverId, request.query ?? {}),
      });
    }),
  );

  app.get(
    "/api/servers/:serverId/players/:name/inventory",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        inventory: await panel.getPlayerInventory(
          request.params.serverId,
          request.params.name,
        ),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/players/:name/inventory/give",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        inventory: await panel.givePlayerInventoryItem(
          request.params.serverId,
          request.params.name,
          request.body ?? {},
        ),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/players/:name/inventory/clear",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        inventory: await panel.clearPlayerInventory(
          request.params.serverId,
          request.params.name,
          request.body ?? {},
        ),
      });
    }),
  );

  app.get(
    "/api/servers/:serverId/assets",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        assets: await panel.listAssets(
          request.params.serverId,
          String(request.query.kind ?? "plugin"),
        ),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/assets/install-url",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        installedTo: await panel.installAssetFromUrl(
          request.params.serverId,
          String(request.body.kind ?? "plugin"),
          request.body.url,
        ),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/assets/remove",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        assets: await panel.removeAsset(
          request.params.serverId,
          String(request.body.kind ?? "plugin"),
          request.body.fileName,
        ),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/assets/install-upload",
    express.raw({ limit: "256mb", type: "application/octet-stream" }),
    asyncRoute(async (request, response) => {
      const fileName =
        request.headers["x-file-name"] ??
        request.query.fileName ??
        `${String(request.query.kind ?? "plugin")}.jar`;
      sendOk(response, {
        installedTo: await panel.installAssetUpload(
          request.params.serverId,
          String(request.query.kind ?? "plugin"),
          String(fileName),
          request.body,
        ),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.get(
    "/api/servers/:serverId/catalog/search",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        catalog: await panel.searchCatalog(request.params.serverId, {
          kind: request.query.kind,
          query: request.query.query,
          profileId: request.query.profileId,
          gameVersion: request.query.gameVersion,
          limit: request.query.limit,
          page: request.query.page,
          index: request.query.index,
        }),
      });
    }),
  );

  app.post(
    "/api/servers/:serverId/catalog/install",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        install: await panel.installCatalogProject(request.params.serverId, request.body ?? {}),
        state: await panel.getState(request.params.serverId),
      });
    }),
  );

  app.post(
    "/api/playit/install",
    asyncRoute(async (_request, response) => {
      sendOk(response, {
        playit: await panel.playit.installBinary(),
        state: await panel.getState(panel.activeServerId),
      });
    }),
  );

  app.post(
    "/api/playit/connect",
    asyncRoute(async (_request, response) => {
      sendOk(response, {
        connect: await panel.connectPlayit(),
        state: await panel.getState(panel.activeServerId),
      });
    }),
  );

  app.post(
    "/api/playit/claim",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        playit: await panel.playit.generateClaim(
          String(request.body.agentName ?? panel.panelConfig.playit.agentName),
        ),
        state: await panel.getState(panel.activeServerId),
      });
    }),
  );

  app.post(
    "/api/playit/secret",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        playit: await panel.playit.saveSecret(request.body.secret),
        state: await panel.getState(panel.activeServerId),
      });
    }),
  );

  app.post(
    "/api/playit/start",
    asyncRoute(async (_request, response) => {
      sendOk(response, {
        playit: await panel.playit.startAgent(),
        state: await panel.getState(panel.activeServerId),
      });
    }),
  );

  app.post(
    "/api/playit/stop",
    asyncRoute(async (_request, response) => {
      sendOk(response, {
        playit: await panel.playit.stopAgent(),
        state: await panel.getState(panel.activeServerId),
      });
    }),
  );

  app.post(
    "/api/playit/reset",
    asyncRoute(async (_request, response) => {
      sendOk(response, {
        playit: await panel.playit.reset(),
        state: await panel.getState(panel.activeServerId),
      });
    }),
  );

  app.get(
    "/api/playit/tunnels",
    asyncRoute(async (_request, response) => {
      sendOk(response, {
        playit: await panel.playit.refreshTunnels(),
      });
    }),
  );

  app.post(
    "/api/app-update/check",
    asyncRoute(async (_request, response) => {
      sendOk(response, {
        appUpdate: await panel.checkForAppUpdate(),
        state: await panel.getState(panel.activeServerId),
      });
    }),
  );

  app.post(
    "/api/app-update/applying",
    asyncRoute(async (_request, response) => {
      sendOk(response, {
        appUpdate: await panel.markAppUpdateApplying(),
        state: await panel.getState(panel.activeServerId),
      });
    }),
  );

  const server = await new Promise((resolve) => {
    const listener = app.listen(panel.panelConfig.panel.port, panel.panelConfig.panel.host, () => {
      panel.appendLog(
        null,
        "panel",
        `Listening on http://${panel.panelConfig.panel.host}:${panel.panelConfig.panel.port}`,
      );
      resolve(listener);
    });
  });

  activeRuntime = {
    app,
    panel,
    server,
    url: `http://${panel.panelConfig.panel.host}:${panel.panelConfig.panel.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error?.code === "ERR_SERVER_NOT_RUNNING") {
            resolve();
            return;
          }
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await panel.shutdown().catch(() => {});
      activeRuntime = null;
    },
  };

  return activeRuntime;
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  startPanelServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
