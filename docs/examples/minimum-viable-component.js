import { component } from "tutuca";

const MinimumViableComponent = component({});

export function getComponents() {
  return [MinimumViableComponent];
}

export function getRoot() {
  return MinimumViableComponent.make({});
}

export function getStoryBookSection() {
  return {
    title: "Minimum Viable Component",
    description: "Smallest possible component definition",
    items: [
      {
        title: "Default",
        description: "Renders nothing visible",
        item: MinimumViableComponent.make(),
      },
    ],
  };
}
