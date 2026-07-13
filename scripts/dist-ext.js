// Build variant: non-minified, with all dependencies kept external (not bundled).
// `packages: "external"` keeps every bare npm import (e.g. `chai`) external, while the
// `externalizeImmutable` plugin handles the vendored relative `./deps/immutable.js`.
// Runs after scripts/dist.js and writes into the existing dist/ dir.
import { copyFileSync, readFileSync } from "node:fs";
import * as esbuild from "esbuild";
import { TIERS } from "./tiers.js";

const externalizeImmutable = {
  name: "externalize-immutable",
  setup(build) {
    // matches both ./deps/immutable.js and ../deps/immutable.js.
    // esbuild compiles filters with Go's RE2 — no lookarounds, no backreferences.
    build.onResolve({ filter: /(^|\/)deps\/immutable\.js$/ }, () => ({
      path: "immutable",
      external: true,
    }));
  },
};

const EXT = {
  bundle: true,
  format: "esm",
  platform: "browser",
  charset: "utf8",
  legalComments: "none",
  packages: "external",
  plugins: [externalizeImmutable],
  logLevel: "warning",
};

const written = [];
async function build(entry, outfile, opts = {}) {
  await esbuild.build({ ...EXT, entryPoints: [entry], outfile, ...opts });
  written.push(outfile);
}

for (const [input, name] of TIERS) await build(input, `dist/${name}.ext.js`);

// Storybook library and inspector component library: bundled with `tutuca` kept external
// (packages:"external") so the consumer's import map points "tutuca" at the same runtime
// their story modules use — one tutuca instance, which component scope/identity requires.
await build("storybook.js", "dist/tutuca-storybook.js");
await build("components.js", "dist/tutuca-components.js");

// Ship standalone ESM bundles of the externalized deps so consumers can point an
// import map at tutuca's own copies (tutuca/immutable, tutuca/chai) and switch
// between the full and ext builds without installing immutable/chai separately.
// immutable is already a self-contained ESM bundle, so it's copied verbatim.
copyFileSync("deps/immutable.js", "dist/immutable.js");

// chai is bundled (not external) from deps/chai.js, which applies tutuca's
// jest-style matchers (toBe, toEqual, …) so `tutuca/chai` matches the CLI runner.
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

// esbuild emits the plugin-returned path for an external import, so the specifier is
// already `immutable` and needs no post-hoc rewrite. Guard the assumption rather than
// trust it: a relative deps/ specifier surviving here means a broken published bundle.
for (const f of written) {
  if (/(["'])(?:\.\.?\/)+deps\/immutable\.js\1/.test(readFileSync(f, "utf8"))) {
    throw new Error(`${f}: relative deps/immutable.js specifier survived externalization`);
  }
}
