// The same DOM interactions run against the JS and wasm-gc builds.
import assert from "node:assert/strict";
export const settle = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const button = (app, text) =>
	[...app.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));

export async function todo(app, window) {
	const text = () => app.textContent.replace(/\s+/g, "");
	assert.match(text(), /Preparethequarterlyreport/);

	const input = (label) => app.querySelector(`[aria-label="${label}"]`);
	const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

	// Quick add through the DOM.
	input("Quick add").value = "Call Ada today p1 @phone";
	fire(input("Quick add"), "input");
	fire(input("Quick add task"), "submit");
	await settle();
	assert.match(text(), /CallAda/);
	assert.equal(input("Quick add").value, "");

	// Complete it.
	const row = [...app.querySelectorAll("span")].find((s) => s.textContent === "Call Ada");
	const checkbox = row.closest(".group").querySelector('input[type="checkbox"]');
	checkbox.checked = true;
	fire(checkbox, "change");
	await settle();
	// Completed tasks leave the page unless "Show completed" is on.
	assert.doesNotMatch(text(), /CallAda/);
	const show = input("Show completed") ?? app.querySelector('label input[type="checkbox"]');
	show.checked = true;
	fire(show, "change");
	await settle();
	const done = [...app.querySelectorAll("span")].find((s) => s.textContent === "Call Ada");
	assert.match(done.className, /line-through/);

	// Open the upcoming page from the sidebar.
	const upcoming = [...app.querySelectorAll("button")].find((b) =>
		b.textContent.includes("Upcoming"),
	);
	upcoming.click();
	await settle();
	assert.match(app.querySelector("h2").textContent, /Upcoming/);

	// The console's custom formatter shows the exposed app: its state, vdom and component.
	const [formatter] = globalThis.devtoolsFormatters.filter((f) => f.tutuca);
	const flat = (ml) =>
		typeof ml === "string" ? ml : ml[0] === "object" ? "<ref>" : ml.slice(2).map(flat).join("");
	const { tutuca } = globalThis;
	assert.match(flat(formatter.header(tutuca.app.state)), /^\{ /);
	assert.ok(formatter.hasBody(tutuca.app.state));
	assert.match(flat(formatter.header(tutuca.app.vdom)), /\[\d+ vnodes?\]/);
	assert.match(flat(formatter.header(tutuca.app.component)), /Component TodoApp/);
	assert.match(flat(formatter.body(tutuca.app.component)), /view main/);
	assert.equal(formatter.header({}), null, "other values keep the native view");
	// JS "install is idempotent per target": the demo installs it on expose, once.
	assert.equal(globalThis.devtoolsFormatters.filter((f) => f.tutuca).length, 1);
	// JS "ignores values it doesn't know".
	for (const v of [1, "s", null, undefined, {}, [], [1, {}], () => {}]) {
		assert.equal(formatter.header(v), null);
		assert.equal(formatter.hasBody(v), false);
	}
	// JS "large non vdom arrays bail out on the first item" (reads one): this one never reads an
	// item, it checks a marker.
	let reads = 0;
	const big = new Proxy(new Array(100000).fill(0), {
		get: (t, k) => {
			if (/^\d+$/.test(String(k))) reads++;
			return t[k];
		},
	});
	assert.equal(formatter.header(big), null);
	assert.equal(reads, 0);
	assert.match(tutuca.app.componentAt(input("Quick add")), / at /);
}

export const demos = {
	math: async (app) => {
		assert.match(app.textContent, /Saved problems/);
		// A slider moves a coefficient: the equation follows.
		const slider = app.querySelector('input[type="range"]');
		assert.ok(slider, "a coefficient slider");
		const before = app.textContent;
		slider.value = String(Number(slider.value) + 1);
		slider.dispatchEvent(new app.ownerDocument.defaultView.Event("input", { bubbles: true }));
		await settle();
		assert.notEqual(app.textContent, before, "the slider changes the problem");
		button(app, "complex roots").click();
		await settle();
		assert.match(app.textContent.replace(/\s+/g, ""), /x=−1±2i/);
		assert.equal(app.querySelector("math").namespaceURI, "http://www.w3.org/1998/Math/MathML");
		// demos.test.js "math demo: saves, reopens and removes problems", through the DOM.
		const opens = () => app.querySelectorAll('button[title="Open"]');
		assert.equal(opens().length, 2);
		button(app, "two roots").click(); // Back to the demo's x² − 3x + 2, unsaved.
		await settle();
		button(app, "Save problem").click();
		await settle();
		assert.equal(opens().length, 3);
		assert.match(opens()[0].textContent, /x² − 3x \+ 2 = 0/);
		button(app, "Save problem").click();
		await settle();
		assert.equal(opens().length, 3, "already saved: no duplicate");
		opens()[2].click();
		await settle();
		assert.match(app.textContent, /has no inverse/);
		app.querySelector('[aria-label="Remove problem"]').click();
		await settle();
		assert.equal(opens().length, 2);
	},

	drawing: async (app, window) => {
		assert.equal(app.querySelectorAll("svg g > *").length, 5);
		button(app, "New").click();
		await settle();
		assert.equal(app.querySelectorAll("svg g > *").length, 0);
		app.querySelector('[title="Undo (Ctrl+Z)"]').click();
		await settle();
		assert.equal(app.querySelectorAll("svg g > *").length, 5);
		// demos.test.js "drawing demo: picks a tool".
		const rect = app.querySelector('button[title="Rectangle (R)"]');
		const before = rect.className;
		rect.click();
		await settle();
		assert.notEqual(app.querySelector('button[title="Rectangle (R)"]').className, before);
		const svg = app.querySelector("svg");
		const pointer = (type, x, y) =>
			svg.dispatchEvent(
				new window.MouseEvent(type, {
					bubbles: true,
					cancelable: true,
					clientX: x,
					clientY: y,
				}),
			);
		pointer("pointerdown", 20, 20);
		await settle();
		pointer("pointermove", 120, 90);
		await settle();
		pointer("pointerup", 120, 90);
		await settle();
		assert.equal(app.querySelectorAll("svg g > *").length, 6, "a new shape");
	},

	jsonschema: async (app, window) => {
		assert.match(app.textContent, /Schema/);
		const field = [...app.querySelectorAll('input[aria-label="string value"]')][0];
		field.value = "ord_1";
		field.dispatchEvent(new window.Event("input", { bubbles: true }));
		await settle();
		// The demo infers again after each edit, so it is never left stale.
		assert.ok(
			![...app.querySelectorAll("button")].some((b) => b.textContent.includes("Update schema")),
		);
		// demos.test.js "json studio demo: the schema follows the payload", through the DOM.
		const key = app.querySelector('input[aria-label="key"]');
		key.value = "orderNumber";
		key.dispatchEvent(new window.Event("input", { bubbles: true }));
		await settle();
		assert.match(app.textContent, /orderNumber/);
		assert.ok(
			![...app.querySelectorAll("button")].some((b) => b.textContent.includes("Update schema")),
		);
		const select = app.querySelector("select");
		assert.ok(select, "a sample picker");
		const before = app.textContent;
		select.value = select.options[select.options.length - 1].value;
		select.dispatchEvent(new window.Event("change", { bubbles: true }));
		await settle();
		assert.notEqual(app.textContent, before, "the sample switches");
	},

	thingtracker: async (app, window) => {
		// A tap on a thing logs it: a toast says so.
		const coffee = app.querySelector('[aria-label^="Log Coffee"]');
		assert.ok(coffee, "Coffee to tap");
		coffee.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
		await settle();
		assert.match(app.textContent, /Coffee/);
		assert.match(app.textContent, /Undo|logged|Logged/);
	},
};

export async function counter(window, start) {
	const reports = [];
	const page = window.document.getElementById("app");
	page.addEventListener("tutucareport", (e) =>
		reports.push(`${e.detail.key} ${e.detail.type} ${e.detail.data}`),
	);
	await start();
	const [a, b, none] = page.querySelectorAll("tutuca-app");
	assert.match(a.shadowRoot.textContent, /Clicked 0/);
	assert.match(b.shadowRoot.textContent, /Clicked 10/);
	assert.equal(none.shadowRoot.textContent, "no app for nothing");
	b.shadowRoot
		.querySelector("button")
		.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.match(b.shadowRoot.textContent, /Clicked 11/);
	assert.match(a.shadowRoot.textContent, /Clicked 0/, "each element has its own app");
	assert.deepEqual(reports, ["counter:10 count 11"]);
	// A removed element's app stops: it no longer handles clicks.
	const button = a.shadowRoot.querySelector("button");
	a.remove();
	await new Promise((resolve) => setTimeout(resolve, 10));
	button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.match(button.textContent, /Clicked 0/);
}

export async function storybook(root, window) {
	const button = (text) =>
		[...root.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));
	assert.ok(button("Task/With subtasks"), "the story list renders");
	// The requests the page's <tutuca-app>s make, by key.
	const requests = [];
	root.addEventListener("tutucarequest", (e) => requests.push(e.detail.key));

	button("Task/With subtasks").click();
	await settle();
	const preview = root.querySelector("tutuca-app");
	assert.equal(preview.getAttribute("app-key"), "Todo/Task/With subtasks@0");
	assert.deepEqual(requests, ["Todo/Task/With subtasks@0"], "one request mounts the preview");
	assert.ok(preview.shadowRoot, "the preview runs in a shadow root");
	assert.equal(preview.textContent, "", "the UI never renders inside it");
	const inside = preview.shadowRoot;
	assert.match(inside.textContent, /Move house/, "the preview runs the story");
	const reports = [];
	root.addEventListener("tutucareport", (e) => reports.push(e.detail));
	assert.match(root.textContent, /complete, reorder and remove subtasks/);

	const firstInside = inside.firstElementChild;
	const lastInside = inside.lastElementChild.firstElementChild;
	root.querySelector('[title="Run to end"]').click();
	await settle();
	// JS "the inner app mounts in the shadow root and survives outer renders".
	assert.equal(root.querySelector("tutuca-app"), preview, "the UI keeps the element");
	assert.equal(inside.firstElementChild, firstInside, "and its shadow root as it was");
	assert.equal(inside.lastElementChild.firstElementChild, lastInside);
	assert.equal(preview.childNodes.length, 0);
	assert.equal(requests.length, 1, "the outer render doesn't mount it again");
	assert.match(root.textContent, /collapsed/);
	assert.doesNotMatch(root.textContent, /failed/);

	// A click inside the preview is the story's: the timeline gets a user entry.
	// The timeline: the list after the "Timeline" heading.
	const timeline = () =>
		[...root.querySelectorAll("h3")].find((h) => h.textContent === "Timeline").nextElementSibling
			.children.length;
	const before = timeline();
	const toggle = [...inside.querySelectorAll("button")].find((b) => /▸|▾/.test(b.textContent));
	// JS "inner clicks reach the inner host, and the outer host only sees the element".
	const outerTargets = [];
	root.addEventListener("click", (e) => outerTargets.push(e.target));
	const reportsBefore = reports.length;
	toggle.click();
	assert.deepEqual(outerTargets, [preview], "the page sees the click on the element");
	// JS "emit reaches an outer handler": reports arrive after the event, not during it.
	assert.equal(reports.length, reportsBefore, "reports are queued");
	await settle();
	// The story tells the UI, which asks for the new summary.
	assert.equal(timeline(), before + 1, "the timeline gets the click");
	assert.match(root.textContent, /click → toggleExpand\(\)/);
	// It reports its state to the page as an event on the element.
	assert.ok(reports.length > 0 && reports.at(-1).type === "state", "the preview reports its state");
	assert.equal(reports.at(-1).key, "Todo/Task/With subtasks@0");
	assert.equal(typeof reports.at(-1).data, "object", "with the summary as its data");

	// A key no story answers says so.
	const stray = window.document.createElement("tutuca-app");
	stray.setAttribute("app-key", "No/Such story");
	window.document.body.append(stray);
	assert.equal(stray.shadowRoot.textContent, "no app for No/Such story");
	assert.equal(stray.controller, null);

	// A preview the UI didn't render, under the storybook's root, which answers the requests
	// that reach it (as JS's startStorybook listens on rootNode).
	const body = root;
	const solo = window.document.createElement("tutuca-app");
	const soloReports = [];
	solo.addEventListener("tutucareport", (e) => soloReports.push(e.detail.key));
	solo.setAttribute("app-key", "Math/Matrix/Singular");
	body.append(solo);
	const soloRoot = () => solo.shadowRoot.lastElementChild;
	assert.match(soloRoot().textContent, /no inverse/, "it runs its story");
	// Records each app's disposal, as JS's test wraps the controller's dispose.
	const disposed = [];
	const watch = () => {
		const { controller } = solo;
		const key = solo.getAttribute("app-key");
		const { dispose } = controller;
		controller.dispose = () => {
			disposed.push(key);
			dispose();
		};
	};
	watch();
	const requestsBefore = requests.length;
	// JS "changing app-key disposes the app and requests a new one"; and "stale requests are
	// dropped": the reports the old key's app queued don't arrive under it.
	const firstRoot = soloRoot();
	solo.setAttribute("app-key", "Math/Quadratic/Double root");
	assert.notEqual(soloRoot(), firstRoot, "a new key mounts a new app");
	assert.deepEqual(disposed, ["Math/Matrix/Singular"], "the old key's app is disposed");
	assert.deepEqual(
		requests.slice(requestsBefore),
		["Math/Quadratic/Double root"],
		"and a new one requested",
	);
	watch();
	assert.doesNotMatch(soloRoot().textContent, /no inverse/);
	await settle();
	assert.ok(soloReports.length > 0);
	assert.deepEqual(
		new Set(soloReports),
		new Set(["Math/Quadratic/Double root"]),
		"only the new key reports",
	);
	// JS "moving the element keeps its app".
	const mountedRoot = soloRoot();
	const box = window.document.createElement("div");
	body.append(box);
	box.append(solo);
	await settle();
	assert.equal(soloRoot(), mountedRoot, "a move keeps the app");
	assert.equal(disposed.length, 1, "a move disposes nothing");
	assert.equal(requests.length, requestsBefore + 1, "and requests nothing");
	// JS "removing the element disposes its app": back on the page, it starts afresh.
	solo.remove();
	await settle();
	assert.deepEqual(
		disposed,
		["Math/Matrix/Singular", "Math/Quadratic/Double root"],
		"removal disposes the app",
	);
	assert.equal(solo.controller, null);
	box.append(solo);
	assert.notEqual(soloRoot(), mountedRoot, "a removed element's app was disposed");

	// The previews' classes get compiled: margaui writes their CSS in the shadow root.
	await new Promise((resolve) => setTimeout(resolve, 500));
	const css = [...inside.querySelectorAll("style")].map((s) => s.textContent).join("");
	assert.match(css, /\.flex/, "compiled classes in the preview");

	// JS "classes stories compute at render compile into their shadow roots": a class only the
	// edit view shows gets compiled once a click there renders it.
	const editor = window.document.createElement("tutuca-app");
	editor.setAttribute("app-key", "JSON/Document");
	body.append(editor);
	const editorCss = () =>
		[...editor.shadowRoot.querySelectorAll("style")].map((s) => s.textContent).join("");
	await new Promise((resolve) => setTimeout(resolve, 500));
	assert.match(editorCss(), /\.flex/);
	assert.doesNotMatch(editorCss(), /decoration-dashed/, "the view mode never shows it");
	[...editor.shadowRoot.querySelectorAll("button")].find((b) => b.textContent === "Edit").click();
	await new Promise((resolve) => setTimeout(resolve, 500));
	assert.match(
		editorCss(),
		/\.decoration-dashed/,
		"the edit view's classes compile after its render",
	);

	// JS "… and a pick scrolls to the top": the story panel scrolls back on a pick.
	const storyMain = root.querySelector("[data-story-main]");
	storyMain.scrollTop = 500;
	button("Task/Plain").click();
	await settle();
	assert.equal(root.querySelector("tutuca-app").getAttribute("app-key"), "Todo/Task/Plain@0");
	assert.equal(root.querySelector("[data-story-main]"), storyMain, "the same panel");
	assert.equal(storyMain.scrollTop, 0, "a pick scrolls the panel to its top");
}
