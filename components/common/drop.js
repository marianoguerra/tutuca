// Dropping a JSON file on a component to replace what it shows, when its allowDrop is on: the
// file's JSON goes through the component's data load (DATA_META, src/data.js).
import { $if, field, loadData, send, t, tag } from "../../src/tutuca.js";
import { DROP_TARGET, droppedJsonFile } from "./files.js";

const { div, p } = tag;

// The fields a component that takes dropped JSON files adds.
export const jsonDropFields = () => ({
	allowDrop: t.boolean(), // Off by default: a drop goes to what's around it then.
	dropName: t.string(), // The file dropped last, while it's read.
	dropError: t.string(),
});

// body, made by a function so each branch has its own nodes, as a drop target when allowDrop
// is on, with the last drop's error (the hasDropError query) under it. Only then is there an on:drop: a drop handler
// takes the drop whether it does anything or not, so a component that doesn't allow it leaves
// the drop to what's around it.
export const jsonDropTarget = (body) =>
	$if(
		field("allowDrop"),
		div(
			{ class: `flex flex-col gap-1 ${DROP_TARGET}`, "on:drop": send("dropFile") },
			body(),
			$if(field("hasDropError"), p({ class: "text-xs text-error" }, field("dropError")), null),
		),
		body(),
	);

// The dropFile message and the readText answer that load the file's JSON through the
// component's data load (DATA_META), so a drop sets it the way an agent's set_state does and
// is refused for the same reasons. after(next, ctx) runs once a drop loaded.
export const dataDrop = ({ after = () => {} } = {}) => ({
	on: {
		// A file dropped from outside the page: the first JSON one is read, and loaded when the
		// answer comes.
		dropFile: {
			args: [],
			emits: { ask: ["readText"] },
			run(next, _args, ctx) {
				if (!this.allowDrop) return;
				const dropped = droppedJsonFile(ctx.event);
				if (dropped === null) return;
				if (dropped.error !== undefined) {
					next.dropError = dropped.error;
					return;
				}
				next.dropName = dropped.file.name;
				next.dropError = "";
				ctx.ask("readText", [dropped.file]);
			},
		},
	},
	answers: {
		// The dropped file's text: loaded when it's valid, the error shown otherwise.
		readText: {
			ok(next, [text], ctx) {
				const name = this.dropName || "the file";
				next.dropName = "";
				let json;
				try {
					json = JSON.parse(text);
				} catch (error) {
					next.dropError = `${name} is not JSON: ${error.message}`;
					return;
				}
				const { error } = loadData(next, json, name);
				next.dropError = error ?? "";
				if (error === undefined) after(next, ctx);
			},
			error(next, [error]) {
				next.dropError = `Reading ${this.dropName || "the file"} failed: ${error?.message ?? error}`;
				next.dropName = "";
			},
			unhandled(next) {
				next.dropName = "";
			},
		},
	},
});
