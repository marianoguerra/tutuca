import { component, html, IMap } from "tutuca";
import { ITEMS } from "../examples/shared.js";
import { TextDirective } from "../examples/text-directive.js";
import { AttributeBinding } from "../examples/attribute-binding.js";
import { Counter } from "../examples/tutorial-counter.js";
import { EventModifiers } from "../examples/event-modifiers.js";
import { ConditionalAttributes } from "../examples/conditional-attributes.js";
import { ListIteration } from "../examples/list-iteration.js";
import { ListAndFilter } from "../examples/list-and-filter.js";
import { ListFilterEnrich } from "../examples/list-filter-enrich.js";
import { ListFilterEnrichWith } from "../examples/list-filter-enrich-with.js";
import { RenderWithScope } from "../examples/render-with-scope.js";
import { ComputedProperties } from "../examples/computed-properties.js";
import { DangerSetInnerHtml } from "../examples/danger-set-inner-html.js";
import { Entry } from "../examples/entry.js";
import { MultipleViews } from "../examples/multiple-views.js";
import { PushView } from "../examples/push-view.js";
import { RequestExample, getRequestHandlers as getRequestExampleHandlers } from "../examples/request-example.js";
import { DnDExample } from "../examples/dnd-example.js";
import { StylesExample, StylesExampleRoot } from "../examples/styles-example.js";
import { SeqItemAccess } from "../examples/seq-item-access.js";
import { TreeRoot, TreeItem } from "../examples/tree.js";

const Tutorial = component({
  name: "Tutorial",
  fields: {
    currentStep: 0,
    steps: [],
  },
  methods: {
    wrapStep(v) {
      const lastStep = this.steps.size - 1;
      return v < 0 ? lastStep : v > lastStep ? 0 : v;
    },
    goToStep(i, ctx) {
      ctx.at.index("steps", i).logic("init");
      return this.setCurrentStep(i);
    },
    goNext(isCtrl, ctx) {
      const newStep = this.wrapStep(isCtrl ? this.steps.size - 1 : this.currentStep + 1);
      return this.goToStep(newStep, ctx);
    },
    goPrev(isCtrl, ctx) {
      const newStep = this.wrapStep(isCtrl ? 0 : this.currentStep - 1);
      return this.goToStep(newStep, ctx);
    },
    getCurrentStepLabel() {
      return this.currentStep + 1;
    },
  },
  logic: {
    init() {
      return this;
    },
  },
  view: html`<section>
    <div class="flex gap-3 justify-between items-center">
      <button class="btn btn-soft btn-primary" @on.click=".goPrev isCtrl ctx">
        Prev
      </button>
      <div class="font-mono">
        <span @text=".getCurrentStepLabel"></span> /
        <span @text=".stepsLen"></span>
      </div>
      <button class="btn btn-soft btn-primary" @on.click=".goNext isCtrl ctx">
        Next
      </button>
    </div>
    <div class="p-3 border border-indigo-600 mb-3">
      <x render=".steps[.currentStep]"></x>
    </div>
  </section>`,
});

export function getComponents() {
  return [
    Tutorial,
    TextDirective,
    AttributeBinding,
    Counter,
    EventModifiers,
    ConditionalAttributes,
    ListIteration,
    ListAndFilter,
    ListFilterEnrich,
    ListFilterEnrichWith,
    RenderWithScope,
    ComputedProperties,
    DangerSetInnerHtml,
    MultipleViews,
    Entry,
    PushView,
    RequestExample,
    DnDExample,
    StylesExample,
    StylesExampleRoot,
    SeqItemAccess,
    TreeRoot,
    TreeItem,
  ];
}

export function getRoot() {
  const ENTRIES = ITEMS.map((v) => Entry.make({ title: v, description: `Length: ${v.length}` }));
  return Tutorial.make({
    steps: [
      TextDirective.make(),
      AttributeBinding.make(),
      Counter.make(),
      EventModifiers.make(),
      ConditionalAttributes.make(),
      ListIteration.make({ items: ITEMS }),
      ListAndFilter.make({ items: ITEMS }),
      ListFilterEnrich.make({ items: ITEMS }),
      ListFilterEnrichWith.make({ items: ITEMS }),
      RenderWithScope.make(),
      DangerSetInnerHtml.make(),
      MultipleViews.make(),
      PushView.make({
        items: ENTRIES,
      }),
      RequestExample.make(),
      ComputedProperties.make({ items: ITEMS }),
      DnDExample.make({ items: ITEMS }),
      StylesExampleRoot.make(),
      SeqItemAccess.make({
        byIndex: ENTRIES,
        currentKey: "key-0",
        byKey: IMap(
          ITEMS.map((v, i) => [
            `key-${i}`,
            Entry.make({ title: v, description: `Length: ${v.length}` }),
          ]),
        ),
      }),
      TreeRoot.Class.fromData([
        {
          label: "home",
          items: [
            {
              label: "alice",
              items: [
                { type: "file", label: ".bashrc" },
                { type: "file", label: ".profile" },
              ],
            },
            {
              label: "bob",
              items: [
                { type: "file", label: ".zrc" },
                {
                  label: "Desktop",
                  items: [{ type: "file", label: ".DS_Store" }],
                },
              ],
            },
          ],
        },
        {
          label: "etc",
          items: [{ type: "file", label: "passwd" }],
        },
      ]),
    ],
  });
}

export function getRequestHandlers() {
  return getRequestExampleHandlers();
}
