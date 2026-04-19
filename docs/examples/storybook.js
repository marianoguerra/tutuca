import { component, html } from "tutuca";
import * as attributeBindingMod from "./attribute-binding.js";
import * as composabilityMod from "./composability.js";
import * as computedPropertiesMod from "./computed-properties.js";
import * as conditionalAttributesMod from "./conditional-attributes.js";
import * as counterMod from "./counter.js";
import * as dangerSetInnerHtmlMod from "./danger-set-inner-html.js";
import * as dndMod from "./dnd-example.js";
import * as entryMod from "./entry.js";
import * as eventModifiersMod from "./event-modifiers.js";
import * as jsonMod from "./json.js";
import * as lintErrorsMod from "./lint-errors.js";
import * as listAndFilterMod from "./list-and-filter.js";
import * as listFilterEnrichMod from "./list-filter-enrich.js";
import * as listFilterEnrichWithMod from "./list-filter-enrich-with.js";
import * as listIterationMod from "./list-iteration.js";
import * as macroNamedSlotsMod from "./macro-named-slots.js";
import * as macroParamsMod from "./macro-params.js";
import * as macroSlotsMod from "./macro-slots.js";
import * as macroStaticMod from "./macro-static.js";
import * as minimumViableComponentMod from "./minimum-viable-component.js";
import * as multipleViewsMod from "./multiple-views.js";
import * as personalSiteMod from "./personal-site.js";
import * as pushViewMod from "./push-view.js";
import * as renderWithScopeMod from "./render-with-scope.js";
import * as requestExampleMod from "./request-example.js";
import * as seqItemAccessMod from "./seq-item-access.js";
import * as staticViewComponentMod from "./static-view-component.js";
import * as stylesExampleMod from "./styles-example.js";
import * as textDirectiveMod from "./text-directive.js";
import * as todoMod from "./todo.js";
import * as treeMod from "./tree.js";
import * as visualWasmMod from "./visual-wasm.js";

const Storybook = component({
  name: "Storybook",
  fields: {
    selectedSectionIndex: 0,
    sections: [],
  },
  bubble: {
    sectionSelected(section, ctx) {
      ctx.stopPropagation();
      return this.setSelectedSectionIndex(this.sections.indexOf(section));
    },
  },
  view: html`<div class="flex gap-3 p-3 h-screen">
    <div
      class="w-1/4 list bg-base-100 rounded-box shadow-md h-full overflow-y-auto"
    >
      <x render-each=".sections" as="listEntry"></x>
    </div>
    <div class="flex-1 h-full overflow-y-auto">
      <x render=".sections[.selectedSectionIndex]"></x>
    </div>
  </div>`,
});

const Section = component({
  name: "Section",
  fields: { title: "?", description: "", items: [] },
  statics: {
    fromData({ title = "???", description = "", items = [] }) {
      return this.make({
        title,
        description,
        items: items.map((v) => Example.Class.fromData(v)),
      });
    },
  },
  view: html`<section>
    <h2 class="text-lg font-bold" @text=".title"></h2>
    <p class="text-md italic opacity-60" @text=".description"></p>
    <div class="flex flex-col gap-3 mt-3">
      <x render-each=".items"></x>
    </div>
  </section>`,
  input: {
    onListItemClick(ctx) {
      ctx.bubble("sectionSelected", [this]);
      return this;
    },
  },
  views: {
    listEntry: html`<div
      class="list-row cursor-pointer hover:bg-base-200"
      @on.click="onListItemClick ctx"
    >
      <div @text=".title" class="list-col-grow"></div>
      <p class="text-xs opacity-60 list-col-wrap" @text=".description"></p>
    </div> `,
  },
});

const Example = component({
  name: "Example",
  fields: { title: "?", description: "", item: null },
  statics: {
    fromData({ title = "???", description = "", item = null }) {
      return this.make({
        title,
        description,
        item,
      });
    },
  },
  view: html`<div class="card card-border bg-base-200 shadow-md">
    <div class="card-body">
      <h2 class="card-title" @text=".title"></h2>
      <p class="text-md italic opacity-60" @text=".description"></p>
      <div class="bg-base-100 p-3">
        <x render=".item"></x>
      </div>
    </div>
  </div>`,
});

const SECTION_MODULES = [
  counterMod,
  todoMod,
  //attributeBindingMod,
  //composabilityMod,
  //computedPropertiesMod,
  //conditionalAttributesMod,
  //dangerSetInnerHtmlMod,
  dndMod,
  //entryMod,
  //eventModifiersMod,
  jsonMod,
  //lintErrorsMod,
  //listAndFilterMod,
  //listFilterEnrichMod,
  //listFilterEnrichWithMod,
  //listIterationMod,
  //macroNamedSlotsMod,
  //macroParamsMod,
  //macroSlotsMod,
  //macroStaticMod,
  //minimumViableComponentMod,
  //multipleViewsMod,
  personalSiteMod,
  //pushViewMod,
  //renderWithScopeMod,
  //requestExampleMod,
  //seqItemAccessMod,
  //staticViewComponentMod,
  //stylesExampleMod,
  //textDirectiveMod,
  treeMod,
  visualWasmMod,
  composabilityMod,
];

export function getComponents() {
  const seen = new Set([Storybook, Section, Example]);
  for (const mod of SECTION_MODULES) {
    for (const c of mod.getComponents()) {
      seen.add(c);
    }
  }
  return [...seen];
}

export function getMacros() {
  const macros = {};
  for (const mod of SECTION_MODULES) {
    if (mod.getMacros) {
      Object.assign(macros, mod.getMacros());
    }
  }
  return macros;
}

export function getRequestHandlers() {
  const handlers = {};
  for (const mod of SECTION_MODULES) {
    if (mod.getRequestHandlers) {
      Object.assign(handlers, mod.getRequestHandlers());
    }
  }
  return handlers;
}

export function getRoot() {
  const sections = SECTION_MODULES.map((mod) => mod.getStoryBookSection())
    .map((data) => Section.Class.fromData(data))
    .sort((a, b) => a.title.localeCompare(b.title));
  const storyBookSections = getStoryBookSection();
  storyBookSections.items.push({
    title: "Inception",
    item: Storybook.make({ sections }),
  });
  return Storybook.make({
    sections: [...sections, Section.Class.fromData(storyBookSections)],
  });
}

export function getStoryBookSection() {
  const counterSection = Section.Class.fromData(counterMod.getStoryBookSection());
  return {
    title: "Storybook",
    description: "The storybook itself, rendered as a section",
    items: [
      {
        title: "Storybook",
        description: "Storybook root with two sections",
        item: Storybook.make({
          sections: [counterSection, Section.Class.fromData(todoMod.getStoryBookSection())],
        }),
      },
      {
        title: "Single Section",
        description: "A standalone Section rendered by itself",
        item: counterSection,
      },
      {
        title: "Single Example",
        description: "A standalone Example card",
        item: Example.Class.fromData({
          title: "Example Title",
          description: "Example description",
          item: counterSection.items.first()?.item ?? null,
        }),
      },
    ],
  };
}
