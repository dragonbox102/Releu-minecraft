# Releu Minecraft

Releu is a desktop Minecraft server manager for local hosting, backups, add-ons, public join links, and optional Bedrock crossplay on Java servers.

## Features

- Create and manage multiple Minecraft server instances
- Install and use supported server software: Vanilla, Paper, Purpur, Fabric, Forge, and NeoForge
- Start, stop, restart, and force-kill servers
- View live console logs and send commands
- Track server status, RAM usage, CPU usage, and basic host metrics
- Edit important server and runtime settings from the app
- Manage players with common actions such as inventory view, gamemode, kick, ban, unban, whitelist, unwhitelist, op, and deop
- Browse and manage server files
- Manage worlds and import world archives
- Install add-ons from supported catalog sources or upload your own plugin and mod files
- Create manual local backups and scheduled automatic backups
- Set a max total backup storage limit and automatically prune the oldest backups when the limit is reached
- Revert to older backups with a confirmation flow
- Open backup folders from the app
- Link a local `playit.gg` agent for public join addresses
- View tunnel status and public join addresses from inside the app
- Support Bedrock crossplay on Java servers through Geyser and Floodgate
- Include Windows and Linux release builds, with macOS packaging configuration in the project
- Include a cloud backup section that is currently under development

## Install

### Windows
1. Download the latest `Releu-minecraft.exe`
2. Run the file
3. Releu starts locally on your machine

### Linux
1. Download the latest `Releu-minecraft.AppImage`
2. Mark it executable
3. Run it

### Run From Source
```powershell
npm.cmd start
```

Then open:

```text
http://127.0.0.1:8787
```

## Quick Tutorial

### 1. Create Your First Server
1. Open Releu
2. Create a new server
3. Enter a server name
4. Choose the server software you want:
   - Paper or Purpur for plugin servers
   - Fabric, Forge, or NeoForge for modded servers
   - Vanilla for a plain official server
5. Choose the Minecraft version or build
6. Finish setup

### 2. Start the Server
1. Open the server in Releu
2. Go to the overview or console section
3. Press `Start`
4. Wait for the server to finish booting

### 3. Use the Main Sections
- **Overview**: check server status, performance, and quick actions
- **Console**: view logs and run commands
- **Players**: manage players and moderation actions
- **Files**: browse and manage server files
- **Backups**: create backups, change backup settings, and revert
- **Cloud Backup**: reserved for future cloud backup support
- **Worlds**: manage worlds and import world archives
- **Add-ons / Mods**: install or upload add-ons
- **Software**: change or reinstall server software
- **Misc**: adjust gameplay and join-related options
- **Settings**: manage app, playit, updater, and desktop settings

### 4. Add Plugins or Mods
- For **Paper** or **Purpur**, use plugins
- For **Fabric**, **Forge**, or **NeoForge**, use mods
- Install from supported catalog sources or upload your own files

### 5. Create Backups
1. Open the `Backups` section
2. Press `Create Backup Now` for a manual backup
3. Configure:
   - automatic backups
   - backup interval
   - max total backup storage
4. If storage reaches the configured max, Releu can remove the oldest backups first

### 6. Revert to a Backup
1. Open the `Backups` section
2. Pick the backup you want
3. Press `Revert`
4. Confirm the warnings
5. Let Releu restore that backup

### 7. Make the Server Public With playit.gg
1. Open the playit settings area in Releu
2. Install the playit agent if needed
3. Generate a claim link
4. Finish linking the agent in your browser
5. Create or assign a tunnel
6. Use the public address shown by playit

### 8. Enable Optional Bedrock Crossplay
1. Install Geyser
2. Install Floodgate
3. Keep the normal Java server running
4. If you use playit for Bedrock players, create a separate UDP tunnel for the Bedrock port

## Public Access With playit.gg

Releu can work with `playit.gg` for public join addresses.

### Java Tunnel Target
Create or assign a Java tunnel pointing to:

```text
127.0.0.1:25565
```

### Bedrock Tunnel Target
If you enable Geyser for Bedrock crossplay, Bedrock traffic usually needs a separate UDP tunnel pointing to:

```text
127.0.0.1:19132
```

Java and Bedrock can use the same playit agent, but they need separate tunnels.

## Backups

Releu local backups support:

- manual backups
- scheduled automatic backups
- max total storage limit
- automatic pruning of oldest backups
- revert to previous backups
- confirmation steps before revert

## Add-ons and Mods

Releu supports:

- installing from supported catalog sources
- uploading your own mod and plugin files
- managing files already installed on the server

Notes:

- plugin files go into the selected server's `plugins/` folder
- mod files go into the selected server's `mods/` folder
- Paper and Purpur support plugins, but not Java mods by themselves
- Fabric, Forge, and NeoForge are used for mod-capable server setups

## Notes

- Cloud backup is currently under development
- The project includes macOS packaging configuration, but end-user support should be treated cautiously until it is fully validated in release use

## Build

```powershell
npm.cmd run build:exe
npm.cmd run build:linux
npm.cmd run build:mac
```

## Credits

- Releu uses Pelican UI in parts of the app
- Some custom Releu features were designed in a Pelican-inspired visual style
- Pelican GitHub: https://github.com/pelican-dev/panel

## Safety

Releu runs locally by default for safety, control, and performance.
