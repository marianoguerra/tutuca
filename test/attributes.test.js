import { expect, test } from "bun:test";
import { ParseContext } from "../src/anode.js";
import { ConstAttrs, DynAttrs, getAttrParser } from "../src/attribute.js";
import {
  BindVal,
  ConstVal,
  DynVal,
  FieldVal,
  NameVal,
  RequestVal,
  SeqAccessVal,
  TypeVal,
} from "../src/value.js";
import { DOMParser } from "./dom.js";

const html = String.raw;

const mpx = () => new ParseContext();

const domParser = new DOMParser();
function parseAttrs(html, px = mpx()) {
  const attrs = domParser.parseFromString(html, "text/html").body.childNodes[0].attributes;
  return getAttrParser(px).parse(attrs, true);
}

test("parse empty attrs", () => {
  const [nAttrs, wrapperAttrs, textChild] = parseAttrs(`<p></p>`);
  expect(nAttrs).toBeInstanceOf(ConstAttrs);
  expect(wrapperAttrs).toBe(null);
  expect(textChild).toBe(null);
});

test("parse constant attr", () => {
  const [nAttrs] = parseAttrs(`<p class="foo"></p>`);
  expect(nAttrs).toBeInstanceOf(ConstAttrs);
  expect(Object.entries(nAttrs.items)).toEqual([["class", "foo"]]);
});

test("parse constant attr in dynamic", () => {
  const [nAttrs] = parseAttrs(`<p class="foo" :id="'bar'"></p>`);
  expect(nAttrs).toBeInstanceOf(ConstAttrs);
  expect(Object.entries(nAttrs.items)).toEqual([
    ["class", "foo"],
    ["id", "bar"],
  ]);
});

test("parse dyn attrs", () => {
  const [nAttrs] = parseAttrs(
    html`<p
      :name="foo"
      :type="Foo"
      :bool="false"
      :num="42"
      :str="'hi'"
      :field=".bar"
      :bind="@key"
      :req="!do"
      :seq=".a[.b]"
      :dyn="*dynamic"
    ></p>`,
  );
  expect(nAttrs).toBeInstanceOf(DynAttrs);
  const [name, type, bool, num, str, field, bind, req, seq, dyn] = nAttrs.items;
  expect(name.name).toBe("name");
  expect(name.val).toBeInstanceOf(NameVal);
  expect(name.val.name).toBe("foo");
  expect(name.val.toString()).toBe("foo");

  expect(type.name).toBe("type");
  expect(type.val).toBeInstanceOf(TypeVal);
  expect(type.val.name).toBe("Foo");
  expect(type.val.toString()).toBe("Foo");

  expect(bool.name).toBe("bool");
  expect(bool.val).toBeInstanceOf(ConstVal);
  expect(bool.val.val).toBe(false);
  expect(bool.val.toString()).toBe("false");

  expect(num.name).toBe("num");
  expect(num.val).toBeInstanceOf(ConstVal);
  expect(num.val.val).toBe(42);
  expect(num.val.toString()).toBe("42");

  expect(str.name).toBe("str");
  expect(str.val).toBeInstanceOf(ConstVal);
  expect(str.val.val).toBe("hi");
  expect(str.val.toString()).toBe("'hi'");

  expect(field.name).toBe("field");
  expect(field.val).toBeInstanceOf(FieldVal);
  expect(field.val.name).toBe("bar");
  expect(field.val.toString()).toBe(".bar");

  expect(bind.name).toBe("bind");
  expect(bind.val).toBeInstanceOf(BindVal);
  expect(bind.val.name).toBe("key");
  expect(bind.val.toString()).toBe("@key");

  expect(req.name).toBe("req");
  expect(req.val).toBeInstanceOf(RequestVal);
  expect(req.val.name).toBe("do");
  expect(req.val.toString()).toBe("!do");

  expect(seq.val).toBeInstanceOf(SeqAccessVal);
  expect(seq.val.seqVal).toBeInstanceOf(FieldVal);
  expect(seq.val.seqVal.name).toBe("a");
  expect(seq.val.keyVal).toBeInstanceOf(FieldVal);
  expect(seq.val.keyVal.name).toBe("b");
  expect(seq.val.toString()).toBe(".a[.b]");

  expect(dyn.name).toBe("dyn");
  expect(dyn.val).toBeInstanceOf(DynVal);
  expect(dyn.val.name).toBe("dynamic");
  expect(dyn.val.toString()).toBe("*dynamic");

  expect(nAttrs.toMacroVars()).toEqual({
    name: "foo",
    type: "Foo",
    bool: "false",
    num: "42",
    str: "'hi'",
    field: ".bar",
    bind: "@key",
    req: "!do",
    seq: ".a[.b]",
    dyn: "*dynamic",
  });
});

test("parse const attrs", () => {
  const [nAttrs] = parseAttrs(
    html`<p
      name="foo"
      type="Foo"
      bool="false"
      num="42"
      str="'hi'"
      field=".bar"
      bind="@key"
      req="!do"
      seq=".a[.b]"
      dyn="*dynamic"
    ></p>`,
  );

  expect(nAttrs.toMacroVars()).toEqual({
    name: "'foo'",
    type: "'Foo'",
    bool: "'false'",
    num: "'42'",
    str: "''hi''",
    field: "'.bar'",
    bind: "'@key'",
    req: "'!do'",
    seq: "'.a[.b]'",
    dyn: "'*dynamic'",
  });
});

test.todo("parse string attribute with quote escaping");
