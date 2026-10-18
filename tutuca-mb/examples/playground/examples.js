// What the playground offers: the landing page's examples, then the component libraries.
// Paths are relative to this file; the playground loads each example's files as text and
// compiles them as one package.
// - A site example (examples/site/*) defines `books()`, which the run's boot file hands to
//   @run.start.
// - A library is its stories' package, its components' package and the example packages
//   those build on, every one editable, in dependency order (`packages`). Each compiles on its
//   own against the ones before it, as moon builds them (compile.js); `boot` names the books.
//   A package's `uses` gives the aliases its moon.pkg gives the packages before it, `std` the
//   core-library packages it aliases otherwise than by their last segment, and `targets` the
//   backends of its target-only files (its moon.pkg `targets`). Its files are listed, so
//   `files` is all of them.
const pkg = (dir, names, { uses = {}, std, targets } = {}) => ({
	dir,
	name: `marianoguerra/tutuca/examples/${dir.replace(/^\.\.\//, "")}`,
	files: names.map((name) => `${dir}/${name}`),
	uses,
	...(std ? { std } : {}),
	...(targets ? { targets } : {}),
});
const library = (id, title, boot, packages) => ({
	id,
	title,
	boot,
	packages,
	files: packages.flatMap((p) => p.files),
});

const FM = { fm: "math" };
const COMMON = "../common";
const JSON_EDITOR = "../json_editor";
const common = pkg(COMMON, ["clock.mbt", "files.mbt"]);
const jsonEditor = pkg(JSON_EDITOR, ["json.mbt"]);
const todo = pkg("../todo", [
	"app.mbt",
	"common.mbt",
	"dates.mbt",
	"fixtures.mbt",
	"project.mbt",
	"quickadd.mbt",
	"task.mbt",
	"using.mbt",
]);

export const examples = [
	{ id: "counter", title: "1 · Counter", files: ["../site/counter/counter.mbt"] },
	{ id: "todo-list", title: "2 · Todo list", files: ["../site/todo_list/todo_list.mbt"] },
	{ id: "composed", title: "3 · Composed components", files: ["../site/composed/composed.mbt"] },
	{ id: "async", title: "4 · Asks", files: ["../site/async/async.mbt"] },
	{
		id: "mistakes",
		title: "5 · Mistakes",
		files: ["../site/mistakes/mistakes.mbt", "../site/mistakes/broken/typos.mbt"],
	},
	library("math", "🧮 Math", "[math_book(), workbench_book()]", [
		pkg("../math", ["math.mbt", "mathml.mbt", "workbench.mbt"], { std: FM }),
		pkg("../math/stories", ["stories.mbt"], { uses: { math: "../math" } }),
	]),
	library("json", "🗂️ JSON editor", "[json_book()]", [
		jsonEditor,
		pkg("../json_editor/stories", ["stories.mbt"], { uses: { json: JSON_EDITOR } }),
	]),
	library("json-schema", "📐 JSON Schema", "[schema_book(), studio_book()]", [
		jsonEditor,
		common,
		pkg("../jsonschema", ["fixtures.mbt", "infer.mbt", "model.mbt", "snapshot.mbt", "studio.mbt", "views.mbt"], {
			uses: { jv: JSON_EDITOR, common: COMMON },
		}),
		pkg("../jsonschema/stories", ["stories.mbt"], { uses: { js: "../jsonschema", jv: JSON_EDITOR } }),
	]),
	library("todo", "✅ Todo app", "[todo_book()]", [
		todo,
		pkg("../todo/stories", ["stories.mbt"], { uses: { todo: "../todo" } }),
	]),
	library("drawing", "🎨 Drawing", "[drawing_book()]", [
		common,
		pkg("../drawing", ["drawing.mbt", "shapes.mbt"], { uses: { common: COMMON }, std: FM }),
		pkg("../drawing/stories", ["stories.mbt"], { uses: { common: COMMON, drawing: "../drawing" } }),
	]),
	library("thing-tracker", "📈 Thing tracker", "[thing_tracker_book()]", [
		common,
		pkg(
			"../thingtracker",
			[
				"app.mbt",
				"bundle_data.mbt",
				"common.mbt",
				"emoji_data.mbt",
				"emoji_picker.mbt",
				"entry_list.mbt",
				"event_editor.mbt",
				"fixtures.mbt",
				"measure.mbt",
				"measurement_wizard.mbt",
				"model.mbt",
				"panel.mbt",
				"panels.mbt",
				"prompt.mbt",
				"records.mbt",
				"rows.mbt",
				"tag_editor.mbt",
				"text_js.mbt",
				"text_table.mbt",
				"thing_editor.mbt",
				"time.mbt",
				"using.mbt",
				"views.mbt",
			],
			{
				uses: { common: COMMON },
				targets: { "text_js.mbt": ["js"], "text_table.mbt": ["wasm-gc"] },
			},
		),
		pkg("../thingtracker/stories", ["stories.mbt"], {
			uses: { common: COMMON, tt: "../thingtracker" },
		}),
	]),
	library("tutuca-dev", "🔍 Dev panel", "[dev_book()]", [
		jsonEditor,
		todo,
		pkg("../devtools", ["stories.mbt"], { uses: { jv: JSON_EDITOR, todo: "../todo" } }),
	]),
];

