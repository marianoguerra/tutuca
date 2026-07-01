export class Describe {
  constructor({ title, componentName = null, parent = null }) {
    this.title = title;
    this.componentName = componentName;
    this.parent = parent;
    this.children = [];
  }
}

export class Test {
  constructor({ title, fn, componentName = null, parent = null }) {
    this.title = title;
    this.fn = fn;
    this.componentName = componentName;
    this.parent = parent;
  }
}

export class ModuleTests {
  constructor({ path = null, suites = [] } = {}) {
    this.path = path;
    this.suites = suites;
  }
}

function isComponentObject(x) {
  return (
    x !== null &&
    typeof x === "object" &&
    typeof x.name === "string" &&
    typeof x.Class === "function"
  );
}

function resolveComponentName(arg, components) {
  if (isComponentObject(arg)) return arg.name;
  if (typeof arg === "function") {
    for (const c of components) if (c.Class === arg) return c.name;
  }
  return null;
}

function titleFromArg(arg) {
  if (typeof arg === "string") return arg;
  if (isComponentObject(arg)) return arg.name;
  if (typeof arg === "function") return arg.name || "(anonymous)";
  return String(arg);
}

export function makeCollector({ path = null, components = [] } = {}) {
  const moduleTests = new ModuleTests({ path, suites: [] });
  const stack = [];

  function describe(...args) {
    let head;
    let options = null;
    let fn;
    if (args.length === 2) {
      [head, fn] = args;
    } else if (args.length === 3) {
      [head, options, fn] = args;
    } else {
      throw new Error(`describe() expects 2 or 3 arguments, got ${args.length}`);
    }
    if (typeof fn !== "function") {
      throw new Error(
        `describe(${JSON.stringify(titleFromArg(head))}): final argument must be a function`,
      );
    }

    let componentName = null;
    if (typeof head !== "string") {
      componentName = resolveComponentName(head, components);
    }
    if (componentName === null && options && options.component != null) {
      componentName = resolveComponentName(options.component, components);
    }
    if (componentName === null) {
      const parent = stack.length ? stack[stack.length - 1] : null;
      if (parent) componentName = parent.componentName;
    }

    const parent = stack.length ? stack[stack.length - 1] : null;
    const node = new Describe({
      title: titleFromArg(head),
      componentName,
      parent,
    });
    if (parent) parent.children.push(node);
    else moduleTests.suites.push(node);

    stack.push(node);
    try {
      fn();
    } finally {
      stack.pop();
    }
  }

  function test(title, fn) {
    if (typeof title !== "string") {
      throw new Error("test(title, fn): title must be a string");
    }
    if (typeof fn !== "function") {
      throw new Error(`test(${JSON.stringify(title)}): fn must be a function`);
    }
    const parent = stack.length ? stack[stack.length - 1] : null;
    if (!parent) {
      throw new Error(`test(${JSON.stringify(title)}) must be called inside a describe()`);
    }
    parent.children.push(
      new Test({
        title,
        fn,
        componentName: parent.componentName,
        parent,
      }),
    );
  }

  return { describe, test, moduleTests };
}
