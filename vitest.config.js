import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dist = (f) => fileURLToPath(new URL(`./dist/${f}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // src/storybook/*.js and src/components/**/*.js import the BARE "tutuca"
      // specifier, which Node resolves through the package self-reference
      // (package.json name + exports "." -> dist/tutuca.js). Vite's resolver does
      // not implement self-reference — it only walks node_modules — so the mapping
      // has to be explicit. This is why `pretest` builds dist/ first.
      { find: /^tutuca$/, replacement: dist("tutuca.js") },
      { find: /^tutuca\/components$/, replacement: dist("tutuca-components.js") },
    ],
  },
  test: {
    environment: "node", // the tests build their own jsdom, via test/dom.js
    globals: false,
    include: ["test/*.test.js"],
    // The CLI tests spawn `node dist/tutuca-cli.js`, and one builds a skill tree in
    // beforeAll — both far slower than the 5s/10s defaults.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    server: {
      // Load the prebuilt bundles natively rather than pushing 250KB+ single-file
      // bundles through Vite's transform pipeline.
      deps: { external: [/[\\/]dist[\\/]/] },
    },
  },
});
