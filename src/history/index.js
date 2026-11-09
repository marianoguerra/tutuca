// Time travel: a Timeline of states with a cursor, and historyEngine, which records one for a
// live Host as a sync engine and travels by applying a recorded state as a change from
// elsewhere, so the other engines (storage, peers) follow.

import { transitionLabel } from "../core/text.js";

// The icon of each origin of a timeline entry.
export const ORIGINS = { initial: "◆", reload: "↻", step: "▸", user: "☝", external: "⇅" };
// The task a task's chain started with: an event, or a message sent from outside.
const rootTask = (task) => {
	while (task.parent != null) task = task.parent;
	return task;
};

// The left entry of the two closest in time, the one to drop to keep the rest spread out,
// sparing the first and the current; -1 when every one is spared.
const closestLeft = (entries, cursor) => {
	let found = -1;
	let closest = Infinity;
	for (let i = 2; i < entries.length; i++) {
		const left = i - 1;
		if (left === cursor) continue;
		const gap = entries[i].at - entries[left].at;
		// <= drops the most recent of equally close pairs, keeping older ones.
		if (gap <= closest) {
			closest = gap;
			found = left;
		}
	}
	return found;
};

// States in order, entries { state, label, origin, at, ... }, and a cursor at the one shown.
// Recording after going back drops the entries after the cursor. Past max entries it drops
// one of the two closest in time, so a burst of changes thins out but the history keeps its
// spread; the first entry and the current one stay.
export class Timeline {
	constructor({ max = 1000, now = Date.now } = {}) {
		this.max = max;
		this.now = now;
		this.entries = [];
		this.cursor = 0;
	}
	get size() {
		return this.entries.length;
	}
	get current() {
		return this.entries[this.cursor];
	}
	get atEnd() {
		return this.cursor === this.entries.length - 1;
	}
	begin(entry) {
		this.entries = [{ at: this.now(), ...entry }];
		this.cursor = 0;
		return this.current;
	}
	record(entry) {
		this.entries.length = this.cursor + 1;
		this.entries.push({ at: this.now(), ...entry });
		this.cursor = this.entries.length - 1;
		while (this.entries.length > this.max) {
			const i = closestLeft(this.entries, this.cursor);
			if (i < 0) break;
			this.entries.splice(i, 1);
			if (i < this.cursor) this.cursor--;
		}
		return this.current;
	}
	// Folds transition into the current entry when it's the last one and continues the chain
	// that made it (the same origin), as async replies do; false when it starts an entry of its
	// own. transition is a Transition, or the task one is about.
	merge(transition, state) {
		const entry = this.current;
		if (!this.atEnd || entry?.chain === undefined || entry.chain !== transition.origin) {
			return false;
		}
		entry.state = state;
		entry.transitions = [...(entry.transitions ?? []), transition];
		return true;
	}
	// Records the state transition made: merged into the current entry when it continues its
	// chain, else a new user entry labeled by the task the chain started with, extra added to it.
	recordTask(transition, state, extra = {}) {
		if (this.merge(transition, state)) return this.current;
		const label = transitionLabel(rootTask(transition.task ?? transition));
		const chain = transition.origin;
		return this.record({
			state,
			label,
			origin: "user",
			chain,
			transitions: [transition],
			...extra,
		});
	}
	goto(i) {
		this.cursor = Math.max(0, Math.min(Number(i), this.entries.length - 1));
		return this.current;
	}
	back() {
		return this.goto(this.cursor - 1);
	}
	forward() {
		return this.goto(this.cursor + 1);
	}
	toStart() {
		return this.goto(0);
	}
	toEnd() {
		return this.goto(this.entries.length - 1);
	}
}

// Records the timeline of the Host it's attached to (host.attachSync(engine)): one entry per
// user action, its async replies folded in, and one per change from another engine. The
// first entry is the state before the first change. goto(i) clears the queued tasks and
// applies entry i as a change from this engine, so it isn't recorded and every other engine
// sees it; an async reply that lands after it starts a new branch from there. onChange gets
// the timeline after each change and move.
export const historyEngine = ({ max = 1000, now = Date.now, onChange = () => {} } = {}) => {
	const timeline = new Timeline({ max, now });
	let link = null;
	const seed = (state) => {
		if (timeline.size === 0) timeline.begin({ state, label: "initial", origin: "initial" });
	};
	// Each of the Timeline's moves, applied to the host.
	const move = (op) => (arg) => {
		if (link === null || timeline.size === 0) return;
		const { state } = timeline[op](arg);
		link.host.clearTasks();
		link.apply(() => state);
		onChange(timeline);
	};
	return {
		name: "history",
		timeline,
		attach(l) {
			link = l;
		},
		detach() {
			link = null;
		},
		commit({ prev, next, task }) {
			seed(prev);
			if (task === null) {
				timeline.record({ state: next, label: "synced change", origin: "external" });
			} else timeline.recordTask(task, next);
			onChange(timeline);
		},
		goto: move("goto"),
		back: move("back"),
		forward: move("forward"),
		toStart: move("toStart"),
		toEnd: move("toEnd"),
	};
};
