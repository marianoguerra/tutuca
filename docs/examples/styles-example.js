import { component, css, html } from "tutuca";

export const StylesExample = component({
  name: "StylesExample",
  fields: {},
  style: css`
    .mine {
      color: red;
    }
  `,
  commonStyle: css`
    .common {
      color: yellow;
    }
  `,
  globalStyle: css`
    .styles-example-global-class {
      color: green;
    }
  `,
  view: html`<section>
    <p>View: main</p>
    <p class="mine">My Style</p>
    <p class="common">Common Style</p>
    <p class="styles-example-global-class">Global Style</p>
  </section>`,
  views: {
    one: html`<section>
      <p>View: one</p>
      <p class="mine">My Style</p>
      <p class="common">Common Style</p>
      <p class="styles-example-global-class">Global Style</p>
    </section>`,
    two: {
      view: html`<section>
        <p>View: two</p>
        <p class="mine">My Style</p>
        <p class="common">Common Style</p>
        <p class="styles-example-global-class">Global Style</p>
      </section>`,
      style: css`
        .mine {
          color: orange;
          text-decoration: underline;
        }
      `,
    },
  },
});

export const StylesExampleRoot = component({
  name: "StylesExampleRoot",
  fields: { value: StylesExample.make() },
  view: html`<section class="flex flex-col gap-3">
    <x render=".value"></x>
    <x render=".value" as="one"></x>
    <x render=".value" as="two"></x>
  </section>`,
});

export function getComponents() {
  return [StylesExample, StylesExampleRoot];
}

export function getRoot() {
  return StylesExampleRoot.make({});
}

export function getExamples() {
  return {
    title: "Styles",
    description: "Local, common, global and per-view styles",
    items: [
      {
        title: "All Views",
        description: "Renders main, one and two views together",
        value: StylesExampleRoot.make(),
      },
      {
        title: "Main View Only",
        description: "Single component rendered standalone",
        value: StylesExample.make(),
      },
    ],
  };
}
