import { describe, expect, test, vi } from "vitest";
import { component, html, macro, path } from "../index.js";
import { ComponentStack, Components } from "../src/components.js";
import { produce } from "../src/immer.js";
import { Stack } from "../src/stack.js";
import { rootDispatcher, Transactor } from "../src/transactor.js";
import { HeadlessParseContext as ParseContext } from "./dom.js";

function setupStack(Comp) {
  return setupStackComps([Comp]);
}
function setupStackComps(compArray, it = compArray[0].make()) {
  const comps = new Components();
  const compStack = new ComponentStack(comps);
  compStack.registerComponents(compArray);
  return Stack.root(comps, it);
}
describe("Components", () => {
  test("component statics cannot shadow framework metadata or behavior", () => {
    expect(() =>
      component({
        name: "BadViewsStatic",
        fields: {},
        statics: { views() {} },
      }),
    ).toThrow('component static "views" is reserved by the framework');
    expect(() =>
      component({
        name: "BadCompileStatic",
        fields: {},
        statics: { compile() {} },
      }),
    ).toThrow('component static "compile" is reserved by the framework');
  });

  test("provide binding", () => {
    const Comp = component({
      name: "MyComponent",
      fields: { message: "hey there!" },
      provide: {
        getMessage: ".message",
      },
    });
    Comp.compile(ParseContext);
    expect(Comp.provide.getMessage).toBeDefined();
    const stack = setupStack(Comp);
    expect(stack.lookupDynamic("getMessage")).toBe("hey there!");
  });

  test("provides are pushed automatically on enter", () => {
    const Comp = component({
      name: "MyComponent",
      fields: { message: "hey there!" },
      provide: {
        getMessage: ".message",
      },
    });
    Comp.compile(ParseContext);
    const stack = setupStack(Comp);
    // entering the producer pushes its provides automatically, and the
    // nearest frame wins.
    expect(stack.lookupDynamic("getMessage")).toBe("hey there!");
    expect(stack.enter(Comp.make({ message: "hey!" })).lookupDynamic("getMessage")).toBe("hey!");
  });

  test("lookup binding", () => {
    const CompA = component({
      name: "CompA",
      fields: { message: "hey there!" },
      provide: {
        getMessage: ".message",
      },
    });
    const CompB = component({
      name: "CompB",
      fields: { message: "hi!" },
      // A lookup names what it wants, not who provides it: whoever is nearest above
      // and provides `getMessage` answers, and the default covers "nobody does".
      lookup: [{ name: "getMessage", default: ".message" }],
    });
    CompA.compile(ParseContext);
    CompB.compile(ParseContext);

    expect(CompA.provide.getMessage).toBeDefined();
    {
      // CompA is the root frame, so its provide is in scope.
      const stack = setupStackComps([CompA, CompB]);
      expect(stack.lookupDynamic("getMessage")).toBe("hey there!");
    }

    expect("getMessage" in CompB.lookup).toBe(true);
    {
      // NOTE: component order — root is CompB, no CompA producer above, so the
      // lookup falls back to its default (CompB's own .message).
      const stack = setupStackComps([CompB, CompA]);
      expect(stack.lookupDynamic("getMessage")).toBe("hi!");
    }

    {
      // CompA is the root frame, so its provide IS in scope: the lookup resolves to
      // the producer's value, not the default.
      const stack = setupStackComps([CompA, CompB]).enter(
        CompB.make({ message: "custom message" }),
      );
      expect(stack.lookupDynamic("getMessage")).toBe("hey there!");
    }

    {
      // The producer's value threads through from the root instance.
      const stack = setupStackComps([CompA, CompB], CompA.make({ message: "hallo" })).enter(
        CompB.make({ message: "custom message" }),
      );
      expect(stack.lookupDynamic("getMessage")).toBe("hallo");
    }
  });

  test("provide: { Name: 'self' } publishes the component type to the subtree", () => {
    const Cell = component({ name: "Cell", fields: { v: 0 } });
    const Board = component({
      name: "Board",
      fields: { title: "b" },
      // The published name is the interface; "self" is the only value, so what lands
      // on the stack is a component by construction.
      provide: { Slot: "self" },
    });
    const Other = component({ name: "Other", fields: { title: "o" }, provide: { Slot: "self" } });
    for (const C of [Cell, Board, Other]) C.compile(ParseContext);

    const stack = setupStackComps([Board, Cell, Other]);
    expect(stack.lookupDynamic("Slot")).toBe(Board);
    // Nearest publisher wins, the same way a provided value does.
    expect(stack.enter(Other.make({})).lookupDynamic("Slot")).toBe(Other);
  });

  test("ctx.lookup: dyn finds the publisher, lex finds the registration", () => {
    const Cell = component({ name: "Cell", fields: { v: 0 } });
    const Board = component({
      name: "Board",
      fields: { title: "b" },
      provide: { Cell: "self" },
    });
    for (const C of [Cell, Board]) C.compile(ParseContext);
    const comps = new Components();
    new ComponentStack(comps).registerComponents([Board, Cell]);
    const ctx = rootDispatcher(new Transactor(comps, Board.make({})));

    // Board publishes ITSELF under the name "Cell", shadowing the registered Cell.
    expect(ctx.lookup("Cell")).toBe(Board);
    expect(ctx.lookup("Cell", { route: ["dyn"] })).toBe(Board);
    expect(ctx.lookup("Cell", { route: ["lex"] })).toBe(Cell);
    // Array order is walk order, exactly as an intent route.
    expect(ctx.lookup("Cell", { route: ["lex", "dyn"] })).toBe(Cell);
    // A name nobody publishes falls through to the registration scope.
    expect(ctx.lookup("Board")).toBe(Board);
    // An empty route resolves to null rather than falling back to the default.
    expect(ctx.lookup("Cell", { route: [] })).toBe(null);
  });

  test("a provide publishes its value AND the absolute path it lives at", () => {
    const Doc = component({ name: "Doc", fields: { title: "t" } });
    const Comp = component({
      name: "Holder",
      fields: { doc: null, sheets: new Map(), selId: "" },
      provide: { active: ".doc", picked: ".sheets[.selId]" },
    });
    for (const C of [Doc, Comp]) C.compile(ParseContext);
    const doc = Doc.make({ title: "hi" });
    const root = Comp.make({ doc, sheets: new Map([["a", doc]]), selId: "a" });
    const stack = setupStackComps([Comp, Doc], root);
    // Both halves: what a `*name` reads, and where `<x render="*name">` resumes.
    const active = stack.lookupDynamicLocated("active");
    expect(active.value).toBe(doc);
    expect(active.path.toKeys()).toEqual([{ field: "doc" }]);
    // A seq-access provide keeps its live key, so it follows `.selId`.
    expect(stack.lookupDynamicLocated("picked").path.lookup(root)).toBe(doc);
  });

  // The path is only published when it demonstrably addresses the value being
  // rendered. Reading `*name` still works; there is simply nowhere to resume, so
  // `<x render="*name">` renders nothing rather than editing a guessed address.
  test("a provide whose position cannot be addressed publishes the value with no path", () => {
    const Doc = component({ name: "Doc", fields: { title: "t" } });
    const Holder = component({
      name: "Holder",
      fields: { doc: null },
      provide: { active: ".doc" },
    });
    for (const C of [Doc, Holder]) C.compile(ParseContext);
    const other = Holder.make({ doc: Doc.make({ title: "elsewhere" }) });
    // Entering a value that is not at the render path this stack is standing on:
    // `it` moved, the position did not.
    const stack = setupStackComps([Holder, Doc]).enter(other);
    const loc = stack.lookupDynamicLocated("active");
    expect(loc.value).toBe(other.doc);
    expect(loc.path).toBe(null);
    expect(stack.lookupDynamic("active")).toBe(other.doc);
  });

  test("a published TYPE has no path, so it can never be a render target", () => {
    const Board = component({ name: "Board", fields: { t: "b" }, provide: { Slot: "self" } });
    Board.compile(ParseContext);
    const stack = setupStackComps([Board]);
    expect(stack.lookupDynamic("Slot")).toBe(Board);
    expect(stack.lookupDynamicLocated("Slot")).toBe(null);
  });

  test("registerPaths: a name resolves from the registration scope, nearest first", () => {
    const Comp = component({ name: "Comp", fields: { theme: "dark", session: "s" } });
    Comp.compile(ParseContext);
    const comps = new Components();
    const outer = new ComponentStack(comps);
    outer.registerComponents([Comp], { paths: { theme: path().field("theme") } });
    expect(outer.lookupPath("theme").toKeys()).toEqual([{ field: "theme" }]);
    expect(outer.lookupPath("session")).toBe(null);
    const inner = outer.enter();
    inner.registerPaths({ session: path().field("session") });
    // The inner scope sees both; the outer one still sees only its own.
    expect(inner.lookupPath("session").toKeys()).toEqual([{ field: "session" }]);
    expect(inner.lookupPath("theme").toKeys()).toEqual([{ field: "theme" }]);
    expect(outer.lookupPath("session")).toBe(null);
    // A type name has no path — that is what lookupComponent answers.
    inner.registerPaths({ Theme: path().field("theme") });
    expect(inner.lookupPath("Theme")).toBe(null);
  });

  test("ctx.lookup: the lex leg of a value name reads a registered path", () => {
    const Root = component({ name: "Root", fields: { theme: "dark", live: "bright" } });
    Root.compile(ParseContext);
    const comps = new Components();
    new ComponentStack(comps).registerComponents([Root], {
      paths: { theme: path().field("theme") },
    });
    const ctx = rootDispatcher(new Transactor(comps, Root.make({})));
    expect(ctx.lookup("theme")).toBe("dark");
    expect(ctx.lookup("theme", { route: ["lex"] })).toBe("dark");
    // The `dyn` leg answers too: a `*name` READ is itself "nearest provider, else
    // registered path", so the same order applies whether it is a view or a handler
    // asking. What the legs separate is which environment gets asked first.
    expect(ctx.lookup("theme", { route: ["dyn"] })).toBe("dark");
    expect(ctx.lookup("missing", { route: ["dyn", "lex"] })).toBe(null);
  });

  test("registerComponents with aliases", () => {
    const CompA = component({
      name: "CompA",
      fields: { message: "hey there!" },
    });
    const comps = new Components();
    const compStack = new ComponentStack(comps);
    compStack.registerComponents([CompA], { aliases: { AliasA: "CompA", AliasB: "CompA" } });
    expect(Object.keys(compStack.byName)).toEqual(["CompA", "AliasA", "AliasB"]);
    // Scope tables hold the component itself.
    expect(compStack.byName.CompA).toBe(CompA);
    expect(compStack.byName.AliasA).toBe(CompA);
    expect(compStack.byName.AliasB).toBe(CompA);
  });

  test("registerComponents binds scope to Class so direct Class.make resolves comp fields", () => {
    const Chat = component({ name: "Chat", fields: { message: "hi" } });
    const Shell = component({
      name: "Shell",
      fields: { chat: { component: "Chat", args: { message: "hi" } } },
    });
    const comps = new Components();
    const compStack = new ComponentStack(comps);
    compStack.registerComponents([Chat, Shell]);
    // direct Class.make (e.g. from a deserialization path) without a threaded scope
    const shell = Shell.make({ chat: { message: "from data" } });
    expect(shell.chat.message).toBe("from data");
  });

  test("one spec registered into two scopes yields independent Components", () => {
    const comps = new Components();
    const Widget = component({ name: "Widget", fields: { message: "hi" } });
    const WidgetB = component(Widget.spec);
    const scopeA = new ComponentStack(comps);
    const scopeB = new ComponentStack(comps);
    scopeA.registerComponents([Widget]);
    scopeB.registerComponents([WidgetB]);

    // WidgetB is a distinct Component with a distinct id and Class
    expect(WidgetB).not.toBe(Widget);
    expect(WidgetB.id).not.toBe(Widget.id);
    expect(WidgetB).not.toBe(Widget);
    expect(Widget.scope).not.toBe(WidgetB.scope);
    // rebuilt as a named class so getTypeName/datacomp keep seeing the component name
    expect(WidgetB.getMetaClass().name).toBe("Widget");

    const a = Widget.make({ message: "from A" });
    const b = WidgetB.make({ message: "from B" });
    // reverse lookup resolves each instance to its own Component/scope
    expect(comps.getCompFor(a)).toBe(Widget);
    expect(comps.getCompFor(b)).toBe(WidgetB);
    expect(comps.getCompFor(a).scope).toBe(Widget.scope);
    expect(comps.getCompFor(b).scope).toBe(WidgetB.scope);

    // an Immer-produced instance still resolves through the inherited binding.
    const a2 = produce(a, (draft) => {
      draft.message = "edited";
    });
    expect(a2).not.toBe(a);
    expect(comps.getCompFor(a2)).toBe(Widget);
  });

  test("fromData static using this.make resolves its own scope per spec instance", () => {
    const comps = new Components();
    const Widget = component({
      name: "Widget",
      fields: { message: "hi" },
      statics: {
        fromData(d) {
          return this.make({ message: d.msg });
        },
      },
    });
    const WidgetB = component(Widget.spec);
    const scopeA = new ComponentStack(comps);
    const scopeB = new ComponentStack(comps);
    scopeA.registerComponents([Widget]);
    scopeB.registerComponents([WidgetB]);

    const a = Widget.fromData({ msg: "A" });
    const b = WidgetB.fromData({ msg: "B" });
    expect(a.message).toBe("A");
    expect(b.message).toBe("B");
    expect(comps.getCompFor(a)).toBe(Widget);
    expect(comps.getCompFor(b)).toBe(WidgetB);
  });

  test("registerComponents alias overriding existing component triggers console.assert", () => {
    const CompA = component({ name: "CompA", fields: {} });
    const CompB = component({ name: "CompB", fields: {} });
    const comps = new Components();
    const compStack = new ComponentStack(comps);
    const assertSpy = vi.spyOn(console, "assert").mockImplementation(() => {});
    try {
      compStack.registerComponents([CompA, CompB], { aliases: { CompA: "CompB" } });
      expect(assertSpy).toHaveBeenCalledWith(false, "alias overrides component", "CompA");
    } finally {
      assertSpy.mockRestore();
    }
  });

  test("registerMacros lowercases keys so capitalized const names work", () => {
    const Card = macro({}, html`<div class="card"></div>`);
    const stack = new ComponentStack();
    stack.registerMacros({ Card });
    expect(stack.lookupMacro("card")).toBe(Card);
    expect(stack.lookupMacro("Card")).toBeNull();
  });

  test("registerMacros warns via console.assert on case-collision", () => {
    const a = macro({}, html`<span></span>`);
    const b = macro({}, html`<em></em>`);
    const stack = new ComponentStack();
    stack.registerMacros({ Card: a });
    const assertSpy = vi.spyOn(console, "assert").mockImplementation(() => {});
    try {
      stack.registerMacros({ card: b });
      const collisionCall = assertSpy.mock.calls.find(
        (args) => args[0] === false && args[1] === "macro key collision",
      );
      expect(collisionCall).toBeDefined();
      expect(collisionCall[2]).toBe("card");
    } finally {
      assertSpy.mockRestore();
    }
    expect(stack.lookupMacro("card")).toBe(b);
  });

  test("registerComponents alias to inexistent component triggers console.warn", () => {
    const CompA = component({ name: "CompA", fields: {} });
    const comps = new Components();
    const compStack = new ComponentStack(comps);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      compStack.registerComponents([CompA], { aliases: { AliasX: "NotAComp" } });
      expect(warnSpy).toHaveBeenCalledWith(
        "alias",
        "AliasX",
        "to inexistent component",
        "NotAComp",
      );
      expect(compStack.byName.AliasX).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("component-typed field defaults", () => {
  // `{ component: "Name", args }` is a string-deferred component field: the name
  // is resolved against a scope at make() time. Built without a registered scope
  // (e.g. bare Class.make() in tooling/tests) it degrades to null — but warns
  // instead of failing far away as `expected null to be an instance of Record`.
  const Parent = component({
    name: "Parent",
    fields: { sidebar: { component: "Sidebar", args: {} } },
    view: html`<div></div>`,
  });

  test("warns and yields null when built without a registered scope", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const p = Parent.make({});
      expect(p.sidebar).toBeNull();
      const msg = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(msg).toContain('component field "sidebar"');
      expect(msg).toContain("Sidebar");
      expect(msg).toContain("without a registered scope");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("resolves the component when built via a registered scope", () => {
    const Sidebar = component({
      name: "Sidebar",
      fields: { title: "?" },
      view: html`<aside @text=".title"></aside>`,
    });
    const stack = new ComponentStack();
    stack.registerComponents([Parent, Sidebar]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const p = stack.lookupComponent("Parent").make({});
      expect(p.sidebar).not.toBeNull();
      expect(p.sidebar.title).toBe("?");
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
