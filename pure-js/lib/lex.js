// Tokens of pure-js source. Smaller than JavaScript's: names are ASCII, there are no regular
// expressions (a / is always division), and template literals are lexed here with a stack of
// open braces, so the lexer needs no help from the parser and lookahead is copying its state.

import { Diagnostic, Stop } from "./diagnostic.js";
import { FEATURES } from "./tables.js";

export class Token {
	constructor(kind, value, start, end, newlineBefore) {
		this.kind = kind; // "name", "num", "string", "template", "punct", "eof"
		this.value = value; // the name, the punctuator, the cooked string, the number
		this.start = start;
		this.end = end;
		this.newlineBefore = newlineBefore;
		this.raw = null; // num, string and template: the source text of the value
		this.head = false; // template: starts with a backtick (else with a brace)
		this.tail = false; // template: ends with a backtick (else with ${)
		this.valueStart = start; // template: where its text starts and ends
		this.valueEnd = end;
	}
}

const PUNCTUATORS = [
	">>>=",
	"...",
	"===",
	"!==",
	"**=",
	"<<=",
	">>=",
	">>>",
	"&&=",
	"||=",
	"??=",
	"=>",
	"==",
	"!=",
	"<=",
	">=",
	"&&",
	"||",
	"??",
	"?.",
	"++",
	"--",
	"+=",
	"-=",
	"*=",
	"/=",
	"%=",
	"&=",
	"|=",
	"^=",
	"**",
	"<<",
	">>",
	"{",
	"}",
	"(",
	")",
	"[",
	"]",
	";",
	",",
	"<",
	">",
	"+",
	"-",
	"*",
	"/",
	"%",
	"&",
	"|",
	"^",
	"!",
	"~",
	"?",
	":",
	"=",
	".",
	"@",
	"#",
];

