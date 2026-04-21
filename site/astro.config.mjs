import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";

const runxPackagesPath = resolveRunxPackagesPath();
const runxTokensPath = path.join(runxPackagesPath, "tokens", "dist");
const runxUiPath = path.join(runxPackagesPath, "ui", "src");

function resolveRunxPackagesPath() {
  const configuredPath = process.env.RUNX_PACKAGES_PATH;
  if (configuredPath) {
    const absoluteConfiguredPath = path.resolve(configuredPath);
    if (!isCompleteRunxPackagesPath(absoluteConfiguredPath)) {
      throw new Error(`RUNX_PACKAGES_PATH is missing required runx token/ui assets: ${absoluteConfiguredPath}`);
    }
    return absoluteConfiguredPath;
  }

  const searchRoots = enumerateAncestorDirs(fileURLToPath(new URL(".", import.meta.url)));
  const relativeCandidates = [
    path.join(".runx", "runx", "cloud", "packages"),
    path.join("runx", "cloud", "packages"),
    path.join(".runx", "runx", "packages"),
    path.join("runx", "packages"),
  ];

  for (const root of searchRoots) {
    for (const relativePath of relativeCandidates) {
      const candidate = path.join(root, relativePath);
      if (isCompleteRunxPackagesPath(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    `Could not resolve complete runx token/ui packages from ${searchRoots[0]}. Checked ${relativeCandidates.join(", ")} while walking to filesystem root.`,
  );
}

function isCompleteRunxPackagesPath(candidate) {
  if (!fs.existsSync(candidate)) {
    return false;
  }
  const requiredPaths = [
    path.join(candidate, "tokens", "dist", "layers.css"),
    path.join(candidate, "tokens", "dist", "tokens.css"),
    path.join(candidate, "ui", "src", "Panel", "Panel.css"),
    path.join(candidate, "ui", "src", "LiveFeed", "LiveFeedContent.css"),
    path.join(candidate, "ui", "src", "LiveFeed", "LiveFeedHeader.css"),
  ];
  return requiredPaths.every((requiredPath) => fs.existsSync(requiredPath));
}

function enumerateAncestorDirs(startDir) {
  const roots = [];
  let current = path.resolve(startDir);
  while (true) {
    roots.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return roots;
}

export default defineConfig({
  site: "https://aster.runx.ai",
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
