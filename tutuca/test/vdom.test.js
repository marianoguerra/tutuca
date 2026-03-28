import { describe, expect, test } from "bun:test";
import { h } from "../src/vdom.js";
describe("h", () => {
    test("maps class to className", () => {
        const node = h("div", { class: "foo" });
        expect(node.attrs.className).toBe("foo");
        expect(node.attrs.class).toBeUndefined();
    });
    test("maps for to htmlFor", () => {
        const node = h("label", { for: "input-id" });
        expect(node.attrs.htmlFor).toBe("input-id");
        expect(node.attrs.for).toBeUndefined();
    });
});
