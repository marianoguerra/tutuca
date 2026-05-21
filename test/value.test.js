import { describe, expect, test } from "bun:test";
import { EventHandler } from "../src/attribute.js";
import {
  ConstVal,
  FieldVal,
  HandlerNameVal,
  MethodVal,
  PredicateVal,
  SeqAccessVal,
  StrTplVal,
  tokenizeValue,
  vp,
} from "../src/value.js";

// Minimal parse context: predicate parsing reports issues via px.onParseIssue.
const px = { frame: {}, onParseIssue() {} };

test("string template with interpolation", () => {
  const r = vp.parseText("$'flex flex-col gap-3 {.foo}'");
  expect(r).toBeInstanceOf(StrTplVal);
  expect(r.vals.length).toBe(2);
  expect(r.vals[0].val).toBe("flex flex-col gap-3 ");
  expect(r.vals[1].name).toBe("foo");
});

test("constant-only template stays a StrTplVal", () => {
  // A `$'…'` whose every part is constant is no longer folded to a ConstVal —
  // it stays a StrTplVal so the linter can flag it. toLiteralSource() gives
  // the equivalent plain string literal.
  const r = vp.parseText("$'flex flex-col gap-3 {\\'hi\\'}'");
  expect(r).toBeInstanceOf(StrTplVal);
  expect(r.toLiteralSource()).toBe("'flex flex-col gap-3 hi'");
  expect(r.eval(null)).toBe("flex flex-col gap-3 hi");
});

describe("string template syntax", () => {
  // parseText and parseMacroAttr accept the string-template kind, so `$'…'`
  // templates work there. parseBool, parseSequence and parseComponent do not.

  describe("$'…' templates with {…} interpolation", () => {
    // A `$'…'` token is parsed by StrTplVal.parse: it splits the interior on
    // {…} groups — text between them becomes ConstVal, expressions inside
    // braces are parsed via parseText.

    test("text with field interpolation", () => {
      const r = vp.parseText("$'flex gap-3 {.foo}'");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals[0].val).toBe("flex gap-3 ");
      expect(r.vals[1].name).toBe("foo");
    });

    test("multiple interpolations", () => {
      // Empty ConstVal bookends are trimmed by StrTplVal.parse, so the
      // leading/trailing "" segments produced by the split don't appear in vals.
      const r = vp.parseText("$'{.a} between {.b}'");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals.length).toBe(3);
      expect(r.vals[0].name).toBe("a");
      expect(r.vals[1].val).toBe(" between ");
      expect(r.vals[2].name).toBe("b");
    });

    test("only interpolation, no surrounding text", () => {
      // After trimming, a single-placeholder template collapses to one entry —
      // this is the shape the REDUNDANT_TEMPLATE_STRING lint rule keys off.
      const r = vp.parseText("$'{.foo}'");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals.length).toBe(1);
      expect(r.vals[0].name).toBe("foo");
    });

    test("whitespace bookends are preserved (non-empty ConstVal)", () => {
      const r = vp.parseText("$' {.foo} '");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals.length).toBe(3);
      expect(r.vals[0].val).toBe(" ");
      expect(r.vals[1].name).toBe("foo");
      expect(r.vals[2].val).toBe(" ");
    });
  });

  describe("constant-only templates stay StrTplVal", () => {
    // When every part inside {…} resolves to a ConstVal the template is just a
    // string literal written the long way, but StrTplVal.parse keeps it a
    // StrTplVal (not folded) so the linter can flag it. toLiteralSource()
    // returns the equivalent plain string literal.

    test("quoted constant inside braces", () => {
      const r = vp.parseText("$'flex {\\'gap-3\\'}'");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.toLiteralSource()).toBe("'flex gap-3'");
      expect(r.eval(null)).toBe("flex gap-3");
    });

    test("numeric constant inside braces", () => {
      const r = vp.parseText("$'width: {42}px'");
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.toLiteralSource()).toBe("'width: 42px'");
      expect(r.eval(null)).toBe("width: 42px");
    });
  });

  describe("plain '…' string literals", () => {
    // A bare multi-word run like `flex gap-3` is two tokens, not a value, so
    // it returns null. A single-quoted `'…'` literal carries spaces verbatim.

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

    test("unquoted multi-word string returns null", () => {
      const r = vp.parseText("flex gap-3");
      expect(r).toBeNull();
    });

    test("legacy unquoted {…} template returns null", () => {
      expect(vp.parseText("flex {.foo}", px)).toBeNull();
      expect(vp.parseText("{.foo}", px)).toBeNull();
    });
  });

  describe("string-template kind absent: parse methods that reject templates", () => {
    // parseBool, parseSequence and parseComponent groups omit the
    // string-template kind, so `$'…'` values return null in those contexts.

    test("parseBool rejects string template", () => {
      const r = vp.parseBool("$'flex {.foo}'", px);
      expect(r).toBeNull();
    });

    test("parseBool rejects quoted constant", () => {
      const r = vp.parseBool("'flex gap-3'", px);
      expect(r).toBeNull();
    });

    test("parseSequence rejects string template", () => {
      const r = vp.parseSequence("$'items {.foo}'", px);
      expect(r).toBeNull();
    });

    test("parseComponent rejects string template", () => {
      const r = vp.parseComponent("$'child {.foo}'", px);
      expect(r).toBeNull();
    });
  });

  describe("parseMacroAttr accepts the string-template kind (macro dynamic attrs)", () => {
    test("string template works in parseMacroAttr", () => {
      const r = vp.parseMacroAttr("$'flex {.foo}'", px);
      expect(r).toBeInstanceOf(StrTplVal);
      expect(r.vals[0].val).toBe("flex ");
      expect(r.vals[1].name).toBe("foo");
    });

    test("quoted constant works in parseMacroAttr", () => {
      const r = vp.parseMacroAttr("'flex gap-3'", px);
      expect(r).toBeInstanceOf(ConstVal);
      expect(r.val).toBe("flex gap-3");
    });
  });
});

