import { JSDOM, VirtualConsole } from "jsdom";
import { ParseContext } from "../../src/anode.js";
import { LintParseContext } from "../core/lint-check.js";

export async function createNodeEnv() {
  const virtualConsole = new VirtualConsole();
  virtualConsole.forwardTo(console, { jsdomErrors: "none" });
  virtualConsole.on("jsdomError", (err) => {
    if (err?.message?.includes("Could not parse CSS stylesheet")) return;
    console.error(err.message);
  });
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", { virtualConsole });
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
