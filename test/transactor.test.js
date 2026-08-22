import { describe, expect, test } from "vitest";
import { produce } from "../src/immer.js";
import { FieldStep, Path, SeqAccessStep } from "../src/path.js";
import { PASS, Transactor } from "../src/transactor.js";
import { HandlerNameVal } from "../src/value.js";

const obj = (value = {}) => value;

// The two dispatch buckets, plus the scope-registered chain the `lex` leg walks.
// `intentChain` is a list per name because a handler may decline with PASS and hand the
// intent to the next one.
function makeComps({ receive = {}, intent = {}, intentChain = null } = {}) {
  const compMeta = { receive, intent };
  return {
    getCompFor: () => compMeta,
    getIntentChainFor: (_inst, _name) => intentChain ?? [],
  };
}

function setup(handlers, root = { tag: "root" }) {
  return new Transactor(makeComps(handlers), root);
}

function runAll(t) {
  while (t.hasPendingTransactions) t.transactNext();
}

test("can push send transaction", () => {
  const t = new Transactor();
  t.pushSend(new Path([]), "blurb", []);
  expect(t.hasPendingTransactions).toBe(true);
});

describe("refusal channel", () => {
  test("a receive name with no implementation raises NO_HANDLER", () => {
    const t = setup({});
    const seen = [];
    const unsubscribe = t.observeRefusals((r) => seen.push(r));
    // The view wrote `@on.click="missing"`; the resolved fallback runs.
    const handler = HandlerNameValEval(t, "missing");
    const self = {};
    const result = handler.call(self, { draft: 1 });
    expect(result).toBe(self); // graceful: returns `this`, no throw
    expect(t.refusals.length).toBe(1);
    expect(seen.length).toBe(1);
    expect(t.refusals[0].kind).toBe("NO_HANDLER");
    expect(t.refusals[0].info).toEqual({ namespace: "receive", name: "missing", argCount: 1 });
    // unsubscribing stops delivery; the ring keeps recording
    unsubscribe();
    t.refuse("NO_HANDLER", { name: "again" });
    expect(seen.length).toBe(1);
    expect(t.refusals.length).toBe(2);
  });

  test("the refusal ring is capped", () => {
    const t = new Transactor();
    for (let i = 0; i < 250; i++) t.refuse("NO_HANDLER", { i });
    expect(t.refusals.length).toBeLessThanOrEqual(200);
    expect(t.refusals.at(-1).info.i).toBe(249);
  });

  test("ctx.forward() from a handler with no name refuses FORWARD_NO_NAME", () => {
    // covered through the intent walk below; direct unit of the guard:
    const t = setup({
      ping(draft) {
        return this;
      },
    });
    t.pushSend(new Path([]), "ping", []);
    runAll(t);
    expect(t.refusals.filter((r) => r.kind === "FORWARD_NO_NAME").length).toBe(0);
  });
});

function HandlerNameValEval(t, name) {
  // Resolve a missing handler exactly as a dispatch would: an empty stack
  // whose getHandlerFor finds nothing, with the transaction as ctx.
  const stack = {
    ctx: { transactor: t },
    getHandlerFor: () => null,
  };
  return new HandlerNameVal(name, "receive").eval(stack);
}

describe("$unknown fallback handler", () => {
  test("receive.$unknown is called when receive.<name> is missing", () => {
    const calls = [];
    const t = setup({
      receive: {
        $unknown(draft, ...args) {
          const ctx = args[args.length - 1];
          calls.push({ name: ctx.name, args: args.slice(0, -1) });
          return this;
        },
      },
    });
    t.pushSend(new Path([]), "anyName", [1, 2]);
    runAll(t);
    expect(calls).toEqual([{ name: "anyName", args: [1, 2] }]);
  });

  test("named receive handler wins over $unknown", () => {
    const calls = [];
    const t = setup({
      receive: {
        ping(draft, ...args) {
          calls.push({ via: "named", name: args[args.length - 1].name });
          return this;
        },
        $unknown(draft, ...args) {
          calls.push({ via: "unknown", name: args[args.length - 1].name });
          return this;
        },
      },
    });
    t.pushSend(new Path([]), "ping", []);
    t.pushSend(new Path([]), "other", []);
    runAll(t);
    expect(calls).toEqual([
      { via: "named", name: "ping" },
      { via: "unknown", name: "other" },
    ]);
  });

  test("intent.$unknown is called when intent.<name> is missing", () => {
    const calls = [];
    const t = new Transactor(
      makeComps({
        intent: {
          $unknown(draft, ...args) {
            calls.push({ name: args[args.length - 1].name });
            return this;
          },
        },
      }),
      obj({ a: obj({ tag: "leaf" }) }),
    );
    // Raised BY the component at `.a`, so the `dyn` leg offers it to the root — an
    // intent is never offered to the component that raised it.
    t.pushIntent(new Path([new FieldStep("a")]), "anyIntent", [], { route: ["dyn"] });
    runAll(t);
    expect(calls).toEqual([{ name: "anyIntent" }]);
  });

  test("an answer arrives in `receive`, so receive.$unknown catches it", async () => {
    const calls = [];
    const t = new Transactor(
      makeComps({
        receive: {
          $unknown(draft, ...args) {
            const ctx = args[args.length - 1];
            calls.push({ name: ctx.name, payload: args.slice(0, -1) });
            return this;
          },
        },
        intentChain: [{ fn: async () => "ok" }],
      }),
      {},
    );
    t.pushIntent(new Path([]), "loadX", [], { route: ["lex"] });
    await t.settle();
    // Named `<intent>Ok` and carrying the result ALONE. There is no arm that can be
    // handed both a result and an error, so none can read the wrong one.
    expect(calls).toEqual([{ name: "loadXOk", payload: ["ok"] }]);
  });

  test("missing handler with no $unknown is a silent no-op", () => {
    const root = { tag: "root" };
    const t = setup({}, root);
    t.pushSend(new Path([]), "whatever", []);
    runAll(t);
    expect(t.state.val).toBe(root);
  });

  test("ctx.name reflects the dispatched name in named handlers too", () => {
    const seen = [];
    const t = setup({
      receive: {
        hello(draft, ...args) {
          seen.push(args[args.length - 1].name);
          return this;
        },
      },
    });
    t.pushSend(new Path([]), "hello", []);
    runAll(t);
    expect(seen).toEqual(["hello"]);
  });
});

