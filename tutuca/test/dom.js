import { JSDOM } from "jsdom";
import { ANode, ParseContext, TextNode } from "../src/anode.js";

const { window } = new JSDOM("");
const { DOMParser, Text, Comment } = window;

export const mpx = () => new ParseContext(DOMParser, Text, Comment);

export class HeadlessParseContext extends ParseContext {
  constructor() {
    super(DOMParser, Text, Comment);
  }
}

export function parse(html) {
  const px = mpx();
  const r = ANode.parse(html, px);

  return [r, px];
}

export const isTextNode = (node) => node instanceof TextNode;
export const isTextNodeWithText = (node, text) =>
  node instanceof TextNode && node.v === text;

export { DOMParser, Text, Comment };
