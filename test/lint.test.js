import { expect, test } from "vitest";
import { LintClassCollectorCtx } from "../dev.js";
import { component, html, macro } from "../index.js";
import { ComponentStack } from "../src/components.js";
import {
  ALT_HANDLER_NOT_DEFINED,
  ALT_HANDLER_NOT_REFERENCED,
  ASYNC_HANDLER,
  BAD_VALUE,
  BINDING_MEMBER_TOO_DEEP,
  COMP_FIELD_BAD_SHAPE,
  CONSTANT_CONDITION,
  checkComponent,
  DEPRECATED_BARE_X_DIRECTIVE,
  DUPLICATE_ATTR_DEFINITION,
  DYN_ALIAS_NOT_REFERENCED,
  DYN_VAL_NOT_DEFINED,
  FIELD_NAME_RESERVED_BY_RECORD,
  FIELD_VAL_IS_METHOD,
  FIELD_VAL_NOT_DEFINED,
  GLOBAL_SELECTOR_IN_SCOPED_STYLE,
  IF_NO_BRANCH_SET,
  INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD,
  INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER,
  INPUT_HANDLER_METHOD_NOT_IMPLEMENTED,
  INPUT_HANDLER_NOT_IMPLEMENTED,
  INPUT_HANDLER_NOT_REFERENCED,
  LintParseContext,
  LOOKUP_BAD_SHAPE,
  LOOKUP_TARGET_MALFORMED,
  MAYBE_ADD_AT_PREFIX,
  MAYBE_DROP_AT_PREFIX,
  METHOD_VAL_IS_FIELD,
  METHOD_VAL_NOT_DEFINED,
  PLACEHOLDERLESS_TEMPLATE_STRING,
  PROVIDE_NOT_ADDRESSABLE,
  REDUNDANT_TEMPLATE_STRING,
  RENDER_IT_OUTSIDE_OF_LOOP,
  SUGGEST_BINDING_MEMBER,
  TOP_LEVEL_AT_RULE_IN_SCOPED_STYLE,
  UNKNOWN_COMPONENT_NAME,
  UNKNOWN_COMPONENT_SPEC_KEY,
  UNKNOWN_DIRECTIVE,
  UNKNOWN_EVENT_MODIFIER,
  UNKNOWN_HANDLER_ARG_NAME,
  UNKNOWN_MACRO_ARG,
  UNKNOWN_X_ATTR,
  UNKNOWN_X_OP,
  UNSUPPORTED_EXPR_SYNTAX,
  X_OP_IGNORES_CHILDREN,
} from "../tools/core/lint-check.js";
import { Comment, document, Text } from "./dom.js";

class HeadlessLintParseContext extends LintParseContext {
  constructor() {
    super(document, Text, Comment);
  }
}

function defAndCheck(opts, { macros, wellKnownExtras } = {}) {
  const Comp = component(opts);
  Comp.scope = new ComponentStack();
  if (macros) Comp.scope.registerMacros(macros);
  Comp.compile(HeadlessLintParseContext);
  const lx = checkComponent(Comp, undefined, wellKnownExtras ? { wellKnownExtras } : undefined);
  return [lx, Comp];
}

const defAndCheckWithExtras = (opts, wellKnownExtras) => defAndCheck(opts, { wellKnownExtras });
const defAndCheckWithMacros = (opts, macros) => defAndCheck(opts, { macros });

test("ASYNC_HANDLER flags an async input handler with the fix help", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<button @on.click="go">go</button>`,
    input: {
      async go() {},
    },
  });
  const found = lx.reports.filter((r) => r.id === ASYNC_HANDLER);
  expect(found.length).toBe(1);
  expect(found[0].level).toBe("error");
  expect(found[0].info).toEqual({ name: "go", channel: "input" });
  expect(found[0].suggestion.kind).toBe("rephrase");
  expect(found[0].suggestion.text).toContain("ctx.request");
});

test("ASYNC_HANDLER flags async handlers across receive/bubble/response/alter", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div></div>`,
    receive: { async onMsg() {} },
    bubble: { async onEvt() {} },
    response: { async onRes() {} },
    alter: {
      async onAlt(_k, v) {
        return v;
      },
    },
  });
  const channels = lx.reports
    .filter((r) => r.id === ASYNC_HANDLER)
    .map((r) => r.info.channel)
    .sort();
  expect(channels).toEqual(["alter", "bubble", "receive", "response"]);
});

test("CONSTANT_CONDITION warns on a string literal in @show", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div @show="'open'">x</div>`,
  });
  const found = lx.reports.filter((r) => r.id === CONSTANT_CONDITION);
  expect(found.length).toBe(1);
  expect(found[0].level).toBe("warn");
  expect(found[0].info.literal).toBe("'open'");
  expect(found[0].info.originAttr).toBe("@show");
});

test("CONSTANT_CONDITION warns on a placeholderless template in a @hide condition", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div @hide="$'busy'">x</div>`,
  });
  const found = lx.reports.filter((r) => r.id === CONSTANT_CONDITION);
  expect(found.length).toBe(1);
  expect(found[0].info.originAttr).toBe("@hide");
});

test("CONSTANT_CONDITION does not warn on a literal predicate argument", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { status: "idle" },
    view: html`<div @show="equals? .status 'idle'" @hide="equals? .status $'busy'">x</div>`,
  });
  expect(lx.reports.filter((r) => r.id === CONSTANT_CONDITION).length).toBe(0);
});

test("CONSTANT_CONDITION warns on a predicate whose arguments are all literals", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div @show="equals? 'a' 'b'">x</div>`,
  });
  const found = lx.reports.filter((r) => r.id === CONSTANT_CONDITION);
  expect(found.length).toBe(1);
  expect(found[0].info.literal).toBe("equals? 'a' 'b'");
  expect(found[0].info.originAttr).toBe("@show");
});

test("a bad field inside a predicate argument is still reported", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { status: "idle" },
    view: html`<div @show="equals? .statsu 'idle'">x</div>`,
  });
  const found = lx.reports.filter((r) => r.id === FIELD_VAL_NOT_DEFINED);
  expect(found.length).toBe(1);
  expect(found[0].info.name).toBe("statsu");
});

test("CONSTANT_CONDITION does not warn on a boolean literal or a string in a text slot", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    // `true` is a deliberate constant; `'x'` in @text is a legit string literal.
    view: html`<div @show="true" @text="'x'">y</div>`,
  });
  expect(lx.reports.filter((r) => r.id === CONSTANT_CONDITION).length).toBe(0);
});

test("ASYNC_HANDLER does not flag synchronous handlers", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<button @on.click="go">go</button>`,
    input: {
      go() {
        return this;
      },
    },
    receive: {
      onMsg() {
        return this;
      },
    },
    bubble: {
      onEvt() {
        return this;
      },
    },
    response: {
      onRes() {
        return this;
      },
    },
    alter: {
      onAlt(_k, v) {
        return v;
      },
    },
  });
  expect(lx.reports.filter((r) => r.id === ASYNC_HANDLER).length).toBe(0);
});

const atRuleReports = (lx) => lx.reports.filter((r) => r.id === TOP_LEVEL_AT_RULE_IN_SCOPED_STYLE);
const selectorReports = (lx) => lx.reports.filter((r) => r.id === GLOBAL_SELECTOR_IN_SCOPED_STYLE);

test("TOP_LEVEL_AT_RULE_IN_SCOPED_STYLE flags non-nestable at-rules in commonStyle", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div></div>`,
    commonStyle: `@import url("x.css");\n@font-face { font-family: F; }\n@keyframes spin { to { opacity: 0; } }`,
  });
  const found = atRuleReports(lx);
  expect(found.map((r) => r.info.atRule).sort()).toEqual(["font-face", "import", "keyframes"]);
  expect(found[0].level).toBe("error");
  expect(found[0].info.key).toBe("commonStyle");
  expect(found[0].suggestion.kind).toBe("rephrase");
  expect(found[0].suggestion.text).toContain("globalStyle");
});

test("TOP_LEVEL_AT_RULE_IN_SCOPED_STYLE reports location and view context for a per-view style", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div></div>`,
    // line 1 is blank, the at-rule sits on line 2
    style: `\n  @keyframes spin { to { opacity: 0; } }`,
  });
  const found = atRuleReports(lx);
  expect(found.length).toBe(1);
  expect(found[0].info.key).toBe("style");
  expect(found[0].context.viewName).toBe("main");
  expect(found[0].info.location).toEqual({ line: 2, column: 3 });
});

test("TOP_LEVEL_AT_RULE_IN_SCOPED_STYLE matches vendor-prefixed keyframes", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div></div>`,
    commonStyle: `@-webkit-keyframes spin { to { opacity: 0; } }`,
  });
  expect(atRuleReports(lx).length).toBe(1);
});

test("nestable group rules in scoped style are not flagged", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div></div>`,
    commonStyle: `
      @media (min-width: 40em) { p { color: red; } }
      @supports (display: grid) { p { display: grid; } }
      @container (min-width: 10em) { p { color: blue; } }
      @layer base { p { margin: 0; } }
      @scope (p) { a { color: green; } }
      @starting-style { p { opacity: 0; } }
    `,
  });
  expect(atRuleReports(lx).length).toBe(0);
});

test("at-rules inside comments or strings are not flagged", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div></div>`,
    commonStyle: `/* @import should be ignored */ p::before { content: "@keyframes x"; }`,
  });
  expect(atRuleReports(lx).length).toBe(0);
});

test("globalStyle is never checked", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div></div>`,
    globalStyle: `@import url("x.css"); body { margin: 0; } @keyframes spin { to { opacity: 0; } }`,
  });
  expect(atRuleReports(lx).length).toBe(0);
  expect(selectorReports(lx).length).toBe(0);
});

