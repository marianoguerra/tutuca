import { describe, expect, spyOn, test } from "bun:test";
import { component, html, macro } from "../index.js";
import { ComponentStack, Components, LookupInfo, ProvideInfo } from "../src/components.js";
import { Stack } from "../src/stack.js";
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
  test("provide binding", () => {
    const Comp = component({
      name: "MyComponent",
      fields: { message: "hey there!" },
      provide: {
        getMessage: ".message",
      },
    });
    Comp.compile(ParseContext);
    expect(Comp.provide.getMessage).toBeInstanceOf(ProvideInfo);
    expect(typeof Comp.provide.getMessage.symbol).toBe("symbol");
    expect(Comp.provide.getMessage.name).toBe("getMessage");
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
    // no `on.stackEnter`: entering the producer pushes its provides automatically,
    // and the nearest frame wins.
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
      lookup: {
        theMessage: { for: "CompA.getMessage", default: ".message" },
      },
    });
    CompA.compile(ParseContext);
    CompB.compile(ParseContext);

    expect(CompA.provide.getMessage).toBeInstanceOf(ProvideInfo);
    expect(typeof CompA.provide.getMessage.symbol).toBe("symbol");
    expect(CompA.provide.getMessage.name).toBe("getMessage");
    {
      // CompA is the root frame, so its provide is in scope.
      const stack = setupStackComps([CompA, CompB]);
      expect(stack.lookupDynamic("getMessage")).toBe("hey there!");
    }

    expect(CompB.lookup.theMessage).toBeInstanceOf(LookupInfo);
    expect(CompB.lookup.theMessage.compName).toBe("CompA");
    expect(CompB.lookup.theMessage.provideName).toBe("getMessage");
    expect(CompB.lookup.theMessage.name).toBe("theMessage");
    {
      // NOTE: component order — root is CompB, no CompA producer in scope, so the
      // lookup falls back to its default (CompB's own .message).
      const stack = setupStackComps([CompB, CompA]);
      expect(stack.lookupDynamic("theMessage")).toBe("hi!");
    }

    {
      // CompA is the root frame, so its provide IS in scope: the lookup resolves to
      // the producer's value, not the default.
      const stack = setupStackComps([CompA, CompB]).enter(
        CompB.make({ message: "custom message" }),
      );
      expect(stack.lookupDynamic("theMessage")).toBe("hey there!");
    }

    {
      // The producer's value threads through from the root instance.
      const stack = setupStackComps([CompA, CompB], CompA.make({ message: "hallo" })).enter(
        CompB.make({ message: "custom message" }),
      );
      expect(stack.lookupDynamic("theMessage")).toBe("hallo");
    }
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
    const shell = Shell.Class.make({ chat: { message: "from data" } });
    expect(shell.get("chat").get("message")).toBe("from data");
  });

  test("clone() lets one definition live in two independent scopes", () => {
    const comps = new Components();
    const Widget = component({ name: "Widget", fields: { message: "hi" } });
    const WidgetB = Widget.clone();
    const scopeA = new ComponentStack(comps);
    const scopeB = new ComponentStack(comps);
    scopeA.registerComponents([Widget]);
    scopeB.registerComponents([WidgetB]);

    // clone is a distinct Component with a distinct id and Class
    expect(WidgetB).not.toBe(Widget);
    expect(WidgetB.id).not.toBe(Widget.id);
    expect(WidgetB.Class).not.toBe(Widget.Class);
    expect(Widget.scope).not.toBe(WidgetB.scope);
    // rebuilt as a named Record so getTypeName/datacomp keep seeing the component name
    expect(WidgetB.Class.getMetaClass().name).toBe("Widget");

    const a = Widget.make({ message: "from A" });
    const b = WidgetB.make({ message: "from B" });
    // reverse lookup resolves each instance to its own Component/scope
    expect(comps.getCompFor(a)).toBe(Widget);
    expect(comps.getCompFor(b)).toBe(WidgetB);
    expect(comps.getCompFor(a).scope).toBe(Widget.scope);
    expect(comps.getCompFor(b).scope).toBe(WidgetB.scope);

    // a .set()-derived instance (new object identity) still resolves correctly,
    // proving the binding lives on the prototype and survives Immutable updates
    const a2 = a.set("message", "edited");
    expect(a2).not.toBe(a);
    expect(comps.getCompFor(a2)).toBe(Widget);
  });

  test("fromData static using this.make resolves its own scope per clone", () => {
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
    const WidgetB = Widget.clone();
    const scopeA = new ComponentStack(comps);
    const scopeB = new ComponentStack(comps);
    scopeA.registerComponents([Widget]);
    scopeB.registerComponents([WidgetB]);

    const a = Widget.Class.fromData({ msg: "A" });
    const b = WidgetB.Class.fromData({ msg: "B" });
    expect(a.get("message")).toBe("A");
    expect(b.get("message")).toBe("B");
    expect(comps.getCompFor(a)).toBe(Widget);
    expect(comps.getCompFor(b)).toBe(WidgetB);
  });

  test("registerComponents alias overriding existing component triggers console.assert", () => {
    const CompA = component({ name: "CompA", fields: {} });
    const CompB = component({ name: "CompB", fields: {} });
    const comps = new Components();
    const compStack = new ComponentStack(comps);
    const assertSpy = spyOn(console, "assert").mockImplementation(() => {});
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
    const assertSpy = spyOn(console, "assert").mockImplementation(() => {});
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
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
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
