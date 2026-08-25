import { describe, expect, test, vi } from "vitest";
import { produce } from "../src/immer.js";
import {
  classFromData,
  FieldBool,
  FieldFloat,
  FieldInt,
  FieldList,
  FieldMap,
  FieldObject,
  FieldSet,
  FieldString,
  validateDraftFields,
} from "../src/oo.js";

describe("native field descriptors", () => {
  test.each([
    [FieldString, "text", "", "hello"],
    [FieldInt, "int", 0, 4],
    [FieldFloat, "float", 0, 2.5],
    [FieldBool, "bool", false, true],
  ])("%p validates its native scalar", (FieldClass, type, defaultValue, sample) => {
    const field = new FieldClass("value");
    expect(field.type).toBe(type);
    expect(field.defaultValue).toEqual(defaultValue);
    expect(field.isValid(sample)).toBe(true);
  });

  test("collection fields use native values", () => {
    expect(new FieldList("items").isValid([])).toBe(true);
    expect(new FieldObject("data").isValid({ a: 1 })).toBe(true);
    expect(new FieldMap("byId").isValid(new Map())).toBe(true);
    expect(new FieldSet("selected").isValid(new Set())).toBe(true);
  });
});

describe("classFromData", () => {
  test("infers native field types and freezes component state", () => {
    const Model = classFromData("Model", {
      fields: {
        count: 0,
        ratio: 0.5,
        title: "",
        enabled: false,
        items: [],
        data: {},
        byId: new Map(),
        selected: new Set(),
      },
    });
    const value = Model.make({
      items: [1],
      data: { ok: true },
      byId: new Map([["a", 1]]),
      selected: new Set(["a"]),
    });
    const fields = Model.getMetaClass().fields;
    expect(Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.type]))).toEqual({
      count: "float",
      ratio: "float",
      title: "text",
      enabled: "bool",
      items: "list",
      data: "object",
      byId: "map",
      selected: "set",
    });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.items)).toBe(true);
  });

  test("component classes are Immer draftable and preserve their prototype", () => {
    const Counter = classFromData("Counter", {
      fields: { count: 0 },
      methods: {
        doubled() {
          return this.count * 2;
        },
      },
    });
    const before = Counter.make();
    const after = produce(before, (draft) => {
      draft.count++;
    });
    expect(after).toBeInstanceOf(Counter);
    expect(after.doubled()).toBe(2);
    expect(before.count).toBe(0);
  });

  test("make coerces invalid constructor inputs to field defaults", () => {
    const Model = classFromData("Model", {
      fields: { count: { type: "int", defaultValue: 0 }, items: [] },
    });
    const value = Model.make({ count: 3.5, items: "bad" });
    expect(value.count).toBe(3);
    expect(value.items).toEqual([]);
  });

  // A whole-number default can't mean "int": `0.0` IS `0` in JS, so inferring
  // int from it truncated every fractional value ever assigned to the field.
  // The shorthand is float; truncation is opt-in through the descriptor form.
  test("a whole-number default infers float and keeps fractional values", () => {
    const Model = classFromData("Model", {
      fields: { price: 0, rounded: { type: "int", defaultValue: 0 } },
    });
    expect(Model.getMetaClass().fields.price.type).toBe("float");
    const value = Model.make({ price: 3.14, rounded: 3.14 });
    expect(value.price).toBe(3.14);
    expect(value.rounded).toBe(3);
  });

  test("draft validation coerces assignments and rejects invalid values", () => {
    const Model = classFromData("Model", {
      fields: { count: { type: "int", defaultValue: 0 }, ratio: 1.5 },
    });
    const before = Model.make({ count: 2 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const after = produce(before, (draft) => {
      draft.count = 4.8;
      draft.ratio = Infinity;
      validateDraftFields(before, draft);
    });
    expect(after.count).toBe(4);
    expect(after.ratio).toBe(1.5);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  test("no generated setters or collection mutators are exposed", () => {
    const Model = classFromData("Model", { fields: { count: 0, items: [] } });
    const value = Model.make();
    expect(value.setCount).toBeUndefined();
    expect(value.pushInItems).toBeUndefined();
  });
});
