import { component, html } from "tutuca";

export const ConditionalAttributes = component({
  name: "ConditionalAttributes",
  fields: { isActive: true },
  view: html`<section>
    <button
      @if.class=".isActive"
      @then="'btn btn-success'"
      @else="'btn btn-ghost'"
      @if.title=".isActive"
      @then.title="'Click to disable'"
      @else.title="'Click to enable'"
      @on.click=".toggleIsActive"
    >
      <span @show=".isActive">Enabled</span>
      <span @hide=".isActive">Disabled</span>
    </button>
  </section>`,
});

export function getComponents() {
  return [ConditionalAttributes];
}

export function getRoot() {
  return ConditionalAttributes.make({});
}

export function getStoryBookSection() {
  return {
    title: "Conditional Attributes",
    description: "@if/@then/@else for class and title attributes",
    items: [
      {
        title: "Active",
        description: "Initial state is enabled",
        item: ConditionalAttributes.make({ isActive: true }),
      },
      {
        title: "Inactive",
        description: "Initial state is disabled",
        item: ConditionalAttributes.make({ isActive: false }),
      },
    ],
  };
}
