// The host: what holds the root component and keeps the page showing it.
//
// It is the only caller of morph. Everything it puts on the page is lowerRoot of its root.
import { lowerRoot } from "../bind/lower.js";
import { morph } from "../bind/vnode.js";
import { Scope } from "../component/scope.js";

export class Host {
	// rootNode is the element whose children the host renders.
	constructor({ document, rootNode }) {
		this.document = document;
		this.rootNode = rootNode;
		this.scope = new Scope();
		this.root = null; // The root component: the whole state.
		this.vnodes = undefined; // What the last render put in rootNode.
	}
	start(root) {
		this.root = root;
		this.render();
	}
	// Morphs the page from the last vnodes to the root's.
	render() {
		const vnodes = lowerRoot(this.root);
		morph(this.document, this.rootNode, vnodes, this.vnodes);
		this.vnodes = vnodes;
	}
}