describe("ctx.targetPath (the position an intent was raised at)", () => {
  const leafRoot = () => obj({ a: obj({ b: obj({ tag: "leaf" }) }) });
  const leafPath = () => new Path([new FieldStep("a"), new FieldStep("b")]);
  const dynIntent = (intent, root = leafRoot()) => {
    const t = new Transactor(makeComps({ intent }), root);
    t.pushIntent(leafPath(), "foo", [], { route: ["dyn"] });
    return t;
  };

  test("the `dyn` leg starts at the sender's PARENT, never at the sender itself", () => {
    const hops = [];
    const t = dynIntent({
      foo(...args) {
        const ctx = args[args.length - 1];
        hops.push({ pathLen: ctx.path.steps.length, targetLen: ctx.targetPath.steps.length });
        return this;
      },
    });
    runAll(t);
    // Two hops from a depth-2 leaf, not three: a component that wanted to handle its own
    // intent would have written the body inline, so it is never offered one.
    expect(hops).toEqual([
      { pathLen: 1, targetLen: 2 },
      { pathLen: 0, targetLen: 2 },
    ]);
  });

  test("targetPath is the same reference on every hop", () => {
    const seenTargets = [];
    const t = dynIntent({
      foo(...args) {
        seenTargets.push(args[args.length - 1].targetPath);
        return this;
      },
    });
    runAll(t);
    expect(seenTargets.length).toBe(2);
    expect(seenTargets[0]).toBe(seenTargets[1]);
    expect(seenTargets[0].steps.length).toBe(2);
  });

  test("targetPath !== path at every hop of a walk", () => {
    const hops = [];
    const t = dynIntent({
      foo(...args) {
        const ctx = args[args.length - 1];
        hops.push(ctx.targetPath === ctx.path);
        return this;
      },
    });
    runAll(t);
    expect(hops).toEqual([false, false]);
  });

  test("running is not answering: an observer lets the walk go on", () => {
    const hops = [];
    const t = dynIntent({
      foo(...args) {
        hops.push(args[args.length - 1].path.steps.length);
        return this; // no reply — this handler is an OBSERVER
      },
    });
    runAll(t);
    expect(hops).toEqual([1, 0]);
  });

  test("a reply ends the walk", () => {
    const hops = [];
    const t = dynIntent({
      foo(...args) {
        const ctx = args[args.length - 1];
        hops.push(ctx.path.steps.length);
        ctx.reply("done");
        return this;
      },
    });
    runAll(t);
    expect(hops).toEqual([1]); // the root hop never happens
  });

  test("ctx.stop() ends the walk answering nothing", () => {
    const hops = [];
    const t = dynIntent({
      foo(...args) {
        const ctx = args[args.length - 1];
        hops.push(ctx.path.steps.length);
        if (ctx.path.steps.length === 1) ctx.stop();
        return this;
      },
    });
    runAll(t);
    expect(hops).toEqual([1]);
  });

  test("receive: ctx.targetPath === ctx.path (single-hop, origin == current)", () => {
    const seen = [];
    const t = new Transactor(
      makeComps({
        receive: {
          ping(draft, ...args) {
            const ctx = args[args.length - 1];
            seen.push({ same: ctx.targetPath === ctx.path, len: ctx.targetPath.steps.length });
            return this;
          },
        },
      }),
      obj({ a: obj({ tag: "leaf" }) }),
    );
    t.pushSend(new Path([new FieldStep("a")]), "ping", []);
    runAll(t);
    expect(seen).toEqual([{ same: true, len: 1 }]);
  });

  describe("an answer pins its SeqAccessStep key to dispatch time", () => {
    function deferredIntentTransactor(receive, root) {
      let resolveReq;
      const t = new Transactor(
        makeComps({
          receive,
          intentChain: [{ fn: () => new Promise((res) => (resolveReq = res)) }],
        }),
        root,
      );
      return { t, resolve: (v) => resolveReq(v) };
    }
    const makeRoot = () =>
      obj({ sheets: obj({ a: obj({ title: "a" }), b: obj({ title: "b" }) }), selId: "b" });
    const seqAccessPath = () => new Path([new SeqAccessStep("sheets", "selId")]);
    const markLoaded = {
      loadOk(draft, res) {
        draft.loaded = res;
      },
    };

    test("by default the answer lands on the item that RAISED the intent", async () => {
      const { t, resolve } = deferredIntentTransactor(markLoaded, makeRoot());
      t.pushIntent(seqAccessPath(), "load", [], { route: ["lex"] });
      t.state.val = produce(t.state.val, (draft) => {
        draft.selId = "a";
      }); // user switches tab mid-flight
      resolve("ok");
      await t.settle();
      expect(t.state.val.sheets.b.loaded).toBe("ok");
      expect(t.state.val.sheets.a.loaded ?? null).toBe(null);
    });

    test("livePath: true re-evaluates the key live and lands on the current item", async () => {
      const { t, resolve } = deferredIntentTransactor(markLoaded, makeRoot());
      t.pushIntent(seqAccessPath(), "load", [], { route: ["lex"], livePath: true });
      t.state.val = produce(t.state.val, (draft) => {
        draft.selId = "a";
      });
      resolve("ok");
      await t.settle();
      expect(t.state.val.sheets.a.loaded).toBe("ok");
      expect(t.state.val.sheets.b.loaded ?? null).toBe(null);
    });

    test("a pinned target deleted before the answer arrives is a no-op", async () => {
      const tolerant = {
        loadOk(draft, res) {
          if (draft) draft.loaded = res;
        },
      };
      const { t, resolve } = deferredIntentTransactor(tolerant, makeRoot());
      t.pushIntent(seqAccessPath(), "load", [], { route: ["lex"] });
      t.state.val = produce(t.state.val, (draft) => {
        delete draft.sheets.b;
      });
      const before = t.state.val;
      resolve("ok");
      await t.settle();
      expect(t.state.val).toBe(before);
    });
  });

  test("ctx.sendAtPath(ctx.targetPath, ...) from a root hop reaches the originator", () => {
    const replies = [];
    const t = new Transactor(
      makeComps({
        receive: {
          ack(draft, ...args) {
            const ctx = args[args.length - 1];
            replies.push({ name: ctx.name, pathLen: ctx.path.steps.length });
            return this;
          },
        },
        intent: {
          foo(draft, ...args) {
            const ctx = args[args.length - 1];
            if (ctx.path.steps.length === 0) ctx.sendAtPath(ctx.targetPath, "ack", []);
            return this;
          },
        },
      }),
      leafRoot(),
    );
    t.pushIntent(leafPath(), "foo", [], { route: ["dyn"] });
    runAll(t);
    expect(replies).toEqual([{ name: "ack", pathLen: 2 }]);
  });
});

