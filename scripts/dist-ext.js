// Build variant: non-minified, with all dependencies kept external (not bundled).
// `packages: "external"` keeps every bare npm import (e.g. `chai`) external, while the
// `externalizeImmutable` plugin handles the vendored relative `./deps/immutable.js`.
// Runs after scripts/dist.js and writes into the existing dist/ dir.

const externalizeImmutable = {
  name: "externalize-immutable",
  setup(build) {
    // matches both ./deps/immutable.js and ../deps/immutable.js
    build.onResolve({ filter: /(^|\/)deps\/immutable\.js$/ }, () => ({
      path: "immutable",
      external: true,
    }));
  },
};

import { TIERS } from "./tiers.js";

for (const [input, name] of TIERS) {
  const output = `${name}.ext.js`;
  const result = await Bun.build({
    entrypoints: [input],
    format: "esm",
    packages: "external",
    plugins: [externalizeImmutable],
    // no minify* options -> non-minified, comments stripped by default
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  // Bun keeps the original specifier for external modules, so rewrite the
  // relative deps/immutable.js import/export specifiers to the bare package.
  const text = (await result.outputs[0].text()).replaceAll(
    /(["'])(?:\.\.?\/)+deps\/immutable\.js\1/g,
    '"immutable"',
  );
  await Bun.write(`dist/${output}`, text);
}

// Storybook library: bundled with `tutuca` kept external (packages:"external")
// so the consumer's import map points "tutuca" at the same runtime their story
// modules use — one tutuca instance, which component scope/identity requires.
const sb = await Bun.build({
  entrypoints: ["storybook.js"],
  format: "esm",
  packages: "external",
  plugins: [externalizeImmutable],
});
if (!sb.success) {
  for (const log of sb.logs) console.error(log);
  process.exit(1);
}
await Bun.write("dist/tutuca-storybook.js", await sb.outputs[0].text());

// Inspector component library: same contract as the storybook bundle — `tutuca`
// kept external (packages:"external") so the consumer's import map points
// "tutuca" at the same runtime, and immutable externalized to the bare package.
const comps = await Bun.build({
  entrypoints: ["components.js"],
  format: "esm",
  packages: "external",
  plugins: [externalizeImmutable],
});
if (!comps.success) {
  for (const log of comps.logs) console.error(log);
  process.exit(1);
}
await Bun.write("dist/tutuca-components.js", await comps.outputs[0].text());

// Ship standalone ESM bundles of the externalized deps so consumers can point an
// import map at tutuca's own copies (tutuca/immutable, tutuca/chai) and switch
// between the full and ext builds without installing immutable/chai separately.
// immutable is already a self-contained ESM bundle, so it's copied verbatim.
await Bun.write("dist/immutable.js", Bun.file("deps/immutable.js"));

// chai is bundled (not external) from deps/chai.js, which applies tutuca's
// jest-style matchers (toBe, toEqual, …) so `tutuca/chai` matches the CLI runner.
const chaiBuild = await Bun.build({
  entrypoints: ["deps/chai.js"],
  format: "esm",
  // chai inlined -> dist/chai.js stays self-contained for browser import maps.
});
if (!chaiBuild.success) {
  for (const log of chaiBuild.logs) console.error(log);
  process.exit(1);
}
await Bun.write("dist/chai.js", await chaiBuild.outputs[0].text());
