import { expect, test } from "bun:test";
import { Set as ISet } from "../deps/immutable.js";
import { classFromData, FieldSet, fieldsByTypeName } from "../src/oo.js";

test("FieldSet is registered in fieldsByTypeName", () => {
  expect(fieldsByTypeName.set).toBe(FieldSet);
});

test("FieldSet validates ISet values", () => {
  const f = new FieldSet("tags");
  expect(f.isValid(ISet())).toBe(true);
  expect(f.isValid(ISet([1, 2, 3]))).toBe(true);
  expect(f.isValid([1, 2, 3])).toBe(false);
  expect(f.isValid("nope")).toBe(false);
});

test("FieldSet coerces arrays to ISet", () => {
  const f = new FieldSet("tags");
  const result = f.coerceOr([1, 2, 3]);
  expect(ISet.isSet(result)).toBe(true);
  expect(result.size).toBe(3);
});

test("FieldSet coerces native Set to ISet", () => {
  const f = new FieldSet("tags");
  const result = f.coerceOr(new Set(["a", "b"]));
  expect(ISet.isSet(result)).toBe(true);
  expect(result.size).toBe(2);
  expect(result.has("a")).toBe(true);
});

test("FieldSet default value is empty ISet", () => {
  const f = new FieldSet("tags");
  expect(ISet.isSet(f.defaultValue)).toBe(true);
  expect(f.defaultValue.size).toBe(0);
});

test("classFromData detects native Set and creates FieldSet", () => {
  const Cls = classFromData("WithSet", {
    fields: { tags: new Set(["a", "b"]) },
  });
  const inst = Cls();
  expect(ISet.isSet(inst.get("tags"))).toBe(true);
  expect(inst.get("tags").has("a")).toBe(true);
});

test("classFromData detects ISet and creates FieldSet", () => {
  const Cls = classFromData("WithISet", {
    fields: { tags: ISet(["x", "y"]) },
  });
  const inst = Cls();
  expect(ISet.isSet(inst.get("tags"))).toBe(true);
  expect(inst.get("tags").size).toBe(2);
});

test("classFromData with type descriptor for set", () => {
  const Cls = classFromData("WithSetType", {
    fields: { tags: { type: "set", defaultValue: ["a"] } },
  });
  const inst = Cls();
  expect(ISet.isSet(inst.get("tags"))).toBe(true);
  expect(inst.get("tags").has("a")).toBe(true);
});

test("proto: tagsIsEmpty and tagsLen", () => {
  const Cls = classFromData("SetSize", { fields: { tags: ISet() } });
  const empty = Cls();
  expect(empty.tagsIsEmpty()).toBe(true);
  expect(empty.tagsLen()).toBe(0);

  const withItems = empty.setTags(ISet([1, 2]));
  expect(withItems.tagsIsEmpty()).toBe(false);
  expect(withItems.tagsLen()).toBe(2);
});

test("proto: addInTags", () => {
  const Cls = classFromData("SetAdd", { fields: { tags: ISet() } });
  const inst = Cls();
  const r = inst.addInTags("hello");
  expect(r.get("tags").has("hello")).toBe(true);
  expect(r.tagsLen()).toBe(1);
});

test("proto: addInTags deduplicates", () => {
  const Cls = classFromData("SetDedup", { fields: { tags: ISet() } });
  const inst = Cls().addInTags("a").addInTags("a").addInTags("b");
  expect(inst.tagsLen()).toBe(2);
});

test("proto: deleteInTags / removeInTags", () => {
  const Cls = classFromData("SetDel", { fields: { tags: ISet([1, 2, 3]) } });
  const inst = Cls();
  const r = inst.deleteInTags(2);
  expect(r.get("tags").has(2)).toBe(false);
  expect(r.tagsLen()).toBe(2);

  const r2 = inst.removeInTags(3);
  expect(r2.get("tags").has(3)).toBe(false);
});

test("proto: hasInTags", () => {
  const Cls = classFromData("SetHas", { fields: { tags: ISet(["a", "b"]) } });
  const inst = Cls();
  expect(inst.hasInTags("a")).toBe(true);
  expect(inst.hasInTags("z")).toBe(false);
});

test("proto: setTags coerces array", () => {
  const Cls = classFromData("SetCoerce", { fields: { tags: ISet() } });
  const inst = Cls();
  const r = inst.setTags([1, 2, 3]);
  expect(ISet.isSet(r.get("tags"))).toBe(true);
  expect(r.tagsLen()).toBe(3);
});

test("proto: resetTags", () => {
  const Cls = classFromData("SetReset", { fields: { tags: ISet() } });
  const inst = Cls().addInTags("a").addInTags("b");
  expect(inst.tagsLen()).toBe(2);
  const r = inst.resetTags();
  expect(r.tagsLen()).toBe(0);
});

test("proto: toggleInTags adds value when not present", () => {
  const Cls = classFromData("SetToggle", { fields: { tags: ISet() } });
  const inst = Cls();
  const r = inst.toggleInTags("foo");
  expect(r.hasInTags("foo")).toBe(true);
});

test("proto: toggleInTags removes value when present", () => {
  const Cls = classFromData("SetToggle", { fields: { tags: ISet() } });
  const inst = Cls().addInTags("foo");
  expect(inst.hasInTags("foo")).toBe(true);
  const r = inst.toggleInTags("foo");
  expect(r.hasInTags("foo")).toBe(false);
});

test("proto: toggleInTags round trip", () => {
  const Cls = classFromData("SetToggle", { fields: { tags: ISet() } });
  const inst = Cls();
  const step1 = inst.toggleInTags("bar");
  expect(step1.hasInTags("bar")).toBe(true);
  const step2 = step1.toggleInTags("bar");
  expect(step2.hasInTags("bar")).toBe(false);
});
