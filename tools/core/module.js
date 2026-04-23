export const EXAMPLES_SHAPE_MISMATCH = "EXAMPLES_SHAPE_MISMATCH";

export class Example {
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

export class ExampleGroup {
  constructor({ title, description = null, items }) {
    this.title = title;
    this.description = description;
    this.items = items;
  }
}

export class ExampleSection {
  constructor({ title, description = null, groups = [], items = [] }) {
    this.title = title;
    this.description = description;
    this.groups = groups;
    this.items = items;
  }
  *flatten() {
    for (const item of this.items) {
      yield { groupTitle: null, example: item };
    }
    for (const group of this.groups) {
      for (const item of group.items) {
        yield { groupTitle: group.title, example: item };
      }
    }
  }
}

export class NormalizedModule {
  constructor({ mod, path = null, components, macros, requestHandlers, section, root }) {
    this.mod = mod;
    this.path = path;
    this.components = components;
    this.macros = macros;
    this.requestHandlers = requestHandlers;
    this.section = section;
    this.root = root;
  }
}

function parseExample(raw, index, components) {
  if (!raw || typeof raw !== "object") {
    const err = new Error(
      `${EXAMPLES_SHAPE_MISMATCH}: example at index ${index} is not an object`,
    );
    err.code = EXAMPLES_SHAPE_MISMATCH;
    throw err;
  }
  if (raw.value === undefined && raw.item !== undefined) {
    const err = new Error(
      `${EXAMPLES_SHAPE_MISMATCH}: example at index ${index} uses legacy "item" key; rename to "value"`,
    );
    err.code = EXAMPLES_SHAPE_MISMATCH;
    throw err;
  }
  if (raw.value === undefined) {
    const err = new Error(
      `${EXAMPLES_SHAPE_MISMATCH}: example at index ${index} missing "value"`,
    );
    err.code = EXAMPLES_SHAPE_MISMATCH;
    throw err;
  }
  return new Example({
    title: raw.title ?? `Example ${index + 1}`,
    description: raw.description ?? null,
    value: raw.value,
    view: raw.view ?? "main",
    componentName: resolveComponentName(raw.value, components),
  });
}

function parseGroup(raw, index, components) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) {
    const err = new Error(
      `${EXAMPLES_SHAPE_MISMATCH}: group at index ${index} must have an "items" array`,
    );
    err.code = EXAMPLES_SHAPE_MISMATCH;
    throw err;
  }
  return new ExampleGroup({
    title: raw.title ?? `Group ${index + 1}`,
    description: raw.description ?? null,
    items: raw.items.map((e, i) => parseExample(e, i, components)),
  });
}

function parseSection(raw, components) {
  if (Array.isArray(raw)) {
    const err = new Error(
      `${EXAMPLES_SHAPE_MISMATCH}: getExamples() returned a flat array; expected a section ` +
        `object { title, description?, groups?, items }.`,
    );
    err.code = EXAMPLES_SHAPE_MISMATCH;
    throw err;
  }
  if (!raw || typeof raw !== "object") {
    const err = new Error(
      `${EXAMPLES_SHAPE_MISMATCH}: getExamples() must return a section object`,
    );
    err.code = EXAMPLES_SHAPE_MISMATCH;
    throw err;
  }
  const items = Array.isArray(raw.items)
    ? raw.items.map((e, i) => parseExample(e, i, components))
    : [];
  const groups = Array.isArray(raw.groups)
    ? raw.groups.map((g, i) => parseGroup(g, i, components))
    : [];
  if (items.length === 0 && groups.length === 0) {
    const err = new Error(
      `${EXAMPLES_SHAPE_MISMATCH}: getExamples() returned a section with no items or groups`,
    );
    err.code = EXAMPLES_SHAPE_MISMATCH;
    throw err;
  }
  return new ExampleSection({
    title: raw.title ?? "Examples",
    description: raw.description ?? null,
    groups,
    items,
  });
}

export function normalizeModule(mod, { path = null } = {}) {
  const present = new Set();
  for (const key of [
    "getComponents",
    "getMacros",
    "getRequestHandlers",
    "getExamples",
    "getStoryBookSection",
    "getRoot",
  ]) {
    if (typeof mod[key] === "function") present.add(key);
  }

  if (present.has("getStoryBookSection") && !present.has("getExamples")) {
    const err = new Error(
      `${EXAMPLES_SHAPE_MISMATCH}: module exports getStoryBookSection; rename it to getExamples.`,
    );
    err.code = EXAMPLES_SHAPE_MISMATCH;
    throw err;
  }

  const components = present.has("getComponents") ? mod.getComponents() : [];
  const macros = present.has("getMacros") ? mod.getMacros() : null;
  const requestHandlers = present.has("getRequestHandlers")
    ? mod.getRequestHandlers()
    : null;
  const root = present.has("getRoot") ? mod.getRoot() : null;
  const section = present.has("getExamples")
    ? parseSection(mod.getExamples(), components)
    : null;

  return {
    normalized: new NormalizedModule({
      mod,
      path,
      components,
      macros,
      requestHandlers,
      section,
      root,
    }),
    present,
  };
}
