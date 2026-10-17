// What the DevTools formatters (formatters.js, vdom-formatters.js) share: JsonML parts and a
// formatter built from a header and rows. Enable custom formatters in DevTools → Settings →
// Preferences → Console → "Enable custom formatters".

export const LIST_STYLE = "list-style:none;margin:0;padding-left:14px";
export const span = (style, ...kids) => ["span", { style }, ...kids];
export const objectRef = (v) => ["object", { object: v }];
export const truncate = (s, max) => (s.length > max ? `${s.slice(0, max)}…` : s);
// The parts of each item, an array of parts, with sep between them.
export const join = (items, sep = ", ") =>
	items.flatMap((item, i) => (i === 0 ? item : [sep, ...item]));

// header(v) is the parts for v, or null for values it doesn't format; rows(v) its <li>s.
export const makeFormatter = ({ header, rows }) => ({
	header(v) {
		try {
			const parts = header(v);
			return parts === null ? null : ["span", {}, ...parts];
		} catch {
			return null; // Fall back to the native view rather than breaking the console.
		}
	},
	hasBody(v) {
		return rows(v).length > 0;
	},
	body(v) {
		return ["ol", { style: LIST_STYLE }, ...rows(v)];
	},
});

export const install = (target, formatter) => {
	target.devtoolsFormatters ??= [];
	if (!target.devtoolsFormatters.includes(formatter)) target.devtoolsFormatters.push(formatter);
	return formatter;
};
