import { describe, expect, test } from "bun:test";
import { component, html } from "../index.js";
import { renderToHTML, renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";

const document = setupJsdom();

// A `@loop-with` handler can return an explicit, ordered `keys` array: the
// renderer visits exactly those keys (filter-then-paginate), binding @key to
// each ORIGINAL key so event paths and two-way binding keep their identity.
const Row = component({
  name: "Row",
  fields: { label: "" },
  view: html`<span @text=".label"></span>`,
});

const Picker = component({
  name: "Picker",
  fields: { rows: [], order: [] },
  methods: {
    removeRow(i) {
      return this.setRows(this.rows.delete(i));
    },
  },
  alter: {
    pick() {
      return { keys: this.order.toArray ? this.order.toArray() : [...this.order] };
    },
  },
  view: html`<ul>
    <li @each=".rows" @loop-with="pick">
      <span class="key" :data-key="@key" @text="@key"></span>
      <x render-it></x>
      <button :data-key="@key" @on.click="$removeRow @key">remove</button>
    </li>
  </ul>`,
});

const makePicker = (order) =>
  Picker.make({
    rows: [
      Row.make({ label: "zero" }),
      Row.make({ label: "one" }),
      Row.make({ label: "two" }),
      Row.make({ label: "three" }),
    ],
    order,
  });

describe("@loop-with keys", () => {
  test("visits exactly the returned keys, in order", () => {
    const out = renderToHTML(
      document,
      [Picker, Row],
      null,
      makePicker([2, 0]),
      HeadlessParseContext,
    );
    expect(out).toContain("two");
    expect(out).toContain("zero");
    expect(out).not.toContain("one");
    expect(out).not.toContain("three");
    // order is the keys order, not the sequence order
    expect(out.indexOf("two")).toBeLessThan(out.indexOf("zero"));
  });

  test("binds @key to the original key, not the page position", () => {
    const { container, cleanup } = renderToHTMLNode(
      document,
      [Picker, Row],
      null,
      makePicker([3, 1]),
      HeadlessParseContext,
    );
    const keys = [...container.querySelectorAll("span.key")].map((s) => s.dataset.key);
    expect(keys).toEqual(["3", "1"]);
    cleanup();
  });

  test("a click resolves the original key through the event path", () => {
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Picker, Row],
      null,
      makePicker([3, 1]),
      HeadlessParseContext,
    );
    expect(app.state.val.rows.size).toBe(4);
    // the first rendered row is original index 3 ("three")
    container.querySelector('button[data-key="3"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.rows.size).toBe(3);
    expect(app.state.val.rows.get(0).label).toBe("zero");
    cleanup();
  });

  test("keys takes precedence over start/end", () => {
    const Both = component({
      name: "Both",
      fields: { rows: [] },
      alter: {
        pick() {
          return { keys: [2], start: 0, end: 1 };
        },
      },
      view: html`<ul>
        <li @each=".rows" @loop-with="pick"><x render-it></x></li>
      </ul>`,
    });
    const root = Both.make({
      rows: [Row.make({ label: "zero" }), Row.make({ label: "one" }), Row.make({ label: "two" })],
    });
    const out = renderToHTML(document, [Both, Row], null, root, HeadlessParseContext);
    expect(out).toContain("two");
    expect(out).not.toContain("zero");
    expect(out).not.toContain("one");
  });
});

// `<x render-each>` desugars to `@each` wrapping a `<x render-it>`, so a
// `@loop-with` slice must reach the sequence the same way it does on a host
// element loop. Both spellings are exercised: `@loop-with` is the preferred
// form, bare `loop-with` still parses (deprecated, see DEPRECATED_BARE_X_DIRECTIVE).
describe("@loop-with on <x render-each>", () => {
  const makePaged = (attr) =>
    component({
      name: `Paged${attr.replace(/\W/g, "")}`,
      fields: { rows: [] },
      alter: {
        page() {
          return { start: 1, end: 3 };
        },
      },
      view: html`<ul>
        <x render-each=".rows" ${attr}="page"></x>
      </ul>`,
    });

  const rows = [
    Row.make({ label: "zero" }),
    Row.make({ label: "one" }),
    Row.make({ label: "two" }),
    Row.make({ label: "three" }),
  ];

  for (const attr of ["@loop-with", "loop-with"]) {
    test(`${attr} slices the rendered list to [start, end)`, () => {
      const Paged = makePaged(attr);
      const out = renderToHTML(
        document,
        [Paged, Row],
        null,
        Paged.make({ rows }),
        HeadlessParseContext,
      );
      expect(out).toContain("one");
      expect(out).toContain("two");
      expect(out).not.toContain("zero");
      expect(out).not.toContain("three");
    });
  }
});

