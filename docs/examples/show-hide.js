import { component, html } from "tutuca";

const ShowHide = component({
  name: "ShowHide",
  fields: { isOpen: false, count: 0 },
  methods: {
    label() {
      return this.isOpen ? "Hide details" : "Show details";
    },
    incCount() {
      return this.setCount(this.count + 1);
    },
  },
  view: html`<section class="flex flex-col gap-2">
    <button
      class="btn btn-primary"
      @on.click="$toggleIsOpen"
      @text="$label"
    ></button>

    <!-- @show on a host element: visibility on the element itself -->
    <div class="card p-3 border" @show=".isOpen">
      <p>
        Details panel &mdash; only visible when
        <code>isOpen</code> is true.
      </p>
      <button class="btn btn-sm" @on.click="$incCount">Click me</button>
      <p>Clicked <x text=".count"></x> times.</p>
    </div>

    <!-- @hide as the inverse on a host element -->
    <p class="text-sm opacity-60" @hide=".isOpen">
      (details are hidden)
    </p>

    <!-- show as a wrapper attribute on <x> render ops: no extra DOM -->
    <p>
      Count, only when open: <x text=".count" show=".isOpen"></x>
    </p>
  </section>`,
});

export function getComponents() {
  return [ShowHide];
}

export function getRoot() {
  return ShowHide.make({});
}

export function getExamples() {
  return {
    title: "Show / Hide",
    description: "Conditional display with @show, @hide, and the <x> wrapper form",
    items: [
      {
        title: "Default (closed)",
        description: "Click to open the details panel",
        value: ShowHide.make(),
      },
      {
        title: "Open with prior clicks",
        description: "Pre-opened, count starts at 3",
        value: ShowHide.make({ isOpen: true, count: 3 }),
      },
    ],
  };
}
