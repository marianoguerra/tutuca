// Drag and drop: the drag the host keeps from dragstart to dragend, read by handlers as ctx.drag.
import { handlerFor, pathOf } from "./events.js";

// The events over a drop target. They reach the nearest enclosing component that handles them,
// so a drop on a child's elements gets to the parent's on:drop.
export const DROP_EVENTS = new Set(["dragenter", "dragover", "dragleave", "drop"]);
// What the host listens to once a component handles drop.
export const DRAG_EVENTS = ["dragstart", "dragend", ...DROP_EVENTS];

// The element being dragged: where it was rendered, its data-dragtype and the value there
// when the drag started.
export class Drag {
	/** @param {import("../../tree/path.js").DispatchPath} path */
	constructor(path, type, node, value) {
		this.path = path;
		this.type = type;
		this.node = node;
		this.value = value;
	}
	// The key of the child of receiver the dragged element is in, as sourceKey is for a
	// message; null when it was dragged from outside receiver.
	sourceKeyIn(receiver) {
		return this.path.sourceKeyIn(receiver);
	}
}
// The host's drag state, from dragstart to dragend: the Drag, if one of the root's elements is
// dragged, and the drop target marked with data-draggingover.
export class DragTracker {
	constructor(rootNode) {
		this.rootNode = rootNode;
		/** @type {Drag | null} */
		this.drag = null;
		this.over = null; // The drop target with data-draggingover.
	}
	// The drop events tell the browser where a drop may happen; dragstart remembers the drag.
	// Called before the event is routed, so its handler reads the drag.
	beforeEvent(e, root) {
		if (e.type === "dragstart") this.start(e, root);
		else if (DROP_EVENTS.has(e.type)) this.dragOver(e, root);
	}
	// Called after the event is handled: dragend forgets the drag.
	afterEvent(e) {
		if (e.type === "dragend") this.end();
	}
	// Remembers what is dragged: the closest draggable element, where it was rendered and its value.
	start(e, root) {
		const node = e.target.closest?.('[draggable="true"]');
		const path = node ? pathOf(node, this.rootNode) : null;
		if (path === null) return;
		this.end();
		const value = path.toKeyPath().getIn(root);
		this.drag = new Drag(path, node.getAttribute("data-dragtype"), node, value);
		node.setAttribute("data-dragging", "");
		if (e.dataTransfer) {
			e.dataTransfer.setData("text/plain", ""); // Firefox starts no drag without data.
			e.dataTransfer.effectAllowed = "move";
		}
	}
	// Over a drop target, an element with a drop handler, lets the drop happen and marks it.
	dragOver(e, root) {
		if (e.type === "drop") {
			e.preventDefault();
			this.mark(null);
		} else if (e.type === "dragleave") {
			if (!this.rootNode.contains(e.relatedTarget ?? null)) this.mark(null);
		} else {
			const info = handlerFor(e.target, "drop", this.rootNode, root, true);
			// The browser shows a move cursor over a drop target, a not-allowed one elsewhere. A
			// drag from outside the page (a file) is copied: the browser forbids moving most.
			if (info !== null) {
				e.preventDefault();
				if (e.dataTransfer) e.dataTransfer.dropEffect = this.drag === null ? "copy" : "move";
			}
			this.mark(info?.node ?? null);
		}
	}
	mark(node) {
		if (node === this.over) return;
		if (this.over !== null) this.over.removeAttribute("data-draggingover");
		this.over = node;
		if (node !== null) node.setAttribute("data-draggingover", this.drag?.type ?? "external");
	}
	end() {
		this.mark(null);
		if (this.drag !== null) this.drag.node.removeAttribute("data-dragging");
		this.drag = null;
	}
}
