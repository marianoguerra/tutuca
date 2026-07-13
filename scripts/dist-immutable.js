import { execFileSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";

const repo = process.argv[2] || "https://github.com/marianoguerra/immutable-js.git";
const branch = process.argv[3] || "7.x";

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

rmSync("immutable-js", { recursive: true, force: true });
run("git", ["clone", "--depth", "1", "--branch", branch, repo]);
run("npm", ["install"], { cwd: "immutable-js" });
run("npm", ["run", "build"], { cwd: "immutable-js" });
copyFileSync("immutable-js/dist/immutable.js", "deps/immutable.js");
rmSync("immutable-js", { recursive: true, force: true });
