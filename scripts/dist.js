import { $ } from "bun";
import { chmodSync } from "node:fs";

await $`rm -rf dist && mkdir dist`;

const modules = [
  ["index.js", "tutuca"],
  ["extra.js", "tutuca-extra"],
  ["dev.js", "tutuca-dev"],
];

for (const [input, output] of modules) {
  await $`bun build ${input} --outfile dist/${output}.js --format esm`;
  await $`bun build ${input} --outfile dist/${output}.min.js --format esm --minify-whitespace --minify-syntax`;
  await $`brotli dist/${output}.min.js -o dist/${output}.min.js.br`;
}

await $`bun build tools/tutuca.js --outfile dist/tutuca-cli.js --format esm --target node --external jsdom --external prettier`;
chmodSync("dist/tutuca-cli.js", 0o755);
