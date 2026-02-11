import type { Props } from "./types.ts";

function isHtmlAttribute(propName: string): boolean {
  return propName[4] === "-" && (propName[0] === "d" || propName[0] === "a");
}

function getDomProp(node: Element, propName: string): unknown {
  return (node as unknown as Record<string, unknown>)[propName];
}

function setDomProp(node: Element, propName: string, value: unknown): void {
  (node as unknown as Record<string, unknown>)[propName] = value;
}

function applyProperties(node: Element, props: Props, previous: Props): void {
  for (const propName in props) {
    const propValue = props[propName];

    if (propValue === undefined) {
      removeProperty(node, propName, previous);
    } else if (isHtmlAttribute(propName)) {
      // aria-* and data-* must use setAttribute
      node.setAttribute(propName, propValue as string);
    } else {
      if (typeof propValue === "object" && propValue !== null) {
        patchObject(node, previous, propName, propValue as Props);
      } else {
        setDomProp(node, propName, propValue);
      }
    }
  }
}

// Map DOM property names to their HTML attribute counterparts
const PROP_TO_ATTR: Record<string, string> = {
  className: "class",
  htmlFor: "for",
};

function removeProperty(node: Element, propName: string, previous: Props): void {
  if (previous) {
    const previousValue = previous[propName];

    if (isHtmlAttribute(propName)) {
      // aria-* and data-* must use removeAttribute
      node.removeAttribute(propName);
    } else if (typeof previousValue === "string") {
      setDomProp(node, propName, "");
      // Remove the underlying HTML attribute so the DOM matches a fresh render
      const attrName = PROP_TO_ATTR[propName] || propName;
      node.removeAttribute(attrName);
    } else {
      setDomProp(node, propName, null);
    }
  }
}

function patchObject(
  node: Element,
  previous: Props,
  propName: string,
  propValue: Props,
): void {
  const previousValue = previous ? previous[propName] : undefined;

  if (
    previousValue &&
    typeof previousValue === "object" &&
    Object.getPrototypeOf(previousValue) !== Object.getPrototypeOf(propValue)
  ) {
    setDomProp(node, propName, propValue);
    return;
  }

  if (
    typeof getDomProp(node, propName) !== "object" ||
    getDomProp(node, propName) === null
  ) {
    setDomProp(node, propName, {});
  }

  for (const k in propValue) {
    (getDomProp(node, propName) as Record<string, unknown>)[k] = propValue[k];
  }
}

export { applyProperties, isHtmlAttribute };
