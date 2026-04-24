export default {
  name: "aster",
  prettyUrls: "strip",
  repo: "https://github.com/runxhq/aster",
  editBranch: "main",
  editBasePath: "docs",
  theme: {
    preset: "default",
    colors: {
      primary: "#0f766e",
      light: "#14b8a6",
      dark: "#115e59",
    },
    fonts: {
      sans: "'IBM Plex Sans', sans-serif",
      mono: "'IBM Plex Mono', monospace",
    },
  },
  navigation: {
    tabs: [
      {
        tab: "Aster",
        groups: [
          {
            group: "Start",
            pages: ["introduction", "philosophy", "architecture", "proving-ground", "evolution"],
          },
          {
            group: "Operate",
            pages: ["operating-model", "flows", "skill-upstream", "operations"],
          },
          {
            group: "Reference",
            pages: ["run-catalog", "backlog"],
          },
        ],
      },
    ],
  },
  navbar: {
    links: [
      {
        type: "github",
        href: "https://github.com/runxhq/aster",
      },
    ],
    primary: {
      type: "button",
      label: "View Repo",
      href: "https://github.com/runxhq/aster",
    },
  },
  footer: {
    links: [
      {
        type: "github",
        href: "https://github.com/runxhq/aster",
      },
    ],
  },
  search: {
    featured: ["introduction", "philosophy", "evolution"],
  },
};
