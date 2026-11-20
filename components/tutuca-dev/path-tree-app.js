// An app that takes every kind of path step: the path tree's stories and tests use it.
import {
	component,
	each,
	field,
	h,
	provided,
	pushView,
	render,
	renderEach,
	renderIt,
	Scope,
	seqItem,
	t,
} from "../../src/tutuca.js";

const leaf = (name) =>
	component({ name, fields: { label: t.string() }, view: h("span", {}, field("label")) });
export const pathTreeSpecs = {
	Theme: leaf("Theme"),
	Title: leaf("Title"),
	Search: leaf("Search"),
	Tag: leaf("Tag"),
	Sidebar: component({
		name: "Sidebar",
		fields: { search: t.component("Search") },
		view: h("nav", {}, render(field("search")), render(provided("theme"))),
	}),
	Page: component({
		name: "Page",
		fields: { title: t.component("Title"), sidebar: t.component("Sidebar") },
		view: h("article", {}, render(field("title")), render(field("sidebar"))),
	}),
	Todo: component({
		name: "Todo",
		fields: { label: t.string(), done: t.boolean(), tags: t.array(t.component("Tag")) },
		views: {
			main: h("li", {}, field("label"), renderEach(field("tags"))),
			row: h("tr", {}, field("label")),
		},
	}),
	App: component({
		name: "App",
		fields: {
			theme: t.component("Theme"),
			header: t.component("Title"),
			pages: t.map(t.component("Page")),
			current: t.string(),
			todos: t.array(t.component("Todo")),
		},
		provides: { theme: "theme" },
		loops: { open: { filter: (_k, todo) => !todo.done } },
		view: h(
			"main",
			{},
			render(field("header"), "compact"),
			render(seqItem("pages", "current")),
			renderEach(field("todos"), "open"),
			h("table", {}, pushView("row", each(field("todos"), h("tbody", {}, renderIt())))),
		),
	}),
};
export const makeApp = (C, { todos = 3 } = {}) =>
	C.App({
		theme: C.Theme({ label: "dark" }),
		header: C.Title({ label: "Hi" }),
		current: "docs",
		pages: {
			home: C.Page({ title: C.Title(), sidebar: C.Sidebar({ search: C.Search() }) }),
			docs: C.Page({ title: C.Title(), sidebar: C.Sidebar({ search: C.Search() }) }),
		},
		todos: Array.from({ length: todos }, (_, i) =>
			C.Todo({ label: `t${i}`, done: i === 1, tags: [C.Tag({ label: "x" })] }),
		),
	});
export const appScope = () => {
	const scope = new Scope();
	scope.register(pathTreeSpecs);
	return scope;
};
