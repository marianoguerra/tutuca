import { expect, test } from "bun:test";
import { Path } from "../src/path.js";
import { Transactor } from "../src/transactor.js";

test("can push logic transaction", () => {
  const t = new Transactor();
  t.pushBubble(new Path([]), "blurb", []);
  expect(t.hasPendingTransactions).toBe(true);
});
