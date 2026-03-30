import { component, html } from "tutuca";

const Counter = component({
  name: "Counter",
  fields: {
    count: 0,
  },
  methods: {
    // event handlers can call methods directly with a `.` prefix `@on.click=".inc"`
    inc() {
      return this.setCount(this.count + 1);
    },
  },
  input: {
    // event handlers can call input handlers by name `@on.click="dec"`
    dec() {
      return this.setCount(this.count - 1);
    },
  },
  view: html`<div class="join join-vertical">
    <button class="btn btn-error" @on.click="dec">-</button>
    <div class="stats">
      <div class="stat text-center">
        <div class="stat-title">Count</div>
        <div class="stat-value" @text=".count"></div>
        <div class="stat-desc">Current Count</div>
      </div>
    </div>
    <button class="btn btn-success" @on.click=".inc">+</button>
  </div>`,
});

export function getComponents() {
  return [Counter];
}

export function getRoot() {
  return Counter.make({});
}
