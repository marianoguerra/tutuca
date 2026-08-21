import { describe, expect, test } from "vitest";
import { dispatchPhase, phaseOps, resolveArgs } from "../src/on.js";

// Records every dispatch primitive call so we can assert what dispatchPhase emits.
function fakeDispatcher() {
  const calls = [];
  const rec = (method) => (path, name, args, opts) =>
    calls.push({ method, path, name, args, opts });
  return {
    calls,
    sendAtPath: rec("sendAtPath"),
    intentAtPath: rec("intentAtPath"),
  };
}

describe("phaseOps", () => {
  test("expands shorthand buckets in fixed kind order, then do", () => {
    const ops = phaseOps({
      // Declared out of order on purpose: the shorthand buckets come out in OP_KINDS
      // order, and the explicit `do` sequence follows.
      intent: [{ name: "r", opts: { route: ["lex"] } }],
      send: [{ name: "s" }],
      do: [{ type: "intent", name: "d", opts: { route: ["dyn"] } }],
    });
    expect(ops.map((o) => [o.type, o.name])).toEqual([
      ["send", "s"],
      ["intent", "r"],
      ["intent", "d"],
    ]);
  });

  test("empty phase yields no ops", () => {
    expect(phaseOps({})).toEqual([]);
  });
});

describe("resolveArgs", () => {
  test("plain array is used verbatim", () => {
    expect(resolveArgs([1, 2], { x: 9 })).toEqual([1, 2]);
  });
  test("function is called with self and its return used", () => {
    expect(resolveArgs((self) => [self.x, 2], { x: 9 })).toEqual([9, 2]);
  });
  test("missing args default to empty", () => {
    expect(resolveArgs(undefined, {})).toEqual([]);
    expect(resolveArgs(() => null, {})).toEqual([]);
  });
});

describe("dispatchPhase", () => {
  test("routes each kind to the matching primitive against targetPath", () => {
    const d = fakeDispatcher();
    const self = { id: 7 };
    dispatchPhase(
      d,
      "TARGET",
      {
        send: [
          { name: "select", args: (s) => [s.id] },
          { name: "onType", args: ["co"], opts: { x: 1 } },
        ],
        intent: [{ name: "load", args: [1], opts: { route: ["lex"] } }],
        do: [{ type: "intent", name: "ping", args: [], opts: { route: ["dyn"] } }],
      },
      self,
    );

    expect(d.calls).toEqual([
      { method: "sendAtPath", path: "TARGET", name: "select", args: [7], opts: undefined },
      { method: "sendAtPath", path: "TARGET", name: "onType", args: ["co"], opts: { x: 1 } },
      {
        method: "intentAtPath",
        path: "TARGET",
        name: "load",
        args: [1],
        opts: { route: ["lex"] },
      },
      {
        method: "intentAtPath",
        path: "TARGET",
        name: "ping",
        args: [],
        opts: { route: ["dyn"] },
      },
    ]);
  });

  test("null/undefined phase is a no-op", () => {
    const d = fakeDispatcher();
    dispatchPhase(d, "TARGET", null, {});
    dispatchPhase(d, "TARGET", undefined, {});
    expect(d.calls).toEqual([]);
  });
});
