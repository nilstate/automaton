import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";

const runxPackageCandidates = [
  fileURLToPath(new URL("../runx/packages", import.meta.url)),
  fileURLToPath(new URL("../../runx/packages", import.meta.url)),
  fileURLToPath(new URL("../../runx/cloud/packages", import.meta.url)),
];
const runxPackagesPath = runxPackageCandidates.find((candidate) => fs.existsSync(candidate))
  ?? runxPackageCandidates[1];
const runxTokensPath = path.join(runxPackagesPath, "tokens", "dist");
const runxUiPath = path.join(runxPackagesPath, "ui", "src");

export default defineConfig({
  site: "https://automaton.runx.ai",
  output: "static",
  vite: {
    resolve: {
      alias: {
        "@runx-tokens": runxTokensPath,
        "@runx-ui": runxUiPath,
      },
    },
    server: {
      fs: {
        allow: [runxPackagesPath],
      },
    },
  },
});
