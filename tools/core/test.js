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
  await getTests({ describe, test, expect, drive });

  // Lazily build one registered scope (components + request handlers + macros) the
  // first time `drive` is used, mirroring tools/core/lint.js. Lazy so an unused
  // `drive` never mutates the shared Component objects' `.scope`.
  let _stack = null;
  function getStack() {
    if (_stack) return _stack;
    _stack = new ComponentStack();
    _stack.registerComponents(components);
    if (macros) _stack.registerMacros(macros);
    if (requestHandlers) _stack.registerRequestHandlers(requestHandlers);
    return _stack;
  }

  // Drive `value` (a component instance) through one `on`-phase config
  // ({ send, bubble, request, input, do } — same shape as an example's on.init),
  // dispatching every action at the root and awaiting the full cascade. Returns
  // the settled root value. `opts.onMessage(message, before, after)` observes each
  // committed transaction (message = { kind, name, args, path }).
  async function drive(value, phase, opts = {}) {
    const transactor = new Transactor(getStack().comps, value);
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
