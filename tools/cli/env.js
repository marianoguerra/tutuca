import { JSDOM } from "jsdom";
import { ParseContext } from "../../src/anode.js";
import { LintParseContext } from "../core/lint-check.js";

export async function createNodeEnv() {
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>");
  const { DOMParser, Text, Comment } = dom.window;
  globalThis.document = dom.window.document;

  class HeadlessParseContext extends ParseContext {
    constructor() {
      super(DOMParser, Text, Comment);
    }
  }
  class HeadlessLintParseContext extends LintParseContext {
    constructor() {
      super(DOMParser, Text, Comment);
    }
  }

  return {
    document: dom.window.document,
    ParseContext: HeadlessParseContext,
    LintParseContext: HeadlessLintParseContext,
    makeDocument() {
      const d = new JSDOM("<!DOCTYPE html><html><body></body></html>");
      return d.window.document;
    },
  };
}
