// Drag and drop: the drag the host keeps from dragstart to dragend, read by handlers as ctx.drag.

// The events over a drop target. They reach the nearest enclosing component that handles them,
// so a drop on a child's elements gets to the parent's on:drop.
export const DROP_EVENTS = new Set(["dragenter", "dragover", "dragleave", "drop"]);
// What the host listens to once a component handles drop.
export const DRAG_EVENTS = ["dragstart", "dragend", ...DROP_EVENTS];

// The element being dragged: where it was rendered, its data-dragtype and the value there
// when the drag started.
export class Drag {
	constructor(path, type, node, value) {
		this.path = path;
		this.type = type;
		this.node = node;
		this.value = value;
	}
	// The key of the child of receiver the dragged element is in, as sourceKey is for a
	// message; null when it was dragged from outside receiver.
	keyIn(receiver) {
		return this.path.sourceKeyIn(receiver);
	}
}
