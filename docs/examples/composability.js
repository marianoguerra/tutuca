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
  receive: {
    init(ctx) {
      ctx.at.field("personalSite").send("init");
      return this;
    },
  },
  view: html`<section class="flex flex-col gap-4">
    <div role="tablist" class="tabs tabs-border">
      <button
        role="tab"
        @if.class="equals? .activeSection 'todo'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setActiveSection 'todo'"
      >
        To-Do
      </button>
      <button
        role="tab"
        @if.class="equals? .activeSection 'json'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setActiveSection 'json'"
      >
        JSON Editor
      </button>
      <button
        role="tab"
        @if.class="equals? .activeSection 'tree'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setActiveSection 'tree'"
      >
        Tree
      </button>
      <button
        role="tab"
        @if.class="equals? .activeSection 'personalSite'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setActiveSection 'personalSite'"
      >
        Personal Site
      </button>
      <button
        role="tab"
        @if.class="equals? .activeSection 'dnd'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setActiveSection 'dnd'"
      >
        Drag and Drop
      </button>
      <button
        role="tab"
        @if.class="equals? .activeSection 'visualWasm'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setActiveSection 'visualWasm'"
      >
        Visual Wasm
      </button>
    </div>
    <div @show="equals? .activeSection 'todo'"><x render=".todo"></x></div>
    <div @show="equals? .activeSection 'json'"><x render=".json"></x></div>
    <div @show="equals? .activeSection 'tree'"><x render=".tree"></x></div>
    <div @show="equals? .activeSection 'personalSite'"><x render=".personalSite"></x></div>
    <div @show="equals? .activeSection 'dnd'"><x render=".dnd"></x></div>
    <div @show="equals? .activeSection 'visualWasm'"><x render=".visualWasm"></x></div>
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

export function getExamples() {
  return {
    title: "Composability",
    description: "Tabbed view that composes several independent example components",
    items: [
      {
        title: "Default (To-Do tab)",
        description: "All sub-apps wired up, To-Do tab selected",
        value: getRoot(),
      },
      {
        title: "JSON Editor Selected",
        description: "Starts on the JSON Editor tab",
        value: getRoot().setActiveSection("json"),
      },
      {
        title: "Tree Selected",
        description: "Starts on the Tree tab",
        value: getRoot().setActiveSection("tree"),
      },
    ],
  };
}
