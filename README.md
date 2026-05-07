````markdown
# Local Minecraft Panel

This project provides a **desktop Minecraft server manager** for local hosting, backups, add-ons, and public join links.

## Features

- Create and manage multiple server instances  
- Download and install Paper or Purpur  
- Start, stop, restart, or force-kill server processes  
- View live console logs and send commands  
- Edit key `server.properties` settings per server  
- Automatically save server configurations  
- Create manual backups + hourly automatic backups  
- Upload plugins or mods directly to the server  
- Manage players (OP, whitelist, ban, kick, gamemode, heal, feed, teleport)  
- Install and run a local `playit.gg` agent  

## Install as EXE (Recommended)

1. Go to **Releu.lol**  
2. Download the latest `.exe`  
3. Run the file — no setup required  

The panel will start automatically.

## Alternative: Run via Node.js

If you prefer running from source:

```powershell
npm.cmd start
````

Then open:

```
http://127.0.0.1:8787
```

## Public Access with playit.gg

* Install the agent from inside the panel
* Generate a claim link and complete setup in your browser
* If no public address appears:

  * Open the playit dashboard from the panel
  * Assign the tunnel to the agent OR
  * Create a **Minecraft Java** tunnel pointing to:

```
127.0.0.1:25565
```

---

Runs locally by default for safety and performance.

```
```


## Notes

- Plugin files are installed into the selected server's `plugins/` folder.
- Mod files are installed into the selected server's `mods/` folder.
- Paper and Purpur load plugins, but they do not load mods by themselves. The mod section still manages the files on disk for mod-capable server setups.