describe("boolean predicates in parseBool", () => {
  // A single-token value still parses as a plain G_BOOL value.
  test("single-token value is not a predicate", () => {
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
    // `Foo` is a type name — not allowed in the G_PRED_ARG group used for args.
    expect(vp.parseBool("empty? Foo", px)).toBeNull();
  });

  test("predicate args accept bind values", () => {
    const r = vp.parseBool("truthy? @flag", px);
    expect(r).toBeInstanceOf(PredicateVal);
    expect(r.args[0].name).toBe("flag");
  });

  test("predicate eval applies the function", () => {
    const stack = { lookupFieldRaw: (n) => ({ items: [], name: "hi" })[n] };
    expect(vp.parseBool("empty? .items", px).eval(stack)).toBe(true);
    expect(vp.parseBool("empty? .name", px).eval(stack)).toBe(false);
    expect(vp.parseBool("truthy? .name", px).eval(stack)).toBe(true);
    expect(vp.parseBool("falsy? .items", px).eval(stack)).toBe(true);
    expect(vp.parseBool("null? .items", px).eval(stack)).toBe(false);
  });
});

describe("$ method prefix vs . field prefix", () => {
  test(". parses to a FieldVal", () => {
    const r = vp.parseText(".count");
    expect(r).toBeInstanceOf(FieldVal);
    expect(r.name).toBe("count");
    expect(r.toString()).toBe(".count");
  });

  test("$ parses to a MethodVal", () => {
    const r = vp.parseText("$fullName");
    expect(r).toBeInstanceOf(MethodVal);
    expect(r.name).toBe("fullName");
    expect(r.toString()).toBe("$fullName");
  });

  test("$' is a string template, not a method", () => {
    const r = vp.parseText("$'hi {.name}'");
    expect(r).toBeInstanceOf(StrTplVal);
    expect(vp.parseText("$name")).toBeInstanceOf(MethodVal);
  });

  test("$ works as a conditional-slot value", () => {
    expect(vp.parseBool("$canSubmit", px)).toBeInstanceOf(MethodVal);
  });

  test("$ is rejected in path-bearing slots (@each, <x render>)", () => {
    // A method result has no addressable path, so it cannot be iterated or
    // rendered as a child — `.field` stays valid there.
    expect(vp.parseSequence("$items", px)).toBeNull();
    expect(vp.parseComponent("$child", px)).toBeNull();
    expect(vp.parseSequence(".items", px)).toBeInstanceOf(FieldVal);
  });

  test("FieldVal.eval reads the raw field without invoking", () => {
    const fn = () => "called";
    const stack = { lookupFieldRaw: (n) => ({ count: 7, m: fn })[n] };
    expect(vp.parseText(".count").eval(stack)).toBe(7);
    expect(vp.parseText(".m").eval(stack)).toBe(fn);
  });

  test("MethodVal.eval invokes the method", () => {
    const stack = { lookupMethod: (n) => ({ fullName: "Ada L" })[n] };
    expect(vp.parseText("$fullName").eval(stack)).toBe("Ada L");
  });

  test("MethodVal.evalAsHandler hands back the raw function", () => {
    const fn = function () {};
    const stack = { lookupFieldRaw: (n) => ({ inc: fn })[n] };
    expect(vp.parseText("$inc").evalAsHandler(stack)).toBe(fn);
  });

  test("$ is a method handler, a bare name is an input handler", () => {
    expect(vp.parseInputHandler("$inc", px).handlerVal).toBeInstanceOf(MethodVal);
    expect(vp.parseInputHandler("dec", px).handlerVal).toBeInstanceOf(HandlerNameVal);
  });

  test(". cannot be used in handler position", () => {
    expect(vp.parseInputHandler(".inc", px)).toBeNull();
  });

  test("$ method handler keeps its args", () => {
    const h = EventHandler.parse("$setStr value", px);
    expect(h.handlerVal).toBeInstanceOf(MethodVal);
    expect(h.handlerVal.name).toBe("setStr");
    expect(h.args.length).toBe(1);
  });
});