test("tutuca-lint-ignore on the same line suppresses the finding", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div></div>`,
    commonStyle: `@import url("x.css"); /* tutuca-lint-ignore */`,
  });
  expect(atRuleReports(lx).length).toBe(0);
});

test("GLOBAL_SELECTOR_IN_SCOPED_STYLE flags a leading body/:root selector", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div></div>`,
    commonStyle: `body { margin: 0; }\n:root { --c: red; }`,
  });
  const found = selectorReports(lx);
  expect(found.map((r) => r.info.selector).sort()).toEqual([":root", "body"]);
  expect(found[0].level).toBe("error");
  expect(found[0].suggestion.text).toContain("globalStyle");
});

test("GLOBAL_SELECTOR_IN_SCOPED_STYLE ignores non-leading and :scope selectors", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div></div>`,
    commonStyle: `& body { color: red; }\ndiv body { color: red; }\n:scope p { color: red; }\np { color: body; }`,
  });
  expect(selectorReports(lx).length).toBe(0);
});

test("warn on unknown component spec key with did-you-mean suggestion", () => {
  const [lx, Comp] = defAndCheck({
    name: "Comp",
    view: html`<div></div>`,
    viw: "<span></span>",
  });
  expect(Comp.extra.viw).toBe("<span></span>");
  const matched = lx.reports.filter((r) => r.id === UNKNOWN_COMPONENT_SPEC_KEY);
  expect(matched.length).toBe(1);
  expect(matched[0].info.key).toBe("viw");
  expect(matched[0].level).toBe("warn");
  expect(matched[0].suggestion).toEqual({ kind: "replace-name", from: "viw", to: "view" });
});

test("wellKnownExtras suppresses unknown spec key warning", () => {
  const opts = { name: "Comp", view: html`<div></div>`, customAttr: { foo: 1 } };
  const [lxWithout] = defAndCheck(opts);
  expect(lxWithout.reports.filter((r) => r.id === UNKNOWN_COMPONENT_SPEC_KEY).length).toBe(1);

  const [lxWith] = defAndCheckWithExtras(opts, new Set(["customAttr"]));
  expect(lxWith.reports.filter((r) => r.id === UNKNOWN_COMPONENT_SPEC_KEY).length).toBe(0);
});

test("framework well-known extras (requestOverridesField) never warn", () => {
  const [lx, Comp] = defAndCheck({
    name: "Comp",
    view: html`<div></div>`,
    requestOverridesField: "requestHandlers",
  });
  expect(Comp.extra.requestOverridesField).toBe("requestHandlers");
  expect(lx.reports.filter((r) => r.id === UNKNOWN_COMPONENT_SPEC_KEY).length).toBe(0);
});

test("no UNKNOWN_COMPONENT_SPEC_KEY on a maximal legit spec", () => {
  const [lx, Comp] = defAndCheck({
    name: "MaxComp",
    view: html`<div></div>`,
    style: "",
    commonStyle: "",
    globalStyle: "",
    input: {},
    receive: {},
    bubble: {},
    response: {},
    alter: {},
    views: { other: "<i></i>" },
    provide: {},
    lookup: {},
    fields: {},
    methods: {},
    statics: {},
  });
  expect(Object.keys(Comp.extra).length).toBe(0);
  expect(lx.reports.filter((r) => r.id === UNKNOWN_COMPONENT_SPEC_KEY).length).toBe(0);
});

test("don't allow render-it outside a loop", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div><x render-it></x></div>`,
  });
  expect(lx.reports.length).toBe(1);
  expect(lx.reports[0].id).toBe(RENDER_IT_OUTSIDE_OF_LOOP);
});

test("allow two render-its inside the same loop", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div>
      <div @each=".items">
        <x render-it></x>
        <x render-it></x>
      </div>
    </div>`,
  });
  const ids = lx.reports.map((r) => r.id);
  expect(ids).not.toContain(RENDER_IT_OUTSIDE_OF_LOOP);
});

test("allow render-it with sibling x-show inside loop", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [], enabled: true },
    view: html`<div>
      <div @each=".items">
        <x render-it></x>
        <x show=".enabled"><span>a</span></x>
      </div>
    </div>`,
  });
  const ids = lx.reports.map((r) => r.id);
  expect(ids).not.toContain(RENDER_IT_OUTSIDE_OF_LOOP);
});

test("allow render-it deeply nested with sibling x-show inside loop", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [], enabled: true },
    view: html`<div>
      <div @each=".items">
        <section>
          <div>
            <x render-it></x>
            <x show=".enabled"><span>a</span></x>
          </div>
        </section>
      </div>
    </div>`,
  });
  const ids = lx.reports.map((r) => r.id);
  expect(ids).not.toContain(RENDER_IT_OUTSIDE_OF_LOOP);
});

test("flag render-it that is sibling of a loop (not inside it)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div>
      <x render-it></x>
      <div @each=".items"><span>x</span></div>
    </div>`,
  });
  const ids = lx.reports.map((r) => r.id);
  expect(ids).toContain(RENDER_IT_OUTSIDE_OF_LOOP);
});

test("warn on unknown event modifiers", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    input: { do() {} },
    view: html`<button @on.click+foo+alt="do">do it</button>`,
  });
  expect(lx.reports.length).toBe(1);
  const [
    {
      id,
      info: { name, modifier },
    },
  ] = lx.reports;
  expect(id).toBe(UNKNOWN_EVENT_MODIFIER);
  expect(name).toBe("click");
  expect(modifier).toBe("foo");
});

test("warn on unknown event handler arg name", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    input: { do() {} },
    view: html`<button @on.click="do foo event bar ctx">do it</button>`,
  });
  expect(lx.reports.length).toBe(2);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(UNKNOWN_HANDLER_ARG_NAME);
    expect(info.name).toBe("foo");
  }
  {
    const { id, info } = lx.reports[1];
    expect(id).toBe(UNKNOWN_HANDLER_ARG_NAME);
    expect(info.name).toBe("bar");
  }
});

test("warn on event handler in view with no impl", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    methods: {
      doClick() {},
    },
    input: {
      doKeyDown() {},
    },
    view: html`<button @on.click="doClick" @on.keydown="$doKeyDown">
      do it
    </button>`,
  });
  expect(lx.reports.length).toBe(4);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(INPUT_HANDLER_NOT_IMPLEMENTED);
    expect(info.name).toBe("doClick");
  }
  {
    const { id, info } = lx.reports[1];
    expect(id).toBe(INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER);
    expect(info.name).toBe("doClick");
  }
  {
    const { id, info } = lx.reports[2];
    expect(id).toBe(INPUT_HANDLER_METHOD_NOT_IMPLEMENTED);
    expect(info.name).toBe("doKeyDown");
  }
  {
    const { id, info } = lx.reports[3];
    expect(id).toBe(INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD);
    expect(info.name).toBe("doKeyDown");
  }
});

test("error when . reads a method, suggesting $", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { count: 0 },
    methods: { isReady() {} },
    view: html`<p @show=".isReady">hi</p>`,
  });
  const r = lx.reports.find((x) => x.id === FIELD_VAL_IS_METHOD);
  expect(r).toBeDefined();
  expect(r.info.name).toBe("isReady");
  expect(r.suggestion).toEqual({ kind: "rewrite", from: ".isReady", to: "$isReady" });
});

test("error when a field name collides with the Immutable Record API", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { entries: [], hashCode: 0, count: 0 },
    view: html`<p>hi</p>`,
  });
  const reports = lx.reports.filter((x) => x.id === FIELD_NAME_RESERVED_BY_RECORD);
  expect(reports.map((r) => r.info.name).sort()).toEqual(["entries", "hashCode"]);
});

test("no Record API collision for safe field names (size, keys, values)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { size: 0, keys: [], values: [], name: "" },
    view: html`<p>hi</p>`,
  });
  expect(lx.reports.some((x) => x.id === FIELD_NAME_RESERVED_BY_RECORD)).toBe(false);
});

test("error when $ calls a field, suggesting .", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { count: 0 },
    view: html`<p @text="$count">hi</p>`,
  });
  const r = lx.reports.find((x) => x.id === METHOD_VAL_IS_FIELD);
  expect(r).toBeDefined();
  expect(r.info.name).toBe("count");
  expect(r.suggestion).toEqual({ kind: "rewrite", from: "$count", to: ".count" });
});

test("error when $ names nothing defined", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { count: 0 },
    view: html`<p @text="$nope">hi</p>`,
  });
  const r = lx.reports.find((x) => x.id === METHOD_VAL_NOT_DEFINED);
  expect(r).toBeDefined();
  expect(r.info.name).toBe("nope");
});

test("warn on undefined field attr (field)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { name: "" },
    view: html`<p :title=".name" :id=".id" @text=".bar" @show=".isVisible">
      hi
    </p>`,
  });
  expect(lx.reports.length).toBe(3);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(FIELD_VAL_NOT_DEFINED);
    expect(info.name).toBe("id");
  }
  {
    const { id, info } = lx.reports[1];
    expect(id).toBe(FIELD_VAL_NOT_DEFINED);
    expect(info.name).toBe("isVisible");
  }
  {
    const { id, info } = lx.reports[2];
    expect(id).toBe(FIELD_VAL_NOT_DEFINED);
    expect(info.name).toBe("bar");
  }
});

test("warn on undefined field attr (string template)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { name: "" },
    view: html`<p :title="$'title is {.title}'">hi</p>`,
  });
  expect(lx.reports.length).toBe(1);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(FIELD_VAL_NOT_DEFINED);
    expect(info.name).toBe("title");
  }
});

