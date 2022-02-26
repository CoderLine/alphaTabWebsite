/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */

// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: {
    alphaTab: ["introduction", "contributing"],
    "Getting Started (Web)": [
      "getting-started/installation-web",
      "getting-started/configuration-web",
    ],
    "Getting Started (.net)": [
      "getting-started/installation-net",
      "getting-started/configuration-net",
    ],
    Guides: [
      "guides/lowlevel-apis",
      "guides/styling-player",
      "guides/multiple-soundfonts",
      "guides/song-details",
      "guides/exporter",
      "guides/handling-midi-events",
      "guides/nodejs",
      "guides/breaking-changes-095-096",
      "guides/breaking-changes-097-098",
    ],
    "API Reference": [
      "reference/settings",
      "reference/api",
      "reference/score",
      "reference/scorerenderer",
      "reference/alphasynth",
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
  },
  alphaTex: {
    alphaTex: [
      "alphatex/introduction",
      "alphatex/metadata",
      "alphatex/notes",
      "alphatex/bar-metadata",
      "alphatex/tracks-staves",
      "alphatex/beat-effects",
      "alphatex/note-effects",
    ],
  },
  showcase: {
    Showcase: [
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
};

module.exports = sidebars;
