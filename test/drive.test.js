import { expect, test } from "vitest";
import { expect as chaiExpect } from "../deps/chai.js";
import { component, html } from "../index.js";
import { runTests } from "../tools/core/test.js";

// A component with a plain message handler and an intent's answer arm, so `drive` can
// exercise both a synchronous message and an async intent settling.
const Counter = component({
  name: "Counter",
  fields: { count: 0, loaded: null },
  receive: {
    inc(draft, by, _ctx) {
      draft.count = this.count + (by ?? 1);
    },
    // The answer to `load`, arriving as an ordinary message under its own name.
    loadOk(draft, result, _ctx) {
      draft.loaded = result;
    },
    // "Nothing claimed it" — a different sentence from "a handler refused it", and it
    // carries the arguments the intent was raised with.
    nudgeUnhandled(draft, by, _ctx) {
      draft.loaded = `unhandled:${by}`;
    },
  },
  view: html`<div></div>`,
});

test("drive injected into getTests runs a phase and returns the settled value", async () => {
  let settled = null;
  const trace = [];
  const report = await runTests({
    expect: chaiExpect,
    components: [Counter],
    intentHandlers: { load: async () => "DATA" },
    getTests: ({ describe, test, drive }) => {
      describe(Counter, () => {
        test("init phase", async () => {
          settled = await drive(
            Counter.make({ count: 0 }),
            {
              send: [{ name: "inc", args: [2] }],
              intent: [{ name: "load", args: [], opts: { route: ["lex"] } }],
            },
            { onMessage: (m) => trace.push(`${m.kind}:${m.name ?? ""}`) },
          );
        });
      });
    },
  });

  expect(report.modules[0].counts.fail).toBe(0);
  expect(settled.count).toBe(2); // send inc 2
  expect(settled.loaded).toBe("DATA"); // the intent's answer settled
  expect(trace).toContain("receive:inc");
  expect(trace).toContain("receive:loadOk");
});

test("drive args function receives the instance (self)", async () => {
  let settled = null;
  await runTests({
    expect: chaiExpect,
    components: [Counter],
    getTests: ({ describe, test, drive }) => {
      describe(Counter, () => {
        test("args fn", async () => {
          settled = await drive(Counter.make({ count: 10 }), {
            send: [{ name: "inc", args: (self) => [self.count] }], // inc by its own count
          });
        });
      });
    },
  });
  expect(settled.count).toBe(20);
});

test("an intent at the root runs out of route and answers <name>Unhandled", async () => {
  let settled = null;
  await runTests({
    expect: chaiExpect,
    components: [Counter],
    getTests: ({ describe, test, drive }) => {
      describe(Counter, () => {
        test("intent phase", async () => {
          settled = await drive(Counter.make({ count: 5 }), {
            intent: [{ name: "nudge", args: [1], opts: { route: ["dyn"] } }],
          });
        });
      });
    },
  });
  // drive originates at the root, so the `dyn` leg has no ancestor to offer it to. The
  // walk runs out and the sender hears `nudgeUnhandled`, carrying the intent's own args
  // — a real answer where the old design could only print a warning.
  expect(settled.count).toBe(5);
  expect(settled.loaded).toBe("unhandled:1");
});
