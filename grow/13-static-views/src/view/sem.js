// The semantic tree (spec/view/sem.rkt): what evaluating a view produces.
//
// It says what the rendered tree means, not how the DOM records it. Wrapper nodes say that
// their children are the render of a component.
export class SNode {
	constructor(type, parts) {
		this.type = type;
		Object.assign(this, parts);
	}
}

// tid is the template the element comes from, ns its namespace or null to inherit its
// parent's, key its key or null, props its { name: value } and children its nodes.
export const el = (tid, tag, ns, key, props, children) =>
	new SNode("el", { tid, tag, ns, key, props, children });
export const text = (string) => new SNode("text", { string });
// A comment the view itself writes.
export const comment = (string) => new SNode("comment", { string });
// An explicit fragment: a sibling key scope.
export const group = (key, children) => new SNode("group", { key, children });
// The render of an instance of class cname.
export const component = (cname, children) => new SNode("component", { cname, children });
