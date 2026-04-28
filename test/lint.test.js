import { expect, test } from "bun:test";
import { LintClassCollectorCtx } from "../dev.js";
import { component, html, macro } from "../index.js";
import { ComponentStack } from "../src/components.js";
import {
  ALT_HANDLER_NOT_DEFINED,
  ALT_HANDLER_NOT_REFERENCED,
  COMPUTED_NOT_REFERENCED,
  COMPUTED_VAL_NOT_DEFINED,
  checkComponent,
  DUPLICATE_ATTR_DEFINITION,
  FIELD_VAL_NOT_DEFINED,
  INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD,
  INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER,
  INPUT_HANDLER_METHOD_NOT_IMPLEMENTED,
  INPUT_HANDLER_NOT_IMPLEMENTED,
  INPUT_HANDLER_NOT_REFERENCED,
  LintParseContext,
  RENDER_IT_OUTSIDE_OF_LOOP,
  MAYBE_DROP_AT_PREFIX,
  UNKNOWN_COMPONENT_NAME,
  UNKNOWN_DIRECTIVE,
  UNKNOWN_EVENT_MODIFIER,
  UNKNOWN_HANDLER_ARG_NAME,
  UNKNOWN_MACRO_ARG,
  UNKNOWN_REQUEST_NAME,
  UNKNOWN_X_ATTR,
  UNKNOWN_X_OP,
} from "../tools/core/lint-check.js";
import { Comment, document, Text } from "./dom.js";

class HeadlessLintParseContext extends LintParseContext {
  constructor() {
    super(document, Text, Comment);
  }
}

export const mpx = () => new HeadlessLintParseContext();

function defAndCheck(opts) {
  const Comp = component(opts);
  Comp.scope = new ComponentStack();
  Comp.compile(HeadlessLintParseContext);
  const lx = checkComponent(Comp);
  return [lx, Comp];
}

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
    view: html`<button @on.click="doClick" @on.keydown=".doKeyDown">
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
    view: html`<p :title="title is {.title} and {$myComp}">hi</p>`,
  });
  expect(lx.reports.length).toBe(2);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(FIELD_VAL_NOT_DEFINED);
    expect(info.name).toBe("title");
  }
  {
    const { id, info } = lx.reports[1];
    expect(id).toBe(COMPUTED_VAL_NOT_DEFINED);
    expect(info.name).toBe("myComp");
  }
});

test("warn on undefined computed attr", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    computed: {
      foo() {
        return 0;
      },
    },
    view: html`<p :title="$foo" :id="$bar">hi</p>`,
  });
  expect(lx.reports.length).toBe(1);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(COMPUTED_VAL_NOT_DEFINED);
    expect(info.name).toBe("bar");
  }
});

test("warn on undefined computed in @if.class condition", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div @if.class="$myComputed" @then="'active'" @else="'inactive'">
      hi
    </div>`,
  });
  expect(lx.reports.length).toBe(1);
  const { id, info } = lx.reports[0];
  expect(id).toBe(COMPUTED_VAL_NOT_DEFINED);
  expect(info.name).toBe("myComputed");
});

test("warn on undefined computed in @dangerouslysetinnerhtml", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    view: html`<div @dangerouslysetinnerhtml="$myComputed">hi</div>`,
  });
  expect(lx.reports.length).toBe(1);
  const { id, info } = lx.reports[0];
  expect(id).toBe(COMPUTED_VAL_NOT_DEFINED);
  expect(info.name).toBe("myComputed");
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
  expect(dupes.length).toBe(2);
  expect(dupes.every((r) => r.info.name === "class")).toBe(true);
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

test("warn on Type/request not in scope", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { name: "" },
    input: { do() {} },
    view: html`<button @on.click="do !req MyComp ctx">do it</button>`,
  });
  expect(lx.reports.length).toBe(2);
  {
    const { id, info } = lx.reports[0];
    expect(id).toBe(UNKNOWN_REQUEST_NAME);
    expect(info.name).toBe("req");
  }
  {
    const { id, info } = lx.reports[1];
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

test("hint on computed property defined but not referenced", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    computed: {
      usedTotal() {
        return 1;
      },
      unusedTotal() {
        return 2;
      },
    },
    view: html`<p :title="$usedTotal">hi</p>`,
  });
  expect(lx.reports.length).toBe(1);
  const { id, info, level } = lx.reports[0];
  expect(id).toBe(COMPUTED_NOT_REFERENCED);
  expect(info.name).toBe("unusedTotal");
  expect(level).toBe("hint");
});

