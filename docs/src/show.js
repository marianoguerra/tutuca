import { compile } from "margaui";
import { compileClassesToStyleText, tutuca } from "tutuca";

const VALID_ID_RE = /^[a-zA-Z0-9_-]+$/;
const APP_ROOT = "#app";

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function detectTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  setTheme(mq.matches ? "dark" : "light");
  mq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
}

function showError(msg) {
  const root = document.querySelector(APP_ROOT);
  root.textContent = msg;
}

async function main() {
  detectTheme();

  const params = new URLSearchParams(location.search);
  const exampleId = params.get("exampleId");
  const disableCache = params.has("disableCache");
  if (!exampleId) {
    showError("Missing exampleId query param");
    return;
  }
  if (!VALID_ID_RE.test(exampleId)) {
    showError("Invalid exampleId");
    return;
  }

  let mod;
  try {
    mod = await import(`../examples/${exampleId}.js`);
  } catch (e) {
    showError(`Failed to load example "${exampleId}": ${e.message}`);
    return;
  }

  const app = tutuca(APP_ROOT);
  const components = mod.getComponents();
  const scope = app.registerComponents(components);
  if (mod.getMacros) scope.registerMacros(mod.getMacros());
  if (mod.getRequestHandlers) scope.registerRequestHandlers(mod.getRequestHandlers());
  const extraCSSClasses = new Set(mod.getExtraCSSClasses?.() ?? []);
  const styleText = await compileClassesToStyleText(app, compile, extraCSSClasses);
  const style = document.createElement("style");
  style.textContent = styleText;
  document.head.appendChild(style);
  app.state.set(mod.getRoot());
  app.start({ noCache: disableCache });
  app.dispatchLogicAtRoot("init", []);
}

main();
