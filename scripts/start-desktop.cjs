const path = require("node:path");
const { spawn } = require("node:child_process");

const electronBinary = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ["."], {
  cwd: path.resolve(__dirname, ".."),
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("close", (code, signal) => {
  if (code !== null) {
    process.exit(code);
    return;
  }

  console.error(`Electron exited with signal ${signal ?? "unknown"}.`);
  process.exit(1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
