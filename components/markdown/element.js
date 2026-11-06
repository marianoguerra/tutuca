// The <md-view> element views render markdown with: markdownrswasm's web component (see
// vendor/VERSION), which renders GitHub flavored markdown with the Rust markdown crate as wasm,
// raw HTML escaped, in a shadow DOM. Setting its content property renders it; text that extends
// what it had (an answer streaming in) renders just the new blocks.
//
// Importing this defines it, in a browser; the element and its wasm load on the side. Until it's
// defined, a md-view rendered has no content property, so the renderer sets a content attribute:
// defined, it renders that, and the renderer sets the property from then on. Without a DOM (node,
// the tests) nothing is defined, and md-view stays a plain element with a content attribute.
export const MD_VIEW = "md-view";

// The theme's colors and fonts, through the CSS variables that cross the shadow root.
const THEME = `
	:host { line-height: 1.55; overflow-wrap: anywhere; }
	:host > div > div > :first-child { margin-top: 0; }
	a { color: var(--color-primary, inherit); }
	pre, code { border-radius: 0.25rem; }
	:not(pre) > code { padding: 0.1em 0.3em; background: rgba(127, 127, 127, 0.15); }
	ul:has(> li > input[type="checkbox"]) { list-style: none; padding-left: 0.25em; }
	table { margin: 0.5em 0; }
	hr { border: 0; border-top: 1px solid rgba(127, 127, 127, 0.4); }
`;

const define = async () => {
	const { MdView } = await import("./vendor/markdownrswasmwc.js");
	MdView.basePath = new URL("./vendor/", import.meta.url).href;
	// Its default sheet, shared by every md-view, with the theme after it.
	const rules = [...MdView.defaultStyleSheet.cssRules].map((r) => r.cssText);
	MdView.defaultStyleSheet.replaceSync(`${rules.join("\n")}\n${THEME}`);
	// A content attribute, set before it was defined, is its content too.
	class TutucaMdView extends MdView {
		static observedAttributes = ["content"];
		attributeChangedCallback(name, _old, value) {
			if (name === "content") this.content = value;
		}
	}
	if (!customElements.get(MD_VIEW)) customElements.define(MD_VIEW, TutucaMdView);
	return true;
};

let defined = null;
// Defines md-view once, in a browser: true when it's defined, false without a DOM.
export const registerMarkdown = () => {
	if (defined !== null) return defined;
	const browser = globalThis.customElements !== undefined && globalThis.HTMLElement !== undefined;
	defined = browser ? define() : Promise.resolve(false);
	return defined;
};

registerMarkdown().catch((error) => console.error("md-view failed to load", error));
