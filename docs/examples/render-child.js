import { component, html } from "tutuca";

const Greeting = component({
  name: "Greeting",
  fields: { name: "world" },
  view: html`<p class="p-2 border rounded">
    Hello, <strong @text=".name"></strong>!
  </p>`,
});

const Page = component({
  name: "Page",
  fields: { greeting: Greeting.make({ name: "tutorial reader" }) },
  view: html`<section class="flex flex-col gap-2">
    <h2 class="text-lg">Page header</h2>
    <x render=".greeting"></x>
    <p class="opacity-60">&mdash; end of page &mdash;</p>
  </section>`,
});

export function getComponents() {
  return [Page, Greeting];
}

export function getRoot() {
  return Page.make({});
}

export function getExamples() {
  return {
    title: "Rendering a Child Component",
    description: "A parent renders a child via <x render=...>",
    items: [
      {
        title: "Default",
        description: "Greeting addressed to the reader",
        value: Page.make(),
      },
      {
        title: "Custom name",
        description: "Pass a different Greeting instance into the page field",
        value: Page.make({ greeting: Greeting.make({ name: "Ada" }) }),
      },
    ],
  };
}
