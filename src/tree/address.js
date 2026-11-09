// Where a message goes or came from: a path, and the identity of the node it reached when it
// was fixed (spec/tree's (at π ι)). Delivery checks the identity (by-path-checked): a message
// whose path another node took is stale, one whose path reaches no node is orphaned.
import { idOf, isNode } from "./identity.js";
import { DispatchPath } from "./path.js";

export class Address {
	/** @param {DispatchPath} path */
	constructor(path, id, isHost = false) {
		this.path = path;
		/** @type {import("./path.js").KeyPath} */
		this.keyPath = path.toNodeKeyPath();
		this.id = id;
		this.isHost = isHost;
	}
	static at(path, root) {
		return new Address(path, idOf(path.toNodeKeyPath().getIn(root)));
	}
	// The address target reaches in root.
	static of(target, root) {
		return Address.at(target.fix(root), root);
	}
	// { instance } when the node it recorded is at its path, { stale } when another is there
	// instead, or { orphaned } when none is.
	resolve(root) {
		const instance = this.keyPath.getIn(root);
		if (!isNode(instance)) return { orphaned: true };
		return idOf(instance) === this.id ? { instance } : { stale: true };
	}
	// The node ancestors, nearest first, fixed against root: the hops of a notification from
	// here, which a bubble visits in one turn.
	ancestors(root) {
		const hops = [];
		for (let p = this.path.toNodePath(); !p.isRootPath; ) {
			p = p.toParentPath().toNodePath();
			hops.push(Address.at(p, root));
		}
		return hops;
	}
	toString() {
		return this.isHost ? "host" : `${this.keyPath}#${this.id}`;
	}
}
// The root's parent: what environment events and ask answers come from. It has no handlers.
export const HOST = new Address(new DispatchPath(), undefined, true);