test("boolean predicate: valid field emits no report", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div @hide="empty? .items">hi</div>`,
  });
  expect(lx.reports.length).toBe(0);
});

test("error on component-field declaration with class instead of string", () => {
  class FakeNode {}
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { root: { component: FakeNode, args: { keyName: "root" } } },
    view: html`<div></div>`,
  });
  const matched = lx.reports.filter((r) => r.id === COMP_FIELD_BAD_SHAPE);
  expect(matched.length).toBe(1);
  expect(matched[0].level).toBe("error");
  expect(matched[0].info.fieldName).toBe("root");
  expect(matched[0].info.kind).toBe("component-not-string");
  expect(matched[0].info.gotName).toBe("FakeNode");
});

test("error on component-field declaration with non-object args", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { child: { component: "Item", args: 42 } },
    view: html`<div></div>`,
  });
  const matched = lx.reports.filter((r) => r.id === COMP_FIELD_BAD_SHAPE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.fieldName).toBe("child");
  expect(matched[0].info.kind).toBe("args-not-object");
  expect(matched[0].info.got).toBe("number");
});

test("no COMP_FIELD_BAD_SHAPE on a well-formed component field", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { child: { component: "Item", args: { name: "" } } },
    view: html`<div></div>`,
  });
  expect(lx.reports.filter((r) => r.id === COMP_FIELD_BAD_SHAPE).length).toBe(0);
});

test("boolean predicate: undefined field arg warns", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div @hide="empty? .missing">hi</div>`,
  });
  expect(lx.reports.length).toBe(1);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(FIELD_VAL_NOT_DEFINED);
    expect(info.name).toBe("missing");
  }
});

test("boolean predicate: old generated predicate method usage warns", () => {
  // oo.js no longer generates is<Field>Empty/Truthy/Falsy/Null — a view still
  // naming one (e.g. `.isItemsEmpty`) must be flagged so it gets migrated to a
  // predicate (`empty? .items`).
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div @hide=".isItemsEmpty">hi</div>`,
  });
  expect(lx.reports.length).toBe(1);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(FIELD_VAL_NOT_DEFINED);
    expect(info.name).toBe("isItemsEmpty");
  }
});

test("warn on redundant single-placeholder template in :class (FieldVal)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { foo: "" },
    view: html`<p :class="$'{.foo}'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === REDUNDANT_TEMPLATE_STRING);
  expect(matched.length).toBe(1);
  const r = matched[0];
  expect(r.info.simpler).toBe(".foo");
  expect(r.info.originAttr).toBe(":class");
  expect(r.level).toBe("warn");
  expect(r.suggestion).toEqual({ kind: "rewrite", from: "$'{.foo}'", to: ".foo" });
});

test("warn on redundant template in :title", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { count: 0 },
    view: html`<p :title="$'{.count}'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === REDUNDANT_TEMPLATE_STRING);
  expect(matched.length).toBe(1);
  expect(matched[0].info.simpler).toBe(".count");
  expect(matched[0].info.originAttr).toBe(":title");
});

test("warn on redundant template in @text directive", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { msg: "" },
    view: html`<p @text="$'{.msg}'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === REDUNDANT_TEMPLATE_STRING);
  expect(matched.length).toBe(1);
  expect(matched[0].info.simpler).toBe(".msg");
});

test("no redundant-template warning when surrounding text is present", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { name: "" },
    view: html`<p :title="$'hello {.name}'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === REDUNDANT_TEMPLATE_STRING);
  expect(matched.length).toBe(0);
});

test("no redundant-template warning when multiple placeholders concatenate", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { a: "", b: "" },
    view: html`<p :class="$'{.a}{.b}'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === REDUNDANT_TEMPLATE_STRING);
  expect(matched.length).toBe(0);
});

test("no redundant-template warning for direct value reference", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { foo: "" },
    view: html`<p :class=".foo">x</p>`,
  });
  expect(lx.reports.length).toBe(0);
});

test("no redundant-template warning when bookends are whitespace, not empty", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { foo: "" },
    view: html`<p :class="$' {.foo} '">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === REDUNDANT_TEMPLATE_STRING);
  expect(matched.length).toBe(0);
});

test("redundant-template warning still recurses into the inner expression", () => {
  // Confirms the `for (const subVal of vs)` recursion was preserved — a
  // single-placeholder template referring to an undefined field should fire
  // BOTH REDUNDANT_TEMPLATE_STRING and FIELD_VAL_NOT_DEFINED.
  const [lx] = defAndCheck({
    name: "Comp",
    fields: {},
    view: html`<p :class="$'{.unknownField}'">x</p>`,
  });
  const ids = lx.reports.map((r) => r.id);
  expect(ids).toContain(REDUNDANT_TEMPLATE_STRING);
  expect(ids).toContain(FIELD_VAL_NOT_DEFINED);
});

test("hint on placeholderless string template in :title", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: {},
    view: html`<p :title="$'hello'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === PLACEHOLDERLESS_TEMPLATE_STRING);
  expect(matched.length).toBe(1);
  const r = matched[0];
  expect(r.level).toBe("hint");
  expect(r.info.literal).toBe("'hello'");
  expect(r.info.originAttr).toBe(":title");
  expect(r.suggestion).toEqual({ kind: "rewrite", from: "$'hello'", to: "'hello'" });
});

test("hint on template whose only placeholder is a constant", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: {},
    view: html`<p :title="$'width: {42}px'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === PLACEHOLDERLESS_TEMPLATE_STRING);
  expect(matched.length).toBe(1);
  expect(matched[0].info.literal).toBe("'width: 42px'");
});

test("no placeholderless hint when a placeholder is dynamic", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { name: "" },
    view: html`<p :title="$'hello {.name} bye'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === PLACEHOLDERLESS_TEMPLATE_STRING);
  expect(matched.length).toBe(0);
});

test("dynamic single-placeholder template stays REDUNDANT, not placeholderless", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { foo: "" },
    view: html`<p :class="$'{.foo}'">x</p>`,
  });
  const ids = lx.reports.map((r) => r.id);
  expect(ids).toContain(REDUNDANT_TEMPLATE_STRING);
  expect(ids).not.toContain(PLACEHOLDERLESS_TEMPLATE_STRING);
});

test("no placeholderless hint when a macro template's ^var resolves to a constant", () => {
  // The macro body `$'box {^class}'` has a real placeholder; binding it to a
  // constant at the call site must not make it look like a hand-written
  // literal — the call site cannot rewrite it without dropping the macro.
  const box = macro({ class: "''" }, html`<div :class="$'box {^class}'"><x:slot></x:slot></div>`);
  const [lx] = defAndCheckWithMacros(
    {
      name: "Comp",
      fields: {},
      view: html`<x:box class="wide">x</x:box>`,
    },
    { box },
  );
  expect(lx.reports.filter((r) => r.id === PLACEHOLDERLESS_TEMPLATE_STRING).length).toBe(0);
});

test("no placeholderless hint when a macro ^var defaults to an empty constant", () => {
  // `^class` defaults to `''`; the trailing placeholder still counts as
  // dynamic even though it resolved to an empty string and was the last part.
  const box = macro({ class: "''" }, html`<div :class="$'box {^class}'"><x:slot></x:slot></div>`);
  const [lx] = defAndCheckWithMacros(
    {
      name: "Comp",
      fields: {},
      view: html`<x:box>x</x:box>`,
    },
    { box },
  );
  expect(lx.reports.filter((r) => r.id === PLACEHOLDERLESS_TEMPLATE_STRING).length).toBe(0);
});

test("warn on undefined field in @if.class condition", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div @if.class=".myField" @then="'active'" @else="'inactive'">
      hi
    </div>`,
  });
  expect(lx.reports.length).toBe(1);
  const { id, info } = lx.reports[0];
  expect(id).toBe(FIELD_VAL_NOT_DEFINED);
  expect(info.name).toBe("myField");
});

test("warn on undefined field in @dangerouslysetinnerhtml", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div @dangerouslysetinnerhtml=".myField">hi</div>`,
  });
  expect(lx.reports.length).toBe(1);
  const { id, info } = lx.reports[0];
  expect(id).toBe(FIELD_VAL_NOT_DEFINED);
  expect(info.name).toBe("myField");
});

test("warn when attribute set by both literal and :attr (class)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { kind: "" },
    view: html`<div class="foo" :class=".kind">hi</div>`,
  });
  const dupes = lx.reports.filter((r) => r.id === DUPLICATE_ATTR_DEFINITION);
  expect(dupes.length).toBe(1);
  expect(dupes[0].info.name).toBe("class");
});

test("warn when attribute set by both literal and @if.X", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { isOpen: false },
    view: html`<div class="foo" @if.class=".isOpen" @then="'bar'">hi</div>`,
  });
  const dupes = lx.reports.filter((r) => r.id === DUPLICATE_ATTR_DEFINITION);
  expect(dupes.length).toBe(1);
  expect(dupes[0].info.name).toBe("class");
});

test("warn when attribute set by both :attr and @if.X", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { kind: "", isOpen: false },
    view: html`<div :class=".kind" @if.class=".isOpen" @then="'bar'">hi</div>`,
  });
  const dupes = lx.reports.filter((r) => r.id === DUPLICATE_ATTR_DEFINITION);
  expect(dupes.length).toBe(1);
  expect(dupes[0].info.name).toBe("class");
});

test("warn on triple definition: literal + :attr + @if.X", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { kind: "", isOpen: false },
    view: html`<div class="x" :class=".kind" @if.class=".isOpen" @then="'bar'">
      hi
    </div>`,
  });
  const dupes = lx.reports.filter((r) => r.id === DUPLICATE_ATTR_DEFINITION);
  expect(dupes.length).toBe(1);
  expect(dupes[0].info.name).toBe("class");
  expect(dupes[0].info.sources).toEqual(["literal", ":class", "@if.class"]);
});

