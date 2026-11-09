import { engineName } from "./lifecycle.js";

// Sync engines: told about each committed change, and able to apply their own.
// An engine sees every committed change through prepare(change) and commit(change, prepared),
// change being { prev, next, task }, and applies changes from elsewhere through the link attach
// gets. A throwing prepare fails the task, before any engine wrote the change; a throwing
// commit is reported as syncFailed and the change stands.
export class SyncEngines {
	// report(phase, fields) reports what failed, as a Lifecycle (lifecycle.js).
	constructor(report) {
		this.report = report;
		this.list = [];
		this.committing = false; // Engines are writing a change: applies wait in deferred.
		this.deferred = [];
	}
	failed(engine, error) {
		this.report("syncFailed", { engine: engineName(engine, this.list), error });
	}
	get length() {
		return this.list.length;
	}
	attach(engine, link) {
		this.list.push(engine);
		engine.attach?.(link);
	}
	detach() {
		for (const engine of this.list.splice(0)) engine.detach?.();
	}
	// Runs apply later when the engines are writing a change, so every engine sees changes in
	// order; returns whether it deferred it.
	deferWhileCommitting(apply) {
		if (this.committing) this.deferred.push(apply);
		return this.committing;
	}
	// Prepares the change from prev to next with every engine but source, and returns the
	// function that commits it, to call once next is the root. A prepare that throws fails a
	// task's change; a change from elsewhere happened already, so that engine skips it instead.
	prepare(prev, next, task, source = null) {
		if (prev === next) return () => {};
		const change = { prev, next, task };
		const prepared = [];
		for (const engine of this.list) {
			if (engine === source) continue;
			try {
				prepared.push([engine, engine.prepare?.(change)]);
			} catch (error) {
				if (task !== null) throw error;
				this.failed(engine, error);
			}
		}
		return () => {
			this.committing = true;
			try {
				for (const [engine, p] of prepared) {
					try {
						engine.commit(change, p);
					} catch (error) {
						this.failed(engine, error);
					}
				}
			} finally {
				this.committing = false;
			}
			// An engine applied a change while the others still hadn't seen this one: now they have.
			while (this.deferred.length > 0) this.deferred.shift()();
		};
	}
}
