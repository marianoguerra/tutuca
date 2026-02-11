import { component } from "../index.js";
import { ComponentStack, Components, Dynamic, DynamicAlias } from "../src/components.js";
import { Stack } from "../src/stack.js";
import { describe, expect, test } from "bun:test";
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
  test("Dynamic binding", () => {
    const Comp = component({
      name: "MyComponent",
      fields: { message: "hey there!" },
      dynamic: {
        getMessage: ".message",
      },
    });
    Comp.compile(ParseContext);
    expect(Comp.dynamic.getMessage).toBeInstanceOf(Dynamic);
    expect(typeof Comp.dynamic.getMessage.symbol).toBe("symbol");
    expect(Comp.dynamic.getMessage.name).toBe("getMessage");
    const stack = setupStack(Comp);
    const dbinds = {};
    Comp.dynamic.getMessage.evalAndBind(stack, dbinds);
    expect(dbinds[Comp.dynamic.getMessage.symbol]).toBe("hey there!");
  });

  test("Dynamic lookup with default", () => {
    const Comp = component({
      name: "MyComponent",
      fields: { message: "hey there!" },
      dynamic: {
        getMessage: ".message",
      },
    });
    Comp.compile(ParseContext);
    const stack = setupStack(Comp);
    expect(stack.lookupDynamic("getMessage")).toBe("hey there!");
  });

  test("on.stackEnter", () => {
    const Comp = component({
      name: "MyComponent",
      fields: { message: "hey there!" },
      dynamic: {
        getMessage: ".message",
      },
      on: {
        stackEnter(stack) {
          return stack.withDynamicBindings(["getMessage"]);
        },
      },
    });
    Comp.compile(ParseContext);
    const stack = setupStack(Comp);
    expect(stack.lookupDynamic("getMessage")).toBe("hey there!");
    expect(stack.enter(Comp.make({ message: "hey!" })).lookupDynamic("getMessage")).toBe(
      "hey!",
    );
  });

  test("DynamicAlias binding", () => {
    const CompA = component({
      name: "CompA",
      fields: { message: "hey there!" },
      dynamic: {
        getMessage: ".message",
      },
    });
    const CompB = component({
      name: "CompB",
      fields: { message: "hi!" },
      dynamic: {
        theMessage: { for: "CompA.getMessage", default: ".message" },
      },
    });
    CompA.compile(ParseContext);
    CompB.compile(ParseContext);

    expect(CompA.dynamic.getMessage).toBeInstanceOf(Dynamic);
    expect(typeof CompA.dynamic.getMessage.symbol).toBe("symbol");
    expect(CompA.dynamic.getMessage.name).toBe("getMessage");
    {
      const stack = setupStackComps([CompA, CompB]);
      const dbinds = {};
      CompA.dynamic.getMessage.evalAndBind(stack, dbinds);
      expect(dbinds[CompA.dynamic.getMessage.symbol]).toBe("hey there!");
    }

    expect(CompB.dynamic.theMessage).toBeInstanceOf(DynamicAlias);
    expect(CompB.dynamic.theMessage.symbol).toBe(null);
    expect(CompB.dynamic.theMessage.name).toBe("theMessage");
    {
      // NOTE: component order
      const stack = setupStackComps([CompB, CompA]);
      const dbinds = {};
      CompB.dynamic.theMessage.evalAndBind(stack, dbinds);
      expect(dbinds[CompB.dynamic.theMessage.symbol]).toBe("hi!");
    }

    {
      const stack = setupStackComps([CompA, CompB]).enter(
        CompB.make({ message: "custom message" }),
      );
      expect(stack.lookupDynamic("theMessage")).toBe("custom message");
      expect(stack.withDynamicBindings(["theMessage"]).lookupDynamic("theMessage")).toBe(
        "custom message",
      );
    }

    {
      const stack = setupStackComps([CompA, CompB], CompA.make({ message: "hallo" }))
        .withDynamicBindings(["getMessage"])
        .enter(CompB.make({ message: "custom message" }));
      expect(stack.lookupDynamic("theMessage")).toBe("hallo");
      expect(stack.withDynamicBindings(["theMessage"]).lookupDynamic("theMessage")).toBe(
        "custom message",
      );
    }
  });
});
