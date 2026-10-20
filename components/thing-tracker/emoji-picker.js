// Picks an emoji by category or search, with the recently used first.

import {
	$if,
	button,
	component,
	each,
	field,
	send,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { MUTED } from "./common.js";
import { EMOJI, EMOJI_CATEGORIES } from "./emoji.js";
import { normalize, terms } from "./model.js";

const { div, h3, input, label, p } = tag;

const CATEGORY_ICONS = [
	"⭐",
	...EMOJI_CATEGORIES.map((c) => EMOJI.find((e) => e.category === c).char),
];
const CATEGORIES = ["Common", ...EMOJI_CATEGORIES];
const MAX_RESULTS = 300;
export const EmojiPicker = component({
	name: "EmojiPicker",
	fields: {
		query: t.string(),
		category: t.enum(...CATEGORIES),
		value: t.string(),
		recent: t.array(t.string()).len(0, 16),
		paste: t.string(),
	},
	methods: {
		get isSearching() {
			return this.query.trim() !== "";
		},
		get categoryChips() {
			return CATEGORIES.map((name, i) => ({
				name,
				icon: CATEGORY_ICONS[i],
				cls:
					name === this.category
						? "emoji size-9 rounded-lg text-lg bg-primary/20 ring-2 ring-primary"
						: "emoji size-9 rounded-lg text-lg hover:bg-base-200",
			}));
		},
		get matches() {
			if (!this.isSearching) {
				return this.category === "Common"
					? EMOJI
					: EMOJI.filter((e) => e.category === this.category);
			}
			const [first] = terms(this.query);
			const qs = terms(this.query);
			return EMOJI.map((e) => ({
				e,
				hay: normalize([e.name, e.category, ...e.keywords].join(" ")),
			}))
				.filter(({ hay }) => qs.every((q) => hay.includes(q)))
				.map(({ e }) => {
					const name = normalize(e.name);
					const score =
						name === first ? 40 : name.startsWith(first) ? 30 : name.includes(first) ? 20 : 10;
					return { e, score: score + 5 };
				})
				.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
				.map(({ e }) => e);
		},
		get results() {
			return this.matches
				.slice(0, MAX_RESULTS)
				.map((e) => ({ ...this.cell(e.char), name: e.name }));
		},
		cell(char) {
			return {
				char,
				cls:
					char === this.value
						? "emoji aspect-square rounded-md text-xl bg-primary/15 ring-2 ring-primary"
						: "emoji aspect-square rounded-md text-xl hover:bg-base-200",
			};
		},
		get recentCells() {
			return this.recent.map((char) => ({ ...this.cell(char), name: char }));
		},
		get showRecent() {
			return !this.isSearching && this.recent.length > 0;
		},
		get isEmpty() {
			return this.matches.length === 0;
		},
		get emptyText() {
			return `Nothing matches “${this.query.trim()}”. Paste any emoji below instead.`;
		},
		get isCapped() {
			return this.matches.length > MAX_RESULTS;
		},
		get capText() {
			return `Showing ${MAX_RESULTS} of ${this.matches.length}. Keep typing to narrow it down.`;
		},
	},
	view: div(
		{ class: "flex min-h-0 max-h-[45vh] flex-col gap-3" },
		input({
			type: "search",
			class: "input input-sm w-full",
			placeholder: "Search emoji…",
			"aria-label": "Search emoji",
			value: field("query"),
			"on:input": send("setQuery", targetValue()),
		}),
		$if(
			field("isSearching"),
			"",
			div(
				{ class: "flex flex-wrap justify-center gap-1" },
				each(
					field("categoryChips"),
					button(
						{
							class: field("cls"),
							title: field("name"),
							"aria-label": field("name"),
							value: field("name"),
							"on:click": send("setCategory", targetValue()),
						},
						field("icon"),
					),
				),
			),
		),
		$if(
			field("showRecent"),
			div(
				{},
				h3({ class: `mb-1 text-xs ${MUTED}` }, "Recent"),
				div(
					{ class: "grid grid-cols-8 gap-1" },
					each(
						field("recentCells"),
						button(
							{
								class: field("cls"),
								title: field("name"),
								value: field("char"),
								"on:click": send("pick", targetValue()),
							},
							field("char"),
						),
					),
				),
			),
			"",
		),
		div(
			{ class: "min-h-0 flex-1 overflow-y-auto" },
			$if(
				field("isEmpty"),
				p({ class: `py-4 text-center text-sm ${MUTED}` }, field("emptyText")),
				div(
					{ class: "grid grid-cols-8 gap-1" },
					each(
						field("results"),
						button(
							{
								class: field("cls"),
								title: field("name"),
								value: field("char"),
								"on:click": send("pick", targetValue()),
							},
							field("char"),
						),
					),
				),
			),
			$if(
				field("isCapped"),
				p({ class: `py-2 text-center text-xs ${MUTED}` }, field("capText")),
				"",
			),
		),
		label(
			{ class: "flex items-center gap-2 text-sm" },
			"Or paste any emoji",
			input({
				class: "input input-sm w-20 text-center text-lg",
				maxlength: "16",
				placeholder: "🦆",
				"aria-label": "Paste an emoji",
				value: field("paste"),
				"on:input": send("pasted", targetValue()),
			}),
		),
	),
	on: {
		setQuery: {
			args: [t.string()],
			run(draft, [query]) {
				draft.query = query;
			},
		},
		setCategory: {
			args: [t.string()],
			run(draft, [category]) {
				if (CATEGORIES.includes(category)) draft.category = category;
			},
		},
		pick: {
			args: [t.string()],
			emits: { notify: ["emojiPicked"] },
			run(draft, [char], ctx) {
				if (char === "") return;
				draft.value = char;
				draft.recent = [char, ...this.recent.filter((c) => c !== char)].slice(0, 16);
				ctx.notify("emojiPicked", [char]);
			},
		},
		pasted: {
			args: [t.string()],
			emits: { notify: ["emojiPicked"] },
			run(draft, [text], ctx) {
				draft.paste = text;
				const char = text.trim();
				if (char === "" || char.length > 16) return;
				draft.value = char;
				ctx.notify("emojiPicked", [char]);
			},
		},
	},
});
