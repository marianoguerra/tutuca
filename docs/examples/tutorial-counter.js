import { component, html } from "tutuca";

export const Counter = component({
  name: "Counter",
  fields: {
    count: 0,
  },
  methods: {
    inc() {
      return this.setCount(this.count + 1);
    },
  },
  input: {
    dec() {
      return this.setCount(this.count - 1);
    },
  },
  view: html`<div class="flex flex-col">
    <button class="btn btn-soft btn-error" @on.click="dec">-</button>
    <div class="stats">
      <div class="stat text-center">
        <div class="stat-title">Count</div>
        <div class="stat-value" @text=".count"></div>
        <div class="stat-desc">Current Count</div>
      </div>
    </div>
    <button class="btn btn-soft btn-success" @on.click=".inc">+</button>
  </div>`,
});

export function getComponents() {
  return [Counter];
}

export function getRoot() {
  return Counter.make({});
}