describe("tokenizeValue", () => {
  test("splits on whitespace", () => {
    expect(tokenizeValue("equals? .view detail")).toEqual(["equals?", ".view", "detail"]);
  });

  test("keeps a quoted literal with spaces as one token", () => {
    expect(tokenizeValue("equals? .name 'John Doe'")).toEqual(["equals?", ".name", "'John Doe'"]);
  });

  test("keeps an escaped quote inside the token", () => {
    expect(tokenizeValue("equals? .name 'it\\'s here'")).toEqual([
      "equals?",
      ".name",
      "'it\\'s here'",
    ]);
  });

  test("keeps a $'…' template as a single token", () => {
    expect(tokenizeValue("$'a {.b} c' .d")).toEqual(["$'a {.b} c'", ".d"]);
  });

  test("empty string yields no tokens", () => {
    expect(tokenizeValue("")).toEqual([]);
  });
});

describe("equals? predicate with string literals", () => {
  test("parses to a PredicateVal with a ConstVal string arg", () => {
    const r = vp.parseBool("equals? .view 'detail'", px);
    expect(r).toBeInstanceOf(PredicateVal);
    expect(r.pred.name).toBe("equals?");
    expect(r.args.length).toBe(2);
    expect(r.args[0].name).toBe("view");
    expect(r.args[1]).toBeInstanceOf(ConstVal);
    expect(r.args[1].val).toBe("detail");
  });

  test("string literal arg preserves interior spaces", () => {
    const r = vp.parseBool("equals? .name 'John Doe'", px);
    expect(r.args.length).toBe(2);
    expect(r.args[1]).toBeInstanceOf(ConstVal);
    expect(r.args[1].val).toBe("John Doe");
  });

  test("escaped quote in a string literal arg", () => {
    const r = vp.parseBool("equals? .name 'it\\'s'", px);
    expect(r.args[1]).toBeInstanceOf(ConstVal);
    expect(r.args[1].val).toBe("it's");
  });

  test("eval compares the field value against the literal", () => {
    const stack = { lookupFieldRaw: (n) => ({ view: "detail" })[n] };
    expect(vp.parseBool("equals? .view 'detail'", px).eval(stack)).toBe(true);
    expect(vp.parseBool("equals? .view 'list'", px).eval(stack)).toBe(false);
  });

  test("arity mismatch returns null", () => {
    expect(vp.parseBool("equals? .view", px)).toBeNull();
  });

  test("toString round-trips a quoted literal", () => {
    expect(vp.parseBool("equals? .view 'detail'", px).toString()).toBe("equals? .view 'detail'");
  });

  // String literals are still rejected in a plain conditional slot (G_BOOL):
  // only predicate args (and handler args) accept them.
  test("bare string literal in parseBool still returns null", () => {
    expect(vp.parseBool("'detail'", px)).toBeNull();
  });
});

describe("parseField (dynamic field definitions and defaults)", () => {
  test("accepts a field reference", () => {
    expect(vp.parseField(".color", px)).toBeInstanceOf(FieldVal);
  });

  test("accepts a method reference", () => {
    expect(vp.parseField("$color", px)).toBeInstanceOf(MethodVal);
  });

  test("accepts a string-literal constant (dynamic alias default)", () => {
    const r = vp.parseField("'gray'", px);
    expect(r).toBeInstanceOf(ConstVal);
    expect(r.val).toBe("gray");
  });

  test("accepts a numeric constant", () => {
    const r = vp.parseField("42", px);
    expect(r).toBeInstanceOf(ConstVal);
    expect(r.val).toBe(42);
  });

  test("accepts a .seq[.key] seq-access", () => {
    const r = vp.parseField(".sheets[.selId]", px);
    expect(r).toBeInstanceOf(SeqAccessVal);
    expect(r.seqVal.name).toBe("sheets");
    expect(r.keyVal.name).toBe("selId");
  });

  test("seq-access toPathItem yields a SeqAccessStep", () => {
    const step = vp.parseField(".sheets[.selId]", px).toPathItem();
    expect(step.seqField).toBe("sheets");
    expect(step.keyField).toBe("selId");
  });
});

describe("string literals as event-handler args", () => {
  test("handler arg accepts a quoted literal with spaces", () => {
    const handler = EventHandler.parse("showView 'detail mode'", px);
    expect(handler).not.toBeNull();
    expect(handler.args.length).toBe(1);
    expect(handler.args[0]).toBeInstanceOf(ConstVal);
    expect(handler.args[0].val).toBe("detail mode");
  });
});
