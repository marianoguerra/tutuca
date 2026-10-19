// A sync engine that sends each change's ops to a remote (a server, a worker) and applies the
// ops other clients send. The remote orders changes with a version: a change made against an
// older version is rejected and its client resyncs, so the first of two concurrent changes wins.
// A client has one batch in flight at a time, so each one is made against the version before it.
//
// transport: { push(batch), subscribe(onMessage) → unsubscribe, load() → { version, value } | null },
//            delivering each direction's messages in order
// batch:     { clientId, seq, base, ops }, base being the version the ops were made against
// messages:  { type: "batch", clientId, seq, version, ops } | { type: "reject", clientId, seq }
import { project } from "./codec.js";
import { applyProjection, applyStateOps, opsOf } from "./index.js";
import { writeFitting } from "./migrate.js";
import { applyOps, OpConflictError } from "./ops.js";

const newId = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

export const remoteEngine = ({ transport, level = "shared", clientId = newId() }) => {
	let link = null;
	let unsubscribe = null;
	let acked = 0; // the last version the remote confirmed
	let copy = null; // the remote's projection at acked, with the batch in flight applied
	let inflight = null; // the batch pushed and not yet confirmed
	let pending = []; // ops committed since the last push
	let seq = 0;
	let flushing = false; // a flush is queued for the end of this run of tasks
	let resyncs = 0; // the resync in flight, 0 for none; a newer one supersedes it
	let held = []; // messages that arrived during a resync, or between load and attach
	const notify = (type, info) => link?.host.notify(type, { engine, ...info });
	const onMigrate = (report) => notify("stateMigrated", report);

	// Pushes the pending ops as one batch, made to fit the remote's copy, unless one is in flight.
	const flush = () => {
		flushing = false;
		if (link === null || inflight !== null || resyncs !== 0 || pending.length === 0) return;
		const fit = writeFitting(copy, pending, link.root(), { scope: link.host.scope, level });
		pending = [];
		copy = fit.copy;
		if (fit.ops.length === 0) return;
		inflight = { clientId, seq: ++seq, base: acked, ops: fit.ops };
		transport.push(inflight);
	};
	const scheduleFlush = () => {
		if (flushing) return;
		flushing = true;
		queueMicrotask(flush); // one batch per run of tasks
	};
	// Loads the remote's state and brings the shared fields to it; what wasn't confirmed is
	// dropped, as the change that came first won.
	const resync = () => {
		const id = ++resyncs;
		const discarded = [...(inflight?.ops ?? [])];
		inflight = null;
		const loaded = Promise.resolve().then(() => transport.load());
		loaded
			.then((state) => {
				if (link === null || resyncs !== id) return;
				resyncs = 0;
				discarded.push(...pending);
				pending = [];
				if (discarded.length > 0) notify("syncRejected", { ops: discarded });
				acked = state?.version ?? 0;
				copy = state === null ? null : structuredClone(state.value);
				if (copy === null) pushRoot();
				else applyProjection(link, copy, { level, onMigrate, info: { reload: true } });
				for (const message of held.splice(0)) receive(message);
				scheduleFlush();
			})
			.catch((error) => {
				if (resyncs !== id) return;
				resyncs = 0;
				held = [];
				notify("syncFailed", { error });
			});
	};
	const pushRoot = () => {
		pending = [{ op: "set", path: [], value: project(link.root(), { level }) }];
		scheduleFlush();
	};
	const receive = (message) => {
		if (link === null) {
			if (unsubscribe !== null) held.push(message); // subscribed by load, not yet attached
			return;
		}
		if (resyncs !== 0) {
			held.push(message);
			return;
		}
		const ours = message.clientId === clientId && message.seq === inflight?.seq;
		if (message.type === "reject") {
			if (ours) resync();
			return;
		}
		if (message.version <= acked) return; // seen already, or in what a resync loaded
		if (message.version !== acked + 1 || inflight !== null || pending.length > 0) {
			// A gap, or another change got in before ours (in flight or not yet pushed), which the
			// remote rejects or which was made against the state before it: resync.
			if (ours && message.version === acked + 1) {
				acked = message.version;
				inflight = null;
				scheduleFlush();
			} else resync();
			return;
		}
		acked = message.version;
		const { scope } = link.host;
		try {
			copy = applyOps(copy, message.ops);
			link.apply((root) => applyStateOps(root, message.ops, scope, { level, onMigrate }), message);
		} catch (error) {
			notify("syncFailed", { error });
			resync();
		}
	};
	const engine = {
		level,
		clientId,
		async load() {
			// Subscribed before loading, so nothing sent meanwhile is missed: attach replays it.
			unsubscribe = transport.subscribe(receive);
			let stored;
			try {
				stored = await transport.load();
			} catch (error) {
				unsubscribe();
				unsubscribe = null;
				held = [];
				throw error;
			}
			if (stored === null) return null;
			acked = stored.version;
			copy = structuredClone(stored.value);
			return stored.value;
		},
		attach(l) {
			link = l;
			unsubscribe ??= transport.subscribe(receive);
			// Nothing stored yet: the remote starts from this root.
			if (copy === null) pushRoot();
			for (const message of held.splice(0)) receive(message);
		},
		prepare: (change) => opsOf(change, level, link.host.scope),
		commit(_change, ops) {
			if (ops.length === 0) return;
			pending.push(...ops);
			scheduleFlush();
		},
		detach() {
			flush();
			unsubscribe?.();
			unsubscribe = null;
			held = [];
			link = null;
		},
	};
	return engine;
};

// The remote's side: keeps the projection and its version, applies the batches made against
// it and rejects the rest, malformed ones included. save(state) persists { version, value }
// after each one.
export const relay = ({ version = 0, value = null, save = () => {} } = {}) => {
	const state = { version, value };
	return {
		load: () => (state.value === null ? null : structuredClone(state)),
		// The message to send every subscriber for batch.
		receive(batch) {
			const reject = { type: "reject", clientId: batch.clientId, seq: batch.seq };
			if (batch.base !== state.version || !Array.isArray(batch.ops)) return reject;
			let next;
			try {
				next = applyOps(structuredClone(state.value), batch.ops);
			} catch (error) {
				if (error instanceof OpConflictError) return reject;
				throw error;
			}
			state.value = next;
			state.version++;
			save(structuredClone(state));
			const { clientId, seq, ops } = batch;
			return { type: "batch", clientId, seq, version: state.version, ops };
		},
	};
};

// A transport per client over one relay in this process, delivering asynchronously like a
// network would. For tests and demos.
export const memoryRemote = (options) => {
	const remote = relay(options);
	const subscribers = new Set();
	return {
		relay: remote,
		connect: () => ({
			push(batch) {
				queueMicrotask(() => {
					const message = remote.receive(structuredClone(batch));
					for (const fn of subscribers) fn(structuredClone(message));
				});
			},
			subscribe(fn) {
				subscribers.add(fn);
				return () => subscribers.delete(fn);
			},
			load: async () => remote.load(),
		}),
	};
};
