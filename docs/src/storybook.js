import { compile } from "margaui";
import { check, compileClassesToStyleText } from "tutuca";
import { mountStorybook } from "tutuca/storybook";
import { getModules, getRoot } from "../examples/storybook.js";

async function main() {
  const app = await mountStorybook("#app", getModules(), {
    root: getRoot(), // custom root with the Inception demo
    compileCss: (a) => compileClassesToStyleText(a, compile),
  });
  check(app);
}

main();
