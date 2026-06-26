import { expect, spyOn, test } from "bun:test";
import { expect as chaiExpect } from "../deps/chai.js";
import { component, html, phaseHasBubble } from "../index.js";
import { runTests } from "../tools/core/test.js";

// A component with a receive handler and a request/response pair, so `drive` can
// exercise both a synchronous message and an async request settling.
const Counter = component({
  name: "Counter",
  fields: { count: 0, loaded: null },
  receive: {
    inc(by, _ctx) {
      return this.setCount(this.count + (by ?? 1));
    },
  },
  response: {
    load(result, _err, _ctx) {
      return this.setLoaded(result);
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
    requestHandlers: { load: async () => "DATA" },
    getTests: ({ describe, test, drive }) => {
      describe(Counter, () => {
        test("init phase", async () => {
          settled = await drive(
            Counter.make({ count: 0 }),
            { send: [{ name: "inc", args: [2] }], request: [{ name: "load", args: [] }] },
            { onMessage: (m) => trace.push(`${m.kind}:${m.name ?? ""}`) },
          );
        });
      });
    },
  });

  expect(report.modules[0].counts.fail).toBe(0);
  expect(settled.count).toBe(2); // send inc 2
  expect(settled.loaded).toBe("DATA"); // request load settled
  expect(trace).toContain("receive:inc");
  expect(trace).toContain("response:load");
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

test("phaseHasBubble detects bubble in a bucket or a do item", () => {
  expect(phaseHasBubble({ send: [{ name: "inc" }] })).toBe(false);
  expect(phaseHasBubble({ bubble: [{ name: "x" }] })).toBe(true);
  expect(phaseHasBubble({ do: [{ type: "bubble", name: "x" }] })).toBe(true);
  expect(phaseHasBubble(null)).toBe(false);
});

test("drive warns that a bubble action is a no-op at the root", async () => {
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  let settled = null;
  try {
    await runTests({
      expect: chaiExpect,
      components: [Counter],
      getTests: ({ describe, test, drive }) => {
        describe(Counter, () => {
          test("bubble phase", async () => {
            settled = await drive(Counter.make({ count: 5 }), {
              bubble: [{ name: "inc", args: [1] }],
            });
          });
        });
      },
    });
    const msg = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(msg).toContain("bubble");
    expect(msg).toContain("no-op");
  } finally {
    warnSpy.mockRestore();
  }
  // The bubble didn't reach the root's own handler — count unchanged.
  expect(settled.count).toBe(5);
});
