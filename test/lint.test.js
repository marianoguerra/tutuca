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
  FIELD_VAL_NOT_DEFINED,
  INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD,
  INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER,
  INPUT_HANDLER_METHOD_NOT_IMPLEMENTED,
  INPUT_HANDLER_NOT_IMPLEMENTED,
  INPUT_HANDLER_NOT_REFERENCED,
  LintParseContext,
  RENDER_IT_OUTSIDE_OF_LOOP,
  UNKNOWN_COMPONENT_NAME,
  UNKNOWN_EVENT_MODIFIER,
  UNKNOWN_HANDLER_ARG_NAME,
  UNKNOWN_REQUEST_NAME,
} from "../tools/core/lint-check.js";
import { Comment, DOMParser, Text } from "./dom.js";

class HeadlessLintParseContext extends LintParseContext {
  constructor() {
    super(DOMParser, Text, Comment);
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

      <ul @each=".items" @when="myWhen" @enrich-with="myLoopEnrich" @loop-with="myLoopWith">
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
      super(DOMParser, Text, Comment);
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

      <ul @each=".items" @when="myWhen" @enrich-with="myLoopEnrich" @loop-with="myLoopWith">
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
