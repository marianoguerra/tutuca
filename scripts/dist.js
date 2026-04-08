import { $ } from "bun";

await $`rm -rf dist && mkdir dist`;

const modules = [
  ["index.js", "tutuca"],
  ["extra.js", "tutuca-extra"],
  ["dev.js", "tutuca-dev"],
];

for (const [input, output] of modules) {
  await $`bun build ${input} --outfile dist/${output}.js --format esm`;
  await $`bun build ${input} --outfile dist/${output}.min.js --format esm --minify`;
  await $`brotli dist/${output}.min.js -o dist/${output}.min.js.br`;
}
