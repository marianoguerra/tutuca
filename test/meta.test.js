import { describe, expect, test } from "bun:test";
import { LookupInfo, ProvideInfo } from "../src/components.js";
import { lookupToData, provideToData, valToString } from "../src/meta/datacomp.js";
import {
  BindVal,
  DynVal,
  FieldVal,
  NameVal,
  MethodVal,
  RequestVal,
  TypeVal,
} from "../src/value.js";

describe("datacomp", () => {
  test("valToString", () => {
    expect(valToString(new FieldVal("foo"))).toBe(".foo");
    expect(valToString(new MethodVal("foo"))).toBe("$foo");
    expect(valToString(new BindVal("foo"))).toBe("@foo");
    expect(valToString(new DynVal("foo"))).toBe("*foo");
    expect(valToString(new RequestVal("foo"))).toBe("!foo");
    expect(valToString(new TypeVal("Foo"))).toBe("Foo");
    expect(valToString(new NameVal("foo"))).toBe("foo");
  });
  test("provideToData", () => {
    expect(
      provideToData({
        foo: new ProvideInfo("foo", new FieldVal("foo"), Symbol("foo")),
        bar: new ProvideInfo("bar", new MethodVal("baz"), Symbol("bar")),
      }),
    ).toEqual({ foo: ".foo", bar: "$baz" });
  });
  test("lookupToData", () => {
    expect(
      lookupToData({
        withDefault: new LookupInfo("withDefault", "Foo", "bar", new FieldVal("foo")),
        noDefault: new LookupInfo("noDefault", "Bar", "baz", null),
      }),
    ).toEqual({ withDefault: { for: "Foo.bar", default: ".foo" }, noDefault: "Bar.baz" });
  });
});
