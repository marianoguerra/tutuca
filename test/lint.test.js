import { expect, test } from "bun:test";
import { component, html } from "../index.js";
import { ComponentStack } from "../src/components.js";
import {
  COMPUTED_VAL_NOT_DEFINED,
  checkComponent,
  FIELD_VAL_NOT_DEFINED,
  INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD,
  INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER,
  INPUT_HANDLER_METHOD_NOT_IMPLEMENTED,
  INPUT_HANDLER_NOT_IMPLEMENTED,
  LintParseContext,
  RENDER_IT_OUTSIDE_OF_LOOP,
  UNKNOWN_COMPONENT_NAME,
  UNKNOWN_EVENT_MODIFIER,
  UNKNOWN_HANDLER_ARG_NAME,
  UNKNOWN_REQUEST_NAME,
} from "../src/lint/index.js";
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
  const [lx] = defAndCheck({ name: "Comp", view: html`<div><x render-it></x></div>` });
  expect(lx.reports.length).toBe(1);
  expect(lx.reports[0].id).toBe(RENDER_IT_OUTSIDE_OF_LOOP);
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
    view: html`<button @on.click="doClick" @on.keydown=".doKeyDown">do it</button>`,
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
    view: html`<p :title=".name" :id=".id" @text=".bar" @show=".isVisible">hi</p>`,
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