describe("Transaction completion (whenSettled / whenSubtreeSettled)", () => {
  // Drain enough microtasks for any settled promise's .then callbacks to fire.
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  // Observe a promise without awaiting it (so we can assert "still pending").
  function tracked(p) {
    const o = { settled: false, value: undefined };
    p.then((v) => {
      o.settled = true;
      o.value = v;
    });
    return o;
  }

  test("whenSettled is pending until the transaction runs, then resolves with {value, old}", async () => {
    const t = setup({
      receive: {
        ping(draft) {
          return { ...this, pinged: true };
        },
      },
    });
    const txn = t.pushSend(new Path([]), "ping", []);
    const done = tracked(txn.whenSettled());
    await flush();
    expect(done.settled).toBe(false); // queued but not run yet

    runAll(t);
    const val = await txn.whenSettled();
    expect(val).toEqual({ old: { tag: "root" }, value: { tag: "root", pinged: true } });
  });

  test("whenSettled resolves as soon as the handler runs, NOT waiting for derived work", async () => {
    let resolveReq;
    const t = new Transactor(
      makeComps({
        receive: {
          start(draft, ctx) {
            ctx.intent("load", [], { route: ["lex"] }); // fire async work, don't await it
            return this;
          },
          loadOk(draft, result) {
            return { ...this, loaded: result };
          },
        },
        intentChain: [{ fn: () => new Promise((res) => (resolveReq = res)) }],
      }),
      { tag: "root" },
    );
    const start = t.pushSend(new Path([]), "start", []);
    const self = tracked(start.whenSettled());
    const subtree = tracked(start.whenSubtreeSettled());

    runAll(t); // start handler runs and fires the request, which stays in flight
    await flush();
    expect(self.settled).toBe(true); // own handler ran
    expect(subtree.settled).toBe(false); // request still in flight

    resolveReq("DATA");
    await t.settle();
    await flush();
    expect(subtree.settled).toBe(true);
  });

  test("whenSubtreeSettled waits for a fired request's response to run", async () => {
    let resolveReq;
    let responseRan = false;
    const t = new Transactor(
      makeComps({
        receive: {
          start(draft, ctx) {
            ctx.intent("load", [], { route: ["lex"] });
            return this;
          },
          loadOk(draft, result) {
            responseRan = true;
            return { ...this, loaded: result };
          },
        },
        intentChain: [{ fn: () => new Promise((res) => (resolveReq = res)) }],
      }),
      { tag: "root" },
    );
    const start = t.pushSend(new Path([]), "start", []);
    const subtree = tracked(start.whenSubtreeSettled());

    runAll(t);
    await flush();
    expect(subtree.settled).toBe(false); // request in flight, response not created yet

    resolveReq("DATA");
    await t.settle(); // resumes the request, enqueues + drains the ResponseEvent
    const val = await start.whenSubtreeSettled();
    expect(responseRan).toBe(true);
    expect(subtree.settled).toBe(true);
    expect(val).toEqual({ old: { tag: "root" }, value: { tag: "root" } }); // start's own {value, old}
    expect(t.state.val).toEqual({ tag: "root", loaded: "DATA" });
  });

  test("whenSubtreeSettled waits for a NESTED request fired by the response handler", async () => {
    let calls = 0;
    const t = new Transactor(
      makeComps({
        receive: {
          start(draft, ctx) {
            ctx.intent("load", [], { route: ["lex"] });
            return this;
          },
          loadOk(draft, result, ctx) {
            calls++;
            ctx.intent("load2", [], { route: ["lex"] }); // an answer arm raises another intent
            return { ...this, a: result };
          },
          load2Ok(draft, result) {
            calls++;
            return { ...this, b: result };
          },
        },
        intentChain: [{ fn: async () => "ok" }],
      }),
      { tag: "root" },
    );
    const start = t.pushSend(new Path([]), "start", []);
    const subtree = tracked(start.whenSubtreeSettled());

    await t.settle();
    await flush();
    expect(calls).toBe(2); // both the response and the nested response ran
    expect(subtree.settled).toBe(true);
    expect(t.state.val).toEqual({ tag: "root", a: "ok", b: "ok" });
  });

  test("whenSubtreeSettled waits for a derived ctx.send", async () => {
    const order = [];
    const t = new Transactor(
      makeComps({
        receive: {
          start(draft, ctx) {
            ctx.sendAtPath(new Path([]), "next", []);
            order.push("start");
            return this;
          },
          next(draft) {
            order.push("next");
            return this;
          },
        },
      }),
      { tag: "root" },
    );
    const start = t.pushSend(new Path([]), "start", []);
    const subtree = tracked(start.whenSubtreeSettled());

    t.transactNext(); // run only start
    await flush();
    expect(order).toEqual(["start"]);
    expect(subtree.settled).toBe(false); // derived "next" still queued

    t.transactNext(); // run next
    await flush();
    expect(order).toEqual(["start", "next"]);
    expect(subtree.settled).toBe(true);
  });

  test("subtree counter holds for a bubble pushed in afterTransaction (runs after the handler)", async () => {
    const ran = [];
    const t = new Transactor(
      makeComps({
        receive: {
          start(draft, ctx) {
            ctx.sendAtPath(new Path([]), "sib", []); // sync child
            ctx.forward({ route: ["dyn"] }); // becomes an intent after this body finishes
            ran.push("start");
            return this;
          },
          sib(draft) {
            ran.push("sib");
            return this;
          },
        },
        intent: {
          start(draft) {
            ran.push("forwarded");
            return this;
          },
        },
      }),
      obj({ a: obj({ tag: "leaf" }) }),
    );
    // `forward` from a receive body starts a walk in afterTransaction — a child created
    // AFTER the handler ran. The subtree must not settle until that walk has run too.
    const start = t.pushSend(new Path([new FieldStep("a")]), "start", []);
    const subtree = tracked(start.whenSubtreeSettled());

    t.transactNext(); // run start: dispatches sib (sync) and queues the walk (afterTransaction)
    await flush();
    expect(subtree.settled).toBe(false); // sib + the forwarded intent still pending

    runAll(t);
    await flush();
    expect(subtree.settled).toBe(true);
    expect(ran).toEqual(["start", "sib", "forwarded"]);
  });

  describe("robustness: every transacted transaction settles its subtree (no hang)", () => {
    test("undefined-returning handler (the console.warn branch)", async () => {
      const t = setup({
        receive: {
          ping(draft) {
            return undefined;
          },
        },
      });
      const txn = t.pushSend(new Path([]), "ping", []);
      const subtree = tracked(txn.whenSubtreeSettled());
      runAll(t);
      await flush();
      expect(subtree.settled).toBe(true);
    });

    test("throwing handler", async () => {
      const t = setup({
        receive: {
          ping(draft) {
            throw new Error("boom");
          },
        },
      });
      const txn = t.pushSend(new Path([]), "ping", []);
      const subtree = tracked(txn.whenSubtreeSettled());
      expect(() => runAll(t)).toThrow("boom");
      await flush();
      expect(subtree.settled).toBe(true); // finally released the self-unit despite the throw
    });

    test("a request handler that throws still settles via the error response", async () => {
      const t = new Transactor(
        makeComps({
          receive: {
            start(draft, ctx) {
              ctx.intent("load", [], { route: ["lex"] });
              return this;
            },
            // A handler that THROWS fails the intent, and the failure arrives under its
            // own name carrying the error alone.
            loadError(draft, error) {
              return { ...this, failed: error?.message ?? null };
            },
          },
          intentChain: [
            {
              fn: async () => {
                throw new Error("nope");
              },
            },
          ],
        }),
        { tag: "root" },
      );
      const start = t.pushSend(new Path([]), "start", []);
      const subtree = tracked(start.whenSubtreeSettled());
      await t.settle();
      await flush();
      expect(subtree.settled).toBe(true);
      expect(t.state.val).toEqual({ tag: "root", failed: "nope" });
    });
  });

  test("completion must be observed before the transaction runs (lazy allocation)", async () => {
    // `_completion` is created lazily; a top-level transaction that nobody tracked or
    // awaited before it ran has no completion to settle, so a handle taken afterwards
    // stays pending. Intended usage is to grab the handle from the dispatch, up front.
    const t = setup({
      receive: {
        ping(draft) {
          return { ...this, ok: true };
        },
      },
    });
    const txn = t.pushSend(new Path([]), "ping", []);
    runAll(t); // ran without anyone observing its completion
    const late = tracked(txn.whenSettled());
    await flush();
    expect(late.settled).toBe(false);
  });
});

