import { expect, test } from "bun:test";
import { html, macro } from "../index.js";
import {
  DomNode,
  EachNode,
  FragmentNode,
  HideNode,
  MacroNode,
  RenderEachNode,
  RenderItNode,
  RenderOnceNode,
  RenderTextNode,
  ScopeNode,
  ShowNode,
  SlotNode,
  View,
} from "../src/anode.js";
import { ConstAttrs, DynAttrs } from "../src/attribute.js";
import { ConstVal } from "../src/value.js";
import { isTextNode, isTextNodeWithText, mpx, parse } from "./dom.js";

test("parse empty string", () => {
  const [r] = parse("");
  expect(isTextNode(r)).toBe(true);
  expect(isTextNodeWithText(r, "")).toBe(true);
});

test("parse non empty string", () => {
  const [r] = parse("tutuca");
  expect(isTextNode(r)).toBe(true);
  expect(isTextNodeWithText(r, "tutuca")).toBe(true);
});

test("parse render-each", () => {
  const [r] = parse(`<x render-each=".items"></x>`);
  expect(r.iterInfo.whenVal).toBe(null);
  expect(r.iterInfo.loopWithVal).toBe(null);
});

test("parse render-each and when", () => {
  const [r] = parse(`<x render-each=".items" when=".whenH"></x>`);
  // TODO: warn if loop-with and no when, unused result
  // TODO: warn if enrich-with exists
  expect(r.iterInfo.whenVal.name).toBe("whenH");
  expect(r.iterInfo.loopWithVal).toBe(null);
});

test("parse render-each, when and loop-with", () => {
  const [r] = parse(`<x render-each=".items" when=".whenH" loop-with=".lwith"></x>`);
  expect(r.iterInfo.whenVal.name).toBe("whenH");
  expect(r.iterInfo.loopWithVal.name).toBe("lwith");
});

test("parse text directive: const", () => {
  const [r] = parse(`<x text="'hi'"></x>`);
  expect(r).toBeInstanceOf(RenderTextNode);
  expect(r.val).toBeInstanceOf(ConstVal);
  expect(r.val.value).toBe("hi");
});

test("parse text directive: parse error is empty string", () => {
  const [r] = parse(`<x text="%a"></x>`);
  expect(r).toBeInstanceOf(RenderTextNode);
  expect(r.val).toBeInstanceOf(ConstVal);
  expect(r.val.value).toBe("");
});

test("parse text attribute: const", () => {
  const [node] = parse(`<span @text="'hi'"></span>`);
  const r = node.childs[0];
  expect(r).toBeInstanceOf(RenderTextNode);
  expect(r.val).toBeInstanceOf(ConstVal);
  expect(r.val.value).toBe("hi");
});

test("parse text directive: parse error is empty string", () => {
  const [node] = parse(`<span @text="%a"></span>`);
  const r = node.childs[0];
  expect(r).toBeInstanceOf(RenderTextNode);
  expect(r.val).toBeInstanceOf(ConstVal);
  expect(r.val.value).toBe("");
});

test("expand simple macro", () => {
  const m = macro(
    { value: ".text", onInput: ".setText" },
    html`<input :value="^value" @on.input="^onInput value" />`,
  );
  {
    const px = mpx();
    const n = m.expand(px.enterMacro("m", { value: ".text", onInput: ".setText" }, {}));
    expect(n.attrs.items[0].value.name).toBe("text");
    expect(px.events[0].handlers[0].handlerCall.handlerVal.name).toBe("setText");
  }
  {
    const px = mpx();
    const n = m.expand(px.enterMacro("m", { value: ".foo", onInput: ".setFoo" }, {}));
    expect(n.attrs.items[0].value.name).toBe("foo");
    expect(px.events[0].handlers[0].handlerCall.handlerVal.name).toBe("setFoo");
  }
});

class ScopeForMacros {
  constructor(macros) {
    this.macros = macros;
  }
  lookupMacro(name) {
    return this.macros[name] ?? null;
  }
}

test("expand nested macro", () => {
  const inputMacro = macro(
    { value: ".text", oninput: ".setText" },
    html`<input :value="^value" @on.input="^oninput value" />`,
  );

  const outerMacro = macro(
    { value: ".title" },
    html`<div :title="^value">
      <x:input :value=".foo" :oninput=".setFoo"></x:input>
      <p :title="^value"></p>
    </div>`,
  );

  const v = new View("main", html`<div><x:outer :value=".bar"></x:outer></div>`);
  const px = mpx();
  const scope = new ScopeForMacros({ input: inputMacro, outer: outerMacro });
  v.compile(px, scope);
  // NOTE: nested macro will be expanded after expanding outer one
  // so macro vars in px will have the correct values for inner macro
  // and for var with conflicting name (value) in node after inner macro
  // div title
  expect(px.macroNodes[0].node.attrs.items[0].value.name).toBe("bar");
  // p title
  expect(px.macroNodes[0].node.childs[2].attrs.items[0].value.name).toBe("bar");
  // inner input
  expect(px.macroNodes[0].node.childs[0].node.attrs.items[0].value.name).toBe("foo");
  expect(px.events[0].handlers[0].handlerCall.handlerVal.name).toBe("setFoo");
});

