export const EXAMPLES_SHAPE_MISMATCH = "EXAMPLES_SHAPE_MISMATCH";

class Example {
  constructor({
    title,
    description = null,
    value,
    view = "main",
    componentName = null,
    requestHandlerNames = [],
  }) {
    this.title = title;
    this.description = description;
    this.value = value;
    this.view = view;
    this.componentName = componentName;
    // Names of request handlers this example mocks (the keys of its requestHandlers
    // map). Surfaced by `tutuca storybook --dry-run` for inspection.
    this.requestHandlerNames = requestHandlerNames;
  }
}

function resolveComponentName(value, components) {
  for (const comp of components) {
    if (value instanceof comp.Class) return comp.name;
  }
  return null;
}

class ExampleSection {
  constructor({ title, description = null, group = "", items = [] }) {
    this.title = title;
    this.description = description;
    this.group = group;
    this.items = items;
  }
}

class NormalizedModule {
  constructor({ mod, path = null, components, macros, requestHandlers, sections, root }) {
    this.mod = mod;
    this.path = path;
    this.components = components;
    this.macros = macros;
    this.requestHandlers = requestHandlers;
    this.sections = sections;
    this.root = root;
  }
}

function shapeError(message, where) {
  const err = new Error(`${EXAMPLES_SHAPE_MISMATCH}: ${message}`);
  err.code = EXAMPLES_SHAPE_MISMATCH;
  err.where = where;
  return err;
}

function parseExample(raw, index, components, parentPath) {
  const where = `${parentPath}.items[${index}]`;
  if (!raw || typeof raw !== "object") {
    throw shapeError(`example at ${where} is not an object`, where);
  }
  if (raw.value === undefined) {
    throw shapeError(`example at ${where} missing "value"`, where);
  }
  const rh = raw.requestHandlers;
  if (rh != null && (typeof rh !== "object" || Array.isArray(rh))) {
    throw shapeError(`example at ${where} "requestHandlers" must be an object of functions`, where);
  }
  return new Example({
    title: raw.title ?? `Example ${index + 1}`,
    description: raw.description ?? null,
    value: raw.value,
    view: raw.view ?? "main",
    componentName: resolveComponentName(raw.value, components),
    requestHandlerNames: rh ? Object.keys(rh) : [],
  });
}

function parseSection(raw, components, where) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw shapeError(`section at ${where} must be an object { title, description?, items }`, where);
  }
  const items = Array.isArray(raw.items)
    ? raw.items.map((e, i) => parseExample(e, i, components, where))
    : [];
  if (items.length === 0) {
    throw shapeError(`section at ${where} has no items`, where);
  }
  if (raw.group != null && typeof raw.group !== "string") {
    throw shapeError(
      `section at ${where} has a non-string "group" (got ${typeof raw.group}); ` +
        `group must be a string naming the sidebar group, or be omitted`,
      where,
    );
  }
  return new ExampleSection({
    title: raw.title ?? "Examples",
    description: raw.description ?? null,
    group: raw.group ?? "",
    items,
  });
}

function parseSections(raw, components) {
  const where = "examples";
  if (Array.isArray(raw)) {
    return raw.map((r, i) => parseSection(r, components, `${where}[${i}]`));
  }
  if (!raw || typeof raw !== "object") {
    throw shapeError(
      "getExamples() must return a section object or an array of section objects",
      where,
    );
  }
  return [parseSection(raw, components, where)];
}

export function normalizeModule(mod, { path = null } = {}) {
  const present = new Set();
  for (const key of [
    "getComponents",
    "getMacros",
    "getRequestHandlers",
    "getExamples",
    "getTests",
    "getRoot",
  ]) {
    if (typeof mod[key] === "function") present.add(key);
  }

  const components = present.has("getComponents") ? mod.getComponents() : [];
  const macros = present.has("getMacros") ? mod.getMacros() : null;
  const requestHandlers = present.has("getRequestHandlers") ? mod.getRequestHandlers() : null;
  const root = present.has("getRoot") ? mod.getRoot() : null;
  const sections = present.has("getExamples") ? parseSections(mod.getExamples(), components) : [];

  return {
    normalized: new NormalizedModule({
      mod,
      path,
      components,
      macros,
      requestHandlers,
      sections,
      root,
    }),
    present,
  };
}

// Detect component-name clashes across modules: the same `name` defined by two or
// more *distinct* component objects (identity). The storybook registers components
// by name, so such a clash leaves one definition uncompiled and it throws when
// rendered. (A single component object listed by several modules' getComponents() is
// fine — that is the shared-leaf contract and dedupes by identity.)
//
// `entries` is `[{ path, components }]` where `components` is exactly what a module's
// getComponents() returned. Returns `[{ name, paths }]`, one per clashing name, with
// the sorted list of module paths that define it.
export function findComponentNameConflicts(entries) {
  const byName = new Map(); // name -> Map<componentObject, Set<path>>
  for (const { path, components } of entries) {
    for (const comp of components ?? []) {
      if (!comp || typeof comp.name !== "string") continue;
      let objs = byName.get(comp.name);
      if (!objs) {
        objs = new Map();
        byName.set(comp.name, objs);
      }
      let paths = objs.get(comp);
      if (!paths) {
        paths = new Set();
        objs.set(comp, paths);
      }
      if (path != null) paths.add(path);
    }
  }
  const conflicts = [];
  for (const [name, objs] of byName) {
    if (objs.size < 2) continue; // one distinct object for this name → no clash
    const paths = new Set();
    for (const set of objs.values()) for (const p of set) paths.add(p);
    conflicts.push({ name, paths: [...paths].sort() });
  }
  return conflicts.sort((a, b) => a.name.localeCompare(b.name));
}
