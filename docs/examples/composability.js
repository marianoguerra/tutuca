import { component, html } from "tutuca";
import { getComponents as getDndComponents, getRoot as getDndRoot } from "./dnd-example.js";
import { getComponents as getJsonComponents, getRoot as getJsonRoot } from "./json.js";
import {
  getComponents as getPersonalSiteComponents,
  getRoot as getPersonalSiteRoot,
  getRequestHandlers as getRequestHandlersPersonalSite,
} from "./personal-site.js";
import { getComponents as getTodoComponents, getRoot as getTodoRoot } from "./todo.js";
import { getComponents as getTreeComponents, getRoot as getTreeRoot } from "./tree.js";
import {
  getMacros as getMacrosVisualWasm,
  getComponents as getVisualWasmComponents,
  getRoot as getVisualWasmRoot,
} from "./visual-wasm.js";

const Composability = component({
  name: "Composability",
  fields: {
    activeSection: "todo",
    todo: null,
    json: null,
    tree: null,
    personalSite: null,
    visualWasm: null,
    dnd: null,
  },
  methods: {
    isTodoSelected() {
      return this.activeSection === "todo";
    },
    isJsonSelected() {
      return this.activeSection === "json";
    },
    isTreeSelected() {
      return this.activeSection === "tree";
    },
    isPersonalSiteSelected() {
      return this.activeSection === "personalSite";
    },
    isVisualWasmSelected() {
      return this.activeSection === "visualWasm";
    },
    isDndSelected() {
      return this.activeSection === "dnd";
    },
  },
  input: {
    selectTodo() {
      return this.setActiveSection("todo");
    },
    selectJson() {
      return this.setActiveSection("json");
    },
    selectTree() {
      return this.setActiveSection("tree");
    },
    selectPersonalSite() {
      return this.setActiveSection("personalSite");
    },
    selectVisualWasm() {
      return this.setActiveSection("visualWasm");
    },
    selectDnd() {
      return this.setActiveSection("dnd");
    },
  },
  logic: {
    init(ctx) {
      ctx.at.field("personalSite").logic("init");
      return this;
    },
  },
  view: html`<section class="flex flex-col gap-4">
    <div role="tablist" class="tabs tabs-border">
      <button
        role="tab"
        @if.class=".isTodoSelected"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="selectTodo"
      >
        To-Do
      </button>
      <button
        role="tab"
        @if.class=".isJsonSelected"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="selectJson"
      >
        JSON Editor
      </button>
      <button
        role="tab"
        @if.class=".isTreeSelected"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="selectTree"
      >
        Tree
      </button>
      <button
        role="tab"
        @if.class=".isPersonalSiteSelected"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="selectPersonalSite"
      >
        Personal Site
      </button>
      <button
        role="tab"
        @if.class=".isDndSelected"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="selectDnd"
      >
        Drag and Drop
      </button>
      <button
        role="tab"
        @if.class=".isVisualWasmSelected"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="selectVisualWasm"
      >
        Visual Wasm
      </button>
    </div>
    <div @show=".isTodoSelected"><x render=".todo"></x></div>
    <div @show=".isJsonSelected"><x render=".json"></x></div>
    <div @show=".isTreeSelected"><x render=".tree"></x></div>
    <div @show=".isPersonalSiteSelected"><x render=".personalSite"></x></div>
    <div @show=".isDndSelected"><x render=".dnd"></x></div>
    <div @show=".isVisualWasmSelected"><x render=".visualWasm"></x></div>
  </section>`,
});

export function getComponents() {
  return [
    Composability,
    ...getTodoComponents(),
    ...getJsonComponents(),
    ...getTreeComponents(),
    ...getPersonalSiteComponents(),
    ...getVisualWasmComponents(),
    ...getDndComponents(),
  ];
}

export function getRoot() {
  return Composability.make({
    todo: getTodoRoot(),
    json: getJsonRoot(),
    tree: getTreeRoot(),
    personalSite: getPersonalSiteRoot(),
    visualWasm: getVisualWasmRoot(),
    dnd: getDndRoot(),
  });
}

export function getRequestHandlers() {
  return { ...getRequestHandlersPersonalSite() };
}

export function getMacros() {
  return { ...getMacrosVisualWasm() };
}

export function getStoryBookSection() {
  return {
    title: "Composability",
    description: "Tabbed view that composes several independent example components",
    items: [
      {
        title: "Default (To-Do tab)",
        description: "All sub-apps wired up, To-Do tab selected",
        item: getRoot(),
      },
      {
        title: "JSON Editor Selected",
        description: "Starts on the JSON Editor tab",
        item: getRoot().setActiveSection("json"),
      },
      {
        title: "Tree Selected",
        description: "Starts on the Tree tab",
        item: getRoot().setActiveSection("tree"),
      },
    ],
  };
}