test("warn on @if.X with no @then or @else branch", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { isEnabled: false },
    view: html`<div @if.class=".isEnabled">hi</div>`,
  });
  const matched = lx.reports.filter((r) => r.id === IF_NO_BRANCH_SET);
  expect(matched.length).toBe(1);
  expect(matched[0].info.attr).toBe("class");
});

test("no IF_NO_BRANCH_SET when @then is set", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { isEnabled: false },
    view: html`<div @if.class=".isEnabled" @then="'on'">hi</div>`,
  });
  const matched = lx.reports.filter((r) => r.id === IF_NO_BRANCH_SET);
  expect(matched.length).toBe(0);
});

test("no IF_NO_BRANCH_SET when @else is set", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { isEnabled: false },
    view: html`<div @if.class=".isEnabled" @else="'off'">hi</div>`,
  });
  const matched = lx.reports.filter((r) => r.id === IF_NO_BRANCH_SET);
  expect(matched.length).toBe(0);
});

test("warn on undefined seq and key", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: {
      a: [],
      d: 0,
    },
    view: html`<div>
      <x render=".a[.b]"></x>
      <x render=".c[.d]"></x>
    </div>`,
  });
  expect(lx.reports.length).toBe(2);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(FIELD_VAL_NOT_DEFINED);
    expect(info.name).toBe("b");
  }
  {
    const { id, info } = lx.reports[1];
    expect(id).toBe(FIELD_VAL_NOT_DEFINED);
    expect(info.name).toBe("c");
  }
});

test("warn on Type not in scope", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { name: "" },
    input: { do() {} },
    view: html`<button @on.click="do MyComp ctx">do it</button>`,
  });
  expect(lx.reports.length).toBe(1);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(UNKNOWN_COMPONENT_NAME);
    expect(info.name).toBe("MyComp");
  }
});

test("warn on undefined alt field for loop directives", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div>
      <div
        @each=".items"
        @when="myWhen"
        @enrich-with="myEnrich"
        @loop-with="myLoopWith"
      >
        <x render-it></x>
      </div>
    </div>`,
  });
  expect(lx.reports.length).toBe(3);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(ALT_HANDLER_NOT_DEFINED);
    expect(info.name).toBe("myWhen");
  }
  {
    const { id, info } = lx.reports[1];
    expect(id).toBe(ALT_HANDLER_NOT_DEFINED);
    expect(info.name).toBe("myEnrich");
  }
  {
    const { id, info } = lx.reports[2];
    expect(id).toBe(ALT_HANDLER_NOT_DEFINED);
    expect(info.name).toBe("myLoopWith");
  }
});

test("hint on input handler defined but not referenced", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    input: {
      usedClick() {},
      unusedInput() {},
    },
    view: html`<button @on.click="usedClick">ok</button>`,
  });
  expect(lx.reports.length).toBe(1);
  const { id, info, level } = lx.reports[0];
  expect(id).toBe(INPUT_HANDLER_NOT_REFERENCED);
  expect(info.name).toBe("unusedInput");
  expect(level).toBe("hint");
});

test("no unreferenced input hint when handler is referenced", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    input: {
      doClick() {},
    },
    view: html`<button @on.click="doClick">ok</button>`,
  });
  expect(lx.reports.length).toBe(0);
});

test("hint on alter handler defined but not referenced", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    alter: {
      usedEnrich(binds, k, v) {
        binds.label = `${k}:${v}`;
      },
      unusedAlter(_k, v) {
        return v;
      },
    },
    view: html`<div>
      <div @each=".items" @enrich-with="usedEnrich">
        <x render-it></x>
      </div>
    </div>`,
  });
  expect(lx.reports.length).toBe(1);
  const { id, info, level } = lx.reports[0];
  expect(id).toBe(ALT_HANDLER_NOT_REFERENCED);
  expect(info.name).toBe("unusedAlter");
  expect(level).toBe("hint");
});

test("no unreferenced hint when alter handlers are referenced via when/enrich-with/loop-with", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    alter: {
      myWhen() {
        return true;
      },
      myEnrich() {},
      myLoopWith() {},
    },
    view: html`<div>
      <div
        @each=".items"
        @when="myWhen"
        @enrich-with="myEnrich"
        @loop-with="myLoopWith"
      >
        <x render-it></x>
      </div>
    </div>`,
  });
  expect(lx.reports.length).toBe(0);
});

test("no unreferenced hint when a misspelled reference still names the handler", () => {
  // If a handler is referenced (even with a typo on the ref side), the defined
  // handler with that name is considered "intended for use" — no hint.
  const [lx] = defAndCheck({
    name: "Comp",
    fields: {},
    alter: {
      myEnrich() {},
    },
    view: html`<div @enrich-with="myEnrich"></div>`,
  });
  expect(lx.reports.length).toBe(0);
});

test("warn on undefined alt field for scope enrich-with directives", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: {},
    view: html`<div @enrich-with="myEnrich"></div>`,
  });
  expect(lx.reports.length).toBe(1);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(ALT_HANDLER_NOT_DEFINED);
    expect(info.name).toBe("myEnrich");
  }
});

test("lint-errors example catches all error types", () => {
  const [lx] = defAndCheck({
    name: "LintDemo",
    fields: { count: 0, items: [] },
    methods: {
      doClick() {
        return this;
      },
    },
    input: {
      doKeyDown() {},
    },
    view: html`<div>
      <p>Lint Errors Demo - check the Lint tab</p>

      <x render-it></x>

      <button @on.click+badmod="doKeyDown">bad modifier</button>

      <button @on.click="doKeyDown unknownArg event">unknown arg</button>

      <button @on.click="doClick">method as handler</button>

      <button @on.keydown="$doKeyDown">handler as method</button>

      <p :title=".missing">undefined field</p>

      <button @on.click="doKeyDown UnknownComp ctx">
        unknown comp
      </button>

      <div @enrich-with="myEnrich">undefined alter handler</div>

      <ul
        @each=".items"
        @when="myWhen"
        @enrich-with="myLoopEnrich"
        @loop-with="myLoopWith"
      >
        <li><x render-it></x></li>
      </ul>

      <p @text=".count">0</p>
    </div>`,
  });

  const ids = lx.reports.map((r) => r.id);

  expect(ids).toContain(RENDER_IT_OUTSIDE_OF_LOOP);
  expect(ids).toContain(UNKNOWN_EVENT_MODIFIER);
  expect(ids).toContain(UNKNOWN_HANDLER_ARG_NAME);
  expect(ids).toContain(INPUT_HANDLER_NOT_IMPLEMENTED);
  expect(ids).toContain(INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER);
  expect(ids).toContain(INPUT_HANDLER_METHOD_NOT_IMPLEMENTED);
  expect(ids).toContain(INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD);
  expect(ids).toContain(FIELD_VAL_NOT_DEFINED);
  expect(ids).toContain(UNKNOWN_COMPONENT_NAME);
  expect(ids).toContain(ALT_HANDLER_NOT_DEFINED);
});

test("findings carry componentName and viewName in context", () => {
  const [lx] = defAndCheck({
    name: "CtxComp",
    fields: { name: "" },
    views: {
      detail: html`<p :title=".missingInDetail">hi</p>`,
    },
    view: html`<p :title=".missingInMain">hi</p>`,
  });
  const byView = {};
  for (const r of lx.reports) {
    if (r.id !== FIELD_VAL_NOT_DEFINED) continue;
    expect(r.context.componentName).toBe("CtxComp");
    byView[r.info.name] = r.context.viewName;
  }
  expect(byView.missingInMain).toBe("main");
  expect(byView.missingInDetail).toBe("detail");
});

test("component-scoped findings carry componentName and no viewName", () => {
  const [lx] = defAndCheck({
    name: "UnrefComp",
    alter: {
      unusedAlter() {},
    },
    view: html`<p>hi</p>`,
  });
  const unused = lx.reports.find((r) => r.id === ALT_HANDLER_NOT_REFERENCED);
  expect(unused).toBeDefined();
  expect(unused.context.componentName).toBe("UnrefComp");
  expect(unused.context.viewName).toBeUndefined();
});

test("lint-errors example with LintClassCollectorCtx catches all error types", () => {
  class HeadlessLintClassCollectorCtx extends LintClassCollectorCtx {
    constructor() {
      super(document, Text, Comment);
    }
  }

  const Comp = component({
    name: "LintDemo",
    fields: { count: 0, items: [] },
    methods: {
      doClick() {
        return this;
      },
    },
    input: {
      doKeyDown() {},
    },
    view: html`<div>
      <p>Lint Errors Demo - check the Lint tab</p>

      <x render-it></x>

      <button @on.click+badmod="doKeyDown">bad modifier</button>

      <button @on.click="doKeyDown unknownArg event">unknown arg</button>

      <button @on.click="doClick">method as handler</button>

      <button @on.keydown="$doKeyDown">handler as method</button>

      <p :title=".missing">undefined field</p>

      <button @on.click="doKeyDown UnknownComp ctx">
        unknown comp
      </button>

      <div @enrich-with="myEnrich">undefined alter handler</div>

      <ul
        @each=".items"
        @when="myWhen"
        @enrich-with="myLoopEnrich"
        @loop-with="myLoopWith"
      >
        <li><x render-it></x></li>
      </ul>

      <p @text=".count">0</p>
    </div>`,
  });
  Comp.scope = new ComponentStack();
  Comp.compile(HeadlessLintClassCollectorCtx);
  const lx = checkComponent(Comp);

  const ids = lx.reports.map((r) => r.id);

  expect(ids).toContain(RENDER_IT_OUTSIDE_OF_LOOP);
  expect(ids).toContain(UNKNOWN_EVENT_MODIFIER);
  expect(ids).toContain(UNKNOWN_HANDLER_ARG_NAME);
  expect(ids).toContain(INPUT_HANDLER_NOT_IMPLEMENTED);
  expect(ids).toContain(INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER);
  expect(ids).toContain(INPUT_HANDLER_METHOD_NOT_IMPLEMENTED);
  expect(ids).toContain(INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD);
  expect(ids).toContain(FIELD_VAL_NOT_DEFINED);
  expect(ids).toContain(UNKNOWN_COMPONENT_NAME);
  expect(ids).toContain(ALT_HANDLER_NOT_DEFINED);
});

test("macro invocation :handler NameVal does not warn; ^handler in body expands to HandlerNameVal", () => {
  const btn = macro(
    { handler: "onAction", arg: "event" },
    html`<button @on.click="^handler ^arg"></button>`,
  );
  const Comp = component({
    name: "Comp",
    input: { onDo() {} },
    view: html`<div><x:btn :handler="onDo" :arg="event"></x:btn></div>`,
  });
  Comp.scope = new ComponentStack();
  Comp.scope.registerMacros({ btn });
  Comp.compile(HeadlessLintParseContext);
  const lx = checkComponent(Comp);

  const view = Comp.views.main;

  const clickEvents = view.ctx.events.filter((ev) => ev.handlers.some((h) => h.name === "click"));
  expect(clickEvents.length).toBe(1);
  const clickHandler = clickEvents[0].handlers.find((h) => h.name === "click");
  const { handlerVal } = clickHandler.handlerCall;
  expect(handlerVal.constructor.name).toBe("HandlerNameVal");
  expect(handlerVal.name).toBe("onDo");

  const outerAttrEntry = view.ctx.attrs.find(
    (e) =>
      e.attrs?.constructor.name === "DynAttrs" &&
      e.attrs.items.some((a) => a?.constructor.name === "Attr" && a.name === "handler"),
  );
  expect(outerAttrEntry).toBeDefined();
  const handlerAttr = outerAttrEntry.attrs.items.find(
    (a) => a?.constructor.name === "Attr" && a.name === "handler",
  );
  expect(handlerAttr.val.constructor.name).toBe("NameVal");
  expect(handlerAttr.val.name).toBe("onDo");

  const unknownHandlerReports = lx.reports.filter(
    (r) => r.id === UNKNOWN_HANDLER_ARG_NAME && r.info.name === "onDo",
  );
  expect(unknownHandlerReports.length).toBe(0);
});

test("x render-each with when referencing defined alter handler emits nothing", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    alter: {
      filterItem() {
        return true;
      },
    },
    view: html`<div><x render-each=".items" @when="filterItem"></x></div>`,
  });
  expect(lx.reports.length).toBe(0);
});

test("x render-each with undefined when/loop-with handlers is flagged (sugar EachNode still checked)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div><x render-each=".items" @when="missingWhen" loop-with="missingLoop"></x></div>`,
  });
  const flagged = lx.reports
    .filter((r) => r.id === ALT_HANDLER_NOT_DEFINED)
    .map((r) => r.info.name);
  expect(flagged).toContain("missingWhen");
  expect(flagged).toContain("missingLoop");
});

