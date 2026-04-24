import { compile } from "margaui";
import { check, compileClassesToStyleText, injectCss, tutuca } from "tutuca";
import { getComponents, getMacros, getRequestHandlers, getRoot } from "../examples/storybook.js";

async function main() {
  const app = tutuca("#app");
  app.state.set(getRoot());
  const scope = app.registerComponents(getComponents());
  scope.registerMacros(getMacros());
  scope.registerRequestHandlers(getRequestHandlers());

  const style = await compileClassesToStyleText(app, compile);
  injectCss("myapp", style);

  app.start();
  check(app);
}

main();
