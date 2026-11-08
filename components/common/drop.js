// Dropping a JSON file on a component to replace what it shows, when its allowDrop is on: the
// file's JSON goes through the component's data load (DATA_META, src/data.js).

import { JSON_FILE, loadData } from "../../src/meta/index.js";
import { $if, errorMessage, field, send, t, tag } from "../../src/tutuca.js";
import { DROP_TARGET, droppedFile } from "./files.js";

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

// The dropFile message and the readText answer that read a file dropped from outside the page:
// the first one of format(self) (JSON_FILE by default), parsed when it's JSON, goes to
// load(self, next, value, name, ctx), which returns an error, "" when it loaded, or undefined
// when it said so itself. enabled(self) says whether a drop is taken; errors show in the field
// errorField. Reading it sets dropName while the answer comes.
export const fileDrop = ({
	load,
	enabled = () => true,
	format = () => JSON_FILE,
	errorField = "dropError",
}) => ({
	on: {
		dropFile: {
			args: [],
			emits: { ask: ["readText"] },
			run(next, _args, ctx) {
				if (!enabled(this)) return;
				const dropped = droppedFile(ctx.event, format(this));
				if (dropped === null) return;
				if (dropped.error !== undefined) {
					next[errorField] = dropped.error;
					return;
				}
				next.dropName = dropped.file.name;
				next[errorField] = "";
				ctx.ask("readText", [dropped.file]);
			},
		},
	},
	answers: {
		readText: {
			ok(next, [text], ctx) {
				const name = this.dropName || "the file";
				next.dropName = "";
				let value = text;
				if (format(this).json) {
					try {
						value = JSON.parse(text);
					} catch (error) {
						next[errorField] = `${name} is not JSON: ${error.message}`;
						return;
					}
				}
				const error = load(this, next, value, name, ctx);
				if (error !== undefined) next[errorField] = error;
			},
			error(next, [error]) {
				next[errorField] = `Reading ${this.dropName || "the file"} failed: ${errorMessage(error)}`;
				next.dropName = "";
			},
			unhandled(next) {
				next.dropName = "";
			},
		},
	},
});
// A fileDrop of JSON, when allowDrop is on, through the component's data load (DATA_META), so a
// drop sets it the way an agent's set_state does and is refused for the same reasons.
// after(next, ctx) runs once a drop loaded.
export const dataDrop = ({ after = () => {} } = {}) =>
	fileDrop({
		enabled: (self) => self.allowDrop,
		load(_self, next, value, name, ctx) {
			const { error } = loadData(next, value, name);
			if (error === undefined) after(next, ctx);
			return error ?? "";
		},
	});