test("reject recursive macro", () => {
  const selfMacro = macro({}, html`<div><x:self></x:self></div>`);
  const v = new View("main", html`<div><x:self></x:self></div>`);
  const px = mpx();
  const scope = new ScopeForMacros({ self: selfMacro });
  expect(() => v.compile(px, scope)).toThrow();
});

test("don't reject non recursive macro, just multiple instance at same level", () => {
  const cardMacro = macro({}, html`<div class="card"></div>`);
  const v = new View("main", html`<div><x:card></x:card><x:card></x:card></div>`);
  const px = mpx();
  const scope = new ScopeForMacros({ card: cardMacro });
  expect(() => v.compile(px, scope)).not.toThrow();
});

test("don't reject non recursive macro, just multiple instance at different macros", () => {
  const aMacro = macro({}, html`<div class="a"><x:c></x:c></div>`);
  const bMacro = macro({}, html`<div class="b"><x:a></x:a><x:c></x:c></div>`);
  const cMacro = macro({}, html`<div class="c"></div>`);
  const v = new View("main", html`<div><x:a></x:a><x:b></x:b><x:c></x:c></div>`);
  const px = mpx();
  const scope = new ScopeForMacros({ a: aMacro, b: bMacro, c: cMacro });
  expect(() => v.compile(px, scope)).not.toThrow();
});

test("reject recursive macro", () => {
  const aMacro = macro({}, html`<div class="a"><x:b></x:b></div>`);
  const bMacro = macro({}, html`<div class="b"><x:c></x:c></div>`);
  const cMacro = macro({}, html`<div class="c"><x:a></x:a></div>`);
  const v = new View("main", html`<div><x:a></x:a></div>`);
  const px = mpx();
  const scope = new ScopeForMacros({ a: aMacro, b: bMacro, c: cMacro });
  expect(() => v.compile(px, scope)).toThrow();
});

test("reject indirect recursive macro", () => {
  const aMacro = macro({}, html`<div><x:b></x:b></div>`);
  const bMacro = macro({}, html`<div><x:a></x:a></div>`);
  const v = new View("main", html`<div><x:a></x:a></div>`);
  const px = mpx();
  const scope = new ScopeForMacros({ a: aMacro, b: bMacro });
  expect(() => v.compile(px, scope)).toThrow();
});

test("parse macro slots", () => {
  const [node] = parse(
    html`<x:m>
      <span @text="'hi'"></span>
      <x slot="a">
        <p>hello</p>
        <em>bye</em>
      </x>
      <footer @slot="b">Footer</footer>
    </x:m>`,
  );
  expect(node.slots.a).toBeInstanceOf(FragmentNode);
  expect(node.slots.b).toBeInstanceOf(DomNode);
});

test("expand macro slot", () => {
  const post = macro(
    {},
    html`<article><x:slot name="title"><h1>My Post</h1></h1></x:slot></article>`,
  );
  {
    const v = new View("main", html`<div><x:post></x:post></div>`);
    const px = mpx();
    const scope = new ScopeForMacros({ post });
    v.compile(px, scope);
    const m = px.macroNodes[0];
    expect(m.name).toBe("post");
    expect(m.node.childs[0].tagName).toBe("h1");
    expect(m.node.childs[0].childs[0].v).toBe("My Post");
  }
  {
    const v = new View(
      "main",
      html`<div>
        <x:post
          ><x slot="title"><h2>Hello</h2></x></x:post
        >
      </div>`,
    );
    const px = mpx();
    const scope = new ScopeForMacros({ post });
    v.compile(px, scope);
    const m = px.macroNodes[0];
    expect(m.name).toBe("post");
    expect(m.node.childs[0].tagName).toBe("h2");
    expect(m.node.childs[0].childs[0].v).toBe("Hello");
  }
  {
    const v = new View(
      "main",
      html`<div>
        <x:post><h3 @slot="title">Hi there</h3></x:post>
      </div>`,
    );
    const px = mpx();
    const scope = new ScopeForMacros({ post });
    v.compile(px, scope);
    const m = px.macroNodes[0];
    expect(m.name).toBe("post");
    expect(m.node.childs[0].tagName).toBe("h3");
    expect(m.node.childs[0].childs[0].v).toBe("Hi there");
  }
});

