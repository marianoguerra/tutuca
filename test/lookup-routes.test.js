// Name resolution from a handler: `ctx.lookupType` walking the same `dyn`/`lex` legs
// an intent's route names, and `ctx.sendReply` answering the sender of a message.
// End-to-end over a real DOM, because the `dyn` leg has to rebuild the render stack
// from the ctx — a handler never gets the one that evaluated its arguments.
import { expect, test } from "vitest";
import { component, html } from "../index.js";
import { FieldStep, Path } from "../src/path.js";
import { renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";

const document = setupJsdom();

// Registered in the scope under the name "Cell": what the `lex` leg answers with.
const Cell = component({
  name: "Cell",
  fields: { label: "registered" },
  view: html`<i></i>`,
});

const Slot = component({
  name: "Slot",
  fields: { made: "" },
  lookup: ["Cell"],
  receive: {
    build(draft, ctx) {
      draft.made = ctx.lookupType("Cell").make().label;
    },
    buildLex(draft, ctx) {
      draft.made = ctx.lookupType("Cell", { route: ["lex"] }).make().label;
    },
    buildDyn(draft, ctx) {
      draft.made = ctx.lookupType("Cell", { route: ["dyn"] })?.make().label ?? "none";
    },
    buildMissing(draft, ctx) {
      draft.made = String(ctx.lookupType("NoSuchThing"));
    },
    // `theme` is a provided VALUE, so the dyn leg finds a binding that is not a
    // component. The lex leg can never produce this case; the dyn leg always can.
    buildNotAType(draft, ctx) {
      draft.made = String(ctx.lookupType("theme"));
    },
    ping(_draft, ctx) {
      ctx.sendReply("pong", ["from-slot"]);
    },
    pingNoSender(_draft, ctx) {
      ctx.sendReply("pong", ["unreachable"]);
    },
  },
  view: html`<em class="made" @text=".made"></em>`,
});

// Publishes ITSELF under the name "Cell", shadowing the registered Cell for its
// whole subtree — the injection the `dyn` leg exists for.
const Board = component({
  name: "Board",
  fields: { label: "published", theme: "dark", slot: Slot.make({}) },
  provide: { Cell: "self", theme: ".theme" },
  view: html`<div><x render=".slot"></x></div>`,
});

const Plain = component({
  name: "Plain",
  fields: { slot: Slot.make({}) },
  view: html`<div><x render=".slot"></x></div>`,
});

const Root = component({
  name: "Root",
  fields: { board: Board.make({}), plain: Plain.make({}), heard: "" },
  receive: {
    poke(_draft, ctx) {
      ctx.at.field("plain").field("slot").send("ping");
    },
    pong(draft, what) {
      draft.heard = what;
    },
  },
  view: html`<div>
    <x render=".board"></x><x render=".plain"></x>
    <em class="heard" @text=".heard"></em>
  </div>`,
});

function mount() {
  return renderToHTMLNode(
    document,
    [Root, Board, Plain, Slot, Cell],
    null,
    Root.make({}),
    HeadlessParseContext,
  );
}

const madeUnder = (container, which) =>
  container.querySelectorAll(".made")[which === "board" ? 0 : 1].textContent;

// The Slot nested under each parent. `App` only exposes sendAtRoot, so address the
// nested component through the transactor directly.
const slotPath = (parent) => new Path([new FieldStep(parent), new FieldStep("slot")]);
const sendToSlot = (app, parent, name) => app.transactor.pushSend(slotPath(parent), name, []);

test("lex leg resolves the registered component", async () => {
  const { container, app, cleanup } = mount();
  sendToSlot(app, "plain", "build");
  await app.transactor.settle();
  expect(madeUnder(container, "plain")).toBe("registered");
  cleanup();
});

test("dyn leg resolves a type an ancestor published, shadowing the registration", async () => {
  const { container, app, cleanup } = mount();
  sendToSlot(app, "board", "build");
  await app.transactor.settle();
  expect(madeUnder(container, "board")).toBe("published");
  cleanup();
});

test("an explicit route overrides what the declaration would do", async () => {
  const { container, app, cleanup } = mount();
  // Under Board, the publisher wins by default...
  sendToSlot(app, "board", "buildLex");
  await app.transactor.settle();
  expect(madeUnder(container, "board")).toBe("registered");

  // ...and with no publisher above, the dyn leg alone finds nothing.
  sendToSlot(app, "plain", "buildDyn");
  await app.transactor.settle();
  expect(madeUnder(container, "plain")).toBe("none");
  cleanup();
});

test("a name no leg resolves refuses TYPE_NOT_FOUND and returns null", async () => {
  const { container, app, cleanup } = mount();
  const seen = [];
  app.transactor.observeRefusals((r) => seen.push(r));
  sendToSlot(app, "plain", "buildMissing");
  await app.transactor.settle();
  expect(madeUnder(container, "plain")).toBe("null");
  expect(seen.map((r) => r.kind)).toEqual(["TYPE_NOT_FOUND"]);
  expect(seen[0].info.name).toBe("NoSuchThing");
  cleanup();
});

test("a dyn binding that is not a component refuses TYPE_NOT_COMPONENT", async () => {
  const { container, app, cleanup } = mount();
  const seen = [];
  app.transactor.observeRefusals((r) => seen.push(r));
  sendToSlot(app, "board", "buildNotAType");
  await app.transactor.settle();
  expect(madeUnder(container, "board")).toBe("null");
  expect(seen.map((r) => r.kind)).toEqual(["TYPE_NOT_COMPONENT"]);
  expect(seen[0].info.name).toBe("theme");
  cleanup();
});

test("ctx.sendReply answers the sender of a message under a name the replier picks", async () => {
  const { container, app, cleanup } = mount();
  app.sendAtRoot("poke");
  await app.transactor.settle();
  expect(container.querySelector(".heard").textContent).toBe("from-slot");
  cleanup();
});

test("ctx.sendReply with nobody waiting refuses NO_SENDER", async () => {
  const { app, cleanup } = mount();
  const seen = [];
  app.transactor.observeRefusals((r) => seen.push(r));
  // sendAtRoot has no sender to reply to, so the reply chain stops at the first hop.
  sendToSlot(app, "plain", "pingNoSender");
  await app.transactor.settle();
  expect(seen.map((r) => r.kind)).toEqual(["NO_SENDER"]);
  cleanup();
});
