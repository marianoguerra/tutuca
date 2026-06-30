// 07 — TESTS: getTests({ describe, test, expect, drive }).
//
// getTests runs in the terminal — the storybook runs it pre-serve, and
// `tutuca test docs/storybook/07-tests-drive.dev.js` runs it on demand. Two styles:
//   - drive(value, phase, opts?) — dispatches an `on`-phase config against a value
//     through a real transactor, awaits the WHOLE cascade (incl. async requests),
//     and returns the settled instance. opts.onMessage(message, before, after)
//     observes each committed transaction.
//   - `alter` iteration handlers (@when / @enrich-with / @loop-with) — call them
//     directly with .call(inst, ...). (For a higher-level pipeline helper there is
//     `collectIterBindings`, but it only works in the dev/browser build; the core
//     build `tutuca test` resolves to stubs it, so we unit-test the handler here.)
import { component, html } from "tutuca";
import { SAMPLE_ROWS } from "./_shared.js";

const DriveDemo = component({
  name: "DriveDemo",
  fields: { count: 0, rows: [], filter: "" },
  methods: {
    inc() {
      return this.setCount(this.count + 1);
    },
  },
  receive: {
    add(n) {
      return this.setCount(this.count + (n ?? 1));
    },
  },
  input: {
    typeFilter(value) {
      return this.setFilter(value);
    },
  },
  response: {
    load(res, _err) {
      return this.setRows(res);
    },
  },
  alter: {
    matches(_key, row) {
      return this.filter === "" || row.includes(this.filter);
    },
  },
  view: html`<div class="flex flex-col gap-2 max-w-sm">
    <div class="alert alert-info alert-soft text-sm">
      <span>
        This module's <code>getTests</code> run in the terminal (storybook pre-serve,
        or <code>tutuca test</code>) using the injected <code>drive()</code> helper.
        The widget below is the same component those tests drive.
      </span>
    </div>
    <div class="flex items-center gap-2">
      <button class="btn btn-sm" @on.click="$inc">count++</button>
      <span>count: <span @text=".count"></span></span>
    </div>
    <input
      class="input input-sm"
      :value=".filter"
      @on.input="typeFilter value"
      placeholder="filter rows"
    />
    <ul class="menu bg-base-200 rounded w-full">
      <li @each=".rows" @when="matches"><a><x text="@value"></x></a></li>
    </ul>
  </div>`,
});

export function getComponents() {
  return [DriveDemo];
}

export function getRoot() {
  return DriveDemo.make({ rows: SAMPLE_ROWS });
}

export function getRequestHandlers() {
  return { load: async () => SAMPLE_ROWS };
}

export function getExamples() {
  return {
    group: "Authoring · Roots & Tests",
    title: "Tests (drive)",
    description: "getTests with the injected drive() helper + direct alter-handler tests",
    items: [
      {
        title: "Live widget",
        description: "interact here; the tests for it run in the terminal",
        value: DriveDemo.make({ rows: SAMPLE_ROWS }),
      },
      {
        title: "Auto-loaded via on.init",
        description: "on.init → request load (works on a runtime with lifecycle hooks)",
        value: DriveDemo.make(),
        on: { init: { request: [{ name: "load", args: [] }] } },
      },
    ],
  };
}

export function getTests({ describe, test, expect, drive }) {
  describe(DriveDemo, () => {
    describe("drive() — dispatch + settle", () => {
      test("send actions accumulate (receive.add)", async () => {
        const settled = await drive(DriveDemo.make({ count: 0 }), {
          send: [
            { name: "add", args: [2] },
            { name: "add", args: [3] },
          ],
        });
        expect(settled.count).toBe(5);
      });

      test("request action settles the response (response.load)", async () => {
        const settled = await drive(DriveDemo.make({}), {
          request: [{ name: "load", args: [] }],
        });
        expect(settled.rows.size).toBe(4);
      });

      test("args function + onMessage trace", async () => {
        const trace = [];
        const settled = await drive(
          DriveDemo.make({ count: 10 }),
          { send: [{ name: "add", args: (self) => [self.count] }] }, // add its own count
          { onMessage: (m) => trace.push(`${m.kind}:${m.name}`) },
        );
        expect(settled.count).toBe(20);
        expect(trace).toContain("receive:add");
      });
    });

    describe("alter handler (matches) — called directly", () => {
      test("keeps rows containing the filter substring", () => {
        const d = DriveDemo.make({ filter: "be" });
        expect(DriveDemo.alter.matches.call(d, 0, "beta")).toBe(true);
        expect(DriveDemo.alter.matches.call(d, 1, "alpha")).toBe(false);
      });
      test("empty filter keeps everything", () => {
        const d = DriveDemo.make({ filter: "" });
        expect(DriveDemo.alter.matches.call(d, 0, "anything")).toBe(true);
      });
    });
  });
}
