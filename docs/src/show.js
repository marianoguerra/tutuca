// Mount one docs example full-page. Query params:
//
//   exampleId=<name>    which docs/examples/<name>.js to mount (required)
//   disableCache        render without the renderer cache
//   maxStates=<n>       how many states the time-travel slider keeps
//                       (default 1000, 0 turns time travel off)
import { compile } from "margaui";
import { compileClassesToStyleText, tutuca } from "tutuca";
import { ValueHistory } from "./undo.js";

const VALID_ID_RE = /^[a-zA-Z0-9_-]+$/;
const APP_ROOT = "#app";
const DEFAULT_MAX_STATES = 1000;

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

// Returns the number of states to keep, or null when the param is not a whole
// number of states.
function parseMaxStates(raw) {
  if (raw === null || raw === "") return DEFAULT_MAX_STATES;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// Record every committed state and let the slider put any of them back.
// Travelling sets the old value with `isUndo`, so it is not recorded again: the
// history stays a log of what the app did, not of the travelling. A new
// transaction after travelling back continues from there and jumps the slider
// to the end, the way an undo stack branches.
function mountTimeTravel(app, maxStates) {
  const bar = document.querySelector("#time-travel");
  const slider = bar.querySelector("#time-travel-slider");
  const label = bar.querySelector("#time-travel-label");
  const history = new ValueHistory(maxStates);
  const sync = (index) => {
    slider.max = history.size - 1;
    slider.value = index;
    label.value = `state ${index + 1} of ${history.size}`;
    // one state is not a history worth showing
    bar.hidden = history.size < 2;
  };

  // Seed with the state the app mounted with (nothing has changed yet, so no
  // change event carries it) — travelling all the way back reaches the first
  // render instead of the first update.
  history.onChange({ val: app.state.val, old: null, info: null, timestamp: Date.now() });
  sync(0);

  slider.addEventListener("input", () => {
    const index = +slider.value;
    app.state.set(history.at(index).val, { isUndo: true, index });
    sync(index);
  });
  app.state.onChange((change) => {
    // a handler that returned `this` unchanged is not a state to travel to
    if (change.info?.isUndo || change.val === change.old) return;
    history.onChange(change);
    sync(history.size - 1);
  });
}

async function main() {
  detectTheme();

  const params = new URLSearchParams(location.search);
  const exampleId = params.get("exampleId");
  const disableCache = params.has("disableCache");
  const maxStates = parseMaxStates(params.get("maxStates"));
  if (!exampleId) {
    showError("Missing exampleId query param");
    return;
  }
  if (!VALID_ID_RE.test(exampleId)) {
    showError("Invalid exampleId");
    return;
  }
  if (maxStates === null) {
    showError(
      `Invalid maxStates "${params.get("maxStates")}": expected how many states to keep for time travel, 0 to turn it off`,
    );
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
  const styleText = await compileClassesToStyleText(app, compile);
  const style = document.createElement("style");
  style.textContent = styleText;
  document.head.appendChild(style);
  app.state.set(mod.getRoot());
  app.start({ noCache: disableCache });
  // before `init`, so the state it produces is the first recorded change
  if (maxStates > 0) mountTimeTravel(app, maxStates);
  app.sendAtRoot("init", []);
}

main();
