import { describe, expect, test } from "bun:test";
import { IMap } from "../index.js";
import { FieldStep, Path, SeqAccessStep } from "../src/path.js";
import { Transactor } from "../src/transactor.js";

function makeComps({ receive = {}, bubble = {}, response = {}, request = null } = {}) {
  const compMeta = { receive, bubble, response };
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
    const markLoaded = { load(res) { return this.set("loaded", res); } };

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
      const tolerant = { load(res) { return this?.set ? this.set("loaded", res) : this; } };
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
