// End-to-end over a real DOM, covering the shapes the two-channel design has to
// support: a view message answered at home, a view name that LEAVES the component via
// `forward`, an addressed `send`, and an intent on the `lex` leg answering, declining
// (PASS) and failing. The unit tests in transactor.test.js drive the walk directly;
// this file is the one that goes through a real click and a real render.
import { expect, test } from "vitest";
import { component, html, PASS } from "../index.js";
import { renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";

const document = setupJsdom();

const Status = component({
  name: "Status",
  fields: { text: "" },
  receive: {
    flash(t) {
      return this.setText(t);
    },
  },
  view: html`<b class="status" @text=".text"></b>`,
});

const Item = component({
  name: "Item",
  fields: { label: "" },
  receive: {
    // A view name that this component does NOT answer locally: it forwards, and the
    // name leaves the component as an intent without the view changing.
    pick(ctx) {
      ctx.forward({ route: ["dyn"] });
      return this;
    },
    // A plain view message, answered right here.
    shout() {
      return this.setLabel(this.label.toUpperCase());
    },
  },
  view: html`<span><button class="pick" @on.click="pick">p</button>
    <button class="shout" @on.click="shout">s</button>
    <i class="label" @text=".label"></i></span>`,
});

const Root = component({
  name: "Root",
  fields: { item: null, status: null, log: "", rows: "", err: "" },
  receive: {
    boot(ctx) {
      ctx.at.field("status").send("flash", ["ready"]); // addressed send
      ctx.intent("loadRows", [], { route: ["lex"] }); // intent on the lex leg
      return this;
    },
    loadRowsOk(rows) {
      return this.setRows(rows.join(","));
    },
    loadRowsError(e) {
      return this.setErr(String(e));
    },
    loadRowsUnhandled() {
      return this.setErr("nobody claimed it");
    },
  },
  // Answers the intent the Item forwarded up the `dyn` leg.
  intent: {
    pick(ctx) {
      ctx.reply("ok");
      return this.setLog("picked");
    },
  },
  view: html`<div><x render=".item"></x><x render=".status"></x>
    <em class="log" @text=".log"></em><em class="rows" @text=".rows"></em>
    <em class="err" @text=".err"></em></div>`,
});

function mount(intentHandlers) {
  return renderToHTMLNode(
    document,
    [Root, Item, Status],
    null,
    Root.make({ item: Item.make({ label: "a" }), status: Status.make() }),
    HeadlessParseContext,
    { intentHandlers },
  );
}
const txt = (c, sel) => c.querySelector(sel).textContent;

test("a view message answered locally", async () => {
  const { container, app, cleanup } = mount({});
  container.querySelector(".shout").click();
  await app.transactor.settle();
  expect(txt(container, ".label")).toBe("A");
  cleanup();
});

test("a view name that forwards becomes an intent an ancestor answers", async () => {
  const { container, app, cleanup } = mount({});
  container.querySelector(".pick").click();
  await app.transactor.settle();
  expect(txt(container, ".log")).toBe("picked");
  cleanup();
});

test("an addressed send reaches the named child, and a lex intent answers async", async () => {
  const { container, app, cleanup } = mount({ loadRows: async () => ["r1", "r2"] });
  app.sendAtRoot("boot");
  await app.transactor.settle();
  expect(txt(container, ".status")).toBe("ready");
  expect(txt(container, ".rows")).toBe("r1,r2");
  cleanup();
});

test("a declining lex handler runs the route out to <name>Unhandled", async () => {
  const { container, app, cleanup } = mount({ loadRows: async () => PASS });
  app.sendAtRoot("boot");
  await app.transactor.settle();
  expect(txt(container, ".err")).toBe("nobody claimed it");
  cleanup();
});

test("a throwing lex handler answers <name>Error", async () => {
  const { container, app, cleanup } = mount({
    loadRows: async () => {
      throw new Error("nope");
    },
  });
  app.sendAtRoot("boot");
  await app.transactor.settle();
  expect(txt(container, ".err")).toBe("Error: nope");
  cleanup();
});

// The docs site's own Counter, clicked through a real DOM. It is the smallest case of
// "a bare view name resolves in the `receive` bucket", and the one a reader meets first:
// `@on.click="dec"` (a receive handler) beside `@on.click="$inc"` (a method).
test("the docs Counter example: a bare view name and a $method both work", async () => {
  const { getComponents, getRoot } = await import("../docs/examples/counter.js");
  const { container, app, cleanup } = renderToHTMLNode(
    document,
    getComponents(),
    null,
    getRoot(),
    HeadlessParseContext,
  );
  const value = () => container.querySelector(".stat-value").textContent;
  expect(value()).toBe("0");

  container.querySelector(".btn-error").click(); // @on.click="dec"  -> receive.dec
  await app.transactor.settle();
  expect(value()).toBe("-1");

  container.querySelector(".btn-success").click(); // @on.click="$inc" -> methods.inc
  await app.transactor.settle();
  expect(value()).toBe("0");
  cleanup();
});
