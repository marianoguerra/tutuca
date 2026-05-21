// Build variant: non-minified, with `immutable` kept external (not bundled).
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
