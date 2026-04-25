export const EXAMPLES_SHAPE_MISMATCH = "EXAMPLES_SHAPE_MISMATCH";

class Example {
  constructor({ title, description = null, value, view = "main", componentName = null }) {
    this.title = title;
    this.description = description;
    this.value = value;
    this.view = view;
    this.componentName = componentName;
  }
}

function resolveComponentName(value, components) {
  for (const comp of components) {
    if (value instanceof comp.Class) return comp.name;
  }
  return null;
}

class ExampleSection {
  constructor({ title, description = null, items = [] }) {
    this.title = title;
    this.description = description;
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
  if (raw.value === undefined && raw.item !== undefined) {
    throw shapeError(`example at ${where} uses legacy "item" key; rename to "value"`, where);
  }
  if (raw.value === undefined) {
    throw shapeError(`example at ${where} missing "value"`, where);
  }
  return new Example({
    title: raw.title ?? `Example ${index + 1}`,
    description: raw.description ?? null,
    value: raw.value,
    view: raw.view ?? "main",
    componentName: resolveComponentName(raw.value, components),
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
  return new ExampleSection({
    title: raw.title ?? "Examples",
    description: raw.description ?? null,
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