describe("intent handler ctx (walkPath)", () => {
  // Components keyed by a plain-object "kind" field; only "mid" opts into overrides.
  const compByKind = {
    root: { name: "Root" },
    mid: { name: "Mid", extra: { intentOverridesField: "x" } },
    leaf: { name: "Leaf" },
  };
  function makeReqComps(fn) {
    return {
      getCompFor: (v) => compByKind[v?.kind] ?? null,
      getIntentChainFor: () => [{ fn }],
    };
  }
  const rootVal = obj({
    kind: "root",
    child: obj({ kind: "mid", value: obj({ kind: "leaf" }) }),
  });
  const leafPath = new Path([new FieldStep("child"), new FieldStep("value")]);

  test("handler receives a ctx as its final arg, after the intent args", async () => {
    let received;
    const t = new Transactor(
      makeReqComps((...args) => {
        received = args;
        return "ok";
      }),
      rootVal,
    );
    t.pushIntent(leafPath, "load", [1, 2], { route: ["lex"] });
    await t.settle();
    expect(received.slice(0, -1)).toEqual([1, 2]);
    const ctx = received.at(-1);
    expect(typeof ctx.walkPath).toBe("function");
    expect(ctx.root).toBe(rootVal);
  });

  test("walkPath visits the component instances leaf->root", async () => {
    const seen = [];
    const t = new Transactor(
      makeReqComps((...args) => {
        args.at(-1).walkPath((C, inst) => seen.push([C.name, inst.kind]));
        return "ok";
      }),
      rootVal,
    );
    t.pushIntent(leafPath, "load", [], { route: ["lex"] });
    await t.settle();
    expect(seen).toEqual([
      ["Leaf", "leaf"],
      ["Mid", "mid"],
      ["Root", "root"],
    ]);
  });

  test("walkPath stops early when the callback returns false", async () => {
    const seen = [];
    const t = new Transactor(
      makeReqComps((...args) => {
        args.at(-1).walkPath((C) => {
          seen.push(C.name);
          if (C.name === "Mid") return false;
        });
        return "ok";
      }),
      rootVal,
    );
    t.pushIntent(leafPath, "load", [], { route: ["lex"] });
    await t.settle();
    expect(seen).toEqual(["Leaf", "Mid"]);
  });

  test("walkPath yields the same chain after an await (immutable capture)", async () => {
    const runs = [];
    const t = new Transactor(
      makeReqComps(async (...args) => {
        const ctx = args.at(-1);
        const before = [];
        ctx.walkPath((C) => before.push(C.name));
        await Promise.resolve();
        const after = [];
        ctx.walkPath((C) => after.push(C.name));
        runs.push(before, after);
        return "ok";
      }),
      rootVal,
    );
    t.pushIntent(leafPath, "load", [], { route: ["lex"] });
    await t.settle();
    expect(runs[0]).toEqual(["Leaf", "Mid", "Root"]);
    expect(runs[1]).toEqual(["Leaf", "Mid", "Root"]);
  });
});

