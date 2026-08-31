import { describe, expect, test } from "vitest";
import { component } from "../index.js";
import { ComponentStack, Components } from "../src/components.js";
import { immerable } from "../src/immer.js";
import { DispatchPath, FieldStep, SeqStep } from "../src/path.js";
import { Transactor } from "../src/transactor.js";

function setup(Comp, root = Comp.make()) {
  const comps = new Components();
  new ComponentStack(comps).registerComponents([Comp]);
  return new Transactor(comps, root);
}

function send(transactor, path, name, args = []) {
  transactor.pushSend(path, name, args);
  transactor.transactNext();
}

describe("Immer component state", () => {
  test("passes a mutable draft first and keeps this as the frozen current snapshot", () => {
    let seen;
    const Counter = component({
      name: "DraftCounter",
      fields: { count: 0, items: [] },
      receive: {
        increment(draft, by) {
          seen = { self: this, draft };
          draft.count += by;
          draft.items.push("changed");
        },
      },
    });
    const current = Counter.make();
    const transactor = setup(Counter, current);
    send(transactor, DispatchPath.ofSteps([]), "increment", [2]);

    expect(seen.self).toBe(current);
    expect(current.count).toBe(0);
    expect(transactor.state.val.count).toBe(2);
    expect(transactor.state.val.items).toEqual(["changed"]);
    expect(Object.isFrozen(transactor.state.val)).toBe(true);
  });

  test("an untouched draft preserves exact root identity", () => {
    const Observer = component({
      name: "DraftObserver",
      fields: { value: 1 },
      receive: { observe(_draft) {} },
    });
    const current = Observer.make();
    const transactor = setup(Observer, current);
    send(transactor, DispatchPath.ofSteps([]), "observe");
    expect(transactor.state.val).toBe(current);
  });

  test("returning another component swaps the addressed leaf", () => {
    let Other;
    const First = component({
      name: "FirstSwap",
      fields: { value: 1 },
      receive: {
        swap(_draft) {
          return Other.make({ label: "next" });
        },
      },
    });
    Other = component({ name: "OtherSwap", fields: { label: "" } });
    const comps = new Components();
    new ComponentStack(comps).registerComponents([First, Other]);
    const transactor = new Transactor(comps, First.make());
    send(transactor, DispatchPath.ofSteps([]), "swap");
    expect(transactor.state.val).toBeInstanceOf(Other);
    expect(transactor.state.val.label).toBe("next");
  });

  test("mutating and returning a replacement throws", () => {
    const Broken = component({
      name: "BrokenDraftReturn",
      fields: { value: 1 },
      receive: {
        broken(draft) {
          draft.value = 2;
          return { value: 3 };
        },
      },
    });
    const transactor = setup(Broken);
    transactor.pushSend(DispatchPath.ofSteps([]), "broken");
    expect(() => transactor.transactNext()).toThrow(/returned a new value.*modified its draft/i);
  });

  test("nested updates copy the path spine and preserve untouched siblings", () => {
    const Child = component({
      name: "DraftChild",
      fields: { count: 0 },
      receive: {
        increment(draft) {
          draft.count++;
        },
      },
    });
    const Root = component({ name: "DraftRoot", fields: { child: null, sibling: null } });
    const sibling = Object.freeze({ stable: true });
    const root = Root.make({ child: Child.make(), sibling });
    const comps = new Components();
    new ComponentStack(comps).registerComponents([Root, Child]);
    const transactor = new Transactor(comps, root);
    send(transactor, DispatchPath.ofSteps([new FieldStep("child")]), "increment");
    expect(transactor.state.val).not.toBe(root);
    expect(transactor.state.val.child.count).toBe(1);
    expect(transactor.state.val.sibling).toBe(sibling);
  });

  test("custom draftable sequences keep get/set path semantics", () => {
    class Keyed {
      static [immerable] = true;
      constructor(values = new Map()) {
        this.values = values;
      }
      get(key, fallback = null) {
        return this.values.has(key) ? this.values.get(key) : fallback;
      }
      set(key, value) {
        this.values.set(key, value);
      }
    }
    const Child = component({
      name: "CustomSeqChild",
      fields: { count: 0 },
      receive: {
        increment(draft) {
          draft.count++;
        },
      },
    });
    const Root = component({ name: "CustomSeqRoot", fields: { children: new Keyed() } });
    const root = Root.make({ children: new Keyed(new Map([["a", Child.make()]])) });
    const comps = new Components();
    new ComponentStack(comps).registerComponents([Root, Child]);
    const transactor = new Transactor(comps, root);
    send(transactor, DispatchPath.ofSteps([new SeqStep("children", "a")]), "increment");
    expect(transactor.state.val.children.get("a").count).toBe(1);
    expect(root.children.get("a").count).toBe(0);
  });
});
