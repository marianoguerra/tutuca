import { component, html } from "../index.js";
import {
  ANode,
  CommentNode,
  compileModifiers,
  DomNode,
  EachNode,
  FragmentNode,
  HideNode,
  NodeEvents,
  RenderEachNode,
  RenderItNode,
  RenderNode,
  RenderTextNode,
  ScopeNode,
  ShowNode,
  TextNode,
} from "../src/anode.js";
import {
  ConstAttrs,
  DynAttrs,
  EventHandler,
  IfAttr,
  NOT_SET_VAL,
} from "../src/attribute.js";
import { Components } from "../src/components.js";
import { Renderer } from "../src/renderer.js";
import { Stack } from "../src/stack.js";
import {
  AlterHandlerNameVal,
  BindVal,
  ComputedVal,
  ConstVal,
  FieldVal,
  NameVal,
  RawFieldVal,
  RequestVal,
  TypeVal,
  vp,
} from "../src/value.js";
import { describe, expect, test } from "bun:test";
import { HeadlessParseContext, isTextNode, isTextNodeWithText } from "./dom.js";

class DNode {
  constructor(tagName, attrs, childs) {
    this.tagName = tagName;
    this.attrs = attrs;
    this.childs = childs;
  }
  toData() {
    return [this.tagName, this.attrs, this.childs.map((child) => domToData(child))];
  }
}

class DFragment {
  constructor(childs) {
    this.childs = childs;
  }
  toData() {
    return this.childs.map((child) => domToData(child));
  }
}

function domToData(node) {
  return node?.toData?.() ?? node;
}

function dh(tagName, attrs, childs) {
  return tagName === DFragment
    ? new DFragment(childs)
    : new DNode(tagName, attrs, childs);
}

function rxs({ it = null, comps = new Components(), vars = {} }) {
  const fragment = (childs) => new DFragment(childs);
  const comment = () => null;
  const stack = Stack.root(comps, it);
  Object.assign(stack.binds.head.bindings, vars);
  return [stack, new Renderer(comps, dh, fragment, comment)];
}

const mpx = () => new HeadlessParseContext();

function parse(html) {
  const px = mpx();
  const r = ANode.parse(html, px);
  return [r, px];
}

function render(html) {
  const [root, px] = parse(html);
  const [stack, rx] = rxs({});
  return [domToData(root.render(stack, rx)), px, rx];
}

