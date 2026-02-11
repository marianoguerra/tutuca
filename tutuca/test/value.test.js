import { expect, test } from "bun:test";
import { ConstVal, StrTplVal, vp } from "../src/value.js";

test("parse empty string", () => {
  const r = vp.parseAttr("flex flex-col gap-3 {.foo}");
  expect(r).toBeInstanceOf(StrTplVal);
  expect(r.vals[0].value).toBe("flex flex-col gap-3 ");
  expect(r.vals[1].name).toBe("foo");
  expect(r.vals[2].value).toBe("");
});

test("if all constants then turn into a const", () => {
  const r = vp.parseAttr("flex flex-col gap-3 {'hi'}");
  expect(r).toBeInstanceOf(ConstVal);
  expect(r.value).toBe("flex flex-col gap-3 hi");
});
