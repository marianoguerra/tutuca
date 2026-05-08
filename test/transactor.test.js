import { describe, expect, test } from "bun:test";
import { Path } from "../src/path.js";
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
