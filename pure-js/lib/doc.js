// Doc comments: the /** ... */ right before a node, with nothing but spaces between, read from
// the source by the node's offset. They mean nothing to checking or running; an embedder reads
// them (pure-tutuca: a tool's description, a parameter's, a component's prompt). The tree
// doesn't keep comments, so this is all a doc comment is: text before an offset.
//
// A doc is { text, tags }: text the description, its lines without their leading *, trimmed and
// joined; tags [{ tag, name, text }] in order, name the first word of a @param's (null for the
// others).

// The doc comment's text that ends right before offset in source (spaces between), or null.
export const docCommentBefore = (source, offset) => {
	let end = offset;
	while (end > 0 && /\s/.test(source[end - 1])) end--;
	if (end < 2 || source.slice(end - 2, end) !== "*/") return null;
	const start = source.lastIndexOf("/**", end - 2);
	if (start === -1) return null;
	const body = source.slice(start + 3, end - 2);
	// Another comment's end inside it means /** belongs to an earlier comment.
	if (body.includes("*/")) return null;
	return body;
};

const PARAM_TAGS = new Set(["param", "arg", "argument"]);

// A doc comment's body (between /** and */) as { text, tags }.
export const parseDoc = (body) => {
	const lines = body.split(/\r?\n/).map((line) => line.replace(/^\s*\*?\s?/, "").trimEnd());
	const text = [];
	const tags = [];
	for (const line of lines) {
		const tag = /^@([A-Za-z]+)\s*(.*)$/.exec(line.trim());
		if (tag !== null) {
			const [, name, rest] = tag;
			if (PARAM_TAGS.has(name)) {
				const [, param = null, said = ""] =
					/^(?:\{[^}]*\}\s*)?([A-Za-z_$][\w$]*)?\s*-?\s*(.*)$/.exec(rest) ?? [];
				tags.push({ tag: "param", name: param, text: said.trim() });
			} else tags.push({ tag: name, name: null, text: rest.trim() });
		} else if (tags.length > 0 && line.trim() !== "") {
			// A tag's text goes on over the lines after it, up to the next tag.
			const last = tags.at(-1);
			last.text = last.text === "" ? line.trim() : `${last.text} ${line.trim()}`;
		} else text.push(line.trim());
	}
	return { text: text.join(" ").replace(/\s+/g, " ").trim(), tags };
};

// The doc of what starts at offset in source (a node's start), or null when none is before it.
export const docAt = (source, offset) => {
	const body = docCommentBefore(source, offset);
	return body === null ? null : parseDoc(body);
};