// The `@loop-with` handler's 2nd argument is a context object { lookup, filter }.
const fourRows = [
  Row.make({ label: "zero" }),
  Row.make({ label: "one" }),
  Row.make({ label: "two" }),
  Row.make({ label: "three" }),
];

describe("@loop-with ctx", () => {
  test("ctx.lookup reads a scope binding published by an ancestor @enrich-with", () => {
    const Outer = component({
      name: "Outer",
      fields: { rows: [] },
      alter: {
        publish() {
          return { picked: 2 }; // scope enrich exposes @picked = 2
        },
        useLookup(_seq, { lookup }) {
          return { keys: [lookup("picked")] };
        },
      },
      view: html`<div @enrich-with="publish">
        <ul>
          <li @each=".rows" @loop-with="useLookup"><x render-it></x></li>
        </ul>
      </div>`,
    });
    const out = renderToHTML(
      document,
      [Outer, Row],
      null,
      Outer.make({ rows: fourRows }),
      HeadlessParseContext,
    );
    expect(out).toContain("two");
    expect(out).not.toContain("zero");
    expect(out).not.toContain("three");
  });

  test("ctx.filter wraps @when so the handler can reuse the declared predicate", () => {
    const Filtered = component({
      name: "Filtered",
      fields: { rows: [] },
      alter: {
        hasE(_key, row) {
          return row.label.includes("e");
        },
        pick(seq, { filter }) {
          const keys = [];
          for (let i = 0; i < seq.size; i++) if (filter(i, seq.get(i))) keys.push(i);
          return { keys };
        },
      },
      view: html`<ul>
        <li @each=".rows" @when="hasE" @loop-with="pick"><x render-it></x></li>
      </ul>`,
    });
    const out = renderToHTML(
      document,
      [Filtered, Row],
      null,
      Filtered.make({ rows: fourRows }),
      HeadlessParseContext,
    );
    // "zero", "one", "three" contain an 'e'; "two" does not
    expect(out).toContain("zero");
    expect(out).toContain("one");
    expect(out).toContain("three");
    expect(out).not.toContain("two");
  });

  test("a keys return is authoritative — @when is not re-applied", () => {
    const Bypass = component({
      name: "Bypass",
      fields: { rows: [] },
      alter: {
        never() {
          return false; // would drop everything if re-applied
        },
        pickZero() {
          return { keys: [0] };
        },
      },
      view: html`<ul>
        <li @each=".rows" @when="never" @loop-with="pickZero"><x render-it></x></li>
      </ul>`,
    });
    const out = renderToHTML(
      document,
      [Bypass, Row],
      null,
      Bypass.make({ rows: fourRows }),
      HeadlessParseContext,
    );
    expect(out).toContain("zero");
  });

  test("early-exit handler renders exactly the requested page of matches", () => {
    // page 1, size 2, of the rows whose label has an 'e' -> ["zero","one","three"]
    // page 1 is ["three"]; the scan stops once 4 (=(1+1)*2) matches are seen.
    const Paged = component({
      name: "Paged",
      fields: { rows: [], page: 1, pageSize: 2 },
      alter: {
        hasE(_key, row) {
          return row.label.includes("e");
        },
        window(seq, { filter }) {
          const start = this.page * this.pageSize;
          const end = start + this.pageSize;
          const keys = [];
          let m = 0;
          for (let i = 0; i < seq.size && m < end; i++) {
            if (filter(i, seq.get(i))) {
              if (m >= start) keys.push(i);
              m++;
            }
          }
          return { keys };
        },
      },
      view: html`<ul>
        <li @each=".rows" @when="hasE" @loop-with="window"><x render-it></x></li>
      </ul>`,
    });
    const out = renderToHTML(
      document,
      [Paged, Row],
      null,
      Paged.make({ rows: fourRows }),
      HeadlessParseContext,
    );
    expect(out).toContain("three");
    expect(out).not.toContain("zero");
    expect(out).not.toContain("one");
    expect(out).not.toContain("two");
  });
});
