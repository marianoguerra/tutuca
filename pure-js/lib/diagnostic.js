// What every stage reports: a Diagnostic, plain data with a kebab-case code, the stage that found
// it, where it is (offsets into the source) and, for a form pure-js leaves out, whether it is
// excluded by design or omitted from this version. Text for people is formatters.js's job.

// Exit statuses of the command line, one per kind of outcome, as pure-py-mb has them.
export const EXIT = Object.freeze({
	ok: 0,
	byDesign: 1, // a form pure-js excludes by design
	omitted: 2, // a form omitted from this version, which a later version or profile may admit
	illFormed: 3, // well-formedness: names, types, mutation
	syntax: 4, // not JavaScript (or TypeScript) at all
	undefined: 5, // a run reached an operation whose behaviour pure-js leaves undefined
	terminated: 6, // a run ended with an error: a host function failed, an index was missing, ...
});

const EXCLUSIONS = Object.freeze({ byDesign: "by-design", omitted: "omitted" });

export class Diagnostic {
	constructor({
		code,
		stage,
		message,
		start = 0,
		end = start,
		exclusion = null,
		profile = null,
		help = null,
	}) {
		this.code = code;
		this.stage = stage;
		this.message = message;
		this.start = start;
		this.end = end;
		this.exclusion = exclusion; // "by-design", "omitted" or null
		this.profile = profile; // the profile that will admit an omitted form, or null
		this.help = help;
	}
	get exitCode() {
		if (this.exclusion === EXCLUSIONS.byDesign) return EXIT.byDesign;
		if (this.exclusion === EXCLUSIONS.omitted) return EXIT.omitted;
		if (this.stage === "parse") return EXIT.syntax;
		return EXIT.illFormed;
	}
	toJSON() {
		const { code, stage, message, start, end, exclusion, profile, help } = this;
		return { code, stage, message, start, end, exclusion, profile, help };
	}
}

// The exit status of a list of diagnostics: the first one's, or ok.
export const exitCodeOf = (diagnostics) =>
	diagnostics.length === 0 ? EXIT.ok : diagnostics[0].exitCode;

// 1-based line and column of an offset.
export const lineColumn = (source, offset) => {
	let line = 1;
	let lineStart = 0;
	for (let i = 0; i < offset && i < source.length; i++) {
		if (source[i] === "\n") {
			line++;
			lineStart = i + 1;
		}
	}
	return { line, column: offset - lineStart + 1 };
};

// Thrown inside a stage to stop at the first problem (the parser stops there); the stage catches
// it and returns its diagnostic.
export class Stop extends Error {
	constructor(diagnostic) {
		super(diagnostic.message);
		this.diagnostic = diagnostic;
	}
}
