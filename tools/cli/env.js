import { JSDOM } from "jsdom";
import { ParseContext } from "../../src/anode.js";
import { LintParseContext } from "../core/lint-check.js";

export async function createNodeEnv() {
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>");
  const { document, Text, Comment } = dom.window;
  globalThis.document = document;

  class HeadlessParseContext extends ParseContext {
    constructor() {
      super(document, Text, Comment);
    }
  }
  class HeadlessLintParseContext extends LintParseContext {
    constructor() {
      super(document, Text, Comment);
    }
  }

  return {
    document: dom.window.document,
    ParseContext: HeadlessParseContext,
    LintParseContext: HeadlessLintParseContext,
  };
}
