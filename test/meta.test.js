import { describe, expect, test } from "bun:test";
import { LookupInfo, ProvideInfo } from "../src/components.js";
import { lookupToData, provideToData } from "../src/meta/datacomp.js";
import { FieldVal, MethodVal } from "../src/value.js";

describe("datacomp", () => {
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
