import { describe, expect, test } from "vitest";
import { IMap } from "../index.js";
import { FieldStep, Path, SeqAccessStep } from "../src/path.js";
import { Transactor } from "../src/transactor.js";

function makeComps({ receive = {}, bubble = {}, response = {}, input = {}, request = null } = {}) {
  const compMeta = { receive, bubble, response, input };
  return {
    getCompFor: () => compMeta,
    getRequestFor: (_inst, _name) => request,
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
  t.pushBubble(new Path([]), "blurb", []);
  expect(t.hasPendingTransactions).toBe(true);
});

describe("$unknown fallback handler", () => {
  test("receive.$unknown is called when receive.<name> is missing", () => {
    const calls = [];
    const t = setup({
      receive: {
        $unknown(...args) {
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
        ping(...args) {
          calls.push({ via: "named", name: args[args.length - 1].name });
          return this;
        },
        $unknown(...args) {
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

  test("bubble.$unknown is called when bubble.<name> is missing", () => {
    const calls = [];
    const t = setup({
      bubble: {
        $unknown(...args) {
          calls.push({ name: args[args.length - 1].name });
          return this;
        },
      },
    });
    t.pushBubble(new Path([]), "anyBubble", []);
    runAll(t);
    expect(calls).toEqual([{ name: "anyBubble" }]);
  });

  test("response.$unknown is called when response.<name> is missing", async () => {
    const calls = [];
    const t = new Transactor(
      makeComps({
        response: {
          $unknown(...args) {
            const ctx = args[args.length - 1];
            calls.push({ name: ctx.name, payload: args.slice(0, -1) });
            return this;
          },
        },
        request: { fn: async () => "ok" },
      }),
      {},
    );
    await t.pushRequest(new Path([]), "loadX", []);
    runAll(t);
    expect(calls).toEqual([{ name: "loadX", payload: ["ok", null] }]);
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
        hello(...args) {
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

describe("ctx.targetPath (DOM-style origin reference)", () => {
  test("bubble: targetPath is the originating leaf path on every hop while path shrinks", () => {
    const hops = [];
    const t = new Transactor(
      makeComps({
        bubble: {
          foo(...args) {
            const ctx = args[args.length - 1];
            hops.push({ pathLen: ctx.path.steps.length, targetLen: ctx.targetPath.steps.length });
            return this;
          },
        },
      }),
      IMap({ a: IMap({ b: IMap({ tag: "leaf" }) }) }),
    );
    const leafPath = new Path([new FieldStep("a"), new FieldStep("b")]);
    t.pushBubble(leafPath, "foo", [], { bubbles: true });
    runAll(t);
    expect(hops).toEqual([
      { pathLen: 2, targetLen: 2 },
      { pathLen: 1, targetLen: 2 },
      { pathLen: 0, targetLen: 2 },
    ]);
  });

  test("bubble: targetPath reference is identical (immutable) across hops", () => {
    const seenTargets = [];
    const t = new Transactor(
      makeComps({
        bubble: {
          foo(...args) {
            seenTargets.push(args[args.length - 1].targetPath);
            return this;
          },
        },
      }),
      IMap({ a: IMap({ b: IMap({ tag: "leaf" }) }) }),
    );
    const leafPath = new Path([new FieldStep("a"), new FieldStep("b")]);
    t.pushBubble(leafPath, "foo", [], { bubbles: true });
    runAll(t);
    expect(seenTargets.length).toBe(3);
    expect(seenTargets[0]).toBe(seenTargets[1]);
    expect(seenTargets[1]).toBe(seenTargets[2]);
    expect(seenTargets[0]).toBe(leafPath);
  });

  test("bubble: ctx.targetPath !== ctx.path at mid and root, equal at leaf", () => {
    const hops = [];
    const t = new Transactor(
      makeComps({
        bubble: {
          foo(...args) {
            const ctx = args[args.length - 1];
            hops.push(ctx.targetPath === ctx.path);
            return this;
          },
        },
      }),
      IMap({ a: IMap({ b: IMap({ tag: "leaf" }) }) }),
    );
    t.pushBubble(new Path([new FieldStep("a"), new FieldStep("b")]), "foo", [], { bubbles: true });
    runAll(t);
    expect(hops).toEqual([true, false, false]);
  });

  test("stopPropagation halts further hops but doesn't change observed targetPath", () => {
    const hops = [];
    const t = new Transactor(
      makeComps({
        bubble: {
          foo(...args) {
            const ctx = args[args.length - 1];
            hops.push({ pathLen: ctx.path.steps.length, targetLen: ctx.targetPath.steps.length });
            if (ctx.path.steps.length === 1) ctx.stopPropagation();
            return this;
          },
        },
      }),
      IMap({ a: IMap({ b: IMap({ tag: "leaf" }) }) }),
    );
    t.pushBubble(new Path([new FieldStep("a"), new FieldStep("b")]), "foo", [], { bubbles: true });
    runAll(t);
    expect(hops).toEqual([
      { pathLen: 2, targetLen: 2 },
      { pathLen: 1, targetLen: 2 },
    ]);
  });

  test("receive: ctx.targetPath === ctx.path (single-hop, origin == current)", () => {
    const seen = [];
    const t = new Transactor(
      makeComps({
        receive: {
          ping(...args) {
            const ctx = args[args.length - 1];
            seen.push({ same: ctx.targetPath === ctx.path, len: ctx.targetPath.steps.length });
            return this;
          },
        },
      }),
      IMap({ a: IMap({ tag: "leaf" }) }),
    );
    t.pushSend(new Path([new FieldStep("a")]), "ping", []);
    runAll(t);
    expect(seen).toEqual([{ same: true, len: 1 }]);
  });

  test("response: ctx.targetPath === ctx.path", async () => {
    const seen = [];
    const t = new Transactor(
      makeComps({
        response: {
          loadX(...args) {
            const ctx = args[args.length - 1];
            seen.push({ same: ctx.targetPath === ctx.path });
            return this;
          },
        },
        request: { fn: async () => "ok" },
      }),
      IMap({ a: IMap({ tag: "leaf" }) }),
    );
    await t.pushRequest(new Path([new FieldStep("a")]), "loadX", []);
    runAll(t);
    expect(seen).toEqual([{ same: true }]);
  });

  describe("a SeqAccessStep response pins its key to request time", () => {
    function deferredRequestTransactor(response, root) {
      let resolveReq;
      const t = new Transactor(
        makeComps({ response, request: { fn: () => new Promise((res) => (resolveReq = res)) } }),
        root,
      );
      return { t, resolve: (v) => resolveReq(v) };
    }
    const makeRoot = () =>
      IMap({ sheets: IMap({ a: IMap({ title: "a" }), b: IMap({ title: "b" }) }), selId: "b" });
    const seqAccessPath = () => new Path([new SeqAccessStep("sheets", "selId")]);
    const markLoaded = {
      load(res) {
        return this.set("loaded", res);
      },
    };

    test("by default the response lands on the request-time item, not the current one", async () => {
      const { t, resolve } = deferredRequestTransactor(markLoaded, makeRoot());
      const done = t.pushRequest(seqAccessPath(), "load", []);
      t.state.val = t.state.val.set("selId", "a"); // user switches tab mid-flight
      resolve("ok");
      await done;
      runAll(t);
      expect(t.state.val.getIn(["sheets", "b", "loaded"])).toBe("ok");
      expect(t.state.val.getIn(["sheets", "a"]).get("loaded", null)).toBe(null);
    });

    test("livePath: true re-evaluates the key live and lands on the current item", async () => {
      const { t, resolve } = deferredRequestTransactor(markLoaded, makeRoot());
      const done = t.pushRequest(seqAccessPath(), "load", [], { livePath: true });
      t.state.val = t.state.val.set("selId", "a");
      resolve("ok");
      await done;
      runAll(t);
      expect(t.state.val.getIn(["sheets", "a", "loaded"])).toBe("ok");
      expect(t.state.val.getIn(["sheets", "b"]).get("loaded", null)).toBe(null);
    });

    test("a pinned target deleted before the response arrives is a no-op", async () => {
      const tolerant = {
        load(res) {
          return this?.set ? this.set("loaded", res) : this;
        },
      };
      const { t, resolve } = deferredRequestTransactor(tolerant, makeRoot());
      const done = t.pushRequest(seqAccessPath(), "load", []);
      t.state.val = t.state.val.set("sheets", t.state.val.get("sheets").delete("b"));
      const before = t.state.val;
      resolve("ok");
      await done;
      runAll(t);
      expect(t.state.val).toBe(before);
    });
  });

  test("ctx.sendAtPath(ctx.targetPath, ...) from a root bubble handler dispatches back to the originator", () => {
    const replies = [];
    const t = new Transactor(
      makeComps({
        receive: {
          ack(...args) {
            const ctx = args[args.length - 1];
            replies.push({ name: ctx.name, pathLen: ctx.path.steps.length });
            return this;
          },
        },
        bubble: {
          foo(...args) {
            const ctx = args[args.length - 1];
            if (ctx.path.steps.length === 0) {
              ctx.sendAtPath(ctx.targetPath, "ack", []);
            }
            return this;
          },
        },
      }),
      IMap({ a: IMap({ b: IMap({ tag: "leaf" }) }) }),
    );
    t.pushBubble(new Path([new FieldStep("a"), new FieldStep("b")]), "foo", [], { bubbles: true });
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
        ping() {
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
          start(ctx) {
            ctx.request("load", []); // fire async work, don't await it
            return this;
          },
        },
        response: {
          load(result) {
            return { ...this, loaded: result };
          },
        },
        request: { fn: () => new Promise((res) => (resolveReq = res)) },
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
          start(ctx) {
            ctx.request("load", []);
            return this;
          },
        },
        response: {
          load(result) {
            responseRan = true;
            return { ...this, loaded: result };
          },
        },
        request: { fn: () => new Promise((res) => (resolveReq = res)) },
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
          start(ctx) {
            ctx.request("load", []);
            return this;
          },
        },
        response: {
          load(result, _error, ctx) {
            calls++;
            ctx.request("load2", []); // response dispatches another request
            return { ...this, a: result };
          },
          load2(result) {
            calls++;
            return { ...this, b: result };
          },
        },
        request: { fn: async () => "ok" },
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
          start(ctx) {
            ctx.sendAtPath(new Path([]), "next", []);
            order.push("start");
            return this;
          },
          next() {
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
          start(ctx) {
            ctx.sendAtPath(new Path([]), "sib", []); // sync child
            ran.push("start");
            return this;
          },
          sib() {
            ran.push("sib");
            return this;
          },
        },
        bubble: {
          start() {
            ran.push("bubble");
            return this;
          },
        },
      }),
      IMap({ a: IMap({ tag: "leaf" }) }),
    );
    // bubbles:true at a non-root path -> afterTransaction pushes a bubble (a child created
    // AFTER the handler ran); the subtree must not settle until it too has run.
    const start = t.pushSend(new Path([new FieldStep("a")]), "start", [], { bubbles: true });
    const subtree = tracked(start.whenSubtreeSettled());

    t.transactNext(); // run start: dispatches sib (sync) and queues the bubble (afterTransaction)
    await flush();
    expect(subtree.settled).toBe(false); // sib + bubble still pending

    runAll(t);
    await flush();
    expect(subtree.settled).toBe(true);
    expect(ran).toEqual(["start", "sib", "bubble"]);
  });

  describe("robustness: every transacted transaction settles its subtree (no hang)", () => {
    test("skipSelf send", async () => {
      const t = setup({
        receive: {
          ping() {
            return this;
          },
        },
      });
      const txn = t.pushSend(new Path([]), "ping", [], { skipSelf: true });
      const subtree = tracked(txn.whenSubtreeSettled());
      runAll(t);
      await flush();
      expect(subtree.settled).toBe(true);
    });

    test("undefined-returning handler (the console.warn branch)", async () => {
      const t = setup({
        receive: {
          ping() {
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
          ping() {
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
            start(ctx) {
              ctx.request("load", []);
              return this;
            },
          },
          response: {
            load(_result, error) {
              return { ...this, failed: error?.message ?? null };
            },
          },
          request: {
            fn: async () => {
              throw new Error("nope");
            },
          },
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
        ping() {
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

describe("request ctx (walkPath)", () => {
  // Components keyed by an IMap "kind" field; only "mid" opts into overrides via extra.
  const compByKind = {
    root: { name: "Root" },
    mid: { name: "Mid", extra: { requestOverridesField: "x" } },
    leaf: { name: "Leaf" },
  };
  function makeReqComps(fn) {
    return {
      getCompFor: (v) => (v?.get ? (compByKind[v.get("kind", null)] ?? null) : null),
      getRequestFor: () => ({ fn }),
    };
  }
  const rootVal = IMap({
    kind: "root",
    child: IMap({ kind: "mid", value: IMap({ kind: "leaf" }) }),
  });
  const leafPath = new Path([new FieldStep("child"), new FieldStep("value")]);

  test("handler receives a ctx as its final arg, after the request args", async () => {
    let received;
    const t = new Transactor(
      makeReqComps((...args) => {
        received = args;
        return "ok";
      }),
      rootVal,
    );
    await t.pushRequest(leafPath, "load", [1, 2]);
    expect(received.slice(0, -1)).toEqual([1, 2]);
    const ctx = received.at(-1);
    expect(typeof ctx.walkPath).toBe("function");
    expect(ctx.root).toBe(rootVal);
  });

  test("walkPath visits the component instances leaf->root", async () => {
    const seen = [];
    const t = new Transactor(
      makeReqComps((...args) => {
        args.at(-1).walkPath((C, inst) => seen.push([C.name, inst.get("kind", null)]));
        return "ok";
      }),
      rootVal,
    );
    await t.pushRequest(leafPath, "load", []);
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
    await t.pushRequest(leafPath, "load", []);
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
    await t.pushRequest(leafPath, "load", []);
    expect(runs[0]).toEqual(["Leaf", "Mid", "Root"]);
    expect(runs[1]).toEqual(["Leaf", "Mid", "Root"]);
  });
});

describe("pushInput", () => {
  test("dispatches a named input handler with explicit args (no DOM event)", () => {
    const calls = [];
    const t = setup({
      input: {
        setName(value, _ctx) {
          calls.push(value);
          return { ...this, name: value };
        },
      },
    });
    t.pushInput(new Path([]), "setName", ["Ada"]);
    runAll(t);
    expect(calls).toEqual(["Ada"]);
    expect(t.state.val.name).toBe("Ada");
  });

  test("inputAtPath targets a child instance", () => {
    const t = setup(
      {
        input: {
          bump(_ctx) {
            return this.set("n", this.get("n") + 1);
          },
        },
      },
      IMap({ child: IMap({ n: 0 }) }),
    );
    t.pushInput(new Path([new FieldStep("child")]), "bump", []);
    runAll(t);
    expect(t.state.val.get("child").get("n")).toBe(1);
  });
});

describe("settle", () => {
  test("drains queued sync transactions", async () => {
    const t = setup({
      receive: {
        inc(_ctx) {
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

  test("awaits async requests and the chained response work", async () => {
    const t = setup({
      response: {
        load(result, _err, _ctx) {
          return { ...this, loaded: result };
        },
      },
      request: { fn: async () => "data" },
    });
    // fire-and-forget like dispatchPhase does (not awaited directly)
    t.pushRequest(new Path([]), "load", []);
    await t.settle();
    expect(t.state.val.loaded).toBe("data");
  });
});

describe("observe (transaction observer)", () => {
  test("emits a normalized record for a receive send", () => {
    const recs = [];
    const t = setup({
      receive: {
        ping() {
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
        $unknown() {
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

  test("emits kind 'bubble' on every hop", () => {
    const recs = [];
    const t = new Transactor(
      makeComps({
        bubble: {
          foo() {
            return this;
          },
        },
      }),
      IMap({ a: IMap({ tag: "leaf" }) }),
    );
    t.observe((r) => recs.push(r));
    t.pushBubble(new Path([new FieldStep("a")]), "foo", [], { bubbles: true });
    runAll(t);
    expect(recs.map((r) => r.kind)).toEqual(["bubble", "bubble"]);
    expect(recs[0].name).toBe("foo");
  });

  test("emits kind 'input' for pushInput, with before/after", () => {
    const recs = [];
    const t = setup({
      input: {
        setName(v) {
          return { ...this, name: v };
        },
      },
    });
    t.observe((r) => recs.push(r));
    t.pushInput(new Path([]), "setName", ["Ada"]);
    runAll(t);
    expect(recs.length).toBe(1);
    expect(recs[0].kind).toBe("input");
    expect(recs[0].name).toBe("setName");
    expect(recs[0].after).toEqual({ tag: "root", name: "Ada" });
  });

  test("emits an outgoing 'request' record (no after) and a 'response' record (before→after)", async () => {
    const recs = [];
    const t = new Transactor(
      makeComps({
        response: {
          load(result) {
            return { ...this, loaded: result };
          },
        },
        request: { fn: async () => "data" },
      }),
      { tag: "root" },
    );
    t.observe((r) => recs.push(r));
    t.pushRequest(new Path([]), "load", [7]);
    await t.settle();
    const req = recs.find((r) => r.kind === "request");
    const res = recs.find((r) => r.kind === "response");
    expect(req).toBeTruthy();
    expect(req.name).toBe("load");
    expect(req.args).toEqual([7]);
    expect(req.matched).toBe("exact");
    expect(req.before).toEqual({ tag: "root" });
    expect(req.after).toBe(undefined);
    expect(res).toBeTruthy();
    expect(res.before).toEqual({ tag: "root" });
    expect(res.after).toEqual({ tag: "root", loaded: "data" });
  });

  test("pathKeys reflects the transaction path", () => {
    const recs = [];
    const t = setup(
      {
        receive: {
          bump() {
            return this.set("n", this.get("n") + 1);
          },
        },
      },
      IMap({ child: IMap({ n: 0 }) }),
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
          bump() {
            return this.set("n", (this.get("n") ?? 0) + 1);
          },
        },
      }),
      IMap({ sheets: IMap({ a: IMap({ n: 0 }), b: IMap({ n: 0 }) }), selId: "b" }),
    );
    t.observe((r) => recs.push(r));
    t.pushSend(new Path([new SeqAccessStep("sheets", "selId")]), "bump", []);
    runAll(t);
    expect(recs[0].pathKeys).toEqual([{ field: "sheets", key: "b" }]);
  });

  test("a skipSelf send (no handler ran) is not emitted", () => {
    const recs = [];
    const t = setup({
      receive: {
        ping() {
          return this;
        },
      },
    });
    t.observe((r) => recs.push(r));
    t.pushSend(new Path([]), "ping", [], { skipSelf: true });
    runAll(t);
    expect(recs).toEqual([]);
  });

  test("unsubscribe stops delivery", () => {
    const recs = [];
    const t = setup({
      receive: {
        ping() {
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
