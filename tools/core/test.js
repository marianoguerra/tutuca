import { ComponentStack } from "../../src/components.js";
import { dispatchPhase } from "../../src/on.js";
import { Path } from "../../src/path.js";
import { rootDispatcher, Transactor } from "../../src/transactor.js";
import { DescribeResult, ModuleTestReport, TestReport, TestResult } from "./results.js";
import { makeCollector, Test } from "./tests.js";

function buildPath(node) {
  const parts = [];
  let cur = node;
  while (cur) {
    parts.unshift(cur.title);
    cur = cur.parent;
  }
  return parts.join(" > ");
}

function captureError(e) {
  const out = { message: e.message, stack: e.stack };
  if ("expected" in e) out.expected = e.expected;
  if ("actual" in e) out.actual = e.actual;
  return out;
}

function buildStack({ components = [], macros = null, requestHandlers = null } = {}) {
  const stack = new ComponentStack();
  stack.registerComponents(components);
  if (macros) stack.registerMacros(macros);
  if (requestHandlers) stack.registerRequestHandlers(requestHandlers);
  return stack;
}

// Dispatch one `on`-phase config ({ send, bubble, request, input, do } — same
// shape as an example's on.init) at the root over `stack`, awaiting the full
// cascade. Returns the settled root value. `opts.onMessage(message, before,
// after)` observes each committed transaction (message = { kind, name, args, path }).
async function driveStack(stack, value, phase, opts = {}) {
  const transactor = new Transactor(stack.comps, value);
  if (opts.onMessage)
    transactor.state.onChange(({ val, old, info }) => {
      const t = info?.transaction;
      opts.onMessage(
        { kind: t?.handlerProp ?? "input", name: t?.name, args: t?.args, path: t?.path },
        old,
        val,
      );
    });
  dispatchPhase(rootDispatcher(transactor), new Path([]), phase, value);
  await transactor.settle();
  return transactor.state.val;
}

// Drive `value` (a component instance) through one `on`-phase config against a
// freshly-registered scope. `cfg = { components, macros, requestHandlers }`.
// Returns the settled root value. For repeated drives prefer one
// runTests/getTests scope; each call here re-registers the components.
export async function drive(cfg, value, phase, opts = {}) {
  return driveStack(buildStack(cfg), value, phase, opts);
}

export async function runTests({
  getTests,
  components = [],
  path = null,
  expect,
  name = null,
  grep = null,
  bail = false,
  requestHandlers = null,
  macros = null,
} = {}) {
  const counts = { pass: 0, fail: 0, skip: 0, total: 0 };

  if (typeof getTests !== "function") {
    return new TestReport({
      modules: [new ModuleTestReport({ path, suites: [], counts })],
    });
  }
  if (typeof expect !== "function") {
    throw new Error("runTests: expect must be provided (e.g. chai's expect)");
  }

  const { describe, test, moduleTests } = makeCollector({ path, components });

  // Lazily build one registered scope (components + request handlers + macros) the
  // first time `drive` is used, mirroring tools/core/lint.js. Lazy so an unused
  // `drive` never mutates the shared Component objects' `.scope`. The injected
  // `drive` is bound to this scope, so it takes just (value, phase, opts).
  let _stack = null;
  const getStack = () => (_stack ??= buildStack({ components, macros, requestHandlers }));
  const driveLocal = (value, phase, opts = {}) => driveStack(getStack(), value, phase, opts);

  await getTests({ describe, test, expect, drive: driveLocal });

  let bailed = false;

  async function visit(node) {
    if (node instanceof Test) {
      if (name !== null && node.componentName !== name) return null;
      const fullPath = buildPath(node);
      if (grep !== null && !fullPath.includes(grep)) return null;

      counts.total++;
      if (bailed) {
        counts.skip++;
        return new TestResult({
          title: node.title,
          fullPath,
          componentName: node.componentName,
          status: "skip",
        });
      }
      const start = performance.now();
      try {
        await node.fn();
        counts.pass++;
        return new TestResult({
          title: node.title,
          fullPath,
          componentName: node.componentName,
          status: "pass",
          durationMs: performance.now() - start,
        });
      } catch (e) {
        counts.fail++;
        if (bail) bailed = true;
        return new TestResult({
          title: node.title,
          fullPath,
          componentName: node.componentName,
          status: "fail",
          durationMs: performance.now() - start,
          error: captureError(e),
        });
      }
    }

    const childResults = [];
    for (const child of node.children) {
      const r = await visit(child);
      if (r !== null) childResults.push(r);
    }
    if (childResults.length === 0) return null;
    return new DescribeResult({
      title: node.title,
      componentName: node.componentName,
      children: childResults,
    });
  }

  const suiteResults = [];
  for (const suite of moduleTests.suites) {
    const r = await visit(suite);
    if (r !== null) suiteResults.push(r);
  }

  return new TestReport({
    modules: [new ModuleTestReport({ path, suites: suiteResults, counts })],
  });
}