test("warn on macro call with arg not declared in macro defaults", () => {
  const btn = macro({ label: "click" }, html`<button>^label</button>`);
  const Comp = component({
    name: "Comp",
    view: html`<div><x:btn :label="go" :extra="oops"></x:btn></div>`,
  });
  Comp.scope = new ComponentStack();
  Comp.scope.registerMacros({ btn });
  Comp.compile(HeadlessLintParseContext);
  const lx = checkComponent(Comp);

  const unknownArgs = lx.reports.filter((r) => r.id === UNKNOWN_MACRO_ARG);
  expect(unknownArgs.length).toBe(1);
  expect(unknownArgs[0].info.name).toBe("extra");
  expect(unknownArgs[0].info.macroName).toBe("btn");
});

test("warn on unknown @directive", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div @bogus="hello">hi</div>`,
  });
  const matched = lx.reports.filter((r) => r.id === UNKNOWN_DIRECTIVE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.name).toBe("bogus");
  expect(matched[0].info.value).toBe("hello");
});

test("warn on unknown @directive with prefix-like name (no dot)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div @on="oops">hi</div>`,
  });
  const matched = lx.reports.filter((r) => r.id === UNKNOWN_DIRECTIVE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.name).toBe("on");
  expect(matched[0].info.value).toBe("oops");
});

test("known @directives do not raise UNKNOWN_DIRECTIVE", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { name: "x", isOpen: false },
    input: { do() {} },
    view: html`<div @show=".isOpen" @text=".name" @on.click="do" @if.class=".isOpen" @then="'a'">
      hi
    </div>`,
  });
  const unknown = lx.reports.filter((r) => r.id === UNKNOWN_DIRECTIVE);
  expect(unknown.length).toBe(0);
});

test("X_OP_IGNORES_CHILDREN warns when render/render-it/render-each/text carry children", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [], obj: null, name: "" },
    view: html`<div>
      <x render=".obj"><p>hi</p></x>
      <x text=".name">dropped</x>
      <x render-each=".items"><span>row</span></x>
      <div @each=".items"><x render-it><b>item</b></x></div>
    </div>`,
  });
  const warns = lx.reports.filter((r) => r.id === X_OP_IGNORES_CHILDREN);
  expect(warns.length).toBe(4);
  expect(warns.every((w) => w.level === "warn")).toBe(true);
  expect(warns.map((w) => w.info.op).sort()).toEqual([
    "render",
    "render-each",
    "render-it",
    "text",
  ]);
  expect(warns[0].suggestion).toEqual({ kind: "remove", what: "the ignored children" });
});

test("no X_OP_IGNORES_CHILDREN when the child-ignoring ops are empty", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [], obj: null, name: "" },
    view: html`<div>
      <x render=".obj"></x>
      <x text=".name"></x>
      <x render-each=".items"></x>
      <div @each=".items"><x render-it></x></div>
    </div>`,
  });
  expect(lx.reports.filter((r) => r.id === X_OP_IGNORES_CHILDREN).length).toBe(0);
});

test("no X_OP_IGNORES_CHILDREN for whitespace-only or comment-only children", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { obj: null },
    // <x> children are NOT whitespace-condensed, so the newline/indent between the
    // tags is a real whitespace TextNode child; a comment must be ignored by type.
    view: html`<div>
      <x render=".obj">
      </x>
      <x render=".obj"><!-- just a note --></x>
    </div>`,
  });
  expect(lx.reports.filter((r) => r.id === X_OP_IGNORES_CHILDREN).length).toBe(0);
});

test("no X_OP_IGNORES_CHILDREN for child-using ops (show/slot) or bare <x> fragment", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { isOpen: false },
    view: html`<div>
      <x show=".isOpen"><p>shown</p></x>
      <x slot="body"><p>slotted</p></x>
      <x><p>fragment child</p></x>
    </div>`,
  });
  expect(lx.reports.filter((r) => r.id === X_OP_IGNORES_CHILDREN).length).toBe(0);
});

test("warn on unknown <x> op", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div><x bogus="hello"></x></div>`,
  });
  const matched = lx.reports.filter((r) => r.id === UNKNOWN_X_OP);
  expect(matched.length).toBe(1);
  expect(matched[0].info.name).toBe("bogus");
  expect(matched[0].info.value).toBe("hello");
});

test("warn on unknown pseudo-x op", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div @x bogus="hello"></div>`,
  });
  const matched = lx.reports.filter((r) => r.id === UNKNOWN_X_OP);
  expect(matched.length).toBe(1);
  expect(matched[0].info.name).toBe("bogus");
  expect(matched[0].info.value).toBe("hello");
});

test("warn on unknown extra attr on x render-each", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div><x render-each=".items" bogus="nope"></x></div>`,
  });
  const matched = lx.reports.filter((r) => r.id === UNKNOWN_X_ATTR);
  expect(matched.length).toBe(1);
  expect(matched[0].info.op).toBe("render-each");
  expect(matched[0].info.name).toBe("bogus");
  expect(matched[0].info.value).toBe("nope");
});

test("warn on unknown extra attr on x render-it", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div>
      <div @each=".items"><x render-it bogus="nope"></x></div>
    </div>`,
  });
  const matched = lx.reports.filter((r) => r.id === UNKNOWN_X_ATTR);
  expect(matched.length).toBe(1);
  expect(matched[0].info.op).toBe("render-it");
  expect(matched[0].info.name).toBe("bogus");
});

test("@show directive is accepted on an <x> op (no drop-@ hint)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { isOpen: false },
    view: html`<div>
      <div @each=".isOpen"><x render-it @show=".isOpen"></x></div>
    </div>`,
  });
  expect(lx.reports.filter((r) => r.id === UNKNOWN_X_ATTR).length).toBe(0);
  expect(lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX).length).toBe(0);
  expect(lx.reports.filter((r) => r.id === DEPRECATED_BARE_X_DIRECTIVE).length).toBe(0);
});

test("@hide directive is accepted on an <x> op (no drop-@ hint)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { isOpen: false },
    view: html`<div>
      <div @each=".isOpen"><x render-it @hide=".isOpen"></x></div>
    </div>`,
  });
  expect(lx.reports.filter((r) => r.id === UNKNOWN_X_ATTR).length).toBe(0);
  expect(lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX).length).toBe(0);
  expect(lx.reports.filter((r) => r.id === DEPRECATED_BARE_X_DIRECTIVE).length).toBe(0);
});

