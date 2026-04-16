import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";

const runxPackagesPath = fileURLToPath(new URL("../../runx/cloud/packages", import.meta.url));

export default defineConfig({
  site: "https://automaton.runx.ai",
  output: "static",
  vite: {
    server: {
      fs: {
        allow: [runxPackagesPath],
      },
    },
  },
});
