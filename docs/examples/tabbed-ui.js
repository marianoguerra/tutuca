import { component, html } from "tutuca";

export const TabbedUI = component({
  name: "TabbedUI",
  fields: { tab: "overview" },
  view: html`<section class="flex flex-col gap-3">
    <div role="tablist" class="tabs tabs-border">
      <button
        role="tab"
        @if.class="equals? .tab 'overview'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setTab 'overview'"
      >
        Overview
      </button>
      <button
        role="tab"
        @if.class="equals? .tab 'features'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setTab 'features'"
      >
        Features
      </button>
      <button
        role="tab"
        @if.class="equals? .tab 'pricing'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setTab 'pricing'"
      >
        Pricing
      </button>
    </div>

    <div class="card p-3 border" @show="equals? .tab 'overview'">
      <h4>Overview</h4>
      <p>A short summary of what this product does.</p>
    </div>
    <div class="card p-3 border" @show="equals? .tab 'features'">
      <h4>Features</h4>
      <p>The list of features lives on this tab.</p>
    </div>
    <div class="card p-3 border" @show="equals? .tab 'pricing'">
      <h4>Pricing</h4>
      <p>Pricing details go here.</p>
    </div>
  </section>`,
});

export function getComponents() {
  return [TabbedUI];
}

export function getRoot() {
  return TabbedUI.make({});
}

export function getExamples() {
  return {
    title: "Tabbed UI",
    description: "Switch tabs with the equals? predicate, @show and @if.class",
    items: [
      {
        title: "Overview",
        description: "The default tab",
        value: TabbedUI.make({ tab: "overview" }),
      },
      {
        title: "Features",
        description: "Features tab selected",
        value: TabbedUI.make({ tab: "features" }),
      },
      {
        title: "Pricing",
        description: "Pricing tab selected",
        value: TabbedUI.make({ tab: "pricing" }),
      },
    ],
  };
}
