// The classes meta convention: the class names a component's views compute. A view's class can
// read a field, a query or a bind, whose strings are built in code that no walk of the views
// sees; a component whose views do lists every class they can be here, so the class set of an
// app is known before it renders, for CSS compilers that need class names listed.
//
// A component declares it with component({ meta: { [CLASSES_META]: { classes } } }): classes is
// a string of class names separated by whitespace, as a class attribute holds them, and covers
// every view, loop and bind of the component. Lint warns about a computed class in a component
// that doesn't declare them.
import { hasMeta, metaShapeProblems, specOf, t } from "../tutuca.js";

export const CLASSES_META = "https://tutuca.dev/meta/classes";
export const classesMetaSchemas = {
	[CLASSES_META]: {
		// Every class the component's views can compute, separated by whitespace.
		classes: t.string(""),
	},
};
// Whether c (a component or its spec) declares the classes its views compute.
export const hasClassesMeta = (c) => hasMeta(c, CLASSES_META);
// The class names c (a component or its spec) declares; [] when it declares none.
export const declaredClassesOf = (c) => {
	const classes = (specOf(c) ?? c)?.meta?.[CLASSES_META]?.classes;
	return typeof classes === "string" ? classes.split(/\s+/).filter(Boolean) : [];
};
// What's wrong with the shape of what spec declares as its classes; none when it declares none.
export const classesProblems = (c) =>
	metaShapeProblems(specOf(c) ?? c, CLASSES_META, classesMetaSchemas[CLASSES_META]);
