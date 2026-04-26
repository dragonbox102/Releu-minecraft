import express from "express";
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

function resolveServerId(request) {
  return (
    String(request.params.serverId ?? request.query.serverId ?? panel.activeServerId ?? "").trim() ||
    panel.activeServerId
  );
}

export async function startPanelServer() {
  if (activeRuntime) {
    return activeRuntime;
  }

  await panel.init();

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(paths.publicDir));

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
    "/api/settings/updater",
    asyncRoute(async (request, response) => {
      sendOk(response, {
        config: await panel.updateUpdaterSettings(request.body ?? {}),
        state: await panel.getState(panel.activeServerId),
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
