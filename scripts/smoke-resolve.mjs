// Module-resolution hook for the smoke tests. The `.ext` builds keep `immer`
// and `chai` as bare external imports (consumers point an import map at tutuca's
// own copies: tutuca/immer, tutuca/chai). This hook emulates that import map
// under Node so the smoke tests can load the `.ext` bundles against the same
// shipped `dist/immer.js` / `dist/chai.js` a browser consumer would use.
const DIST = new URL("../dist/", import.meta.url);
const MAP = {
  immer: new URL("immer.js", DIST).href,
  chai: new URL("chai.js", DIST).href,
  // dist/tutuca-storybook.js keeps `tutuca` external; map it to the base build,
  // mirroring the consumer import map.
  tutuca: new URL("tutuca.js", DIST).href,
};

export async function resolve(specifier, context, next) {
  const mapped = MAP[specifier];
  if (mapped) return { url: mapped, shortCircuit: true };
  return next(specifier, context);
}