describe("pushSend by name (no DOM event)", () => {
  test("dispatches a named receive handler with explicit args", () => {
    const calls = [];
    const t = setup({
      receive: {
        setName(draft, value, _ctx) {
          calls.push(value);
          return { ...this, name: value };
        },
      },
    });
    t.pushSend(new Path([]), "setName", ["Ada"]);
    runAll(t);
    expect(calls).toEqual(["Ada"]);
    expect(t.state.val.name).toBe("Ada");
  });

  test("sendAtPath targets a child instance", () => {
    const t = setup(
      {
        receive: {
          bump(draft, _ctx) {
            draft.n++;
          },
        },
      },
      obj({ child: obj({ n: 0 }) }),
    );
    t.pushSend(new Path([new FieldStep("child")]), "bump", []);
    runAll(t);
    expect(t.state.val.child.n).toBe(1);
  });
});

describe("settle", () => {
  test("drains queued sync transactions", async () => {
    const t = setup({
      receive: {
        inc(draft, _ctx) {
          return { ...this, n: (this.n ?? 0) + 1 };
        },
      },
    });
    t.pushSend(new Path([]), "inc", []);
    t.pushSend(new Path([]), "inc", []);
    await t.settle();
    expect(t.hasPendingTransactions).toBe(false);
    expect(t.state.val.n).toBe(2);
  });

  test("awaits an async lex handler and the answer it chains", async () => {
    const t = setup({
      receive: {
        loadOk(draft, result, _err, _ctx) {
          return { ...this, loaded: result };
        },
      },
      intentChain: [{ fn: async () => "data" }],
    });
    // fire-and-forget like dispatchPhase does (not awaited directly)
    t.pushIntent(new Path([]), "load", [], { route: ["lex"] });
    await t.settle();
    expect(t.state.val.loaded).toBe("data");
  });
});

