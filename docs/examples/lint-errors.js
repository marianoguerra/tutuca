import { component, html } from "tutuca";

const LintDemo = component({
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

    <!-- RENDER_IT_OUTSIDE_OF_LOOP: render-it without @each -->
    <x render-it></x>

    <!-- UNKNOWN_EVENT_MODIFIER: +badmod is not a known modifier -->
    <button @on.click+badmod="doKeyDown">bad modifier</button>

    <!-- UNKNOWN_HANDLER_ARG_NAME: unknownArg is not recognized -->
    <button @on.click="doKeyDown unknownArg event">unknown arg</button>

    <!-- INPUT_HANDLER_NOT_IMPLEMENTED + INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER:
         doClick is a method but referenced as input handler (no dot) -->
    <button @on.click="doClick">method as handler</button>

    <!-- INPUT_HANDLER_METHOD_NOT_IMPLEMENTED + INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD:
         doKeyDown is input but referenced as method (with dot) -->
    <button @on.keydown=".doKeyDown">handler as method</button>

    <!-- FIELD_VAL_NOT_DEFINED: .missing is not defined -->
    <p :title=".missing">undefined field</p>

    <!-- COMPUTED_VAL_NOT_DEFINED: $missing is not defined -->
    <p :title="$missing">undefined computed</p>

    <!-- UNKNOWN_REQUEST_NAME + UNKNOWN_COMPONENT_NAME -->
    <button @on.click="doKeyDown !unknownReq UnknownComp ctx">
      unknown req/comp
    </button>

    <!-- ALT_HANDLER_NOT_DEFINED: myEnrich is not defined in alter -->
    <div @enrich-with="myEnrich">undefined alter handler</div>

    <!-- ALT_HANDLER_NOT_DEFINED x3: undefined @when / @enrich-with / @loop-with on a loop -->
    <ul @each=".items" @when="myWhen" @enrich-with="myLoopEnrich" @loop-with="myLoopWith">
      <li><x render-it></x></li>
    </ul>

    <p @text=".count">0</p>
  </div>`,
});

export function getComponents() {
  return [LintDemo];
}

export function getRoot() {
  return LintDemo.make({});
}

export function getExamples() {
  return {
    title: "Lint Errors",
    description: "Component with intentional lint errors for the linter demo",
    items: [
      {
        title: "Default",
        description: "All lint errors triggered",
        value: LintDemo.make(),
      },
      {
        title: "With Count",
        description: "Initialized with a non-zero count",
        value: LintDemo.make({ count: 5 }),
      },
    ],
  };
}
