// A drawer for the tree and its agents beside an app that fills the page (a canvas): a button in
// the corner opens it on the right, over the app, with the tree (and the inspector and agents
// under it) and the traces, closed, under that. mountDrawer makes it and says where attachTrail
// (live.js) goes; key, when given, is where the page remembers whether it was open.
const el = (document, name, className = "", text = "") => {
	const node = document.createElement(name);
	if (className !== "") node.className = className;
	if (text !== "") node.textContent = text;
	return node;
};
const remembered = (window, key) => {
	try {
		return key !== null && window?.localStorage.getItem(key) === "open";
	} catch {
		return false;
	}
};
const remember = (window, key, open) => {
	try {
		if (key !== null) window?.localStorage.setItem(key, open ? "open" : "closed");
	} catch {
		// A page without storage forgets it.
	}
};

// Returns { treeNode, tracesNode, isOpen(), onOpen(fn), setTraces(count) }: onOpen's fn runs
// each time it opens, setTraces says how many traces there are in their title.
export const mountDrawer = (document, { title = "Component tree", key = null } = {}) => {
	const window = document.defaultView;
	const toggle = el(document, "button", "trail-drawer-toggle", "🌳");
	toggle.type = "button";
	toggle.title = `${title} and agents`;
	toggle.setAttribute("aria-expanded", "false");
	const drawer = el(document, "aside", "trail-drawer");
	drawer.setAttribute("aria-label", title);
	const head = el(document, "header", "trail-drawer-head");
	const close = el(document, "button", "trail-button", "Close");
	close.type = "button";
	head.append(el(document, "h2", "", title), close);
	const treeNode = el(document, "div", "trail-drawer-tree");
	const traces = el(document, "details", "trail-drawer-traces");
	const tracesTitle = el(document, "summary", "", "Traces");
	const tracesNode = el(document, "div");
	traces.append(tracesTitle, tracesNode);
	drawer.append(head, treeNode, traces);
	document.body.append(toggle, drawer);

	const opened = [];
	const set = (open) => {
		drawer.classList.toggle("trail-drawer-open", open);
		toggle.setAttribute("aria-expanded", String(open));
		remember(window, key, open);
		if (open) for (const fn of opened) fn();
	};
	toggle.addEventListener("click", () => set(!drawer.classList.contains("trail-drawer-open")));
	close.addEventListener("click", () => set(false));
	if (remembered(window, key)) drawer.classList.add("trail-drawer-open");
	return {
		treeNode,
		tracesNode,
		isOpen: () => drawer.classList.contains("trail-drawer-open"),
		onOpen: (fn) => opened.push(fn),
		setTraces: (count) => {
			tracesTitle.textContent = count === 0 ? "Traces" : `Traces · ${count}`;
		},
	};
};
