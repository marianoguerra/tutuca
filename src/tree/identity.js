// A node's identity (spec/tree's ι): a number fresh for each node made, kept by the copies an
// update makes of it, so updates keep it and only making a node (or returning a new one) gives
// a new one. A value with an identity is a node: what an address can reach.
export const idSym = Symbol("TutucaId");
export const idOf = (v) => v?.[idSym];
export const isNode = (v) => idOf(v) !== undefined;
let nextId = 1;
// Gives obj a fresh identity, and returns it.
export const mint = (obj) => {
	obj[idSym] = nextId++;
	return obj;
};
