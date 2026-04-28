import { describe, expect, test } from "bun:test";
import { ConstVal, StrTplVal, vp } from "../src/value.js";

test("parse empty string", () => {
  const r = vp.parseAttr("flex flex-col gap-3 {.foo}");
  expect(r).toBeInstanceOf(StrTplVal);
  expect(r.vals[0].val).toBe("flex flex-col gap-3 ");
  expect(r.vals[1].name).toBe("foo");
  expect(r.vals[2].val).toBe("");
});

test("if all constants then turn into a const", () => {
  const r = vp.parseAttr("flex flex-col gap-3 {'hi'}");
  expect(r).toBeInstanceOf(ConstVal);
  expect(r.val).toBe("flex flex-col gap-3 hi");
});

describe("string template quote requirements", () => {
  // parseText/parseAttr enable okStrTpl, so string templates work there.
  // parseCondValue, parseEach, parseRender do NOT enable okStrTpl.

  describe("no quotes needed: value contains {…} interpolation", () => {
    // The presence of { triggers VAL_SUB_TYPE_STRING_TEMPLATE in getValSubType.
    // StrTplVal.parse splits on {…} groups: text between them becomes ConstVal,
    // expressions inside braces are parsed via parseText.

    test("text with field interpolation", () => {
      const r = vp.parseAttr("flex gap-3 {.foo}");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals[0].val).toBe("flex gap-3 ");
      expect(r.vals[1].name).toBe("foo");
    });

    test("multiple interpolations", () => {
      const r = vp.parseAttr("{.a} between {.b}");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals[0].val).toBe("");
      expect(r.vals[1].name).toBe("a");
      expect(r.vals[2].val).toBe(" between ");
      expect(r.vals[3].name).toBe("b");
    });

    test("only interpolation, no surrounding text", () => {
      const r = vp.parseAttr("{.foo}");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals[0].val).toBe("");
      expect(r.vals[1].name).toBe("foo");
    });
  });

  describe("all-const interpolations fold into ConstVal", () => {
    // When every part inside {…} resolves to a ConstVal, StrTplVal.parse
    // folds the whole thing into a single ConstVal (join of all parts).

    test("quoted constant inside braces", () => {
      const r = vp.parseAttr("flex {'gap-3'}");
      expect(r).toBeInstanceOf(ConstVal);
      expect(r.val).toBe("flex gap-3");
    });

    test("numeric constant inside braces", () => {
      const r = vp.parseAttr("width: {42}px");
      expect(r).toBeInstanceOf(ConstVal);
      expect(r.val).toBe("width: 42px");
    });
  });

  describe("single quotes required: constant string without {…}", () => {
    // Without braces, getValSubType returns -1 (no match) and the parser
    // falls through to the charCode switch. A plain multi-word string like
    // "flex gap-3" doesn't start with a recognized prefix (./$/@/*/etc.)
    // and isn't a valid identifier, so it returns null.
    // Single quotes (charCode 39) tell the parser to treat it as ConstVal.

    test("quoted constant string with spaces", () => {
      const r = vp.parseAttr("'flex gap-3'");
      expect(r).toBeInstanceOf(ConstVal);
      expect(r.val).toBe("flex gap-3");
    });

    test("quoted single word", () => {
      const r = vp.parseAttr("'badge'");
      expect(r).toBeInstanceOf(ConstVal);
      expect(r.val).toBe("badge");
    });

    test("unquoted multi-word string without braces returns null", () => {
      // No prefix, not a valid identifier, no braces → null
      const r = vp.parseAttr("flex gap-3");
      expect(r).toBeNull();
    });
  });

  describe("okStrTpl disabled: parse methods that reject string templates", () => {
    // parseCondValue, parseEach, parseRender never set okStrTpl = true,
    // so string template values return null in those contexts.

    test("parseCondValue rejects string template", () => {
      const r = vp.parseCondValue("flex {.foo}");
      expect(r).toBeNull();
    });

    test("parseCondValue rejects quoted constant", () => {
      const r = vp.parseCondValue("'flex gap-3'");
      expect(r).toBeNull();
    });

    test("parseEach rejects string template", () => {
      const r = vp.parseEach("items {.foo}");
      expect(r).toBeNull();
    });

    test("parseRender rejects string template", () => {
      const r = vp.parseRender("child {.foo}");
      expect(r).toBeNull();
    });
  });

  describe("parseAll enables okStrTpl (macro dynamic attrs)", () => {
    test("string template works in parseAll", () => {
      const r = vp.parseAll("flex {.foo}");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals[0].val).toBe("flex ");
      expect(r.vals[1].name).toBe("foo");
    });

    test("quoted constant works in parseAll", () => {
      const r = vp.parseAll("'flex gap-3'");
      expect(r).toBeInstanceOf(ConstVal);
      expect(r.val).toBe("flex gap-3");
    });
  });
});