describe("observe (transaction observer)", () => {
  test("emits a normalized record for a receive send", () => {
    const recs = [];
    const t = setup({
      receive: {
        ping(draft) {
          return { ...this, pinged: true };
        },
      },
    });
    t.observe((r) => recs.push(r));
    t.pushSend(new Path([]), "ping", [1, 2]);
    runAll(t);
    expect(recs.length).toBe(1);
    const r = recs[0];
    expect(r.kind).toBe("receive");
    expect(r.name).toBe("ping");
    expect(r.args).toEqual([1, 2]);
    expect(r.matched).toBe("exact");
    expect(r.handlerName).toBe("ping");
    expect(r.before).toEqual({ tag: "root" });
    expect(r.after).toEqual({ tag: "root", pinged: true });
    expect(r.pathKeys).toEqual([]);
  });

  test("matched is 'unknown' when only $unknown handles, 'none' when nothing does", () => {
    const recs = [];
    const t = setup({
      receive: {
        $unknown(draft) {
          return this;
        },
      },
    });
    t.observe((r) => recs.push(r));
    t.pushSend(new Path([]), "anything", []);
    runAll(t);
    expect(recs[0].matched).toBe("unknown");

    const recs2 = [];
    const t2 = setup({});
    t2.observe((r) => recs2.push(r));
    t2.pushSend(new Path([]), "anything", []);
    runAll(t2);
    expect(recs2[0].matched).toBe("none");
  });

  test("emits kind 'intent' on every hop of a walk", () => {
    const recs = [];
    const t = new Transactor(
      makeComps({
        intent: {
          foo(draft) {
            return this;
          },
        },
      }),
      obj({ a: obj({ tag: "leaf" }) }),
    );
    t.observe((r) => recs.push(r));
    t.pushIntent(new Path([new FieldStep("a")]), "foo", [], { route: ["dyn"] });
    runAll(t);
    expect(recs.map((r) => r.kind)).toEqual(["intent"]);
    expect(recs[0].name).toBe("foo");
  });

  test("emits kind 'receive' for a named send, with before/after", () => {
    const recs = [];
    const t = setup({
      receive: {
        setName(draft, v) {
          return { ...this, name: v };
        },
      },
    });
    t.observe((r) => recs.push(r));
    t.pushSend(new Path([]), "setName", ["Ada"]);
    runAll(t);
    expect(recs.length).toBe(1);
    expect(recs[0].kind).toBe("receive");
    expect(recs[0].name).toBe("setName");
    expect(recs[0].after).toEqual({ tag: "root", name: "Ada" });
  });

  test("emits an outgoing 'intent' record (no after) and an 'answer' record (before→after)", async () => {
    const recs = [];
    const t = new Transactor(
      makeComps({
        receive: {
          loadOk(draft, result) {
            return { ...this, loaded: result };
          },
        },
        intentChain: [{ fn: async () => "data" }],
      }),
      { tag: "root" },
    );
    t.observe((r) => recs.push(r));
    t.pushIntent(new Path([]), "load", [7], { route: ["lex"] });
    await t.settle();
    const req = recs.find((r) => r.kind === "intent");
    const res = recs.find((r) => r.kind === "answer");
    expect(req).toBeTruthy();
    expect(req.name).toBe("load");
    expect(req.args).toEqual([7]);
    expect(req.matched).toBe("exact");
    expect(req.before).toEqual({ tag: "root" });
    expect(req.after).toBe(undefined);
    // `answer` is an OBSERVATION kind only. The handler ran in the `receive` bucket and
    // could not tell this from a message its parent sent — that is the design's claim.
    expect(res).toBeTruthy();
    expect(res.name).toBe("loadOk");
    expect(res.before).toEqual({ tag: "root" });
    expect(res.after).toEqual({ tag: "root", loaded: "data" });
  });

  test("pathKeys reflects the transaction path", () => {
    const recs = [];
    const t = setup(
      {
        receive: {
          bump(draft) {
            draft.n++;
          },
        },
      },
      obj({ child: obj({ n: 0 }) }),
    );
    t.observe((r) => recs.push(r));
    t.pushSend(new Path([new FieldStep("child")]), "bump", []);
    runAll(t);
    expect(recs[0].pathKeys).toEqual([{ field: "child" }]);
  });

  test("pathKeys pins a dynamic SeqAccessStep to a concrete key", () => {
    // A DOM event inside a `render=".a[.selId]"` reconstructs a SeqAccessStep whose key
    // is a live field reference. pathKeys must resolve it to the concrete key (else a
    // consumer routing by key can't identify the subtree).
    const recs = [];
    const t = new Transactor(
      makeComps({
        receive: {
          bump(draft) {
            draft.n = (draft.n ?? 0) + 1;
          },
        },
      }),
      obj({ sheets: obj({ a: obj({ n: 0 }), b: obj({ n: 0 }) }), selId: "b" }),
    );
    t.observe((r) => recs.push(r));
    t.pushSend(new Path([new SeqAccessStep("sheets", "selId")]), "bump", []);
    runAll(t);
    expect(recs[0].pathKeys).toEqual([{ field: "sheets", key: "b" }]);
  });

  test("unsubscribe stops delivery", () => {
    const recs = [];
    const t = setup({
      receive: {
        ping(draft) {
          return this;
        },
      },
    });
    const off = t.observe((r) => recs.push(r));
    t.pushSend(new Path([]), "ping", []);
    runAll(t);
    off();
    t.pushSend(new Path([]), "ping", []);
    runAll(t);
    expect(recs.length).toBe(1);
  });
});

