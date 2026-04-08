import { $ } from "bun";

const repo =
  process.argv[2] || "https://github.com/marianoguerra/immutable-js.git";
const branch = process.argv[3] || "7.x";

await $`git clone --depth 1 --branch ${branch} ${repo}`;
await $`cd immutable-js && npm install && npm run build`;
await $`cp immutable-js/dist/immutable.js deps/immutable.js`;
await $`rm -rf immutable-js`;
