// Build variant: non-minified, with all bare npm dependencies kept external.
// Runs after scripts/dist.js and writes into the existing dist/ directory.
import * as esbuild from "esbuild";
import { TIERS } from "./tiers.js";

const EXT = {
  bundle: true,
  format: "esm",
  platform: "browser",
  charset: "utf8",
  legalComments: "none",
  packages: "external",
  logLevel: "warning",
};

async function build(entry, outfile, opts = {}) {
  await esbuild.build({ ...EXT, entryPoints: [entry], outfile, ...opts });
}

for (const [input, name] of TIERS) await build(input, `dist/${name}.ext.js`);

// These libraries keep `tutuca` external so applications and story modules share
// one runtime instance, which component scope and identity require.
await build("storybook.js", "dist/tutuca-storybook.js");
await build("components.js", "dist/tutuca-components.js");

// Standalone Immer bundle for browser import maps used with Tutuca's ext builds.
await esbuild.build({
  bundle: true,
  format: "esm",
  platform: "browser",
  charset: "utf8",
  legalComments: "none",
  entryPoints: ["src/immer.js"],
  outfile: "dist/immer.js",
  logLevel: "warning",
});

// Chai is bundled from the adapter that installs Tutuca's Jest-style aliases.
await esbuild.build({
  bundle: true,
  format: "esm",
  platform: "browser",
  charset: "utf8",
  legalComments: "none",
  entryPoints: ["deps/chai.js"],
  outfile: "dist/chai.js",
  logLevel: "warning",
});
