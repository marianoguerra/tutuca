// A markdown document: shown rendered, GitHub flavored (headings, lists, task lists, tables,
// code, links), and written in its edit view, a textarea beside what it renders to. On a canvas
// it's a builtin kind, for rich text and notes anywhere: a .md file dropped on it loads, ⤓
// downloads it as one, and an agent writes it.
import {
	$if,
	AGENT_META,
	agentTool,
	component,
	DATA_META,
	field,
	send,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { setField } from "../common/card.js";
import { metaFor } from "../common/meta.js";
import { MD_VIEW } from "./element.js";

const { div, p, textarea } = tag;

const README = `# Markdown

Write in the **edit view** (✎), see it rendered here.

## What it shows

- *Emphasis*, **strong**, ~~struck~~ and \`code\`
- [Links](https://github.com/marianoguerra/tutuca)
- [x] Task lists
- [ ] Tables and code blocks

| Kind | Example |
| ---- | ------- |
| Heading | \`# Title\` |
| List | \`- item\` |

\`\`\`js
const hello = (name) => \`Hello, \${name}!\`;
\`\`\`

> Raw HTML is escaped, never run.
`;
const NOTES = `# Notes

- [ ] Something to do
- An idea to keep
`;

// The heading lines of a markdown text, outside fenced code blocks.
export const headingsOf = (text) => {
	const headings = [];
	let fence = null;
	for (const line of text.split("\n")) {
		const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
		if (fence !== null) {
			if (marker?.[0] === fence[0] && marker.length >= fence.length) fence = null;
		} else if (marker !== undefined) fence = marker;
		else if (/^ {0,3}#{1,6}(\s|$)/.test(line)) headings.push(line.trim());
	}
	return headings;
};
const wordsIn = (text) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
const PREVIEW = 400;

const MD = "block min-w-0";
const shown = (attrs = {}) => tag[MD_VIEW]({ class: MD, content: field("text"), ...attrs });

export const Markdown = component({
	name: "Markdown",
	meta: {
		...metaFor("Markdown", "📄", "Rich text and notes, written in markdown.", 520),
		// An agent writes the whole text, adds to it or changes part of it; set_state does too.
		[AGENT_META]: {
			prompt:
				"A markdown document (GitHub flavored: headings, lists, task lists, tables, code blocks, links), shown rendered. Write it in markdown; raw HTML is shown escaped, not rendered.",
			summary: "outline",
			tools: [
				agentTool("set_text", "message", ["text"], "Replace the whole text.", {
					target: "setText",
				}),
				agentTool("append_text", "message", ["text"], "Add text at the end, after a blank line.", {
					target: "append",
				}),
				agentTool(
					"replace_text",
					"message",
					["find", "replacement"],
					"Replace every occurrence of find, as written, with replacement.",
					{ target: "replace" },
				),
			],
		},
		// Its data is its text, read from and saved as a .md file.
		[DATA_META]: {
			load: "load",
			data: "markdown",
			file: { type: "text/markdown", extensions: [".md", ".markdown", ".txt"] },
			samples: { readme: README, notes: NOTES },
		},
	},
	fields: { text: t.string() },
	queries: {
		get markdown() {
			return this.text;
		},
		get isEmpty() {
			return this.text.trim() === "";
		},
		// Its size, headings and how it starts, for an agent.
		get outline() {
			if (this.isEmpty) return "An empty markdown document.";
			const headings = headingsOf(this.text);
			const lines = this.text.split("\n").length;
			const start = this.text.slice(0, PREVIEW);
			const more =
				this.text.length > PREVIEW ? `\n… (${this.text.length - PREVIEW} more chars)` : "";
			return [
				`A markdown document: ${wordsIn(this.text)} words, ${lines} lines.`,
				headings.length > 0 ? `Headings:\n${headings.join("\n")}` : "No headings.",
				`Starts:\n${start}${more}`,
			].join("\n");
		},
	},
	view: $if(
		field("isEmpty"),
		p({ class: "text-sm italic opacity-60" }, "Empty: edit it (✎) to write markdown."),
		shown(),
	),
	views: {
		// The text and what it renders to, side by side, stacked when it's narrow.
		edit: div(
			{ class: "@container" },
			div(
				{ class: "grid grid-cols-1 gap-3 @lg:grid-cols-2" },
				textarea({
					class: "textarea textarea-bordered min-h-64 w-full font-mono text-sm",
					"aria-label": "Markdown",
					placeholder: "# Title\n\nWrite markdown here.",
					spellcheck: "false",
					value: field("text"),
					"on:input": send("setText", targetValue()),
				}),
				div(
					{ class: "min-w-0 rounded-box border border-base-300 p-3" },
					$if(field("isEmpty"), p({ class: "text-sm italic opacity-60" }, "Preview"), shown()),
				),
			),
		),
	},
	on: {
		load: setField("text", t.string(), { pure: true }),
		setText: setField("text", t.string(), { pure: true }),
		append: {
			pure: true,
			args: [t.string().len(1)],
			run(next, [text]) {
				next.text = this.isEmpty ? text : `${this.text.replace(/\s+$/, "")}\n\n${text}`;
			},
		},
		replace: {
			pure: true,
			args: [t.string().len(1), t.string()],
			pre: (self, [find]) => self.text.includes(find),
			why: (_self, [find]) => `the text has no ${JSON.stringify(find)}`,
			run(next, [find, replacement]) {
				next.text = this.text.replaceAll(find, replacement);
			},
		},
	},
});

export const markdownComponents = { Markdown };
