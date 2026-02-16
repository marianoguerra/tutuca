import { Dynamic, DynamicAlias } from "../src/components.js";
import { dynamicsToData, dynamicToData, valToString } from "../src/meta/datacomp.js";
import {
  BindVal,
  ComputedVal,
  DynVal,
  FieldVal,
  NameVal,
  RawFieldVal,
  RequestVal,
  TypeVal,
} from "../src/value.js";
import { describe, expect, test } from "bun:test";

describe("datacomp", () => {
  test("valToString", () => {
    expect(valToString(new FieldVal("foo"))).toBe(".foo");
    expect(valToString(new RawFieldVal("foo"))).toBe(".foo");
    expect(valToString(new BindVal("foo"))).toBe("@foo");
    expect(valToString(new DynVal("foo"))).toBe("^foo");
    expect(valToString(new ComputedVal("foo"))).toBe("$foo");
    expect(valToString(new RequestVal("foo"))).toBe("!foo");
    expect(valToString(new TypeVal("Foo"))).toBe("Foo");
    expect(valToString(new NameVal("foo"))).toBe("foo");
  });
  test("dynamicToData", () => {
    expect(dynamicToData(new Dynamic("foo", new FieldVal("foo"), Symbol("foo")))).toEqual(".foo");
    expect(dynamicToData(new DynamicAlias("foo", new FieldVal("foo"), "Foo", "bar"))).toEqual({
      for: "Foo.bar",
      default: ".foo",
    });
  });
  test("dynamicsToData", () => {
    expect(
      dynamicsToData({
        foo: new Dynamic("foo", new FieldVal("foo"), Symbol("foo")),
        bar: new DynamicAlias("bar", new FieldVal("argh"), "Bar", "baz"),
      }),
    ).toEqual({ foo: ".foo", bar: { for: "Bar.baz", default: ".argh" } });
  });
});
