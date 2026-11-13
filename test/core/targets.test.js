// Rendering anything but a page is opt in: component() takes renders only for the targets
// enableTargets was given, and the default bundles carry none of the renderers.
import assert from "node:assert/strict";
import test from "node:test";
import * as esbuild from "esbuild";
import {
	component,
	enableTargets,
	h,
	RenderContext,
	RenderTarget,
	specOf,
} from "../../src/tutuca.js";

test("component() takes renders only for enabled targets, and says which are", () => {
	const pdf = new RenderTarget("pdf");
	const make = () => component({ name: "Doc", view: h("p", {}), renders: { pdf: h("page", {}) } });
	assert.throws(
		make,
		/^Error: Component Doc renders pdf, which isn't an enabled render target: pass its target to enableTargets first \(none is enabled\)$/,
	);
	enableTargets(pdf);
	assert.equal(make().viewsFor(pdf).main.tagName, "page");
	assert.throws(
		() => component({ name: "Doc", renders: { svg: h("g", {}) } }),
		/renders svg, which isn't an enabled render target: .* \(enabled: pdf\)/,
	);
	// Enabling the same target again is fine; another one of the same name, or not a target, isn't.
	enableTargets(pdf);
	assert.throws(
		() => enableTargets(new RenderTarget("pdf")),
		/another render target is enabled as pdf/,
	);
	assert.throws(() => enableTargets("pdf"), /enableTargets takes RenderTargets, not pdf/);
});

test("a component without renders for a target shows its views if the target falls back to them", () => {
	const shows = new RenderTarget("shows", { fallsBackToViews: true });
	const fails = new RenderTarget("fails");
	enableTargets(shows, fails);
	const Plain = component({ name: "Plain", view: h("p", {}, "page") });
	const best = (target) => {
		const instance = Plain.make();
		return RenderContext.root(instance, { target }).getBestViewFor(specOf(instance));
	};
	assert.equal(best(null), Plain.views.main);
	assert.equal(best(shows), Plain.views.main);
	assert.throws(() => best(fails), /^Error: Component Plain has no fails render$/);
});

// What each default bundle (scripts/dist.js's entries) is made of.
const inputsOf = async (contents) => {
	const { metafile } = await esbuild.build({
		stdin: { contents, resolveDir: ".", loader: "js" },
		bundle: true,
		format: "esm",
		platform: "browser",
		write: false,
		metafile: true,
		logLevel: "silent",
	});
	return Object.keys(metafile.inputs);
};
const OPT_IN =
	/^(src\/(tui|jsast|mdast|ps|pdf|docx|checked)\/|deps\/(astring|mdast|pdfkit|docx)\.js)/;

test("the default bundles carry no render target but the page's", async () => {
	for (const contents of [
		'export * from "./src/tutuca.js";',
		'export * from "./src/tutuca.js";\nexport * from "./src/tutuca.dev.js";',
	]) {
		const inputs = await inputsOf(contents);
		assert.ok(inputs.includes("src/core/model/targets.js"), inputs.join("\n"));
		assert.deepEqual(
			inputs.filter((path) => OPT_IN.test(path)),
			[],
		);
	}
});
