// Time travel: a Timeline of states with a cursor, and historyEngine, which records one for a
// live Host as a sync engine and travels by applying a recorded state as a change from
// elsewhere, so the other engines (storage, peers) follow.

import { truncate } from "../dev/jsonml.js";
import { jsonText } from "../paths.js";
import { EventTask } from "../tasks.js";

export const argsLabel = (args) => truncate(args.map(jsonText).join(", "), 80);
// The task a task's chain started with: an event, or a message sent from outside.
export const rootTask = (task) => {
	while (task.parent !== null) task = task.parent;
	return task;
};
// A task as a timeline shows it, like "click → toggle()".
export const taskLabel = (task) => {
	const call = `${task.name}(${argsLabel(task.args)})`;
	return task instanceof EventTask ? `${task.event.type} → ${call}` : call;
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
	// Folds task into the current entry when it's the last one and task continues the chain
	// that made it, as async replies do; false when task starts an entry of its own.
	merge(task, state) {
		const entry = this.current;
		if (!this.atEnd || entry?.rootTask === undefined || entry.rootTask !== rootTask(task)) {
			return false;
		}
		entry.state = state;
		entry.tasks = [...(entry.tasks ?? []), task];
		return true;
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
// first entry is the state before the first change. travel(i) clears the queued tasks and
// applies entry i as a change from this engine, so it isn't recorded and every other engine
// sees it; an async reply that lands after it starts a new branch from there. onChange gets
// the timeline after each change and travel.
export const historyEngine = ({ max = 1000, now = Date.now, onChange = () => {} } = {}) => {
	const timeline = new Timeline({ max, now });
	let link = null;
	const seed = (state) => {
		if (timeline.size === 0) timeline.begin({ state, label: "initial", origin: "initial" });
	};
	const travel = (move) => {
		if (link === null || timeline.size === 0) return;
		const { state } = move();
		link.host.clearTasks();
		link.apply(() => state);
		onChange(timeline);
	};
	return {
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
			} else if (!timeline.merge(task, next)) {
				const root = rootTask(task);
				const label = taskLabel(root);
				timeline.record({ state: next, label, origin: "user", rootTask: root, tasks: [task] });
			}
			onChange(timeline);
		},
		travel: (i) => travel(() => timeline.goto(i)),
		back: () => travel(() => timeline.back()),
		forward: () => travel(() => timeline.forward()),
		toStart: () => travel(() => timeline.toStart()),
		toEnd: () => travel(() => timeline.toEnd()),
	};
};
