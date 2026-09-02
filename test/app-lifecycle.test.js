import { describe, expect, test, vi } from "vitest";
import { component, html } from "../index.js";
import { NullDomCache } from "../src/cache.js";
import { renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";

const Root = component({
  name: "Root",
  fields: { n: 0 },
  receive: {
    inc(draft) {
      draft.n += 1;
    },
  },
  view: html`<p @text=".n"></p>`,
});

describe("App lifecycle", () => {
  test("renderToHTMLNode keeps the cache off when other options are passed", () => {
    const document = setupJsdom();
    const { app, cleanup } = renderToHTMLNode(
      document,
      [Root],
      null,
      Root.make(),
      HeadlessParseContext,
      {
        intentHandlers: {},
      },
    );
    expect(app.renderer.cache).toBeInstanceOf(NullDomCache);
    expect(app._evictCacheId).toBe(null);
    cleanup();
  });

  test("stop() cancels a pending transaction batch", () => {
    vi.useFakeTimers();
    try {
      const document = setupJsdom();
      const { app } = renderToHTMLNode(document, [Root], null, Root.make(), HeadlessParseContext);
      app.sendAtRoot("inc", []);
      expect(app._transactNextBatchId).not.toBe(null);
      app.stop();
      expect(app._transactNextBatchId).toBe(null);
      vi.runAllTimers();
      // Stopped before the batch ran: the queued message stays queued and the state is untouched.
      expect(app.state.val.n).toBe(0);
      expect(app.transactor.hasPendingTransactions).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