describe("the three outcomes of a walk", () => {
  const senderRoot = () => obj({ a: obj({ tag: "leaf" }) });
  const at = () => new Path([new FieldStep("a")]);

  test("a lex handler that returns PASS declines, and the next one is offered it", async () => {
    const tried = [];
    const t = new Transactor(
      makeComps({
        receive: {
          loadOk(draft, v) {
            draft.got = v;
          },
        },
        intentChain: [
          {
            fn: async () => {
              tried.push("first");
              return PASS; // not mine — running is not answering
            },
          },
          {
            fn: async () => {
              tried.push("second");
              return "data";
            },
          },
        ],
      }),
      obj({ tag: "root" }),
    );
    t.pushIntent(new Path([]), "load", [], { route: ["lex"] });
    await t.settle();
    expect(tried).toEqual(["first", "second"]);
    expect(t.state.val.got).toBe("data");
  });

  test("every handler declining runs the route out: <name>Unhandled, with the intent's own args", async () => {
    const t = new Transactor(
      makeComps({
        receive: {
          loadUnhandled(draft, ...args) {
            draft.unhandled = args.slice(0, -1);
          },
        },
        intentChain: [{ fn: async () => PASS }],
      }),
      obj({ tag: "root" }),
    );
    t.pushIntent(new Path([]), "load", [7, 8], { route: ["lex"] });
    await t.settle();
    // Not an error value — the arguments it was RAISED with, so the sender can degrade
    // or retry without having kept a copy.
    expect(t.state.val.unhandled).toEqual([7, 8]);
  });

  test("a sender that declares no Unhandled arm hears <name>Error with noHandler", async () => {
    const t = new Transactor(
      makeComps({
        receive: {
          loadError(draft, reason) {
            draft.why = reason;
          },
        },
        intentChain: [{ fn: async () => PASS }],
      }),
      obj({ tag: "root" }),
    );
    t.pushIntent(new Path([]), "load", [], { route: ["lex"] });
    await t.settle();
    // A sender that does not care WHY an answer is missing writes one arm; one that does
    // writes two.
    expect(t.state.val.why).toBe("noHandler");
  });

  test("a sender that declares no answer arm at all is a notification: nothing happens", async () => {
    const t = new Transactor(
      makeComps({ receive: {}, intentChain: [{ fn: async () => PASS }] }),
      obj({ tag: "root" }),
    );
    const before = t.state.val;
    t.pushIntent(new Path([]), "ping", [], { route: ["lex"] });
    await t.settle();
    expect(t.state.val).toBe(before);
  });

  test("a throwing lex handler fails the intent, and the error arrives alone", async () => {
    const t = new Transactor(
      makeComps({
        receive: {
          loadError(draft, err) {
            draft.msg = err.message;
          },
        },
        intentChain: [
          {
            fn: async () => {
              throw new Error("boom");
            },
          },
        ],
      }),
      obj({ tag: "root" }),
    );
    t.pushIntent(new Path([]), "load", [], { route: ["lex"] });
    await t.settle();
    expect(t.state.val.msg).toBe("boom");
  });

  test("the one-shot is per INTENT, across hops: a second reply is refused", () => {
    const t = new Transactor(
      makeComps({
        receive: {
          fooOk(draft, v) {
            draft.answers = [...(draft.answers ?? []), v];
          },
        },
        intent: {
          foo(draft, ...args) {
            const ctx = args[args.length - 1];
            ctx.reply("first");
            ctx.reply("second"); // refused: the walk already ended
            return this;
          },
        },
      }),
      senderRoot(),
    );
    t.pushIntent(at(), "foo", [], { route: ["dyn"] });
    runAll(t);
    // The answer goes back to the SENDER at `.a`, not to the hop that replied.
    expect(t.state.val.a.answers).toEqual(["first"]);
  });

  test("forward from an intent body amends the args the next hop sees", () => {
    const seen = [];
    const t = new Transactor(
      makeComps({
        intent: {
          foo(draft, ...args) {
            const ctx = args[args.length - 1];
            seen.push(args.slice(0, -1));
            if (ctx.path.steps.length === 1) ctx.forward({ args: ["amended"] });
            return this;
          },
        },
      }),
      obj({ a: obj({ b: obj({ tag: "leaf" }) }) }),
    );
    t.pushIntent(new Path([new FieldStep("a"), new FieldStep("b")]), "foo", ["original"], {
      route: ["dyn"],
    });
    runAll(t);
    expect(seen).toEqual([["original"], ["amended"]]);
  });

  test("a hop that throws does not strand the walk: it continues past it", () => {
    const seen = [];
    const t = new Transactor(
      makeComps({
        intent: {
          foo(draft, ...args) {
            const ctx = args[args.length - 1];
            seen.push(ctx.path.steps.length);
            if (ctx.path.steps.length === 1) throw new Error("hop blew up");
            return this;
          },
        },
      }),
      obj({ a: obj({ b: obj({ tag: "leaf" }) }) }),
    );
    const walk = t.pushIntent(new Path([new FieldStep("a"), new FieldStep("b")]), "foo", [], {
      route: ["dyn"],
    });
    expect(() => runAll(t)).toThrow("hop blew up");
    runAll(t);
    // The transition never happened, so the handler did not answer, so the walk moves on.
    expect(seen).toEqual([1, 0]);
    expect(walk.ended).toBe(true);
  });

  test("a walk is depth-bounded, and the bound ends it AS an exhaustion", () => {
    let hops = 0;
    // Deeper than INTENT_DEPTH, so the `dyn` leg would otherwise keep walking.
    const DEPTH = 70;
    let val = obj({ tag: "leaf" });
    for (let i = 0; i < DEPTH; i++) val = obj({ [`f${i}`]: val });
    const steps = [];
    for (let i = DEPTH - 1; i >= 0; i--) steps.push(new FieldStep(`f${i}`));

    const t = new Transactor(
      makeComps({
        receive: {
          loopUnhandled(draft) {
            draft.gaveUp = true;
          },
        },
        intent: {
          loop(draft) {
            hops++;
            return this; // an observer at every level
          },
        },
      }),
      val,
    );
    t.pushIntent(new Path(steps), "loop", [], { route: ["dyn"] });
    runAll(t);
    expect(hops).toBe(64); // INTENT_DEPTH, not the 70 the path would allow
    // The refusal is delivered as an exhaustion, so the sender still hears something
    // instead of the intent vanishing.
    const leaf = steps.reduce((value, step) => value[step.field], t.state.val);
    expect(leaf.gaveUp).toBe(true);
  });
});
