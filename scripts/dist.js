import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { brotliCompressSync, constants as Z } from "node:zlib";
import * as esbuild from "esbuild";
import { TIERS } from "./tiers.js";

// esbuild defaults differ from the bundler this used to run on, in ways that are
// invisible until they aren't: without `charset` the § render sentinels get \u-escaped,
// and without `legalComments` every dependency's license block is appended to the output.
const COMMON = {
  bundle: true,
  format: "esm",
  platform: "browser",
  charset: "utf8",
  legalComments: "none",
  logLevel: "warning",
};

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

for (const [input, output] of TIERS) {
  await esbuild.build({ ...COMMON, entryPoints: [input], outfile: `dist/${output}.js` });

  await esbuild.build({
    ...COMMON,
    entryPoints: [input],
    outfile: `dist/${output}.min.js`,
    // Identifiers stay unmangled on purpose: component and class names have to
    // survive into stack traces and into the linter's error messages.
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,
  });

  const min = readFileSync(`dist/${output}.min.js`);
  writeFileSync(
    `dist/${output}.min.js.br`,
    brotliCompressSync(min, {
      params: {
        [Z.BROTLI_PARAM_QUALITY]: Z.BROTLI_MAX_QUALITY,
        [Z.BROTLI_PARAM_LGWIN]: 22,
        [Z.BROTLI_PARAM_SIZE_HINT]: min.length,
      },
    }),
  );
}

await esbuild.build({
  ...COMMON,
  entryPoints: ["tools/tutuca.js"],
  outfile: "dist/tutuca-cli.js",
  platform: "node",
  external: ["jsdom", "prettier"],
});

// esbuild re-prints the entry point's hashbang; the bin is unusable without it.
if (!readFileSync("dist/tutuca-cli.js", "utf8").startsWith("#!/usr/bin/env node")) {
  throw new Error("dist/tutuca-cli.js lost its shebang — add banner: { js: '#!/usr/bin/env node' }");
}
chmodSync("dist/tutuca-cli.js", 0o755);
