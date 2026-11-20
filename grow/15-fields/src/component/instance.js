// What an instance says about itself: its class (comp-class in spec/data.rkt) and the scope it
// was made in. Types and classes both read these, so they live in neither.
export const classSym = Symbol("class");
export const scopeSym = Symbol("scope");
// The class of an instance, undefined for any other value.
export const classOf = (value) => value?.[classSym];
export const isComponent = (value) => classOf(value) !== undefined;
// The scope an instance was made in, null when it was made without one.
export const scopeOf = (value) => value?.[scopeSym] ?? null;
