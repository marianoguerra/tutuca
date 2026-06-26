// The `on` config interpreter: turns a lifecycle-phase declaration into a sequence
// of message dispatches against a target instance. Web-reusable — it knows nothing
// about the storybook or the test runner, only about a `dispatcher` (any
// Dispatcher/EventContext) and a target `Path`. Both the storybook engine
// (src/storybook.js, via the bare "tutuca" import) and the `tutuca test` harness
// (tools/core/test.js) drive components through the same code here.
//
// A phase config looks like:
//   { send:    [{ name, args, opts? }],   // -> receive[name]
//     bubble:  [{ name, args, opts? }],   // -> bubble[name], from the target up
//     request: [{ name, args, opts? }],   // -> response[name] on the target
//     input:   [{ name, args, opts? }],   // -> input[name]
//     do:      [{ type, name, args, opts? }] } // explicit ordered, mixed kinds
// `args` is a plain array (used verbatim) or a function `(self) => array` called
// at dispatch with `self` = the target instance.

const OP_KINDS = ["send", "bubble", "request", "input"];

// Compile a phase to one ordered op list: shorthand buckets first (fixed kind
// order), then the explicit `do` sequence (each item carries its own `type`).
export function phaseOps(phase) {
  const ops = [];
  for (const type of OP_KINDS) for (const a of phase[type] ?? []) ops.push({ type, ...a });
  for (const a of phase.do ?? []) ops.push(a);
  return ops;
}

export function resolveArgs(args, self) {
  return typeof args === "function" ? (args(self) ?? []) : (args ?? []);
}

// True if a phase config contains any `bubble` op (shorthand bucket or a `do`
// item of type "bubble"). Pure predicate — dev surfaces (the test harness and
// the storybook engine) use it to warn that a bubble dispatched where the target
// has no author-controlled ancestor can't reach any author handler.
export function phaseHasBubble(phase) {
  if (!phase) return false;
  if (phase.bubble?.length) return true;
  return (phase.do ?? []).some((op) => op.type === "bubble");
}

// Dispatch every op of a phase onto `targetPath`. `self` feeds args functions.
// Dispatches are queued transactions, so op-list order is the execution order.
export function dispatchPhase(dispatcher, targetPath, phase, self) {
  if (!phase) return;
  for (const op of phaseOps(phase)) {
    const args = resolveArgs(op.args, self);
    switch (op.type) {
      case "send":
        dispatcher.sendAtPath(targetPath, op.name, args, op.opts);
        break;
      case "bubble":
        dispatcher.sendAtPath(targetPath, op.name, args, {
          skipSelf: true,
          bubbles: true,
          ...op.opts,
        });
        break;
      case "request":
        dispatcher.requestAtPath(targetPath, op.name, args, op.opts);
        break;
      case "input":
        dispatcher.inputAtPath(targetPath, op.name, args, op.opts);
        break;
    }
  }
}
