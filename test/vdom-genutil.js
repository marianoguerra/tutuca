/**
 * Utilities for generating random VNode trees and mutations.
 * Used for property-based testing and the playground.
 */
import { h, VComment, VFragment, VNode, VText } from "../src/vdom.js";
/**
 * Create a seeded random number generator
 */
export function createRng(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}
/**
 * Pick a random element from an array
 */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
/**
 * Generate a random integer in range [min, max] (inclusive)
 */
export function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}
/**
 * Generate a random string with optional spaces and newlines
 */
export function randString(rng, maxLen = 10, options = {}) {
  const { includeSpaces = false, includeNewlines = false } = options;
  let chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  if (includeSpaces) chars += "   "; // Add extra spaces to increase probability
  if (includeNewlines) chars += "\n\n"; // Add extra newlines
  const len = randInt(rng, 1, maxLen);
  let str = "";
  for (let i = 0; i < len; i++) {
    str += chars[Math.floor(rng() * chars.length)];
  }
  return str;
}
/**
 * Generate a random class name (multiple space-separated classes)
 */
export function randClassName(rng, maxClasses = 3) {
  const classCount = randInt(rng, 1, maxClasses);
  const classes = [];
  for (let i = 0; i < classCount; i++) {
    classes.push(randString(rng, 8));
  }
  return classes.join(" ");
}
// ---------------------------------------------------------------------------
// Style serialization helpers
// ---------------------------------------------------------------------------
/**
 * Convert a camelCase CSS property name to kebab-case.
 * e.g. "backgroundColor" -> "background-color"
 */
