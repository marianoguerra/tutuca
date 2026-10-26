// The asserts the suite uses, so it runs unchanged in Node and in a browser.

const show = (v) => {
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
};

const fail = (message) => {
	throw new Error(message);
};

export const equal = (actual, expected, message = "") => {
	if (actual !== expected) fail(`${message} expected ${show(expected)}, got ${show(actual)}`.trim());
};

export const notEqual = (actual, expected, message = "") => {
	if (actual === expected) fail(`${message} expected something other than ${show(expected)}`.trim());
};

export const ok = (value, message = "expected a truthy value") => {
	if (!value) fail(message);
};

// Objects compare whatever their key order: a Map has none.
const canonical = (v) => {
	if (Array.isArray(v)) return v.map(canonical);
	if (v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
		const out = {};
		for (const k of Object.keys(v).sort()) {
			Object.defineProperty(out, k, { value: canonical(v[k]), enumerable: true });
		}
		return out;
	}
	return v;
};

export const deepEqual = (actual, expected, message = "") => {
	if (show(canonical(actual)) !== show(canonical(expected))) {
		fail(`${message} expected ${show(expected)}, got ${show(actual)}`.trim());
	}
};

export const throws = (fn, pattern, message = "expected an error") => {
	try {
		fn();
	} catch (error) {
		if (pattern && !pattern.test(error.message)) {
			fail(`${message}: ${error.message} doesn't match ${pattern}`);
		}
		return;
	}
	fail(message);
};

export const rejects = async (promise, pattern, message = "expected a rejection") => {
	try {
		await promise;
	} catch (error) {
		if (pattern && !pattern.test(error.message)) {
			fail(`${message}: ${error.message} doesn't match ${pattern}`);
		}
		return;
	}
	fail(message);
};