const isDigit = (c) => c >= "0" && c <= "9";
const isNameStart = (c) =>
	(c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
const isNamePart = (c) => isNameStart(c) || isDigit(c);
const isHex = (c) => isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
const isNewline = (c) => c === "\n" || c === "\r" || c === " " || c === " ";
const isSpace = (c) => c === " " || c === "\t" || c === "\v" || c === "\f" || c === " " || c === "﻿";

export const syntaxError = (message, start, end = start + 1) =>
	new Stop(new Diagnostic({ code: "syntax-error", stage: "parse", message, start, end }));
// A form the lexer or parser recognizes and pure-js leaves out.
export const exclusionMessage = (feature) => {
	const f = FEATURES[feature];
	if (f.status === "by-design") return `pure-js leaves out ${f.what} by design: ${f.why}`;
	const profile = f.profile ? `; the ${f.profile} profile admits them` : "";
	return `this version of pure-js leaves out ${f.what}${profile}`;
};
export const excluded = (feature, start, end) => {
	const f = FEATURES[feature];
	const message = exclusionMessage(feature);
	return new Stop(
		new Diagnostic({
			code: feature,
			stage: "parse",
			message,
			start,
			end,
			exclusion: f.status,
			profile: f.profile ?? null,
		}),
	);
};

export class Lexer {
	constructor(source) {
		this.src = source;
		this.pos = 0;
		this.braces = []; // "{" for a brace, "${" for a template substitution
	}
	save() {
		return { pos: this.pos, braces: [...this.braces] };
	}
	restore(state) {
		this.pos = state.pos;
		this.braces = [...state.braces];
	}
	// Skips spaces and comments; true when it crossed a line break.
	skip() {
		const s = this.src;
		let newline = false;
		while (this.pos < s.length) {
			const c = s[this.pos];
			if (isNewline(c)) {
				newline = true;
				this.pos++;
			} else if (isSpace(c)) {
				this.pos++;
			} else if (c === "/" && s[this.pos + 1] === "/") {
				while (this.pos < s.length && !isNewline(s[this.pos])) this.pos++;
			} else if (c === "/" && s[this.pos + 1] === "*") {
				const close = s.indexOf("*/", this.pos + 2);
				if (close === -1) throw syntaxError("unterminated comment", this.pos, this.pos + 2);
				for (let i = this.pos; i < close; i++) if (isNewline(s[i])) newline = true;
				this.pos = close + 2;
			} else if (c === "<" && s.startsWith("<!--", this.pos)) {
				throw syntaxError(
					"HTML comments are not JavaScript in strict mode",
					this.pos,
					this.pos + 4,
				);
			} else break;
		}
		return newline;
	}
	next() {
		const newline = this.skip();
		const s = this.src;
		const start = this.pos;
		if (start >= s.length) return new Token("eof", null, start, start, newline);
		const c = s[start];
		if (isNameStart(c)) return this.name(start, newline);
		if (c === "\\") throw excluded("identifier-escape", start, start + 2);
		if (c.charCodeAt(0) > 127 && /\p{ID_Start}/u.test(String.fromCodePoint(s.codePointAt(start))))
			throw excluded("identifier-escape", start, start + 1);
		if (isDigit(c) || (c === "." && isDigit(s[start + 1] ?? "")))
			return this.number(start, newline);
		if (c === '"' || c === "'") return this.string(start, newline);
		if (c === "`") return this.template(start, start + 1, true, newline);
		if (c === "}" && this.braces.at(-1) === "${") {
			this.braces.pop();
			return this.template(start, start + 1, false, newline);
		}
		for (const p of PUNCTUATORS) {
			if (!s.startsWith(p, start)) continue;
			// a?.5:1 is a conditional, not a chain.
			if (p === "?." && isDigit(s[start + 2] ?? "")) continue;
			this.pos = start + p.length;
			if (p === "{") this.braces.push("{");
			if (p === "}") this.braces.pop();
			return new Token("punct", p, start, this.pos, newline);
		}
		throw syntaxError(`unexpected character ${JSON.stringify(c)}`, start);
	}
	name(start, newline) {
		const s = this.src;
		let i = start;
		while (i < s.length && isNamePart(s[i])) i++;
		if (s[i] === "\\") throw excluded("identifier-escape", i, i + 2);
		if (i < s.length && s.charCodeAt(i) > 127 && /\p{ID_Continue}/u.test(s[i]))
			throw excluded("identifier-escape", i, i + 1);
		this.pos = i;
		return new Token("name", s.slice(start, i), start, i, newline);
	}
	number(start, newline) {
		const s = this.src;
		let i = start;
		const digits = (ok) => {
			const from = i;
			while (
				i < s.length &&
				(ok(s[i]) || (s[i] === "_" && ok(s[i - 1] ?? "") && ok(s[i + 1] ?? "")))
			)
				i++;
			return i > from;
		};
		if (s[i] === "0" && /[xXoObB]/.test(s[i + 1] ?? "")) {
			const base = s[i + 1].toLowerCase();
			i += 2;
			const ok =
				base === "x"
					? isHex
					: base === "o"
						? (c) => c >= "0" && c <= "7"
						: (c) => c === "0" || c === "1";
			if (!digits(ok)) throw syntaxError("expected digits after the base prefix", start, i);
		} else {
			if (s[i] === "0" && isDigit(s[i + 1] ?? "")) throw excluded("legacy-octal", start, start + 2);
			digits(isDigit);
			if (s[i] === ".") {
				i++;
				digits(isDigit);
			}
			if (s[i] === "e" || s[i] === "E") {
				i++;
				if (s[i] === "+" || s[i] === "-") i++;
				if (!digits(isDigit)) throw syntaxError("expected digits in the exponent", start, i);
			}
		}
		if (s[i] === "n") throw excluded("bigint", start, i + 1);
		if (i < s.length && (isNamePart(s[i]) || s[i] === "\\"))
			throw syntaxError("a number can't be followed by a letter", i);
		this.pos = i;
		const raw = s.slice(start, i);
		const token = new Token("num", Number(raw.replaceAll("_", "")), start, i, newline);
		token.raw = raw;
		return token;
	}
	// One escape at s[i] (the backslash); returns [text, next index].
	escape(i) {
		const s = this.src;
		const c = s[i + 1];
		const simple = {
			n: "\n",
			t: "\t",
			r: "\r",
			b: "\b",
			f: "\f",
			v: "\v",
			"'": "'",
			'"': '"',
			"\\": "\\",
			"`": "`",
			$: "$",
		};
		if (c === undefined) throw syntaxError("unterminated string", i);
		if (c in simple) return [simple[c], i + 2];
		if (c === "0" && !isDigit(s[i + 2] ?? "")) return ["\0", i + 2];
		if (isDigit(c)) throw excluded("legacy-octal", i, i + 2);
		if (c === "\r") return ["", s[i + 2] === "\n" ? i + 3 : i + 2];
		if (isNewline(c)) return ["", i + 2];
		if (c === "x") {
			const h = s.slice(i + 2, i + 4);
			if (!/^[0-9a-fA-F]{2}$/.test(h)) throw syntaxError("bad \\x escape", i, i + 4);
			return [String.fromCharCode(Number.parseInt(h, 16)), i + 4];
		}
		if (c === "u") {
			if (s[i + 2] === "{") {
				const close = s.indexOf("}", i + 3);
				const h = close === -1 ? "" : s.slice(i + 3, close);
				const cp = Number.parseInt(h, 16);
				if (!/^[0-9a-fA-F]+$/.test(h) || cp > 0x10ffff)
					throw syntaxError("bad \\u{} escape", i, close + 1);
				return [String.fromCodePoint(cp), close + 1];
			}
			const h = s.slice(i + 2, i + 6);
			if (!/^[0-9a-fA-F]{4}$/.test(h)) throw syntaxError("bad \\u escape", i, i + 6);
			return [String.fromCharCode(Number.parseInt(h, 16)), i + 6];
		}
		return [c, i + 2]; // a needless escape stands for its character
	}
	string(start, newline) {
		const s = this.src;
		const quote = s[start];
		let i = start + 1;
		let value = "";
		for (;;) {
			if (i >= s.length || s[i] === "\n" || s[i] === "\r")
				throw syntaxError("unterminated string", start, i);
			const c = s[i];
			if (c === quote) break;
			if (c === "\\") {
				const [text, after] = this.escape(i, false);
				value += text;
				i = after;
			} else {
				value += c;
				i++;
			}
		}
		this.pos = i + 1;
		const token = new Token("string", value, start, this.pos, newline);
		token.raw = s.slice(start, this.pos);
		return token;
	}
	// A template chunk from valueStart (after ` or }) to the next ` or ${.
	template(start, valueStart, head, newline) {
		const s = this.src;
		let i = valueStart;
		let cooked = "";
		for (;;) {
			if (i >= s.length) throw syntaxError("unterminated template literal", start, i);
			const c = s[i];
			if (c === "`" || (c === "$" && s[i + 1] === "{")) break;
			if (c === "\\") {
				const [text, after] = this.escape(i);
				cooked += text;
				i = after;
			} else if (c === "\r") {
				cooked += "\n";
				i += s[i + 1] === "\n" ? 2 : 1;
			} else {
				cooked += c;
				i++;
			}
		}
		const tail = s[i] === "`";
		const token = new Token("template", cooked, start, tail ? i + 1 : i + 2, newline);
		token.head = head;
		token.tail = tail;
		token.valueStart = valueStart;
		token.valueEnd = i;
		token.raw = s.slice(valueStart, i).replace(/\r\n?/g, "\n");
		if (!tail) this.braces.push("${");
		this.pos = token.end;
		return token;
	}
}
