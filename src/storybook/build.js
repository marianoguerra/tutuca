// Pure aggregation: turn an array of dev/story modules into the data a
// storybook needs (buildStorybook) and wire per-example request-handler mocks
// (buildExampleIntentHandlers). No DOM — everything here is unit-testable.
import { PASS } from "tutuca";
import { getComponents as getInspectorComponents } from "tutuca/components";
import { Example, Section, SidebarEntry, SidebarGroup, Storybook } from "./components.js";

// Aggregate an array of dev/story modules into the data a storybook needs.
// Each module follows the convention: getComponents() (required) and
// getExamples() -> a section object { title, description?, items: [...] } OR an
// array of such section objects (a module contributing several sidebar sections).
// Both forms are consumed by Section.fromData. Plus optional
// getMacros()/getIntentHandlers().
export function buildStorybook(modules) {
  const rawSections = modules.flatMap((m) => {
    const raw = m.getExamples?.();
    if (raw == null) return [];
    return Array.isArray(raw) ? raw : [raw];
  });
  const sections = rawSections
    .map((s) => Section.fromData(s))
    .sort((a, b) => a.title.localeCompare(b.title));
  // The engine + inspector components own the shared root scope (mountStorybook
  // registers them there). Module components are grouped per module instead (below)
  // so two modules can define *different* components that happen to share a `name`
  // without colliding — each name lands in its own module scope's table.
  const engineComponents = [
    Storybook,
    Section,
    Example,
    SidebarGroup,
    SidebarEntry,
    // ActivityLog + ActivityEntry arrive via getInspectorComponents() (tutuca/components).
    ...getInspectorComponents(),
  ];
  const engineSet = new Set(engineComponents);
  // One component list per module (positional with `modules`), de-duped within the
  // module by identity. Engine/inspector components are dropped — a module that
  // re-lists them (e.g. `export { getComponents } from "tutuca/components"`) keeps
  // them owned by the root scope and still sees them via parent chaining, rather
  // than re-registering (and rebinding their `.scope`) into the module scope.
  const moduleComponents = modules.map((m) => {
    const seen = new Set();
    const out = [];
    for (const c of m.getComponents?.() ?? []) {
      if (!c || engineSet.has(c) || seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
    return out;
  });
  const macros = {};
  const intentHandlers = {};
  // Intent names any example overrides via its `intentHandlers` map (read from the
  // raw section data — the Example component's intentOverridesField convention).
  const overrideNames = new Set();
  for (const s of rawSections) {
    for (const it of s?.items ?? []) {
      for (const name in it?.intentHandlers ?? {}) overrideNames.add(name);
    }
  }
  for (const m of modules) {
    if (m.getMacros) Object.assign(macros, m.getMacros());
    if (m.getIntentHandlers) Object.assign(intentHandlers, m.getIntentHandlers());
  }
  // Flat union (engine ∪ every module's components), kept for consumers that embed a
  // whole storybook as a single value and so must register everything in one scope
  // — e.g. the Inception demo's getComponents() (docs/examples/storybook.js).
  const components = [...new Set([...engineComponents, ...moduleComponents.flat()])];
  return {
    root: Storybook.withSections(sections),
    components,
    engineComponents,
    moduleComponents,
    macros,
    intentHandlers,
    overrideNames,
  };
}

// Storybook intent-handler mocking. One meta handler per intent name (module handlers ∪
// per-example overrides). Each walks the intent ctx's component path to the nearest
// example (a component declaring `intentOverridesField` in its `extra`) and uses that
// example's mock for the name when present, else the module's real handler. The handler
// signature matches the framework's — the IntentContext is the final arg.
export function buildExampleIntentHandlers({ intentHandlers: reals, overrideNames }) {
  const names = new Set([...Object.keys(reals), ...overrideNames]);
  const makeMeta =
    (name) =>
    async (...rest) => {
      const ctx = rest.at(-1);
      const args = rest.slice(0, -1);
      let override = null;
      ctx.walkPath((Comp, inst) => {
        const field = Comp.extra?.intentOverridesField;
        if (!field) return;
        const map = inst[field] ?? null;
        if (map && name in map) {
          override = map[name];
          return false; // nearest example wins
        }
      });
      const fn = override ?? reals[name];
      // Nothing registered under this name: DECLINE, so the walk goes on and the
      // sender hears `<name>Unhandled` rather than a fabricated error.
      if (!fn) return PASS;
      return await fn(...args, ctx);
    };
  const handlers = {};
  for (const name of names) handlers[name] = makeMeta(name);
  return handlers;
}
