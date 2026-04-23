import { ParseContext } from "../../src/anode.js";
import { LintParseContext } from "../../src/lint/index.js";

async function loadJSDOM() {
  try {
    const mod = await import("jsdom");
    return mod.JSDOM;
  } catch (e) {
    if (e?.code === "ERR_MODULE_NOT_FOUND") {
      process.stderr.write(
        "tutuca: `jsdom` is required for this command but is not installed.\n" +
          "Install it as a peer dependency: `npm install --save-dev jsdom`.\n",
      );
      process.exit(1);
    }
    throw e;
  }
}

export async function createNodeEnv() {
  const JSDOM = await loadJSDOM();
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
