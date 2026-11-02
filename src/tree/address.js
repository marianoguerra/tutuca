// Where a message goes or came from: a path, and the identity of the node it reached when it
// was fixed (spec/tree's (at π ι)). Delivery checks the identity (by-path-checked): a message
// whose path another node took is stale, one whose path reaches no node is orphaned.
import { idOf, isNode } from "./identity.js";
import { DispatchPath } from "./path.js";

export class Address {
	constructor(path, id, isHost = false) {
		this.path = path;
		this.updatePath = path.toUpdatePath();
		this.id = id;
		this.isHost = isHost;
	}
	static at(path, root) {
		return new Address(path, idOf(path.toUpdatePath().getIn(root)));
	}
	// The address target reaches in root.
	static of(target, root) {
		return Address.at(target.freeze(root), root);
	}
	// { instance } when the node it recorded is at its path, { stale } with the identity of the
	// one there instead, or { orphaned } when none is.
	resolve(root) {
		const instance = this.updatePath.getIn(root);
		if (!isNode(instance)) return { orphaned: true };
		const found = idOf(instance);
		return found === this.id ? { instance } : { stale: found };
	}
	// The node ancestors, nearest first, fixed against root: the hops of a notification from
	// here, which a bubble visits in one turn.
	ancestors(root) {
		const hops = [];
		for (let p = this.path.toComponentPath(); !p.isRootPath; ) {
			p = p.toParentPath().toComponentPath();
			hops.push(Address.at(p, root));
		}
		return hops;
	}
	toString() {
		return this.isHost ? "host" : `${this.updatePath}#${this.id}`;
	}
}
// The root's parent: what environment events and ask answers come from. It has no handlers.
export const HOST = new Address(new DispatchPath(), undefined, true);
