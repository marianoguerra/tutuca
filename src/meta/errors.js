// Why a call to a component failed, in words a person or a model reads: a ContractError's
// issues spelled out, for data's loadData and an agent's tool results.
import { ContractError, errorMessage, specOf } from "../tutuca.js";

// A type in words: an any with where checks is what its checks are named.
const typeWords = (type) => {
	const where = type.constructor?.kind === "any" ? (type.constraints.where ?? []) : [];
	return where.length > 0 ? where.map((w) => w.name || "valid").join(" and ") : type.text();
};
// Why calling operation name on c failed, in words a person or a model reads; params name its
// args, in order.
export const contractErrorText = (c, error, params = []) => {
	if (!(error instanceof ContractError)) return errorMessage(error);
	const op = error.operation;
	const spec = specOf(c);
	const words = error.issues.map((issue) => {
		if (issue === "unknown") return `there's no ${op}`;
		if (issue === "not-pure") return `${op} can't run as a pure message`;
		if (issue === "args") return `${op} takes ${params.length} arguments`;
		if (issue.startsWith("arg:")) {
			const i = Number(issue.slice(4));
			const type = (spec?.on[op] ?? spec?.queries?.[op])?.args?.[i];
			return `${params[i] ?? `argument ${i + 1}`} isn't ${type ? typeWords(type) : "valid"}`;
		}
		if (issue === "pre")
			return `it can't run with these arguments now${error.detail ? `: ${error.detail}` : ""}`;
		if (issue === "post") return `${op} didn't do what it promises, so nothing changed`;
		if (issue.startsWith("invariant:"))
			return `it would break ${issue.slice(10)}, so nothing changed`;
		if (issue === "returns") return `${op} gave back something it shouldn't`;
		return issue;
	});
	return words.join("; ");
};
