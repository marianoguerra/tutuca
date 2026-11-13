// A preview of a renders.docx on a page, which can't show a .docx: the document renderDocxTree
// makes, as HTML laid out the way tutuca/docx prints it (tasks with ☒ and ☐, ordered lists
// counting from 1, a section's page break as a rule). Word's own look (fonts, spacing) differs.
const make = (document, tag, attrs = {}, ...children) => {
	const node = document.createElement(tag);
	for (const [name, value] of Object.entries(attrs)) {
		if (value !== undefined) node.setAttribute(name, String(value));
	}
	node.append(...children);
	return node;
};

const INLINE = {
	strong: "strong",
	emphasis: "em",
	underline: "u",
	strike: "s",
};
const inline = (document, node) => {
	if (node.type === "text") return document.createTextNode(node.value);
	if (node.type === "inlineCode") return make(document, "code", {}, node.value);
	if (node.type === "break") return make(document, "br");
	const children = node.children.map((child) => inline(document, child));
	if (node.type === "link") return make(document, "a", { href: node.url }, ...children);
	if (node.type === "span") {
		const style = [
			node.color && `color: ${node.color}`,
			node.size && `font-size: ${node.size}pt`,
			node.font && `font-family: ${node.font}`,
			node.highlight && `background: ${node.highlight}`,
		];
		return make(document, "span", { style: style.filter(Boolean).join("; ") }, ...children);
	}
	return make(document, INLINE[node.type], {}, ...children);
};
const inlines = (document, nodes) => nodes.map((node) => inline(document, node));
const isInline = (node) =>
	node.type === "text" ||
	node.type === "break" ||
	node.type === "inlineCode" ||
	node.type in INLINE ||
	node.type === "span" ||
	node.type === "link";

// Blocks, consecutive Inline content (in a table cell) a paragraph.
const blocks = (document, nodes) => {
	const out = [];
	let run = [];
	const flush = () => {
		if (run.length > 0) out.push(make(document, "p", {}, ...inlines(document, run)));
		run = [];
	};
	for (const node of nodes) {
		if (isInline(node)) run.push(node);
		else {
			flush();
			out.push(block(document, node));
		}
	}
	flush();
	return out;
};
const listItem = (document, item) => {
	if (item.type === "list")
		return make(document, "li", { class: "docx-nested" }, block(document, item));
	const box = item.checked === undefined ? [] : [item.checked ? "☒ " : "☐ "];
	return make(document, "li", {}, ...box, ...inlines(document, item.children));
};
const block = (document, node) => {
	switch (node.type) {
		case "paragraph":
			return make(
				document,
				"p",
				{ style: node.align && `text-align: ${node.align}` },
				...inlines(document, node.children),
			);
		case "heading":
			return make(document, `h${node.level}`, {}, ...inlines(document, node.children));
		case "title":
			return make(document, "h1", { class: "docx-title" }, ...inlines(document, node.children));
		case "list":
			return make(
				document,
				node.ordered ? "ol" : "ul",
				{},
				...node.children.map((item) => listItem(document, item)),
			);
		case "code":
			return make(document, "pre", {}, node.value);
		case "pageBreak":
			return make(document, "hr", { class: "docx-page-break" });
		case "table":
			return make(
				document,
				"table",
				{},
				...node.children.map((row) =>
					make(
						document,
						"tr",
						{},
						...row.children.map((cell) =>
							make(
								document,
								row.header ? "th" : "td",
								{ colspan: cell.span, style: cell.fill && `background: ${cell.fill}` },
								...blocks(document, cell.children),
							),
						),
					),
				),
			);
	}
};

// The document of tree, a Document, a Section or a Block: a section per page, a rule between.
export const previewDocx = (document, tree) => {
	const sections =
		tree.type === "document"
			? tree.children
			: tree.type === "section"
				? [tree]
				: [{ children: [tree] }];
	return sections.map((section) =>
		make(
			document,
			"article",
			{ class: `docx-page${section.orientation === "landscape" ? " docx-landscape" : ""}` },
			...blocks(document, section.children),
		),
	);
};
