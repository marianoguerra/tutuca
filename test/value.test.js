import { describe, expect, test } from "bun:test";
import { ConstVal, PredicateVal, StrTplVal, vp } from "../src/value.js";

// Minimal parse context: predicate parsing reports issues via px.onParseIssue.
const px = { frame: {}, onParseIssue() {} };

test("parse empty string", () => {
  const r = vp.parseText("flex flex-col gap-3 {.foo}");
  expect(r).toBeInstanceOf(StrTplVal);
  expect(r.vals.length).toBe(2);
  expect(r.vals[0].val).toBe("flex flex-col gap-3 ");
  expect(r.vals[1].name).toBe("foo");
});

test("if all constants then turn into a const", () => {
  const r = vp.parseText("flex flex-col gap-3 {'hi'}");
  expect(r).toBeInstanceOf(ConstVal);
  expect(r.val).toBe("flex flex-col gap-3 hi");
});

describe("string template quote requirements", () => {
  // parseText and parseMacroAttr accept the string-template kind, so templates
  // work there. parseBool, parseSequence and parseComponent do not.

  describe("no quotes needed: value contains {…} interpolation", () => {
    // The presence of { triggers VAL_SUB_TYPE_STRING_TEMPLATE in getValSubType.
    // StrTplVal.parse splits on {…} groups: text between them becomes ConstVal,
    // expressions inside braces are parsed via parseText.

    test("text with field interpolation", () => {
      const r = vp.parseText("flex gap-3 {.foo}");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals[0].val).toBe("flex gap-3 ");
      expect(r.vals[1].name).toBe("foo");
    });

    test("multiple interpolations", () => {
      // Empty ConstVal bookends are trimmed by StrTplVal.parse, so the
      // leading/trailing "" segments produced by the split don't appear in vals.
      const r = vp.parseText("{.a} between {.b}");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals.length).toBe(3);
      expect(r.vals[0].name).toBe("a");
      expect(r.vals[1].val).toBe(" between ");
      expect(r.vals[2].name).toBe("b");
    });

    test("only interpolation, no surrounding text", () => {
      // After trimming, a single-placeholder template collapses to one entry —
      // this is the shape the REDUNDANT_TEMPLATE_STRING lint rule keys off.
      const r = vp.parseText("{.foo}");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals.length).toBe(1);
      expect(r.vals[0].name).toBe("foo");
    });

    test("whitespace bookends are preserved (non-empty ConstVal)", () => {
      const r = vp.parseText(" {.foo} ");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals.length).toBe(3);
      expect(r.vals[0].val).toBe(" ");
      expect(r.vals[1].name).toBe("foo");
      expect(r.vals[2].val).toBe(" ");
    });
  });

  describe("all-const interpolations fold into ConstVal", () => {
    // When every part inside {…} resolves to a ConstVal, StrTplVal.parse
    // folds the whole thing into a single ConstVal (join of all parts).

    test("quoted constant inside braces", () => {
      const r = vp.parseText("flex {'gap-3'}");
      expect(r).toBeInstanceOf(ConstVal);
      expect(r.val).toBe("flex gap-3");
    });

    test("numeric constant inside braces", () => {
      const r = vp.parseText("width: {42}px");
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
      const r = vp.parseText("'flex gap-3'");
      expect(r).toBeInstanceOf(ConstVal);
      expect(r.val).toBe("flex gap-3");
    });

    test("quoted single word", () => {
      const r = vp.parseText("'badge'");
      expect(r).toBeInstanceOf(ConstVal);
      expect(r.val).toBe("badge");
    });

    test("unquoted multi-word string without braces returns null", () => {
      // No prefix, not a valid identifier, no braces → null
      const r = vp.parseText("flex gap-3");
      expect(r).toBeNull();
    });
  });

  describe("string-template kind absent: parse methods that reject templates", () => {
    // parseBool, parseSequence and parseComponent groups omit the
    // string-template kind, so template values return null in those contexts.

    test("parseBool rejects string template", () => {
      const r = vp.parseBool("flex {.foo}", px);
      expect(r).toBeNull();
    });

    test("parseBool rejects quoted constant", () => {
      const r = vp.parseBool("'flex gap-3'", px);
      expect(r).toBeNull();
    });

    test("parseSequence rejects string template", () => {
      const r = vp.parseSequence("items {.foo}");
      expect(r).toBeNull();
    });

    test("parseComponent rejects string template", () => {
      const r = vp.parseComponent("child {.foo}");
      expect(r).toBeNull();
    });
  });

  describe("parseMacroAttr accepts the string-template kind (macro dynamic attrs)", () => {
    test("string template works in parseMacroAttr", () => {
      const r = vp.parseMacroAttr("flex {.foo}");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals[0].val).toBe("flex ");
      expect(r.vals[1].name).toBe("foo");
    });

    test("quoted constant works in parseMacroAttr", () => {
      const r = vp.parseMacroAttr("'flex gap-3'");
      expect(r).toBeInstanceOf(ConstVal);
      expect(r.val).toBe("flex gap-3");
    });
  });
});

describe("boolean predicates in parseBool", () => {
  // A space-less value still parses as a plain G_BOOL value.
  test("space-less value is not a predicate", () => {
    const r = vp.parseBool(".items", px);
    expect(r).not.toBeInstanceOf(PredicateVal);
    expect(r.name).toBe("items");
  });

  for (const name of ["empty?", "truthy?", "falsy?", "null?"]) {
    test(`${name} parses to a PredicateVal`, () => {
      const r = vp.parseBool(`${name} .items`, px);
      expect(r).toBeInstanceOf(PredicateVal);
      expect(r.pred.name).toBe(name);
      expect(r.args.length).toBe(1);
      expect(r.args[0].name).toBe("items");
    });
  }

  test("unknown predicate returns null", () => {
    expect(vp.parseBool("present? .items", px)).toBeNull();
  });

  test("arity mismatch returns null", () => {
    expect(vp.parseBool("empty? .a .b", px)).toBeNull();
  });

  test("bad predicate arg returns null", () => {
    // `Foo` is a type name — not allowed in the G_BOOL group used for args.
    expect(vp.parseBool("empty? Foo", px)).toBeNull();
  });

  test("predicate args accept bind values", () => {
    const r = vp.parseBool("truthy? @flag", px);
    expect(r).toBeInstanceOf(PredicateVal);
    expect(r.args[0].name).toBe("flag");
  });

  test("predicate eval applies the function", () => {
    const stack = { lookupField: (n) => ({ items: [], name: "hi" })[n] };
    expect(vp.parseBool("empty? .items", px).eval(stack)).toBe(true);
    expect(vp.parseBool("empty? .name", px).eval(stack)).toBe(false);
    expect(vp.parseBool("truthy? .name", px).eval(stack)).toBe(true);
    expect(vp.parseBool("falsy? .items", px).eval(stack)).toBe(true);
    expect(vp.parseBool("null? .items", px).eval(stack)).toBe(false);
  });
});
