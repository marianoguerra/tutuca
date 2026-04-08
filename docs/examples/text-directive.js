import { component, html } from "tutuca";

const TextDirective = component({
  name: "TextDirective",
  fields: { str: "hello", num: 42, bool: true, notSet: null },
  methods: {
    getStrUpper() {
      return this.str.toUpperCase();
    },
  },
  view: html`<div class="grid grid-cols-[auto_auto] gap-x-4 gap-y-2 items-center">
    <span>String:</span> <span @text=".str"></span>
    <span>Number:</span> <span @text=".num"> &lt;- text directive is prepended</span>
    <span>Boolean:</span> <x text=".bool"></x>
    <span>notSet:</span> <span @text=".notSet"></span>
    <span>Method Call:</span> <span @text=".getStrUpper"></span>
  </div>`,
});

export { TextDirective };

export function getComponents() {
  return [TextDirective];
}

export function getRoot() {
  return TextDirective.make({});
}
