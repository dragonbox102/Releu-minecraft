import { startReleuLolSite } from "../src/releu-lol-site.js";

startReleuLolSite().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

