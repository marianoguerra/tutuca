import { describe, expect, test } from "bun:test";
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

describe("Transaction.getCompletionPromise (async completion)", () => {
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

  test("is pending until the transaction is transacted, then resolves with {value, old}", async () => {
    const t = setup({
      receive: {
        ping() {
          return { ...this, pinged: true };
        },
      },
    });
    t.pushSend(new Path([]), "ping", []);
    const txn = t.transactions[0];
    const done = tracked(txn.getCompletionPromise());
    await flush();
    expect(done.settled).toBe(false); // queued but not run yet

    runAll(t);
    const task = await txn.getCompletionPromise();
    expect(task.val).toEqual({ old: { tag: "root" }, value: { tag: "root", pinged: true } });
  });

  test("a completion promise first requested AFTER the transaction ran never resolves", async () => {
    // updateRootValue completes the task with `this._task?.complete?.()`: if no task
    // existed at run time, completion is silently skipped and a later .task is dead.
    const t = setup({
      receive: {
        ping() {
          return { ...this, ok: true };
        },
      },
    });
    t.pushSend(new Path([]), "ping", []);
    const txn = t.transactions[0];
    runAll(t); // runs before anyone touches .task
    const done = tracked(txn.getCompletionPromise());
    await flush();
    expect(done.settled).toBe(false);
  });

  test("setParent gates a parent's completion on an explicitly-wired child", async () => {
    const t = setup({
      receive: {
        ping() {
          return this;
        },
      },
    });
    t.pushSend(new Path([]), "ping", []);
    t.pushSend(new Path([]), "ping", []);
    const [parent, child] = t.transactions;
    child.setParent(parent);
    const parentDone = tracked(parent.getCompletionPromise());

    t.transactNext(); // run only the parent
    await flush();
    expect(parentDone.settled).toBe(false); // still blocked on the child dep

    t.transactNext(); // run the child
    await flush();
    expect(parentDone.settled).toBe(true);
  });

  test("the dependency gate holds across a real awaited boundary", async () => {
    // Proves the Task graph is genuinely async: the parent stays pending across awaits
    // until the child completes, not merely within one synchronous drain.
    const t = setup({
      receive: {
        ping() {
          return this;
        },
      },
    });
    t.pushSend(new Path([]), "ping", []);
    t.pushSend(new Path([]), "ping", []);
    const [parent, child] = t.transactions;
    child.setParent(parent);
    const parentDone = tracked(parent.getCompletionPromise());

    t.transactNext();
    await flush();
    await flush();
    expect(parentDone.settled).toBe(false);

    t.transactNext();
    await flush();
    expect(parentDone.settled).toBe(true);
  });

  // The actual question: completion does NOT automatically span a request/response.
  test("the transaction that fires a request completes immediately, NOT when the response runs", async () => {
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
          load(result, _error) {
            responseRan = true;
            return { ...this, loaded: result };
          },
        },
        request: { fn: () => new Promise((res) => (resolveReq = res)) },
      }),
      { tag: "root" },
    );
    t.pushSend(new Path([]), "start", []);
    const startTxn = t.transactions[0];
    const startDone = tracked(startTxn.getCompletionPromise());

    runAll(t); // runs start -> ctx.request -> request fn suspended on the unresolved promise
    await flush();
    // start already completed while the request is still in flight and before any response:
    expect(startDone.settled).toBe(true);
    expect(responseRan).toBe(false);
    expect(t.hasPendingTransactions).toBe(false); // no response queued yet

    resolveReq("DATA");
    await flush(); // pushRequest resumes and enqueues the ResponseEvent
    expect(t.hasPendingTransactions).toBe(true);
    runAll(t);
    expect(responseRan).toBe(true);
    expect(t.state.val).toEqual({ tag: "root", loaded: "DATA" });
    // start's task never gained the response as a dependency:
    expect(startTxn.task.deps).toEqual([]);
  });

  test("the ResponseEvent has its own completion promise, settling only once it is transacted", async () => {
    let resolveReq;
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
            return { ...this, loaded: result };
          },
        },
        request: { fn: () => new Promise((res) => (resolveReq = res)) },
      }),
      { tag: "root" },
    );
    const pushed = [];
    t.onTransactionPushed = (txn) => pushed.push(txn);

    t.pushSend(new Path([]), "start", []);
    runAll(t); // fire the request
    resolveReq("DATA");
    await flush(); // ResponseEvent now enqueued (and captured in `pushed`)

    const responseTxn = pushed.at(-1);
    const responseDone = tracked(responseTxn.getCompletionPromise());
    await flush();
    expect(responseDone.settled).toBe(false); // queued, not yet transacted

    runAll(t);
    const task = await responseTxn.getCompletionPromise();
    expect(task.val.value).toEqual({ tag: "root", loaded: "DATA" });
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