test("no unreferenced computed hint when referenced", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    computed: {
      total() {
        return 0;
      },
    },
    view: html`<p :title="$total">hi</p>`,
  });
  expect(lx.reports.length).toBe(0);
});

test("no unreferenced computed hint when referenced via <x text=$computed>", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    computed: {
      totalItemsChars() {
        return 0;
      },
    },
    view: html`<div><x text="$totalItemsChars"></x></div>`,
  });
  const unref = lx.reports.filter(
    (r) => r.id === COMPUTED_NOT_REFERENCED && r.info.name === "totalItemsChars",
  );
  expect(unref.length).toBe(0);
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
    computed: {
      total() {
        return 0;
      },
    },
    view: html`<div>
      <p>Lint Errors Demo - check the Lint tab</p>

      <x render-it></x>

      <button @on.click+badmod="doKeyDown">bad modifier</button>

      <button @on.click="doKeyDown unknownArg event">unknown arg</button>

      <button @on.click="doClick">method as handler</button>

      <button @on.keydown=".doKeyDown">handler as method</button>

      <p :title=".missing">undefined field</p>

      <p :title="$missing">undefined computed</p>

      <button @on.click="doKeyDown !unknownReq UnknownComp ctx">
        unknown req/comp
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
  expect(ids).toContain(COMPUTED_VAL_NOT_DEFINED);
  expect(ids).toContain(UNKNOWN_REQUEST_NAME);
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
    computed: {
      total() {
        return 0;
      },
    },
    view: html`<div>
      <p>Lint Errors Demo - check the Lint tab</p>

      <x render-it></x>

      <button @on.click+badmod="doKeyDown">bad modifier</button>

      <button @on.click="doKeyDown unknownArg event">unknown arg</button>

      <button @on.click="doClick">method as handler</button>

      <button @on.keydown=".doKeyDown">handler as method</button>

      <p :title=".missing">undefined field</p>

      <p :title="$missing">undefined computed</p>

      <button @on.click="doKeyDown !unknownReq UnknownComp ctx">
        unknown req/comp
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
  expect(ids).toContain(COMPUTED_VAL_NOT_DEFINED);
  expect(ids).toContain(UNKNOWN_REQUEST_NAME);
  expect(ids).toContain(UNKNOWN_COMPONENT_NAME);
  expect(ids).toContain(ALT_HANDLER_NOT_DEFINED);
});

test("macro invocation :handler NameVal does not warn; ^handler in body expands to InputHandlerNameVal", () => {
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
  expect(handlerVal.constructor.name).toBe("InputHandlerNameVal");
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
    view: html`<div><x render-each=".items" when="filterItem"></x></div>`,
  });
  expect(lx.reports.length).toBe(0);
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

test("hint when unknown-x-attr name is @-prefixed wrapper (@show)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { isOpen: false },
    view: html`<div>
      <div @each=".isOpen"><x render-it @show=".isOpen"></x></div>
    </div>`,
  });
  const errors = lx.reports.filter((r) => r.id === UNKNOWN_X_ATTR);
  expect(errors.length).toBe(1);
  expect(errors[0].info.name).toBe("@show");
  const hints = lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX);
  expect(hints.length).toBe(1);
  expect(hints[0].level).toBe("hint");
  expect(hints[0].info.name).toBe("@show");
  expect(hints[0].info.suggestion).toBe("show");
  expect(hints[0].info.op).toBe("render-it");
});

test("hint when unknown-x-attr name is @-prefixed wrapper (@hide)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { isOpen: false },
    view: html`<div>
      <div @each=".isOpen"><x render-it @hide=".isOpen"></x></div>
    </div>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX);
  expect(hints.length).toBe(1);
  expect(hints[0].info.suggestion).toBe("hide");
});

test("hint when unknown-x-attr name is @-prefixed consumed (@when)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div><x render-each=".items" @when="filterItem"></x></div>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX);
  expect(hints.length).toBe(1);
  expect(hints[0].info.suggestion).toBe("when");
  expect(hints[0].info.op).toBe("render-each");
});

test("hint when unknown-x-attr name is @-prefixed consumed (@loop-with)", () => {
  const [lx] = defAndCheck({
    name: "Comp",
    fields: { items: [] },
    view: html`<div><x render-each=".items" @loop-with="getIter"></x></div>`,
  });
  const hints = lx.reports.filter((r) => r.id === MAYBE_DROP_AT_PREFIX);
  expect(hints.length).toBe(1);
  expect(hints[0].info.suggestion).toBe("loop-with");
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
