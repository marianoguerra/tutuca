import { chmodSync } from "node:fs";
import { $ } from "bun";
import { TIERS } from "./tiers.js";

await $`rm -rf dist && mkdir dist`;

for (const [input, output] of TIERS) {
  await $`bun build ${input} --outfile dist/${output}.js --format esm`;
  await $`bun build ${input} --outfile dist/${output}.min.js --format esm --minify-whitespace --minify-syntax`;
  await $`brotli dist/${output}.min.js -o dist/${output}.min.js.br`;
}

await $`bun build tools/tutuca.js --outfile dist/tutuca-cli.js --format esm --target node --external jsdom --external prettier`;
chmodSync("dist/tutuca-cli.js", 0o755);