test("@when directive is accepted on <x render-each> (no drop-@ hint)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    alter: {
      filterItem() {
        return true;
      },
    },
    view: html`<div><x render-each=".items" @when="filterItem"></x></div>`,
  });
  expect(lx.reports.filter((r) => r.id === UNKNOWN_X_ATTR).length).toBe(0);
  expect(lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX).length).toBe(0);
  expect(lx.reports.filter((r) => r.id === DEPRECATED_BARE_X_DIRECTIVE).length).toBe(0);
});

// TEMPORARY (2026-07-08): bare `show`/`hide`/`when` on `<x>` ops parse but warn.
// Remove with the bare spelling — see docs/spec/simplification-plan.md item 3.
test("DEPRECATED_BARE_X_DIRECTIVE warns on bare show/hide/when on <x> ops", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [], isOpen: false, name: "" },
    alter: {
      filterItem() {
        return true;
      },
      getIterData() {
        return { start: 0, end: 1 };
      },
    },
    view: html`<div>
      <x text=".name" show=".isOpen"></x>
      <div @each=".items"><x render-it hide=".isOpen"></x></div>
      <x render-each=".items" when="filterItem"></x>
      <x render-each=".items" loop-with="getIterData"></x>
    </div>`,
  });
  const warns = lx.reports.filter((r) => r.id === DEPRECATED_BARE_X_DIRECTIVE);
  expect(warns.length).toBe(4);
  expect(warns.every((w) => w.level === "warn")).toBe(true);
  expect(warns.map((w) => w.info.name).sort()).toEqual(["hide", "loop-with", "show", "when"]);
  const loopWarn = warns.find((w) => w.info.name === "loop-with");
  expect(loopWarn.suggestion).toEqual({ kind: "add-prefix", from: "loop-with", to: "@loop-with" });
  const showWarn = warns.find((w) => w.info.name === "show");
  expect(showWarn.info.op).toBe("text");
  expect(showWarn.suggestion).toEqual({ kind: "add-prefix", from: "show", to: "@show" });
  // no drop-@ hint or unknown-attr error for the bare form
  expect(lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX).length).toBe(0);
  expect(lx.reports.filter((r) => r.id === UNKNOWN_X_ATTR).length).toBe(0);
});

test("@loop-with on <x render-each> is the preferred spelling (no attr error, no nudge)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    alter: {
      getIter() {
        return { start: 0, end: 1 };
      },
    },
    view: html`<div><x render-each=".items" @loop-with="getIter"></x></div>`,
  });
  expect(lx.reports.filter((r) => r.id === UNKNOWN_X_ATTR).length).toBe(0);
  expect(lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX).length).toBe(0);
  expect(lx.reports.filter((r) => r.id === DEPRECATED_BARE_X_DIRECTIVE).length).toBe(0);
});

test("hint when unknown-x-attr name is @-prefixed consumed (@as)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { item: null },
    view: html`<div><x render=".item" @as="edit"></x></div>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX);
  expect(hints.length).toBe(1);
  expect(hints[0].info.suggestion).toBe("as");
});

test("hint when unknown-x-op name is @-prefixed op (@text)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { name: "" },
    view: html`<div><x @text=".name"></x></div>`,
  });
  const errors = lx.reports.filter((r) => r.id === UNKNOWN_X_OP);
  expect(errors.length).toBe(1);
  expect(errors[0].info.name).toBe("@text");
  const hints = lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX);
  expect(hints.length).toBe(1);
  expect(hints[0].info.suggestion).toBe("text");
});

test("hint when unknown-x-op name is @-prefixed op (@render-each)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div><x @render-each=".items"></x></div>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX);
  expect(hints.length).toBe(1);
  expect(hints[0].info.suggestion).toBe("render-each");
});

test("hint when unknown-x-op via pseudo-x is @-prefixed (@show)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { isOpen: false },
    view: html`<div @x @show=".isOpen"></div>`,
  });
  const errors = lx.reports.filter((r) => r.id === UNKNOWN_X_OP);
  expect(errors.length).toBe(1);
  const hints = lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX);
  expect(hints.length).toBe(1);
  expect(hints[0].info.suggestion).toBe("show");
});

test("no hint when unknown-x-attr has no @-prefix", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div><x render-each=".items" bogus="x"></x></div>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX);
  expect(hints.length).toBe(0);
});

test("no hint when unknown-x-attr @-prefix tail is not a known name", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div><x render-each=".items" @bogus="x"></x></div>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX);
  expect(hints.length).toBe(0);
});

test("no hint when unknown-x-op @-prefix tail is not a known op", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div><x @bogus="x"></x></div>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX);
  expect(hints.length).toBe(0);
});

test("hint when iteration filter is written bare on a host element (when)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    alter: { filterItem: (_k, v) => Boolean(v) },
    view: html`<ul><li @each=".items" when="filterItem"><x text="@value"></x></li></ul>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_ADD_AT_PREFIX);
  expect(hints.length).toBe(1);
  expect(hints[0].level).toBe("hint");
  expect(hints[0].info.name).toBe("when");
  expect(hints[0].info.tag).toBe("LI");
  expect(hints[0].info.suggestion).toBe("@when");
  expect(hints[0].suggestion).toEqual({ kind: "add-prefix", from: "when", to: "@when" });
});

test("hint when conditional wrapper is written bare on a host element (show)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { isOpen: false },
    view: html`<div show=".isOpen">content</div>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_ADD_AT_PREFIX);
  expect(hints.length).toBe(1);
  expect(hints[0].info.suggestion).toBe("@show");
});

test("hint for bare host directive fires alongside a dynamic attribute (DynAttrs)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [], title: "" },
    alter: { filterItem: (_k, v) => Boolean(v) },
    view: html`<ul :title=".title"><li @each=".items" when="filterItem"><x text="@value"></x></li></ul>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_ADD_AT_PREFIX);
  expect(hints.length).toBe(1);
  expect(hints[0].info.name).toBe("when");
});

test("no MAYBE_ADD_AT_PREFIX hint for the correct @-prefixed host directive", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    alter: { filterItem: (_k, v) => Boolean(v) },
    view: html`<ul><li @each=".items" @when="filterItem"><x text="@value"></x></li></ul>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_ADD_AT_PREFIX);
  expect(hints.length).toBe(0);
});

test("no MAYBE_ADD_AT_PREFIX hint for the bare form on <x render-each>", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    alter: { filterItem: (_k, v) => Boolean(v) },
    view: html`<div><x render-each=".items" when="filterItem"></x></div>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_ADD_AT_PREFIX);
  expect(hints.length).toBe(0);
});

test("no MAYBE_ADD_AT_PREFIX hint for `slot` (a real global HTML attribute)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div slot="actions">x</div>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_ADD_AT_PREFIX);
  expect(hints.length).toBe(0);
});

test("no @-prefix hint on plain @directive (UNKNOWN_DIRECTIVE)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div @bogus="x"></div>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX);
  expect(hints.length).toBe(0);
});

test("known x render-each extras (as/when/loop-with) do not raise UNKNOWN_X_ATTR", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    alter: {
      myWhen() {
        return true;
      },
      myLoopWith(seq) {
        return { seq };
      },
    },
    view: html`<div>
      <x render-each=".items" as="row" when="myWhen" loop-with="myLoopWith"></x>
    </div>`,
  });
  const unknown = lx.reports.filter((r) => r.id === UNKNOWN_X_ATTR);
  expect(unknown.length).toBe(0);
});

test("show/hide on render* and text x ops do not raise UNKNOWN_X_ATTR", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [], isOpen: false, name: "" },
    view: html`<div>
      <x text=".name" show=".isOpen"></x>
      <div @each=".items"><x render-it hide=".isOpen"></x></div>
      <x render-each=".items" show=".isOpen"></x>
    </div>`,
  });
  const unknown = lx.reports.filter((r) => r.id === UNKNOWN_X_ATTR);
  expect(unknown.length).toBe(0);
});

test("known <x> ops do not raise UNKNOWN_X_OP", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [], name: "x", isOpen: false },
    view: html`<div>
      <x text=".name"></x>
      <x show=".isOpen"><span>a</span></x>
      <x render-each=".items"></x>
    </div>`,
  });
  const unknown = lx.reports.filter((r) => r.id === UNKNOWN_X_OP);
  expect(unknown.length).toBe(0);
});

test("BAD_VALUE on bad attr value (invalid identifier)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p :class=".123bad">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("attr");
  expect(matched[0].info.attr).toBe("class");
  expect(matched[0].info.value).toBe(".123bad");
});

test("BAD_VALUE on empty attr value", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p :class="">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("attr");
});

test("BAD_VALUE on bad @text directive value", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p @text=".123bad">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("directive");
  expect(matched[0].info.directive).toBe("text");
});

test("BAD_VALUE on bad @show directive value", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p @show=".123bad">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("directive");
  expect(matched[0].info.directive).toBe("show");
});

test("BAD_VALUE on bad @each directive value", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<li @each=".123bad">x</li>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("directive");
  expect(matched[0].info.directive).toBe("each");
});

test("BAD_VALUE on bad @if condition value", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p @if.class=".123bad" @then="'a'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("if");
  expect(matched[0].info.attr).toBe("class");
});

test("BAD_VALUE on bad <x render> value", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div><x render=".123bad"></x></div>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("x-op");
  expect(matched[0].info.op).toBe("render");
});

test("BAD_VALUE on bad <x text> value", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div><x text=".123bad"></x></div>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("x-op");
  expect(matched[0].info.op).toBe("text");
});

test("BAD_VALUE on bad <x render-each> value", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div><x render-each=".123bad"></x></div>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("x-op");
  expect(matched[0].info.op).toBe("render-each");
});

