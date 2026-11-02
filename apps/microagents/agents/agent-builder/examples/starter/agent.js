// A starting point: the first note part (kind "note", a string) in a textarea. Rename the
// components, change the data and add tools: see the skills (agent contract) for the rules.
export default function define(kit) {
	const { component, field, send, t, tag, targetValue } = kit.tutuca;
	const { div, h2, textarea } = tag;

	const Note = component({
		name: "Note",
		fields: { text: t.string() },
		methods: {
			toDomain() {
				return { text: this.text };
			},
		},
		queries: {
			get summary() {
				return `The note says: ${JSON.stringify(this.text)}`;
			},
		},
		view: div(
			{ class: "flex flex-col gap-2" },
			h2({ class: "text-lg font-semibold" }, "Note"),
			textarea({
				class: "textarea textarea-bordered",
				"aria-label": "Note",
				value: field("text"),
				"on:input": send("set_text", targetValue()),
			}),
		),
		on: {
			set_text: {
				pure: true,
				args: [t.string()],
				run(next, [text]) {
					next.text = text;
				},
			},
		},
	});

	const noteOf = (msg) => (msg.messages ?? []).find((m) => m.kind === "note");
	const decode = (C, bindings, msg) => {
		const part = bindings.notes?.[0] ?? noteOf(msg);
		return C.Note({ text: typeof part?.data === "string" ? part.data : "" });
	};
	const encode = (root, msg) => {
		const kids = msg.messages ?? [];
		const at = kids.findIndex((m) => m.kind === "note");
		if (at >= 0 && kids[at].data === root.text) return msg;
		const part =
			at >= 0 ? { ...kids[at], data: root.text } : kit.tdata.message("note", "note", root.text);
		return {
			...msg,
			messages: at >= 0 ? kids.map((m, i) => (i === at ? part : m)) : [...kids, part],
		};
	};
	return { components: { Note }, root: "Note", decode, encode };
}
