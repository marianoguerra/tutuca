import { JSDOM } from "jsdom";
import { HeadlessParseContext } from "../../test/dom.js";
import { Comment, DOMParser, Text } from "../../test/dom.js";
import { LintParseContext } from "../../src/lint/index.js";

class HeadlessLintParseContext extends LintParseContext {
  constructor() {
    super(DOMParser, Text, Comment);
  }
}

export function createNodeEnv() {
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>");
  globalThis.document = dom.window.document;
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
