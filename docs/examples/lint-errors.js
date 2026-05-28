import { component, html, macro } from "tutuca";

const labeled = macro({ label: "'hi'" }, html`<span @text="^label"></span>`);

const LintDemo = component({
  name: "LintDemo",
  // UNKNOWN_COMPONENT_SPEC_KEY: 'viw' isn't a recognized spec key;
  // suggestion points at the closest known key ('view').
  viw: "<span></span>",
  fields: { count: 0, items: [], kind: "", isOpen: false },
  methods: {
    doClick() {
      return this;
    },
  },
  input: {
    doKeyDown() {},
    // INPUT_HANDLER_NOT_REFERENCED: defined here but never used in any view
    unusedInput() {},
  },
  alter: {
    // ALT_HANDLER_NOT_REFERENCED: defined here but never used in any view
    unusedAlter(_k, v) {
      return v;
    },
  },
  dynamic: {
    // DYN_ALIAS_NOT_REFERENCED: alias declared but never used as *unusedDyn in a view
    unusedDyn: { for: "Theme.color", default: "'gray'" },
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
         doKeyDown is input but referenced as method (with $) -->
    <button @on.keydown="$doKeyDown">handler as method</button>

    <!-- FIELD_VAL_NOT_DEFINED: .missing is not defined -->
    <p :title=".missing">undefined field</p>

    <!-- DYN_VAL_NOT_DEFINED: *missingDyn is not in the component's dynamic map -->
    <p :title="*missingDyn">undefined dynamic</p>

    <!-- UNKNOWN_REQUEST_NAME + UNKNOWN_COMPONENT_NAME -->
    <button @on.click="doKeyDown !unknownReq UnknownComp">
      unknown req/comp
    </button>

    <!-- ALT_HANDLER_NOT_DEFINED: myEnrich is not defined in alter -->
    <div @enrich-with="myEnrich">undefined alter handler</div>

    <!-- ALT_HANDLER_NOT_DEFINED x3: undefined @when / @enrich-with / @loop-with on a loop -->
    <ul @each=".items" @when="myWhen" @enrich-with="myLoopEnrich" @loop-with="myLoopWith">
      <li><x render-it></x></li>
    </ul>

    <!-- UNKNOWN_MACRO_ARG: extra is not declared in the macro defaults -->
    <x:labeled label="ok" extra="oops"></x:labeled>

    <!-- UNKNOWN_DIRECTIVE: @bogus is not a known directive -->
    <div @bogus="oops">unknown directive</div>

    <!-- UNKNOWN_X_OP: bogus is not a known <x> op -->
    <x bogus="oops"></x>

    <!-- UNKNOWN_X_OP via pseudo-x: same diagnostic on a host tag -->
    <div @x bogus="oops"></div>

    <!-- UNKNOWN_X_ATTR: bogus is not a known attribute on <x render-each> -->
    <x render-each=".items" bogus="nope"></x>

    <!-- UNKNOWN_X_ATTR + MAYBE_DROP_AT_PREFIX: @show on <x> is unknown;
         hint suggests dropping the @ to use the wrapper attr 'show' -->
    <ul @each=".items"><x render-it @show=".isOpen"></x></ul>

    <!-- UNKNOWN_X_OP + MAYBE_DROP_AT_PREFIX: @text as the op is unknown;
         hint suggests dropping the @ to use the op 'text' -->
    <x @text=".count"></x>

    <!-- MAYBE_ADD_AT_PREFIX: 'show' is a directive written as a plain attribute
         on a host element; hint suggests adding the @ to get '@show'. The
         mirror of MAYBE_DROP_AT_PREFIX above. -->
    <div show=".isOpen">missing @ on host directive</div>

    <!-- BAD_VALUE on attr: '.123bad' is not a valid identifier -->
    <p :title=".123bad">bad attr value</p>

    <!-- BAD_VALUE on directive: '@text=""' has no parseable value -->
    <p @text="">bad directive value</p>

    <!-- BAD_VALUE on x-op: '<x render="...">' rejects bad expressions -->
    <x render=".123bad"></x>

    <!-- BAD_VALUE on macro var: '^undefined' isn't declared in any macro -->
    <p :title="^undefined">bad macro var</p>

    <!-- UNSUPPORTED_EXPR_SYNTAX (ternary): tutuca doesn't evaluate ternaries
         in dynamic attributes - move the choice into a method/computed field -->
    <p :class=".isOpen ? 'on' : 'off'">ternary in :class</p>

    <!-- UNSUPPORTED_EXPR_SYNTAX (comparison): no comparison operators -
         define a method like .isFooSelected that returns a boolean -->
    <p :class=".kind === 'foo'">comparison in :class</p>

    <!-- UNSUPPORTED_EXPR_SYNTAX (logical): no &&/|| - combine in a method -->
    <p :class=".isOpen && .kind">logical in :class</p>

    <!-- UNSUPPORTED_EXPR_SYNTAX (call-with-args): method calls can't take
         arguments - reference a no-arg method instead -->
    <p :class="$doClick 'foo'">call-with-args in :class</p>

    <!-- REDUNDANT_TEMPLATE_STRING: a single {expr} with no surrounding text
         is just the expression — drop the braces. -->
    <p :title="$'{.count}'">redundant template in :title</p>
    <p :class="$'{.kind}'">redundant template in :class</p>

    <!-- PLACEHOLDERLESS_TEMPLATE_STRING: a $'…' with no dynamic parts is just
         a string literal — drop the leading $. -->
    <p :title="$'plain text'">placeholderless template</p>

    <!-- DUPLICATE_ATTR_DEFINITION x2: "class" is set by literal, :class, and @if.class -->
    <div class="literal" :class=".kind" @if.class=".isOpen" @then="'on'" @else="'off'">
      duplicate class
    </div>

    <!-- IF_NO_BRANCH_SET: @if.class without @then or @else -->
    <div @if.class=".isOpen">if without then or else</div>

    <p @text=".count">0</p>
  </div>`,
});

const HtmlLintDemo = component({
  name: "HtmlLintDemo",
  fields: { count: 0 },
  view: html`<div>
    <p>HTML structural lint errors — check the Lint tab</p>

    <!-- HTML_TAG_NAME_HAS_UPPERCASE: parser lowercases <MyTag> to <mytag> -->
    <MyTag>camelcase tag</MyTag>

    <!-- HTML_SVG_TAG_WILL_LOWERCASE: <myShape> not in the WHATWG SVG list -->
    <svg width="20" height="20"><myShape></myShape></svg>

    <!-- HTML_TAG_NOT_ALLOWED_IN_PARENT (foster-parent):
         <div> directly inside <table> gets reparented OUT of the table -->
    <table><div>foster-parented</div></table>

    <!-- HTML_TEXT_NOT_ALLOWED_IN_PARENT:
         non-whitespace text directly inside <table> gets foster-parented -->
    <table>plain text inside table</table>

    <!-- HTML_TAG_NOT_ALLOWED_IN_PARENT (ignored):
         <li> inside <select> is dropped by the parser -->
    <select><li>not allowed</li></select>

    <!-- HTML_VOID_ELEMENT_HAS_CLOSE_TAG: void <br> with an explicit </br> -->
    <br></br>

    <!-- HTML_DUPLICATE_FORM: inner <form> dropped per HTML5 form-pointer rule -->
    <form><input><form><input></form></form>

    <!-- HTML_NESTED_INTERACTIVE: <a> nested in <a> triggers adoption agency -->
    <a href="#"><a href="#">nested anchor</a></a>

    <!-- HTML_MISNESTED_FORMATTING: <b><i></b></i> — adoption agency reorders -->
    <p><b><i>misnested</b></i></p>

    <!-- HTML_UNEXPECTED_END_TAG: </span> with no matching span; walker
         hits the surrounding <article> (special) and bails. -->
    <article>oops</span></article>

    <!-- HTML_UNCLOSED_BEFORE_END: <span> still open when </section> is seen;
         span gets implicitly closed (and is "unclosed before end"). -->
    <section><span>still open</section>

    <!-- HTML_DUPLICATE_ATTRIBUTE: same attr name twice on one tag;
         second is silently dropped per WHATWG. -->
    <div class="a" class="b">duplicate attr</div>

    <!-- HTML_ATTRIBUTES_ON_END_TAG: </div class="foo"> drops the attrs. -->
    <div></div class="foo">

    <!-- HTML_SELF_CLOSING_END_TAG: trailing /> on a close tag is meaningless. -->
    <div></div/>

    <!-- HTML_MISSING_ATTRIBUTE_VALUE: <input value=> has no value at all
         (zero-length unquoted) — likely a typo. -->
    <input value=>

    <!-- HTML_CDATA_IN_HTML_NAMESPACE: CDATA outside SVG/MathML is silently
         reinterpreted as a bogus comment. -->
    <![CDATA[unexpected]]>

    <!-- HTML_BOGUS_COMMENT: <!foo> isn't a real declaration; parser turns
         it into a bogus comment, dropping the content. -->
    <!badmarkup>

    <!-- HTML_SVG_ATTR_WILL_LOWERCASE: viewbox would be silently rewritten
         to viewBox during SVG attribute case correction. -->
    <svg viewbox="0 0 10 10"></svg>

    <!-- HTML_MATHML_ATTR_WILL_LOWERCASE: definitionurl rewritten to
         definitionURL — the only MathML attribute that case-corrects. -->
    <math definitionurl="x"></math>

    <p @text=".count">0</p>
  </div>`,
});

// Real component used as the target of the bad declarations below — the
// mistake the lint catches is passing this Component reference where a name
// string is required.
const JsonNode = component({
  name: "JsonNode",
  fields: { keyName: "" },
  view: html`<span @text=".keyName"></span>`,
});

const CompFieldShapeDemo = component({
  name: "CompFieldShapeDemo",
  fields: {
    // COMP_FIELD_BAD_SHAPE (kind: "component-not-string"): the Component
    // reference was passed where the component's name as a string is
    // required. Either use the string form `{ component: "JsonNode", args }`
    // when the class isn't in scope yet, or — since JsonNode IS in scope
    // here — just write `JsonNode.make({ keyName: "root" })` as the default.
    badRef: { component: JsonNode, args: { keyName: "root" } },

    // COMP_FIELD_BAD_SHAPE (kind: "args-not-object"): args must be a plain
    // object so it can be spread into the child component's constructor.
    badArgs: { component: "JsonNode", args: 42 },
  },
  view: html`<p>Component-field declaration shape errors — check the Lint tab</p>`,
});

export function getMacros() {
  return { labeled };
}

export function getComponents() {
  return [LintDemo, HtmlLintDemo, JsonNode, CompFieldShapeDemo];
}

export function getRoot() {
  return LintDemo.make({});
}

export function getExamples() {
  return {
    title: "Lint Errors",
    description: "Components with intentional lint errors for the linter demo",
    items: [
      {
        title: "AST lint errors",
        description: "All AST-level lint errors triggered",
        value: LintDemo.make(),
      },
      {
        title: "AST lint errors (with count)",
        description: "Initialized with a non-zero count",
        value: LintDemo.make({ count: 5 }),
      },
      {
        title: "HTML structural lint errors",
        description: "All HTML structural lint errors triggered",
        value: HtmlLintDemo.make(),
      },
      {
        title: "Component field shape errors",
        description: "Field declarations with the wrong {component, args} shape",
        value: CompFieldShapeDemo.make(),
      },
    ],
  };
}
