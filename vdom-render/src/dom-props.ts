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

function removeProperty(node: Element, propName: string, previous: Props): void {
  const previousValue = previous[propName];

  if (isHtmlAttribute(propName)) {
    // aria-* and data-* must use removeAttribute
    node.removeAttribute(propName);
  } else if (typeof previousValue === "string") {
    setDomProp(node, propName, "");
    // Remove the underlying HTML attribute so the DOM matches a fresh render
    const attrName =
      propName === "className" ? "class" : propName === "htmlFor" ? "for" : propName;
    node.removeAttribute(attrName);
  } else {
    setDomProp(node, propName, null);
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

  let current = getDomProp(node, propName);
  if (typeof current !== "object" || current === null) {
    setDomProp(node, propName, {});
    current = getDomProp(node, propName);
  }

  const target = current as Record<string, unknown>;
  for (const k in propValue) {
    target[k] = propValue[k];
  }
}

export { applyProperties, isHtmlAttribute };