function camelToKebab(prop) {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
/**
 * Convert a kebab-case CSS property name to camelCase.
 * e.g. "background-color" -> "backgroundColor"
 */
function kebabToCamel(prop) {
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
/**
 * Serialize a style object to a CSS string.
 * e.g. { color: "red", backgroundColor: "blue" } -> "color: red; background-color: blue"
 */
function styleToCss(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${camelToKebab(k)}: ${v}`)
    .join("; ");
}
/**
 * Parse a CSS string into a camelCase style object.
 * e.g. "color: red; background-color: blue" -> { color: "red", backgroundColor: "blue" }
 */
function cssToStyleObj(css) {
  const obj = {};
  for (const part of css.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) obj[kebabToCamel(key)] = val;
  }
  return obj;
}
/**
 * Deep clone a VNode tree
 */
export function cloneTree(node) {
  if (node instanceof VText) {
    return new VText(node.text);
  }
  if (node instanceof VComment) {
    return new VComment(node.text);
  }
  if (node instanceof VNode) {
    const clonedChildren = node.childs.map((child) => cloneTree(child));
    return new VNode(node.tag, { ...node.attrs }, clonedChildren, node.key, node.namespace);
  }
  return node;
}
/**
 * Collect all paths to VNodes in a tree
 */
export function collectPaths(node, currentPath = []) {
  const paths = [currentPath];
  for (let i = 0; i < node.childs.length; i++) {
    const child = node.childs[i];
    if (child instanceof VNode) {
      paths.push(...collectPaths(child, [...currentPath, i]));
    }
  }
  return paths;
}
/**
 * Get a node at a given path
 */
export function getNodeAtPath(root, path) {
  let current = root;
  for (const idx of path) {
    if (!current.childs || idx >= current.childs.length) return null;
    const child = current.childs[idx];
    if (!(child instanceof VNode)) return null;
    current = child;
  }
  return current;
}
// ---------------------------------------------------------------------------
// Tree generation
// ---------------------------------------------------------------------------
const TAGS = ["div", "span", "p", "section", "ul", "li", "article", "header", "footer"];
export const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = ["svg", "rect", "circle", "line", "path", "g", "text", "polygon"];
/**
 * Generate a random VNode tree
 */
/**
 * Generate a random SVG subtree (always namespaced)
 */
function generateSvgTree(rng, depth = 0, options = {}) {
  const {
    maxDepth = 2,
    includeSpacesInText = true,
    includeNewlinesInText = true,
  } = options;
  const textOptions = {
    includeSpaces: includeSpacesInText,
    includeNewlines: includeNewlinesInText,
  };
  const isLeaf = depth >= maxDepth || rng() < 0.4;
  // Inner SVG tags (not "svg" itself — that's only the root)
  const innerTags = SVG_TAGS.filter((t) => t !== "svg");
  if (isLeaf) {
    const tag = pick(rng, innerTags);
    const props = { namespace: SVG_NS };
    if (rng() < 0.5) props.key = randString(rng, 5);
    return h(tag, props, randString(rng, 10, textOptions));
  }
  const childCount = randInt(rng, 1, 3);
  const children = [];
  for (let i = 0; i < childCount; i++) {
    children.push(generateSvgTree(rng, depth + 1, options));
  }
  const tag = pick(rng, innerTags);
  const props = { namespace: SVG_NS };
  if (rng() < 0.5) props.key = randString(rng, 5);
  return h(tag, props, children);
}
export function generateTree(rng, depth = 0, options = {}) {
  const {
    maxDepth = 3,
    includeSpacesInText = true,
    includeNewlinesInText = true,
    includeSpacesInClassName = true,
  } = options;
  const isLeaf = depth >= maxDepth || rng() < 0.3;
  if (isLeaf) {
    // Leaf node - VText, VComment, or VNode with text
    // Note: At depth 0, we always return VNode to ensure root has childs property
    const leafType = rng();
    if (depth > 0 && leafType < 0.25) {
      return new VText(
        randString(rng, 15, {
          includeSpaces: includeSpacesInText,
          includeNewlines: includeNewlinesInText,
        }),
      );
    }
    if (depth > 0 && leafType < 0.45) {
      return new VComment(
        randString(rng, 15, {
          includeSpaces: includeSpacesInText,
          includeNewlines: includeNewlinesInText,
        }),
      );
    }
    const tag = pick(rng, TAGS);
    const props = {};
    if (rng() < 0.5) {
      props.key = randString(rng, 5);
    }
    if (rng() < 0.3) {
      props.className = includeSpacesInClassName ? randClassName(rng, 3) : randString(rng, 8);
    }
    if (rng() < 0.3) {
      props.id = randString(rng, 8);
    }
    return h(
      tag,
      props,
      randString(rng, 10, {
        includeSpaces: includeSpacesInText,
        includeNewlines: includeNewlinesInText,
      }),
    );
  }
  // Occasionally generate an SVG subtree instead of an HTML branch
  if (depth > 0 && rng() < 0.15) {
    const svgChildren = [];
    const childCount = randInt(rng, 1, 3);
    for (let i = 0; i < childCount; i++) {
      svgChildren.push(generateSvgTree(rng, 0, options));
    }
    const props = { namespace: SVG_NS };
    if (rng() < 0.5) props.key = randString(rng, 5);
    return h("svg", props, svgChildren);
  }
  // Branch node
  const childCount = randInt(rng, 1, 4);
  const children = [];
  for (let i = 0; i < childCount; i++) {
    children.push(generateTree(rng, depth + 1, options));
  }
  // Occasionally wrap some children in a VFragment (exercises flattening)
  if (children.length >= 2 && rng() < 0.15) {
    const start = Math.floor(rng() * (children.length - 1));
    const end = start + 1 + Math.floor(rng() * (children.length - start - 1));
    const wrapped = new VFragment(children.splice(start, end - start));
    children.splice(start, 0, wrapped);
  }
  const tag = pick(rng, TAGS);
  const props = {};
  if (rng() < 0.5) {
    props.key = randString(rng, 5);
  }
  if (rng() < 0.3) {
    props.className = includeSpacesInClassName ? randClassName(rng, 3) : randString(rng, 8);
  }
  return h(tag, props, children);
}
const MUTATION_TYPES = [
  "changeText",
  "changeComment",
  "changeTag",
  "addChild",
  "removeChild",
  "replaceChild",
  "shuffleChildren",
  "changeAttr",
  "changeStyle",
];
/**
 * Generate a random mutation for a tree
 */
export function generateMutation(rng, tree, options = {}) {
  const {
    includeSpacesInText = true,
    includeNewlinesInText = true,
    includeSpacesInClassName = true,
  } = options;
  const paths = collectPaths(tree);
  const path = pick(rng, paths);
  const type = pick(rng, MUTATION_TYPES);
  const textOptions = {
    includeSpaces: includeSpacesInText,
    includeNewlines: includeNewlinesInText,
  };
  switch (type) {
    case "changeText":
      return { type, path, newText: randString(rng, 15, textOptions) };
    case "changeComment":
      return { type, path, newText: randString(rng, 15, textOptions) };
    case "changeTag": {
      const target = getNodeAtPath(tree, path);
      const tags = target && target.namespace === SVG_NS ? SVG_TAGS : TAGS;
      return { type, path, newTag: pick(rng, tags) };
    }
    case "addChild": {
      const parent = getNodeAtPath(tree, path);
      const isSvg = parent && parent.namespace === SVG_NS;
      let child;
      const r = rng();
      if (!isSvg && r < 0.3) {
        child = new VText(randString(rng, 10, textOptions));
      } else if (!isSvg && r < 0.5) {
        child = new VComment(randString(rng, 10, textOptions));
      } else if (r < 0.75) {
        const tags = isSvg ? SVG_TAGS : TAGS;
        const props = isSvg
          ? { key: randString(rng, 5), namespace: SVG_NS }
          : { key: randString(rng, 5) };
        child = h(pick(rng, tags), props, randString(rng, 8, textOptions));
      } else {
        const tags = isSvg ? SVG_TAGS : TAGS;
        const props = isSvg ? { namespace: SVG_NS } : null;
        child = h(pick(rng, tags), props, randString(rng, 8, textOptions));
      }
      return { type, path, child, index: randInt(rng, 0, 10) };
    }
    case "removeChild":
      return { type, path, index: randInt(rng, 0, 10) };
    case "replaceChild": {
      const parent = getNodeAtPath(tree, path);
      const isSvg = parent && parent.namespace === SVG_NS;
      let newChild;
      const r = rng();
      if (!isSvg && r < 0.25) {
        newChild = new VText(randString(rng, 10, textOptions));
      } else if (!isSvg && r < 0.5) {
        newChild = new VComment(randString(rng, 10, textOptions));
      } else if (r < 0.75) {
        const tags = isSvg ? SVG_TAGS : TAGS;
        const props = isSvg
          ? { key: randString(rng, 5), namespace: SVG_NS }
          : { key: randString(rng, 5) };
        newChild = h(pick(rng, tags), props, randString(rng, 8, textOptions));
      } else {
        const tags = isSvg ? SVG_TAGS : TAGS;
        const props = isSvg ? { namespace: SVG_NS } : null;
        newChild = h(pick(rng, tags), props, randString(rng, 8, textOptions));
      }
      return { type, path, index: randInt(rng, 0, 10), newChild };
    }
    case "shuffleChildren":
      return { type, path };
    case "changeAttr": {
      const attr = pick(rng, ["className", "id", "title", "data-test"]);
      let value;
      if (rng() < 0.2) {
        value = undefined;
      } else if (attr === "className" && includeSpacesInClassName) {
        value = randClassName(rng, 3);
      } else {
        value = randString(rng, 10);
      }
      return { type, path, attr, value };
    }
    case "changeStyle": {
      const styleProps = ["color", "backgroundColor", "padding", "margin", "border", "display"];
      const style = {};
      const propCount = randInt(rng, 1, 3);
      for (let i = 0; i < propCount; i++) {
        const prop = pick(rng, styleProps);
        style[prop] = rng() < 0.2 ? undefined : randString(rng, 8);
      }
      return { type, path, style };
    }
  }
}
/**
 * Recompute VNode.attrCount after mutating attrs in-place.
 */
function recomputeAttrCount(node) {
  let count = 0;
  for (const _ in node.attrs) {
    count++;
  }
  node.attrCount = count;
}
/**
 * Apply a mutation to a tree, returning a new tree
 */
export function applyMutation(root, mutation, rng) {
  const clone = cloneTree(root);
  const parent = mutation.path.length === 0 ? clone : getNodeAtPath(clone, mutation.path);
  if (!parent || !(parent instanceof VNode)) return clone;
  switch (mutation.type) {
    case "changeText": {
      let found = false;
      for (let i = 0; i < parent.childs.length; i++) {
        if (parent.childs[i] instanceof VText) {
          parent.childs[i] = new VText(mutation.newText);
          found = true;
          break;
        }
      }
      if (!found) {
        parent.childs.push(new VText(mutation.newText));
      }
      break;
    }
    case "changeComment": {
      let found = false;
      for (let i = 0; i < parent.childs.length; i++) {
        if (parent.childs[i] instanceof VComment) {
          parent.childs[i] = new VComment(mutation.newText);
          found = true;
          break;
        }
      }
      if (!found) {
        parent.childs.push(new VComment(mutation.newText));
      }
      break;
    }
    case "changeTag": {
      if (mutation.path.length === 0) {
        return new VNode(
          mutation.newTag.toUpperCase(),
          clone.attrs,
          clone.childs,
          clone.key,
          clone.namespace,
        );
      }
      const parentPath = mutation.path.slice(0, -1);
      const targetIdx = mutation.path[mutation.path.length - 1];
      const parentNode = parentPath.length === 0 ? clone : getNodeAtPath(clone, parentPath);
      if (parentNode instanceof VNode && parentNode.childs[targetIdx] instanceof VNode) {
        const old = parentNode.childs[targetIdx];
        parentNode.childs[targetIdx] = new VNode(
          mutation.newTag.toUpperCase(),
          old.attrs,
          old.childs,
          old.key,
          old.namespace,
        );
      }
      break;
    }
    case "addChild": {
      const idx = Math.min(mutation.index, parent.childs.length);
      parent.childs.splice(idx, 0, mutation.child);
      break;
    }
    case "removeChild": {
      if (parent.childs.length > 0) {
        const idx = Math.min(mutation.index, parent.childs.length - 1);
        parent.childs.splice(idx, 1);
      }
      break;
    }
    case "replaceChild": {
      if (parent.childs.length > 0) {
        const idx = Math.min(mutation.index, parent.childs.length - 1);
        parent.childs[idx] = mutation.newChild;
      }
      break;
    }
    case "shuffleChildren": {
      const arr = [...parent.childs];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      parent.childs.length = 0;
      parent.childs.push(...arr);
      break;
    }
    case "changeAttr": {
      if (mutation.value === undefined) {
        delete parent.attrs[mutation.attr];
      } else {
        parent.attrs[mutation.attr] = mutation.value;
      }
      recomputeAttrCount(parent);
      break;
    }
    case "changeStyle": {
      const existing =
        typeof parent.attrs.style === "string" ? cssToStyleObj(parent.attrs.style) : {};
      const merged = { ...existing };
      for (const [prop, val] of Object.entries(mutation.style)) {
        if (val === undefined) {
          delete merged[prop];
        } else {
          merged[prop] = val;
        }
      }
      if (Object.keys(merged).length === 0) {
        delete parent.attrs.style;
      } else {
        parent.attrs.style = styleToCss(merged);
      }
      recomputeAttrCount(parent);
      break;
    }
  }
  return clone;
}
