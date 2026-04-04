import { component, html } from "tutuca";

const TextDirective = component({
  name: "TextDirective",
  fields: { str: "hello", num: 42, bool: true, notSet: null },
  methods: {
    getStrUpper() {
      return this.str.toUpperCase();
    },
  },
  view: html`<section>
    <p>String: <span @text=".str"></span></p>
    <p>Number: <span @text=".num"> &lt;- text directive is prepended</span></p>
    <p>Boolean: <x text=".bool"></x></p>
    <p>notSet: <span @text=".notSet"></span></p>
    <p>Method Call: <span @text=".getStrUpper"></span></p>
  </section>`,
});

export { TextDirective };

export function getComponents() {
  return [TextDirective];
}

export function getRoot() {
  return TextDirective.make({});
}
