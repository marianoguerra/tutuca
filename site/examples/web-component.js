// 5. Web components: custom elements are tags like any other, and the custom events they
// fire reach @on.<event-name> handlers. emoji-picker-element fires emoji-click, a
// CustomEvent that bubbles out of its shadow root; the handler reads its detail from ctx.event.
import "https://cdn.jsdelivr.net/npm/emoji-picker-element@1.29.1/index.js";
import { $if, component, field, h, send, tag } from "tutuca";
import { step, stories } from "tutuca/storybook";

const { button, div, p, span } = tag;

export const EmojiPicker = component({
	name: "EmojiPicker",
	fields: (t) => ({ current: t.string(), isPickerVisible: t.boolean() }),
	methods: {
		get hasEmoji() {
			return this.current !== "";
		},
	},
	view: div(
		{ class: "flex flex-col items-center gap-3", "@on.emoji-click": send("pick") },
		$if(
			field("hasEmoji"),
			span({ class: "text-8xl" }, field("current")),
			p({}, "Press Toggle picker and choose an emoji, it will show up here."),
		),
		button({ class: "btn btn-sm", "@on.click": send("togglePicker") }, "Toggle picker"),
		// h makes any tag, custom elements included.
		$if(field("isPickerVisible"), h("emoji-picker", {}), ""),
	),
	on: {
		togglePicker(draft) {
			draft.isPickerVisible = !draft.isPickerVisible;
		},
		pick: {
			args: [],
			run(draft, _args, ctx) {
				// The picker's CustomEvent carries the chosen emoji in detail.
				const unicode = ctx.event?.detail?.unicode;
				if (unicode !== undefined) draft.current = unicode;
			},
		},
	},
});

export default stories({
	title: "EmojiPicker",
	components: { EmojiPicker },
	stories: {
		Empty: {
			make: (C) => C.EmojiPicker(),
			sequences: {
				"open the picker": [
					step.event("click", ".btn"),
					step.check("picker shown", (s) => s.isPickerVisible),
				],
			},
		},
		Picked: { make: (C) => C.EmojiPicker({ current: "🧩" }) },
	},
});