describe("ANode", () => {
  describe("ANode.parse", () => {
    test("parse empty string", () => {
      const [r] = parse("");
      expect(isTextNode(r)).toBeTruthy();
      expect(isTextNodeWithText(r, "")).toBeTruthy();
    });

    test("parse non empty string", () => {
      const [r] = parse("tutuca");
      expect(isTextNodeWithText(r, "tutuca")).toBeTruthy();
    });

    test("parse comment", () => {
      const [root] = parse("<p><!-- tutuca --></p>");
      const r = root.childs[0];
      expect(r).toBeInstanceOf(CommentNode);
      expect(r.v).toBe(" tutuca ");
    });

    test("parse node", () => {
      const [r] = parse("<p><!-- tutuca --><span>foo</span>bar</p>");
      expect(r.childs.length).toBe(3);
      const [c, n, t] = r.childs;
      expect(c).toBeInstanceOf(CommentNode);
      expect(n).toBeInstanceOf(DomNode);
      expect(t).toBeInstanceOf(TextNode);
      expect(c.v).toBe(" tutuca ");
      expect(t.v).toBe("bar");
    });

    test("parse node attributes", () => {
      const [r] = parse("<p id='foo' class='bar' open>tutuca</p>");
      expect(r.attrs).toBeInstanceOf(ConstAttrs);
      expect(r.attrs.items).toEqual({ id: "foo", class: "bar", open: true });
    });

    test("parse fragment node", () => {
      const [r] = parse("<x><!-- tutuca --><span>foo</span>bar</x>");
      expect(r.constructor).toBe(FragmentNode);
      expect(r.childs.length).toBe(3);
      const [c, n, t] = r.childs;
      expect(c).toBeInstanceOf(CommentNode);
      expect(n).toBeInstanceOf(DomNode);
      expect(t).toBeInstanceOf(TextNode);
      expect(c.v).toBe(" tutuca ");
      expect(t.v).toBe("bar");
    });
  });

  describe("ANode.render", () => {
    test("render empty string", () => {
      const [d] = render("");
      expect(d).toBe("");
    });

    test("render string", () => {
      const [d] = render("tutuca");
      expect(d).toBe("tutuca");
    });

    test("render node", () => {
      const [d] = render("<p><!-- tutuca --><span>foo</span>bar</p>");
      expect(d).toEqual([
        "p",
        {},
        [
          null, //"<!-- tutuca -->",
          ["span", {}, ["foo"]],
          "bar",
        ],
      ]);
    });

    test("render attributes", () => {
      const [d] = render("<p id='foo' class='bar' open>tutuca</p>");
      expect(d).toEqual(["p", { id: "foo", class: "bar", open: true }, ["tutuca"]]);
    });

    test("render fragment node", () => {
      const [d] = render("<p><x><!-- tutuca --><span>foo</span>bar</x></p>");
      expect(d).toEqual([
        "p",
        {},
        [
          [
            null, //"<!-- tutuca -->"
            ["span", {}, ["foo"]],
            "bar",
          ],
        ],
      ]);
    });
  });

  describe("VarVal", () => {
    test("parse BindVal", () => {
      const px = mpx();
      const v = vp.parseAttr("@foo", px);
      expect(v).toBeInstanceOf(BindVal);
      expect(v.name).toBe("foo");

      expect(vp.parseAttr("@9foo", px)).toBe(null);
      expect(vp.parseAttr("@f-oo", px)).toBe(null);
    });

    test("parse FieldVal", () => {
      const px = mpx();
      const v = vp.parseAttr(".foo", px);
      expect(v).toBeInstanceOf(FieldVal);
      expect(v.name).toBe("foo");

      expect(vp.parseAttr(".9foo", px)).toBe(null);
      expect(vp.parseAttr(".f-oo", px)).toBe(null);
    });

    test("parse ComputedVal", () => {
      const px = mpx();
      const v = vp.parseAttr("$foo", px);
      expect(v).toBeInstanceOf(ComputedVal);
      expect(v.name).toBe("foo");

      expect(vp.parseAttr("$9foo", px)).toBe(null);
      expect(vp.parseAttr("$f-oo", px)).toBe(null);
    });

    test("parse NameVal", () => {
      const px = mpx();
      const v = vp.parseHandlerArg("foo", px);
      expect(v).toBeInstanceOf(NameVal);
      expect(v.name).toBe("foo");

      expect(vp.parseHandlerArg("9foo", px)).toBe(null);
      expect(vp.parseHandlerArg("f-oo", px)).toBe(null);
    });

    test("parse TypeVal", () => {
      const px = mpx();
      const v = vp.parseHandlerArg("Foo", px);
      expect(v).toBeInstanceOf(TypeVal);
      expect(v.name).toBe("Foo");

      expect(vp.parseHandlerArg("F-oo", px)).toBe(null);
    });

    test("parse RequestVal", () => {
      const px = mpx();
      const v = vp.parseHandlerArg("!foo", px);
      expect(v).toBeInstanceOf(RequestVal);
      expect(v.name).toBe("foo");

      expect(vp.parseHandlerArg("!9foo", px)).toBe(null);
      expect(vp.parseHandlerArg("!f-oo", px)).toBe(null);
    });

    test("parse ConstVal Number", () => {
      const px = mpx();
      {
        const v = vp.parseHandlerArg("42", px);
        expect(v).toBeInstanceOf(ConstVal);
        expect(v.value).toBe(42);
      }
      {
        const v = vp.parseHandlerArg("42.5", px);
        expect(v).toBeInstanceOf(ConstVal);
        expect(v.value).toBe(42.5);
      }
      expect(vp.parseHandlerArg("42.", px)).toBe(null);
      expect(vp.parseHandlerArg("42f", px)).toBe(null);
    });

    test("parse ConstVal Bool", () => {
      const px = mpx();
      const v = vp.parseHandlerArg("true", px);
      expect(v).toBeInstanceOf(ConstVal);
      expect(v.value).toBe(true);
      const v1 = vp.parseHandlerArg("false", px);
      expect(v1).toBeInstanceOf(ConstVal);
      expect(v1.value).toBe(false);
    });

    test("parse bad val", () => {
      const px = mpx();
      const v = vp.parseHandlerArg("^foo", px);
      expect(v).toBe(null);
    });
  });

  describe("Attrs", () => {
    test("@show", () => {
      const [r, px] = parse("<div @show='@myCond'>hi</div>");
      expect(r).toBeInstanceOf(ShowNode);
      expect(r.nodeId).toBe(null);
      expect(px.nodes.length).toBe(0);
      expect(r.node).toBeInstanceOf(DomNode);
    });

    test("@hide", () => {
      const [r, px] = parse("<div @hide='@myCond'>hi</div>");
      expect(r).toBeInstanceOf(HideNode);
      expect(r.nodeId).toBe(null);
      expect(px.nodes.length).toBe(0);
      expect(r.node).toBeInstanceOf(DomNode);
    });

    test("@enrich-with (scope)", () => {
      const [r, px] = parse("<div @enrich-with='.myScope'>hi</div>");
      expect(r).toBeInstanceOf(ScopeNode);
      expect(r.val).toBeInstanceOf(RawFieldVal);
      expect(r.node).toBeInstanceOf(DomNode);
      expect(r.nodeId).toBe(0);
      expect(px.nodes.length).toBe(1);
      expect(px.nodes[0]).toBe(r);
    });

    test("@enrich-with (scope) alter", () => {
      const [r, px] = parse("<div @enrich-with='myScope'>hi</div>");
      expect(r).toBeInstanceOf(ScopeNode);
      expect(r.val).toBeInstanceOf(AlterHandlerNameVal);
      expect(r.node).toBeInstanceOf(DomNode);
      expect(r.nodeId).toBe(0);
      expect(px.nodes.length).toBe(1);
      expect(px.nodes[0]).toBe(r);
    });

    test("@each", () => {
      const [r, px] = parse("<div @each='.mySeq'>hi</div>");
      expect(r).toBeInstanceOf(EachNode);
      expect(r.iterInfo.whenVal).toBe(null);
      expect(r.node).toBeInstanceOf(DomNode);
      expect(r.nodeId).toBe(0);
      expect(px.nodes.length).toBe(1);
      expect(px.nodes[0]).toBe(r);
    });

    test("@each @when", () => {
      const [r, px] = parse("<div @each='.mySeq' @when='.myFilter'>hi</div>");
      expect(r).toBeInstanceOf(EachNode);
      expect(r.iterInfo.whenVal).toBeInstanceOf(RawFieldVal);
      expect(r.node).toBeInstanceOf(DomNode);
      expect(r.iterInfo.enrichWithVal).toBe(null);
      expect(r.nodeId).toBe(0);
      expect(px.nodes.length).toBe(1);
      expect(px.nodes[0]).toBe(r);
    });

    test("@each @when iter handler", () => {
      const [r, px] = parse("<div @each='.mySeq' @when='myFilter'>hi</div>");
      expect(r).toBeInstanceOf(EachNode);
      expect(r.iterInfo.whenVal).toBeInstanceOf(AlterHandlerNameVal);
      expect(r.node).toBeInstanceOf(DomNode);
      expect(r.iterInfo.enrichWithVal).toBe(null);
      expect(r.nodeId).toBe(0);
      expect(px.nodes.length).toBe(1);
      expect(px.nodes[0]).toBe(r);
    });

    test("@each @enrich-with", () => {
      const [r, px] = parse("<div @each='.mySeq' @enrich-with='.myEnrich'>hi</div>");
      expect(r).toBeInstanceOf(EachNode);
      expect(r.iterInfo.enrichWithVal).toBeInstanceOf(RawFieldVal);
      expect(r.node).toBeInstanceOf(DomNode);
      expect(r.iterInfo.whenVal).toBe(null);
      expect(r.nodeId).toBe(0);
      expect(px.nodes.length).toBe(1);
      expect(px.nodes[0]).toBe(r);
    });

    test("@each @enrich-with @when @loop-with", () => {
      const [r, px] = parse(
        "<div @each='.mySeq' @enrich-with='myEnrich' @when='myWhen' @loop-with='myWhenWith'>hi</div>",
      );
      expect(r).toBeInstanceOf(EachNode);
      expect(r.iterInfo.enrichWithVal).toBeInstanceOf(AlterHandlerNameVal);
      expect(r.iterInfo.whenVal).toBeInstanceOf(AlterHandlerNameVal);
      expect(r.iterInfo.loopWithVal).toBeInstanceOf(AlterHandlerNameVal);
      expect(r.node).toBeInstanceOf(DomNode);
      expect(r.nodeId).toBe(0);
      expect(px.nodes.length).toBe(1);
      expect(px.nodes[0]).toBe(r);
    });

    test("when & loop-with filter", () => {
      const Items = component({
        name: "Items",
        fields: { items: [] },
        alter: {
          enrich(binds, k, v, { multiplier, len }) {
            binds.label = `${k} ${v * multiplier} ${len}`;
          },
          when(k, _v, { evens }) {
            const r = evens ? 0 : 1;
            return k % 2 === r;
          },
          loopWith(seq) {
            return {
              evens: seq.size % 2 === 0,
              multiplier: 3,
              len: seq.size,
            };
          },
        },
        view: html`<p>
          <span
            @each=".items"
            @enrich-with="enrich"
            @when="when"
            @loop-with="loopWith"
            @text="@label"
          >
          </span>
        </p>`,
      });
      Items.compile(HeadlessParseContext);
      {
        const [stack, rx] = rxs({
          it: Items.make({ items: [10, 11, 12, 13] }),
        });
        rx.comps.registerComponent(Items);
        const n = rx.renderIt(stack).childs[1];
        expect(
          n.childs[0].filter((c) => c != null).map(({ childs }) => childs[0]),
        ).toEqual(["0 30 4", "2 36 4"]);
      }
      {
        const [stack, rx] = rxs({
          it: Items.make({ items: [10, 11, 12, 13, 14] }),
        });
        rx.comps.registerComponent(Items);
        const n = rx.renderIt(stack).childs[1];
        expect(
          n.childs[0].filter((c) => c != null).map(({ childs }) => childs[0]),
        ).toEqual(["1 33 5", "3 39 5"]);
      }
    });

    test("@each @enrich-with iter handler", () => {
      const [r, px] = parse("<div @each='.mySeq' @enrich-with='myEnrich'>hi</div>");
      expect(r).toBeInstanceOf(EachNode);
      expect(r.iterInfo.enrichWithVal).toBeInstanceOf(AlterHandlerNameVal);
      expect(r.node).toBeInstanceOf(DomNode);
      expect(r.iterInfo.whenVal).toBe(null);
      expect(r.nodeId).toBe(0);
      expect(px.nodes.length).toBe(1);
      expect(px.nodes[0]).toBe(r);
    });

    test("wrap order", () => {
      // if enrich-with comes before each it's a scope wrapper attr
      const [r, px] = parse(
        "<div @show='@a' @hide='@b' @enrich-with='.myScope' @each='.mySeq'>hi</div>",
      );
      expect(r).toBeInstanceOf(ShowNode);
      expect(r.node).toBeInstanceOf(HideNode);
      expect(r.node.node).toBeInstanceOf(ScopeNode);
      expect(r.node.node.node).toBeInstanceOf(EachNode);
      expect(r.node.node.node.node).toBeInstanceOf(DomNode);
      expect(px.nodes.length).toBe(2);
      expect(px.nodes[1]).toBe(r.node.node);
      expect(px.nodes[0]).toBe(r.node.node.node);
    });

    test("@if.class @then @else", () => {
      const [r] = parse(
        "<div @if.class='@myCond' @then='@myThen' @else='@myElse'>hi</div>",
      );
      expect(r).toBeInstanceOf(DomNode);
      expect(r.attrs).toBeInstanceOf(DynAttrs);
      expect(r.attrs.items.length).toBe(1);
      const attr = r.attrs.items[0];
      expect(attr).toBeInstanceOf(IfAttr);
      expect(attr.name).toBe("class");
      expect(attr.condVal).toBeInstanceOf(BindVal);
      expect(attr.condVal.name).toBe("myCond");
      expect(attr.thenVal).toBeInstanceOf(BindVal);
      expect(attr.thenVal.name).toBe("myThen");
      expect(attr.elseVal).toBeInstanceOf(BindVal);
      expect(attr.elseVal.name).toBe("myElse");
    });

    test("@if.class @then", () => {
      const [r] = parse("<div @if.class='@myCond' @then='@myThen'>hi</div>");
      expect(r).toBeInstanceOf(DomNode);
      expect(r.attrs).toBeInstanceOf(DynAttrs);
      expect(r.attrs.items.length).toBe(1);
      const attr = r.attrs.items[0];
      expect(attr).toBeInstanceOf(IfAttr);
      expect(attr.name).toBe("class");
      expect(attr.condVal).toBeInstanceOf(BindVal);
      expect(attr.condVal.name).toBe("myCond");
      expect(attr.thenVal).toBeInstanceOf(BindVal);
      expect(attr.thenVal.name).toBe("myThen");
      expect(attr.elseVal).toBe(NOT_SET_VAL);
    });

    test("@if.class @else", () => {
      const [r] = parse("<div @if.class='@myCond' @else='@myElse'>hi</div>");
      expect(r).toBeInstanceOf(DomNode);
      expect(r.attrs).toBeInstanceOf(DynAttrs);
      expect(r.attrs.items.length).toBe(1);
      const attr = r.attrs.items[0];
      expect(attr).toBeInstanceOf(IfAttr);
      expect(attr.name).toBe("class");
      expect(attr.condVal).toBeInstanceOf(BindVal);
      expect(attr.condVal.name).toBe("myCond");
      expect(attr.thenVal).toBe(NOT_SET_VAL);
      expect(attr.elseVal).toBeInstanceOf(BindVal);
      expect(attr.elseVal.name).toBe("myElse");
    });

    test("two @if", () => {
      // NOTE: second if branches need attribute names to avoid duplicating attribute name and disapearing
      const [r] = parse(
        "<div @if.class='@myCond' @then='@myThen' @else='@myElse' @if.id='@anotherCond' @then.id='@anotherThen' @else.id='@anotherElse'>hi</div>",
      );
      const [stack, _rx] = rxs({
        vars: {
          myCond: true,
          anotherCond: false,
          myThen: "a",
          myElse: "b",
          anotherThen: "c",
          anotherElse: "d",
        },
      });
      expect(r).toBeInstanceOf(DomNode);
      expect(r.attrs).toBeInstanceOf(DynAttrs);
      expect(r.attrs.items.length).toBe(2);
      const [attr, attr1] = r.attrs.items;
      expect(attr).toBeInstanceOf(IfAttr);
      expect(attr.name).toBe("class");
      expect(attr.condVal).toBeInstanceOf(BindVal);
      expect(attr.condVal.name).toBe("myCond");
      expect(attr.thenVal).toBeInstanceOf(BindVal);
      expect(attr.thenVal.name).toBe("myThen");
      expect(attr.elseVal).toBeInstanceOf(BindVal);
      expect(attr.elseVal.name).toBe("myElse");

      expect(attr1).toBeInstanceOf(IfAttr);
      expect(attr1.name).toBe("id");
      expect(attr1.condVal).toBeInstanceOf(BindVal);
      expect(attr1.condVal.name).toBe("anotherCond");
      expect(attr1.thenVal).toBeInstanceOf(BindVal);
      expect(attr1.thenVal.name).toBe("anotherThen");
      expect(attr1.elseVal).toBeInstanceOf(BindVal);
      expect(attr1.elseVal.name).toBe("anotherElse");

      expect(r.attrs.eval(stack)).toEqual({ class: "a", id: "d" });
    });

    test("@on.oneevent", () => {
      const [r, px] = parse(
        "<div @on.click='myHandler @v .f $c true 42 12.5 !myRequest MyType value'>hi</div>",
      );
      expect(r).toBeInstanceOf(DomNode);
      expect(r.attrs).toBeInstanceOf(ConstAttrs);
      expect(r.attrs.items["data-eid"]).toBe(0);
      expect(px.events.length).toBe(1);
      const [event] = px.events;
      expect(event).toBeInstanceOf(NodeEvents);
      expect(event.id).toBe(0);
      expect(event.handlers.length).toBe(1);
      const [{ name, handlerCall: handler }] = event.handlers;
      expect(name).toBe("click");
      expect(handler).toBeInstanceOf(EventHandler);
      expect(handler.handlerVal).toBeInstanceOf(NameVal);
      expect(handler.handlerVal.name).toBe("myHandler");
      expect(handler.args.length).toBe(9);
      const [v, f, c, b, i, fl, e, t, n] = handler.args;
      expect(v).toBeInstanceOf(BindVal);
      expect(v.name).toBe("v");
      expect(f).toBeInstanceOf(FieldVal);
      expect(f.name).toBe("f");
      expect(c).toBeInstanceOf(ComputedVal);
      expect(c.name).toBe("c");
      expect(b).toBeInstanceOf(ConstVal);
      expect(b.value).toBe(true);
      expect(i).toBeInstanceOf(ConstVal);
      expect(i.value).toBe(42);
      expect(fl).toBeInstanceOf(ConstVal);
      expect(fl.value).toBe(12.5);
      expect(e).toBeInstanceOf(RequestVal);
      expect(e.name).toBe("myRequest");
      expect(t).toBeInstanceOf(TypeVal);
      expect(t.name).toBe("MyType");
      expect(n).toBeInstanceOf(NameVal);
      expect(n.name).toBe("value");
    });

    test("@on.twoevents", () => {
      const [r, px] = parse("<div @on.click='h @v' @on.hover='.f @v'>hi</div>");
      expect(r).toBeInstanceOf(DomNode);
      expect(r.attrs).toBeInstanceOf(ConstAttrs);
      expect(r.attrs.items["data-eid"]).toBe(0);
      expect(px.events.length).toBe(1);
      const [event] = px.events;
      expect(event).toBeInstanceOf(NodeEvents);
      expect(event.id).toBe(0);
      expect(event.handlers.length).toBe(2);
      const [{ name: n1, handlerCall: h1 }, { name: n2, handlerCall: h2 }] =
        event.handlers;
      expect(n1).toBe("click");
      expect(h1).toBeInstanceOf(EventHandler);
      expect(h1.handlerVal).toBeInstanceOf(NameVal);
      expect(h1.handlerVal.name).toBe("h");
      expect(h1.args.length).toBe(1);
      const [v] = h1.args;
      expect(v).toBeInstanceOf(BindVal);
      expect(v.name).toBe("v");
      //
      expect(n2).toBe("hover");
      expect(h2).toBeInstanceOf(EventHandler);
      expect(h2.handlerVal).toBeInstanceOf(RawFieldVal);
      expect(h2.handlerVal.name).toBe("f");
      expect(h2.args.length).toBe(1);
      const [v1] = h2.args;
      expect(v1).toBeInstanceOf(BindVal);
      expect(v1.name).toBe("v");
    });

    test("x text", () => {
      const [r, px] = parse("<x text=@title></x>");
      expect(r).toBeInstanceOf(RenderTextNode);
      expect(r.nodeId).toBe(null);
      expect(r.val.name).toBe("title");
      expect(px.nodes.length).toBe(0);
    });

    test("x render", () => {
      const [r, px] = parse("<x render=.title></x>");
      expect(r).toBeInstanceOf(RenderNode);
      expect(r.nodeId).toBe(0);
      expect(r.val.name).toBe("title");
      expect(px.nodes.length).toBe(1);
      expect(px.nodes[0]).toBe(r);
    });

    test("x render-each", () => {
      const [r, px] = parse("<x render-each=.title></x>");
      expect(r).toBeInstanceOf(RenderEachNode);
      expect(r.nodeId).toBe(0);
      expect(r.val.name).toBe("title");
      expect(px.nodes.length).toBe(1);
      expect(px.nodes[0]).toBe(r);
    });

    test("x render-it", () => {
      const [r, px] = parse("<x render-it></x>");
      expect(r).toBeInstanceOf(RenderItNode);
      expect(r.nodeId).toBe(0);
      expect(r.val.name).toBe("it");
      expect(px.nodes.length).toBe(1);
      expect(px.nodes[0]).toBe(r);
    });

    // TODO: test px.error conditions
  });

  describe("render", () => {
    test("x text", () => {
      const [r] = parse("<x text=@v></x>");
      const [stack, rx] = rxs({ vars: { v: "hello" } });
      expect(r.render(stack, rx)).toBe("hello");
    });

    test("@show", () => {
      const [r] = parse("<p @show=@v>hi</p>");
      {
        const [stack, rx] = rxs({ vars: { v: true } });
        expect(r.render(stack, rx)?.tagName).toBe("p");
      }
      {
        const [stack, rx] = rxs({ vars: { v: false } });
        expect(r.render(stack, rx)).toBe(null);
      }
    });

    test("@hide", () => {
      const [r] = parse("<p @hide=@v>hi</p>");
      {
        const [stack, rx] = rxs({ vars: { v: false } });
        expect(r.render(stack, rx)?.tagName).toBe("p");
      }
      {
        const [stack, rx] = rxs({ vars: { v: true } });
        expect(r.render(stack, rx)).toBe(null);
      }
    });

    test("dyn attr var", () => {
      const [r] = parse("<p :title=@v id=foo></p>");
      const [stack, rx] = rxs({ vars: { v: "hello" } });
      const n = r.render(stack, rx);
      expect(n.attrs.title).toBe("hello");
      expect(n.attrs.id).toBe("foo");
    });

    test("x render-it", () => {
      const User = component({
        name: "User",
        fields: { name: "" },
        view: html`<p>hi, I'm <x text=".name"></x></p>`,
      });
      User.compile(HeadlessParseContext);
      const [stack, rx] = rxs({ it: User.make({ name: "bob" }) });
      rx.comps.registerComponent(User);
      const n = rx.renderIt(stack).childs[1];
      expect(n?.tagName).toBe("p");
      expect(n?.childs).toEqual(["hi, I'm ", "bob"]);
    });

    test("x render", () => {
      const Parent = component({
        name: "Parent",
        fields: { name: "" },
        view: html`<p>hi, I'm <x text=".name"></x></p>`,
      });
      const User = component({
        name: "User",
        fields: { name: "", parent: null },
        view: html`<div><x render=".parent"></x></div>`,
      });
      const [stack, rx] = rxs({
        it: User.make({ name: "bob", parent: Parent.make({ name: "sandy" }) }),
      });
      User.compile(HeadlessParseContext);
      Parent.compile(HeadlessParseContext);
      rx.comps.registerComponent(User);
      rx.comps.registerComponent(Parent);
      const userDiv = rx.renderIt(stack).childs[1];
      const n = userDiv.childs[0].childs[1];
      expect(n.tagName).toBe("p");
      expect(n.attrs["data-cid"]).toBe(Parent.id);
      expect(n?.childs).toEqual(["hi, I'm ", "sandy"]);
    });

    test("@enrich-with (scope)", () => {
      const User = component({
        name: "User",
        fields: { name: "", parent: null },
        methods: {
          getScopeBinds() {
            return { nameUpper: this.name.toUpperCase() };
          },
        },
        view: html`<div @enrich-with=".getScopeBinds">
          <x text="@nameUpper"></x>
        </div>`,
      });
      User.compile(HeadlessParseContext);
      const [stack, rx] = rxs({ it: User.make({ name: "bob" }) });
      rx.comps.registerComponent(User);
      const n = rx.renderIt(stack, 10).childs[1];
      expect(n.toData()).toEqual([
        "div",
        { "data-cid": User.id, "data-nid": 0, "data-vid": "main" },
        ["BOB"],
      ]);
    });
    test("@enrich-with (scope) alter", () => {
      const User = component({
        name: "User",
        fields: { name: "", parent: null },
        alter: {
          getScopeBinds() {
            return { nameUpper: this.name.toUpperCase() };
          },
        },
        view: html`<div @enrich-with="getScopeBinds">
          <x text="@nameUpper"></x>
        </div>`,
      });
      User.compile(HeadlessParseContext);
      const [stack, rx] = rxs({ it: User.make({ name: "bob" }) });
      rx.comps.registerComponent(User);
      const n = rx.renderIt(stack, 10).childs[1];
      expect(n.toData()).toEqual([
        "div",
        { "data-cid": User.id, "data-nid": 0, "data-vid": "main" },
        ["BOB"],
      ]);
    });
  });
  describe("input event modifiers", () => {
    function f(a, b) {
      return this + a + b;
    }
    function mkKeyDown(key, { ctrlKey = false }) {
      return { e: { key, ctrlKey, metaKey: ctrlKey } };
    }
    test("empty modifiers don't wrap", () => {
      const f1 = compileModifiers("keydown", [])(f, null);
      expect(f1).toBe(f);
      expect(f1.apply(1, [2, 4])).toBe(7);
    });
    test("one modifier wraps", () => {
      const f1 = compileModifiers("keydown", ["send"]);
      expect(f1(f, mkKeyDown("Enter", {})).apply(3, [10, 5])).toBe(18);
      expect(f1(f, mkKeyDown("A", {})).apply(100, [10, 5])).toBe(100);
    });
    test("two modifier wraps", () => {
      const f1 = compileModifiers("keydown", ["send", "ctrl"]);
      expect(f1(f, mkKeyDown("Enter", { ctrlKey: true })).apply(3, [10, 5])).toBe(18);
      expect(f1(f, mkKeyDown("Enter", { ctrlKey: false })).apply("nope", [10, 5])).toBe(
        "nope",
      );
      expect(f1(f, mkKeyDown("A", {})).apply(100, [10, 5])).toBe(100);
    });
  });
});
