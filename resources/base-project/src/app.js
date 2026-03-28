import { Counter, getComponents } from "./components.js";
import { tutuca } from "./ui.js";

function main() {
  const app = tutuca("#app");
  app.state.set(Counter.make({}));
  app.registerComponents(getComponents());
  app.start();
}

main();
