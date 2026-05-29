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

const modules = [
  ["index.js", "tutuca.ext.js"],
  ["extra.js", "tutuca-extra.ext.js"],
  ["dev.js", "tutuca-dev.ext.js"],
];

for (const [input, output] of modules) {
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
