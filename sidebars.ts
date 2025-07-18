import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: {
    alphaTab: [
      "introduction", 
      "contributing"
    ],
    "Release Notes": [
      {
        type: "autogenerated",
        dirName: 'releases',
        customProps: {
          sort: ['title', 'desc']
        }
      }
    ],
    "Getting Started (Web)": [
      "getting-started/installation-web",
      "getting-started/installation-webpack",
      "getting-started/installation-vite",
      "getting-started/configuration-web",
    ],
    "Getting Started (.net)": [
      "getting-started/installation-net",
      "getting-started/configuration-net",
    ],
    "Getting Started (Android)": [
      "getting-started/installation-android",
      "getting-started/configuration-android",
    ],
    Guides: [
      {
        type: "autogenerated",
        dirName: 'guides',
        customProps: {
          sort: [
            ['order', 'asc'],
            ['title', 'asc']
          ]
        }
      }
    ],
    Migration: [
      {
        type: "autogenerated",
        dirName: 'migration',
        customProps: {
          sort: [
            ['order', 'asc'],
            ['title', 'asc']
          ]
        }
      }
    ],
    "API Reference": [
      {
        type: "category",
        label: "Settings",
        link: {
          type: "doc",
          id: "reference/settings",
        },
        className: "reference-item",
        collapsible: false,
        collapsed: true,
        items: [
          {
            type: "autogenerated",
            dirName: "reference/settings",
          },
        ],
      },
      {
        type: "category",
        label: "API",
        link: {
          type: "doc",
          id: "reference/api",
        },
        className: "reference-item",
        collapsible: false,
        collapsed: true,
        items: [
          {
            type: "autogenerated",
            dirName: "reference/api",
          },
        ],
      },
      {
        type: "doc",
        label: "Data Model",
        id: "reference/score",
      },
      {
        type: "category",
        label: "All Types",
        className: "types-item",
        link: {
          type: "doc",
          id: "reference/types",
        },
        items: [
          {
            type: "autogenerated",
            dirName: "reference/types",
          },
        ],
      },
    ],
  },
  tutorial: {
    Tutorials: ["tutorials"],
    "Tutorial (Web)": [
      "tutorial-web/introduction",
      "tutorial-web/setup",
      "tutorial-web/viewport",
      "tutorial-web/track-selector",
      "tutorial-web/controls",
      "tutorial-web/player",
      "tutorial-web/conclusion",
    ],
    "Tutorial (.net)": [
      "tutorial-net/introduction",
      "tutorial-net/setup",
      "tutorial-net/viewport",
      "tutorial-net/track-selector",
      "tutorial-net/controls",
      "tutorial-net/player",
      "tutorial-net/conclusion",
    ],
    "Tutorial (Android)": [
      "tutorial-android/introduction",
      "tutorial-android/setup",
      "tutorial-android/viewport",
      "tutorial-android/track-selector",
      "tutorial-android/controls",
      "tutorial-android/player",
      "tutorial-android/conclusion",
    ],
  },
  alphaTex: {
    alphaTex: [
      "alphatex/introduction",
      "alphatex/metadata",
      "alphatex/stylesheet",
      "alphatex/notes",
      "alphatex/bar-metadata",
      "alphatex/tracks-staves",
      "alphatex/beat-effects",
      "alphatex/note-effects",
      "alphatex/percussion",
      "alphatex/lyrics",
      "alphatex/sync-points",
    ],
  },
  showcase: [
    {
      type: "category",
      label: "Showcase",
      link: {
        type: "doc",
        id: "showcase/introduction"
      },
      items: [
        "showcase/introduction",
        "showcase/general",
        "showcase/layouts",
        "showcase/music-notation",
        "showcase/guitar-tabs",
        "showcase/special-tracks",
        "showcase/special-notes",
        "showcase/effects",
      ],
    },
    {
      type: "category",
      label: "Formats",
      link: {
        type: "generated-index",
        title: "Introduction",
        description:
          "These pages provide an insight on what the input file formats alphaTab supports and the compatibility for rendering and expressing the same in alphaTex.",
      },
      items: [
        "formats/guitar-pro-8",
        "formats/guitar-pro-7",
        "formats/guitar-pro-6",
        "formats/guitar-pro-3-5",
        "formats/musicxml",
        "formats/capella",
      ],
    },
  ]
};

module.exports = sidebars;
