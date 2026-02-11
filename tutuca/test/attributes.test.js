import { expect, test } from "bun:test";
import { ParseContext } from "../src/anode.js";
import { ConstAttrs, DynAttrs, getAttrParser } from "../src/attribute.js";
import {
  BindVal,
  ComputedVal,
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
  const attrs = domParser.parseFromString(html, "text/html").body.childNodes[0]
    .attributes;
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
      :comp="$slow"
      :req="!do"
      :seq=".a[.b]"
      :dyn="*dynamic"
    ></p>`,
  );
  expect(nAttrs).toBeInstanceOf(DynAttrs);
  const [name, type, bool, num, str, field, bind, comp, req, seq, dyn] = nAttrs.items;
  expect(name.name).toBe("name");
  expect(name.value).toBeInstanceOf(NameVal);
  expect(name.value.name).toBe("foo");
  expect(name.value.toString()).toBe("foo");

  expect(type.name).toBe("type");
  expect(type.value).toBeInstanceOf(TypeVal);
  expect(type.value.name).toBe("Foo");
  expect(type.value.toString()).toBe("Foo");

  expect(bool.name).toBe("bool");
  expect(bool.value).toBeInstanceOf(ConstVal);
  expect(bool.value.value).toBe(false);
  expect(bool.value.toString()).toBe("false");

  expect(num.name).toBe("num");
  expect(num.value).toBeInstanceOf(ConstVal);
  expect(num.value.value).toBe(42);
  expect(num.value.toString()).toBe("42");

  expect(str.name).toBe("str");
  expect(str.value).toBeInstanceOf(ConstVal);
  expect(str.value.value).toBe("hi");
  expect(str.value.toString()).toBe("'hi'");
  // TODO: test escaping

  expect(field.name).toBe("field");
  expect(field.value).toBeInstanceOf(FieldVal);
  expect(field.value.name).toBe("bar");
  expect(field.value.toString()).toBe(".bar");

  expect(bind.name).toBe("bind");
  expect(bind.value).toBeInstanceOf(BindVal);
  expect(bind.value.name).toBe("key");
  expect(bind.value.toString()).toBe("@key");

  expect(comp.name).toBe("comp");
  expect(comp.value).toBeInstanceOf(ComputedVal);
  expect(comp.value.name).toBe("slow");
  expect(comp.value.toString()).toBe("$slow");

  expect(req.name).toBe("req");
  expect(req.value).toBeInstanceOf(RequestVal);
  expect(req.value.name).toBe("do");
  expect(req.value.toString()).toBe("!do");

  expect(seq.value).toBeInstanceOf(SeqAccessVal);
  expect(seq.value.seqVal).toBeInstanceOf(FieldVal);
  expect(seq.value.seqVal.name).toBe("a");
  expect(seq.value.keyVal).toBeInstanceOf(FieldVal);
  expect(seq.value.keyVal.name).toBe("b");
  expect(seq.value.toString()).toBe(".a[.b]");

  expect(dyn.name).toBe("dyn");
  expect(dyn.value).toBeInstanceOf(DynVal);
  expect(dyn.value.name).toBe("dynamic");
  expect(dyn.value.toString()).toBe("*dynamic");

  expect(nAttrs.toMacroVars()).toEqual({
    name: "foo",
    type: "Foo",
    bool: "false",
    num: "42",
    str: "'hi'",
    field: ".bar",
    bind: "@key",
    comp: "$slow",
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
      comp="$slow"
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
    comp: "'$slow'",
    req: "'!do'",
    seq: "'.a[.b]'",
    dyn: "'*dynamic'",
  });
});
