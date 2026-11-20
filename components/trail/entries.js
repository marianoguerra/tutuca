// What went through each place of the tree, as the trail keeps it: an entry per transition,
// where it went. An entry is { click, kind, key, eventType, mode, name, args, outcome, from, to,
// seq, cause, origin, error, emitted, unhandled, watch }: key the place's (pathKey), click the
// number of what caused it, kind which count it adds to there (event, walk, passed, handled,
// other), emitted what its handler sent, unhandled what of that nobody handles, and watch the id
// of the watch it ran in: what the traces view (spans.js) makes its span of.
import { plainOf } from "../../src/tree/record.js";
import { pathKey, pathLabel } from "./paths.js";

export const placeText = (address) =>
	address == null ? "" : address.isHost ? "host" : pathLabel(address.path.toNodePath());
// Which count a transition adds to where it went: handled there, a notify passing through, or
// whatever else became of it.
export const kindOf = ({ mode, outcome }) => {
	if (outcome === "handled") return "handled";
	if (mode === "notify" && (outcome === "passed" || outcome === "unhandled")) return "passed";
	return "other";
};

// The entries of transitions, each where it went; base is what they share.
export const transitionEntries = (transitions, base, sender = "host") =>
	transitions
		.filter((transition) => transition.to?.path != null)
		.map((transition) => ({
			...base,
			kind: kindOf(transition),
			key: pathKey(transition.to.path.toNodePath()),
			mode: transition.mode,
			name: transition.name,
			args: plainOf(transition.args),
			outcome: transition.outcome,
			from: transition.from?.isHost ? sender : placeText(transition.from),
			to: placeText(transition.to),
			seq: transition.seq,
			cause: transition.cause,
			origin: transition.origin,
			error: plainOf(transition.error ?? null),
			emitted: plainOf(transition.emitted),
			unhandled: plainOf(transition.unhandled),
			watch: transition.watch,
		}));

// What a message an agent sent left: its transitions' entries, with no event or walk, from
// by, the agent's name.
export const sentEntriesOf = (transitions, click, by) =>
	transitionEntries(
		transitions,
		{ click, eventType: "agent", outcome: "", seq: null, cause: null, origin: null },
		`agent ${by}`,
	);