test("BAD_VALUE on bad event handler name", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<button @on.click="123bad">x</button>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("handler-name");
});

test("BAD_VALUE on bad event handler arg", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    input: { doThing() {} },
    view: html`<button @on.click="doThing 123bad">x</button>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("handler-arg");
});

test("BAD_VALUE on undefined macro var ^foo outside macro", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p :class="^undefined">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBeGreaterThan(0);
  expect(matched.some((m) => m.info.role === "macro-var")).toBe(true);
});

test("one-level binding member read lints clean", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<ul>
      <li @each=".items" @text="@value.title"></li>
    </ul>`,
  });
  const ids = new Set([BAD_VALUE, BINDING_MEMBER_TOO_DEEP, UNSUPPORTED_EXPR_SYNTAX]);
  expect(lx.reports.filter((r) => ids.has(r.id)).length).toBe(0);
});

test("BINDING_MEMBER_TOO_DEEP on a two-level binding read", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<ul>
      <li @each=".items" @text="@value.a.b"></li>
    </ul>`,
  });
  const matched = lx.reports.filter((r) => r.id === BINDING_MEMBER_TOO_DEEP);
  expect(matched.length).toBe(1);
  expect(matched[0].info.value).toBe("@value.a.b");
  expect(matched[0].suggestion.kind).toBe("rephrase");
  expect(matched[0].suggestion.text).toContain("one level");
  expect(lx.reports.filter((r) => r.id === BAD_VALUE).length).toBe(0);
});

test("UNSUPPORTED_EXPR_SYNTAX field-path on a dotted field read", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p @text=".user.name">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === UNSUPPORTED_EXPR_SYNTAX);
  expect(matched.length).toBe(1);
  expect(matched[0].info.detected).toBe("field-path");
  expect(matched[0].suggestion.text).toContain("@value.member");
  expect(lx.reports.filter((r) => r.id === BAD_VALUE).length).toBe(0);
});

test("SUGGEST_BINDING_MEMBER on a pure-projection @enrich-with handler", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    alter: {
      project(binds, key, value) {
        binds.label = value.title;
        binds.tone = value.get("color");
      },
    },
    view: html`<ul>
      <li @each=".items" @enrich-with="project" :data-tone="@tone" @text="@label"></li>
    </ul>`,
  });
  const matched = lx.reports.filter((r) => r.id === SUGGEST_BINDING_MEMBER);
  expect(matched.length).toBe(1);
  expect(matched[0].info.name).toBe("project");
  expect(matched[0].info.members).toEqual([
    { bind: "label", member: "title" },
    { bind: "tone", member: "color" },
  ]);
  expect(matched[0].suggestion.text).toContain("'@label' -> '@value.title'");
});

test("no SUGGEST_BINDING_MEMBER when the enrich handler derives data", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    alter: {
      derive(binds, key, value) {
        binds.total = value.a + value.b;
      },
    },
    view: html`<ul>
      <li @each=".items" @enrich-with="derive" @text="@total"></li>
    </ul>`,
  });
  expect(lx.reports.filter((r) => r.id === SUGGEST_BINDING_MEMBER).length).toBe(0);
});

test("UNSUPPORTED_EXPR_SYNTAX on ternary in :class", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p :class=".isSelected ? 'a' : 'b'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === UNSUPPORTED_EXPR_SYNTAX);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("attr");
  expect(matched[0].info.attr).toBe("class");
  expect(matched[0].info.detected).toBe("ternary");
  expect(matched[0].suggestion.kind).toBe("rephrase");
  expect(matched[0].suggestion.from).toBe(".isSelected ? 'a' : 'b'");
  expect(typeof matched[0].suggestion.text).toBe("string");
  expect(matched[0].suggestion.text.length).toBeGreaterThan(0);
  expect(lx.reports.filter((r) => r.id === BAD_VALUE).length).toBe(0);
});

test("UNSUPPORTED_EXPR_SYNTAX on comparison in :class", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p :class=".view === 'foo'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === UNSUPPORTED_EXPR_SYNTAX);
  expect(matched.length).toBe(1);
  expect(matched[0].info.detected).toBe("comparison");
  expect(matched[0].info.value).toBe(".view === 'foo'");
});

test("UNSUPPORTED_EXPR_SYNTAX on logical operator in :class", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p :class=".a && .b">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === UNSUPPORTED_EXPR_SYNTAX);
  expect(matched.length).toBe(1);
  expect(matched[0].info.detected).toBe("logical");
});

test("UNSUPPORTED_EXPR_SYNTAX on method call with arguments in :class", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p :class=".isViewSelected 'foo'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === UNSUPPORTED_EXPR_SYNTAX);
  expect(matched.length).toBe(1);
  expect(matched[0].info.detected).toBe("call-with-args");
});

test("UNSUPPORTED_EXPR_SYNTAX also fires for directive values", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p @show=".a === 'b'">x</p>`,
  });
  const matched = lx.reports.filter((r) => r.id === UNSUPPORTED_EXPR_SYNTAX);
  expect(matched.length).toBe(1);
  expect(matched[0].info.role).toBe("directive");
  expect(matched[0].info.detected).toBe("comparison");
});

test("BAD_VALUE still fires for unrecognized invalid expressions", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<p :class=".123bad">x</p>`,
  });
  expect(lx.reports.filter((r) => r.id === BAD_VALUE).length).toBe(1);
  expect(lx.reports.filter((r) => r.id === UNSUPPORTED_EXPR_SYNTAX).length).toBe(0);
});

test("good values do not raise BAD_VALUE", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [], name: "x", isOpen: false },
    input: { doThing() {} },
    view: html`<div>
      <p :class=".name" @text=".name" @show=".isOpen"></p>
      <li @each=".items">x</li>
      <p @if.class=".isOpen" @then="'a'" @else="'b'">x</p>
      <button @on.click="doThing event">x</button>
      <x render-each=".items"></x>
    </div>`,
  });
  const matched = lx.reports.filter((r) => r.id === BAD_VALUE);
  expect(matched.length).toBe(0);
});

// ─────────────────────────────────────────────────────────────────────────
// suggestion field — "did you mean" / mechanical-fix hints attached to the
// finding rather than embedded in the message.
// ─────────────────────────────────────────────────────────────────────────

test("UNKNOWN_HANDLER_ARG_NAME suggests closest known handler arg", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    input: { do() {} },
    view: html`<button @on.click="do valueAsint">x</button>`,
  });
  const r = lx.reports.find((x) => x.id === UNKNOWN_HANDLER_ARG_NAME);
  expect(r.suggestion).toEqual({ kind: "replace-name", from: "valueAsint", to: "valueAsInt" });
});

test("UNKNOWN_HANDLER_ARG_NAME has no suggestion when nothing is close", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    input: { do() {} },
    view: html`<button @on.click="do completelyUnrelatedXyz">x</button>`,
  });
  const r = lx.reports.find((x) => x.id === UNKNOWN_HANDLER_ARG_NAME);
  expect(r.suggestion).toBeNull();
});

test("FIELD_VAL_NOT_DEFINED suggests closest field", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { userName: "" },
    view: html`<p :title=".usrName">x</p>`,
  });
  const r = lx.reports.find((x) => x.id === FIELD_VAL_NOT_DEFINED);
  expect(r.suggestion).toEqual({ kind: "replace-name", from: "usrName", to: "userName" });
});

test("INPUT_HANDLER_NOT_IMPLEMENTED suggests add-prefix when method exists", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    methods: { doClick() {} },
    view: html`<button @on.click="doClick">x</button>`,
  });
  const r = lx.reports.find((x) => x.id === INPUT_HANDLER_NOT_IMPLEMENTED);
  expect(r.suggestion).toEqual({ kind: "add-prefix", from: "doClick", to: "$doClick" });
});

test("INPUT_HANDLER_METHOD_NOT_IMPLEMENTED suggests drop-prefix when input handler exists", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    input: { doKeyDown() {} },
    view: html`<button @on.keydown="$doKeyDown">x</button>`,
  });
  const r = lx.reports.find((x) => x.id === INPUT_HANDLER_METHOD_NOT_IMPLEMENTED);
  expect(r.suggestion).toEqual({ kind: "drop-prefix", from: "$doKeyDown", to: "doKeyDown" });
});

test("INPUT_HANDLER_NOT_IMPLEMENTED suggests closest input handler on typo", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    input: { doSubmit() {} },
    view: html`<button @on.click="doSumbit">x</button>`,
  });
  const r = lx.reports.find((x) => x.id === INPUT_HANDLER_NOT_IMPLEMENTED);
  expect(r.suggestion).toEqual({ kind: "replace-name", from: "doSumbit", to: "doSubmit" });
});

test("MAYBE_DROP_AT_PREFIX hint carries drop-prefix suggestion on the finding", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div><x render-each=".items" @as="edit"></x></div>`,
  });
  const hint = lx.reports.find((x) => x.id === MAYBE_DROP_AT_PREFIX);
  expect(hint.suggestion).toEqual({ kind: "drop-prefix", from: "@as", to: "as" });
});

test("UNKNOWN_X_OP carries the same drop-prefix suggestion as its hint", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { name: "" },
    view: html`<div><x @text=".name"></x></div>`,
  });
  const err = lx.reports.find((x) => x.id === UNKNOWN_X_OP);
  expect(err.suggestion).toEqual({ kind: "drop-prefix", from: "@text", to: "text" });
});

