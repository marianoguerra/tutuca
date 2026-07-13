import { describe, expect, test } from "vitest";
import { component, html } from "../index.js";
import { renderToHTML, renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";

const document = setupJsdom();

// One-level member reads on `@`-bindings (`@value.title`) in display-only
// positions, and the runtime guarantee that `@enrich-with` cannot overwrite
// the loop's own `key`/`value` binds.

const Item = component({
  name: "Item",
  fields: { title: "", color: "" },
  view: html`<i></i>`,
});

const items = [
  Item.make({ title: "alpha", color: "red" }),
  Item.make({ title: "beta", color: "blue" }),
];

describe("binding member reads in views", () => {
  test("@text reads a member of @value inside @each", () => {
    const List = component({
      name: "List",
      fields: { rows: [] },
      view: html`<ul>
        <li @each=".rows" @text="@value.title"></li>
      </ul>`,
    });
    const out = renderToHTML(
      document,
      [List, Item],
      null,
      List.make({ rows: items }),
      HeadlessParseContext,
    );
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
  });

  test("member read works on an @enrich-with bind holding a plain object", () => {
    const List = component({
      name: "List",
      fields: { rows: [] },
      alter: {
        decorate(binds, _key, value) {
          binds.meta = { tone: `tone-${value.color}` };
        },
      },
      view: html`<ul>
        <li @each=".rows" @enrich-with="decorate" :data-tone="@meta.tone" @text="@value.title"></li>
      </ul>`,
    });
    const out = renderToHTML(
      document,
      [List, Item],
      null,
      List.make({ rows: items }),
      HeadlessParseContext,
    );
    expect(out).toContain('data-tone="tone-red"');
    expect(out).toContain('data-tone="tone-blue"');
  });

  test("a handler arg @value.title resolves through event-path replay", () => {
    const Pick = component({
      name: "Pick",
      fields: { rows: [], picked: "" },
      methods: {
        pick(title) {
          return this.setPicked(title);
        },
      },
      view: html`<ul>
        <li @each=".rows">
          <button :data-key="@key" @on.click="$pick @value.title">pick</button>
        </li>
      </ul>`,
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Pick, Item],
      null,
      Pick.make({ rows: items }),
      HeadlessParseContext,
    );
    container.querySelector('button[data-key="1"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.picked).toBe("beta");
    cleanup();
  });
});

describe("@enrich-with cannot overwrite key/value", () => {
  test("an overwritten binds.value is restored and warned about", () => {
    const List = component({
      name: "List",
      fields: { rows: [] },
      alter: {
        hijack(binds, _key, value) {
          binds.value = value.setTitle("hacked");
        },
      },
      view: html`<ul>
        <li @each=".rows" @enrich-with="hijack" @text="@value.title"></li>
      </ul>`,
    });
    const failedAsserts = [];
    const origAssert = console.assert;
    console.assert = (cond, ...args) => {
      if (!cond) failedAsserts.push(args);
    };
    try {
      const out = renderToHTML(
        document,
        [List, Item],
        null,
        List.make({ rows: items }),
        HeadlessParseContext,
      );
      expect(out).toContain("alpha");
      expect(out).not.toContain("hacked");
      expect(failedAsserts.length).toBeGreaterThan(0);
      expect(String(failedAsserts[0][0])).toContain("must not overwrite");
    } finally {
      console.assert = origAssert;
    }
  });
});
