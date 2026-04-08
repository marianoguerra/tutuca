import { component } from "tutuca";

const MinimumViableComponent = component({});

export function getComponents() {
  return [MinimumViableComponent];
}

export function getRoot() {
  return MinimumViableComponent.make({});
}
