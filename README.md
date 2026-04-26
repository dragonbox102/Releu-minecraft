# Local Minecraft Panel

This project gives you a localhost-only web panel for Minecraft servers on Windows. It can:

- Create and manage multiple server instances
- Download and install Paper or Purpur into the selected server
- Start, stop, restart, and force-kill Java server processes
- Stream console logs and send commands
- Edit common `server.properties` values per server
- Auto-save server settings to disk
- Create manual backups and hourly automatic backups per server
- Upload or download-to-server plugin and mod files
- Manage players with OP, whitelist, ban, kick, gamemode, heal, feed, and teleport actions per server
- Install and run a local `playit.gg` agent

## Run it

```powershell
npm.cmd start
```

Then open:

```text
http://127.0.0.1:8787
```

## Public access with playit.gg

The panel can install the `playit` agent and generate a claim link for your account. Because `playit.gg` is account-bound, you still need to finish the claim in your browser. If the panel reports configured tunnels but cannot show a public address, open the playit tunnel dashboard from the UI and either assign the existing tunnel to this agent or create a `Minecraft Java` tunnel pointing at the local server address shown in the panel, usually `127.0.0.1:25565`.

## Notes

- Plugin files are installed into the selected server's `plugins/` folder.
- Mod files are installed into the selected server's `mods/` folder.
- Paper and Purpur load plugins, but they do not load mods by themselves. The mod section still manages the files on disk for mod-capable server setups.