test("UNKNOWN_DIRECTIVE suggests closest known directive", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div @enrichwith="x">hi</div>`,
  });
  const r = lx.reports.find((x) => x.id === UNKNOWN_DIRECTIVE);
  expect(r.suggestion).toEqual({ kind: "replace-name", from: "enrichwith", to: "enrich-with" });
});

test("UNKNOWN_X_OP suggests closest x op on plain typo", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div><x redner-each=".items"></x></div>`,
  });
  const r = lx.reports.find((x) => x.id === UNKNOWN_X_OP);
  expect(r.suggestion).toEqual({ kind: "replace-name", from: "redner-each", to: "render-each" });
});

test("UNKNOWN_EVENT_MODIFIER suggests closest known modifier for the event", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    input: { do() {} },
    view: html`<button @on.click+ctl="do">x</button>`,
  });
  const r = lx.reports.find((x) => x.id === UNKNOWN_EVENT_MODIFIER);
  expect(r.suggestion).toEqual({ kind: "replace-name", from: "+ctl", to: "+ctrl" });
});

test("ALT_HANDLER_NOT_DEFINED suggests closest alter handler", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    alter: { myEnrich() {} },
    view: html`<div><div @each=".items" @enrich-with="myEnrch"><x render-it></x></div></div>`,
  });
  const r = lx.reports.find((x) => x.id === ALT_HANDLER_NOT_DEFINED);
  expect(r.suggestion).toEqual({ kind: "replace-name", from: "myEnrch", to: "myEnrich" });
});

test("UNKNOWN_MACRO_ARG suggests closest declared arg", () => {
  const btn = macro({ label: "click" }, html`<button>^label</button>`);
  const Comp = component({
    name: "Comp",
    view: html`<div><x:btn :lable="go"></x:btn></div>`,
  });
  Comp.scope = new ComponentStack();
  Comp.scope.registerMacros({ btn });
  Comp.compile(HeadlessLintParseContext);
  const lx = checkComponent(Comp);
  const r = lx.reports.find((x) => x.id === UNKNOWN_MACRO_ARG);
  expect(r.suggestion).toEqual({ kind: "replace-name", from: "lable", to: "label" });
});

test("RENDER_IT_OUTSIDE_OF_LOOP suggests wrapping in render-each", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div><x render-it></x></div>`,
  });
  const r = lx.reports.find((x) => x.id === RENDER_IT_OUTSIDE_OF_LOOP);
  expect(r.suggestion).toEqual({ kind: "wrap", from: "<x render-it>", to: "<x render-each>" });
});

test("plain unrelated names produce no false-positive suggestions", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div><x totallybogus="x"></x></div>`,
  });
  const r = lx.reports.find((x) => x.id === UNKNOWN_X_OP);
  expect(r.suggestion).toBeNull();
});

test("x render-each with when referencing missing alter handler warns", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div><x render-each=".items" when="filterItem"></x></div>`,
  });
  const altNotDefined = lx.reports.filter(
    (r) => r.id === ALT_HANDLER_NOT_DEFINED && r.info.name === "filterItem",
  );
  expect(altNotDefined.length).toBe(1);
});

test("no report when *dynamic reference matches a defined provide", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { color: "blue" },
    provide: { color: ".color" },
    view: html`<p :title="*color">hi</p>`,
  });
  const dynReports = lx.reports.filter(
    (r) => r.id === DYN_VAL_NOT_DEFINED || r.id === DYN_ALIAS_NOT_REFERENCED,
  );
  expect(dynReports.length).toBe(0);
});

test("error on *dynamic reference with no matching dynamic definition", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { color: "blue" },
    view: html`<p :title="*missing">hi</p>`,
  });
  const notDefined = lx.reports.filter((r) => r.id === DYN_VAL_NOT_DEFINED);
  expect(notDefined.length).toBe(1);
  expect(notDefined[0].info.name).toBe("missing");
});

test("no report when a lookup is referenced in a view", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    lookup: { color: { for: "Theme.color", default: "'gray'" } },
    view: html`<p :title="*color">hi</p>`,
  });
  const dynReports = lx.reports.filter(
    (r) => r.id === DYN_VAL_NOT_DEFINED || r.id === DYN_ALIAS_NOT_REFERENCED,
  );
  expect(dynReports.length).toBe(0);
});

test("hint when a lookup is never referenced in any view", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    lookup: { color: { for: "Theme.color", default: "'gray'" } },
    view: html`<p>hi</p>`,
  });
  const unused = lx.reports.filter((r) => r.id === DYN_ALIAS_NOT_REFERENCED);
  expect(unused.length).toBe(1);
  expect(unused[0].info.name).toBe("color");
});

test("no unused-dynamic hint for a producer provide absent from its own views", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { color: "blue" },
    provide: { color: ".color" },
    view: html`<p>hi</p>`,
  });
  const unused = lx.reports.filter((r) => r.id === DYN_ALIAS_NOT_REFERENCED);
  expect(unused.length).toBe(0);
});

test("no PROVIDE_NOT_ADDRESSABLE for a field or seq-access provide", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [], selectedKey: "" },
    provide: { all: ".items", selected: ".items[.selectedKey]" },
    view: html`<p>hi</p>`,
  });
  expect(lx.reports.filter((r) => r.id === PROVIDE_NOT_ADDRESSABLE).length).toBe(0);
});

test("error on a provide whose value is not a path (method/constant)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { color: "blue" },
    methods: { themeColor() {} },
    provide: { computed: "$themeColor", literal: "'beta'" },
    view: html`<p>hi</p>`,
  });
  const bad = lx.reports.filter((r) => r.id === PROVIDE_NOT_ADDRESSABLE);
  expect(bad.map((r) => r.info.name).sort()).toEqual(["computed", "literal"]);
});

test("no lookup shape/target reports for well-formed lookups", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    lookup: { a: "Theme.color", b: { for: "Theme.bg", default: "'gray'" } },
    view: html`<p :title="*a" :data-bg="*b">hi</p>`,
  });
  const bad = lx.reports.filter(
    (r) => r.id === LOOKUP_TARGET_MALFORMED || r.id === LOOKUP_BAD_SHAPE,
  );
  expect(bad.length).toBe(0);
});

test("error on a lookup whose target string is not Producer.provideName", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    lookup: { noDot: "ThemeColor", tooManyDots: "A.b.c", emptyHalf: "Theme." },
    view: html`<p>hi</p>`,
  });
  const bad = lx.reports.filter((r) => r.id === LOOKUP_TARGET_MALFORMED);
  expect(bad.map((r) => r.info.name).sort()).toEqual(["emptyHalf", "noDot", "tooManyDots"]);
  // a wrong target string is not a shape error
  expect(lx.reports.filter((r) => r.id === LOOKUP_BAD_SHAPE).length).toBe(0);
});

test("error on a lookup with an invalid object shape", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    lookup: {
      missingFor: { default: "'gray'" },
      unknownKey: { for: "Theme.color", deafult: "'gray'" },
      forNotString: { for: 123 },
      defaultNotString: { for: "Theme.color", default: 5 },
      notStringOrObject: 42,
    },
    view: html`<p>hi</p>`,
  });
  const bad = lx.reports.filter((r) => r.id === LOOKUP_BAD_SHAPE);
  expect(bad.map((r) => r.info.name).sort()).toEqual([
    "defaultNotString",
    "forNotString",
    "missingFor",
    "notStringOrObject",
    "unknownKey",
  ]);
  // a shape error short-circuits the target check (no double report)
  expect(lx.reports.filter((r) => r.id === LOOKUP_TARGET_MALFORMED).length).toBe(0);
});

test("LINT_RULES covers every component-linter code, and only those", async () => {
  const LINT_CHECK = await import("../tools/core/lint-check.js");
  const { LINT_RULES } = await import("../tools/core/lint-rules.js");

  // A "code" export is a SCREAMING_SNAKE string whose value equals its name.
  const codeExports = Object.entries(LINT_CHECK)
    .filter(([k, v]) => typeof v === "string" && v === k && /^[A-Z][A-Z0-9_]+$/.test(k))
    .map(([k]) => k)
    .sort();

  const ruleCodes = LINT_RULES.map((r) => r.code).sort();
  expect(ruleCodes).toEqual(codeExports);
  // No duplicate entries.
  expect(new Set(ruleCodes).size).toBe(ruleCodes.length);
  // Every rule is well-formed.
  for (const r of LINT_RULES) {
    expect(["error", "warn", "hint"]).toContain(r.level);
    expect(r.summary.length).toBeGreaterThan(0);
    expect(r.group.length).toBeGreaterThan(0);
  }
});

test("lint-errors.js demo triggers every non-HTML lint code (drift guard)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { LINT_RULES } = await import("../tools/core/lint-rules.js");
  const dir = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(dir, "..", "docs", "examples", "lint-errors.js"), "utf8");
  // `HTML_*` codes come from the separate htmllinter (exercised by HtmlLintDemo);
  // every other code must be demonstrated. Each case is tagged with a `// CODE: …`
  // comment, so a non-HTML code absent from the source text is an uncovered rule.
  const missing = LINT_RULES.map((r) => r.code)
    .filter((c) => !c.startsWith("HTML_") && !src.includes(c))
    .sort();
  expect(missing).toEqual([]);
});

test("every LINT_RULES code has a formatter (no fall-through to the bare code)", async () => {
  const { LINT_RULES } = await import("../tools/core/lint-rules.js");
  const { lintIdToMessage } = await import("../tools/format/lint.js");

  // `lintIdToMessage` ends in `default: return id`, so a code with no `case`
  // renders as its bare SCREAMING_SNAKE name. The suffix helpers all guard on
  // optional fields, so an empty `info` is safe — a real case still produces
  // human prose (with "undefined" filled in for missing fields), never the
  // code verbatim.
  for (const { code } of LINT_RULES) {
    const msg = lintIdToMessage(code, {});
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toBe(code);
  }
});