test("parse mixed macro attrs", () => {
  const [node] = parse(
    html`<x:m
      class="foo"
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
    ></x:m>`,
  );
  expect(node.attrs).toEqual({
    class: "'foo'",
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

test("parse wrapper macro attrs", () => {
  const [node] = parse(
    html`<x:m class="foo" :name="foo" @slot="mySlot" @show=".loading"></x:m>`,
  );
  expect(node).toBeInstanceOf(SlotNode);
  expect(node.val.value).toBe("mySlot");
  expect(node.node).toBeInstanceOf(ShowNode);
  expect(node.node.val.name).toBe("loading");
  const n = node.node.node;
  expect(n).toBeInstanceOf(MacroNode);
  expect(n.attrs).toEqual({
    class: "'foo'",
    name: "foo",
  });
});

test("dyn attr with constant string template turns constant", () => {
  const [r] = parse(`<p :class="flex {'gap-3'}"></p>`);
  expect(r.attrs).toBeInstanceOf(ConstAttrs);
});

test("dyn attr with non constant string template turns dynamic", () => {
  const [r] = parse(`<p :class="flex {.foo}"></p>`);
  expect(r.attrs).toBeInstanceOf(DynAttrs);
});

function optimizeView(rawView) {
  const v = new View("myView", rawView);
  const px = mpx();
  const scope = new ScopeForMacros({});
  v.compile(px, scope, 0);
  return v;
}

test("optimize: whole root fragment not cached if all constant childs", () => {
  const r = optimizeView(
    html`<x
      ><p>a</p>
      b
      <ul>
        <li>c</li>
        <li>d</li>
      </ul></x
    >`,
  );
  expect(r.anode).toBeInstanceOf(FragmentNode);
});

test("optimize: fragment caches only constant childs", () => {
  const r = optimizeView(
    html`<x
      ><p>a</p>
      b
      <div @show=".isVisible">show</div>
      <div @hide=".isHidden">hide</div>
      <p :id=".key">dyn attrs</p>
      <ul>
        <li>c</li>
        <li>d</li>
      </ul></x
    >`,
  );
  const [p, text, show, _1, hide, _2, dynAttr, _3, ul] = r.anode.childs;
  expect(p).toBeInstanceOf(RenderOnceNode);
  expect(text).toBeInstanceOf(RenderOnceNode);
  expect(show.node).toBeInstanceOf(RenderOnceNode);
  expect(hide.node).toBeInstanceOf(RenderOnceNode);
  expect(dynAttr).toBeInstanceOf(DomNode);
  expect(ul).toBeInstanceOf(RenderOnceNode);
});
test("optimize: doesn't optimize show but it optimizes its child", () => {
  const r = optimizeView(html`<div @show=".a">hi</div>`);
  expect(r.anode).toBeInstanceOf(ShowNode);
  expect(r.anode.node).toBeInstanceOf(RenderOnceNode);
});
test("optimize: doesn't optimize hide but it optimizes its child", () => {
  const r = optimizeView(html`<div @hide=".a">hi</div>`);
  expect(r.anode).toBeInstanceOf(HideNode);
  expect(r.anode.node).toBeInstanceOf(RenderOnceNode);
});
test("optimize: doesn't optimize each nor its direct child", () => {
  const r = optimizeView(html`<div @each=".a">hi</div>`);
  expect(r.anode).toBeInstanceOf(EachNode);
  expect(r.anode.node).toBeInstanceOf(DomNode);
});
test("optimize: doesn't optimize scope nor its direct child", () => {
  const r = optimizeView(html`<div @enrich-with=".a">hi</div>`);
  expect(r.anode).toBeInstanceOf(ScopeNode);
  // TODO: can it optimize tis one?
  expect(r.anode.node).toBeInstanceOf(DomNode);
});
test("optimize: doesn't optimize render-it", () => {
  const r = optimizeView(html`<div><x render-it></x></div>`);
  expect(r.anode.childs[0]).toBeInstanceOf(RenderItNode);
});
test("optimize: doesn't optimize render-each", () => {
  const r = optimizeView(html`<div><x render-each=".a"></x></div>`);
  expect(r.anode.childs[0]).toBeInstanceOf(RenderEachNode);
});
test("optimize: doesn't optimize x text", () => {
  const r = optimizeView(html`<div><x text=".a"></x></div>`);
  expect(r.anode.childs[0]).toBeInstanceOf(RenderTextNode);
});
