// A sync engine that sends each change's ops to a remote (a server, a worker) and applies the
// ops other clients send. The remote orders changes with a version: a change made against an
// older version is rejected and its client reloads, so the first of two concurrent changes wins.
//
// transport: { push(batch), subscribe(onMessage) → unsubscribe, load() → { version, value } | null }
// batch:     { clientId, base, ops }, base being the version the ops were made against
// messages:  { type: "batch", clientId, version, ops } | { type: "reject", clientId }
import { hydrate, project } from "./codec.js";
import { applyStateOps, opsOf } from "./index.js";
import { applyOps } from "./ops.js";

const newId = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

export const remoteEngine = ({ transport, level = "shared", clientId = newId() }) => {
	let link = null;
	let unsubscribe = null;
	let stored = null;
	let acked = 0; // the last version the remote confirmed
	let inflight = 0; // batches pushed and not yet confirmed
	let pending = [];
	const push = (ops) => {
		transport.push({ clientId, base: acked + inflight, ops });
		inflight++;
	};
	const flush = () => {
		if (pending.length === 0) return;
		const ops = pending;
		pending = [];
		push(ops);
	};
	const reload = async () => {
		pending = [];
		inflight = 0;
		const loaded = await transport.load();
		if (link === null || loaded === null) return;
		acked = loaded.version;
		link.apply(() => hydrate(loaded.value, link.host.scope), { reload: true });
	};
	const resync = () => {
		reload().catch((error) => link?.host.notify("syncFailed", { error }));
	};
	const receive = (message) => {
		if (link === null) return;
		if (message.type === "reject") {
			if (message.clientId === clientId) resync();
			return;
		}
		if (message.clientId === clientId) {
			acked = message.version;
			inflight--;
			return;
		}
		if (inflight > 0) return; // ours will be rejected, and the reload brings this one
		if (message.version !== acked + 1) return resync();
		acked = message.version;
		const { scope } = link.host;
		link.apply((root) => applyStateOps(root, message.ops, scope), message);
	};
	return {
		level,
		clientId,
		async load() {
			stored = await transport.load();
			if (stored === null) return null;
			acked = stored.version;
			return stored.value;
		},
		attach(l) {
			link = l;
			unsubscribe = transport.subscribe(receive);
			// Nothing stored yet: the remote starts from this root.
			if (stored === null) push([{ op: "set", path: [], value: project(l.root(), { level }) }]);
		},
		commit(change) {
			const ops = opsOf(change, level, link.host.scope);
			if (ops.length === 0) return;
			if (pending.length === 0) queueMicrotask(flush); // one batch per run of tasks
			pending.push(...ops);
		},
		detach() {
			flush();
			unsubscribe?.();
			link = null;
		},
	};
};

// The remote's side: keeps the projection and its version, applies the batches made against
// it and rejects the rest. save(state) persists { version, value } after each one.
export const relay = ({ version = 0, value = null, save = () => {} } = {}) => {
	const state = { version, value };
	return {
		load: () => (state.value === null ? null : structuredClone(state)),
		// The message to send every subscriber for batch.
		receive(batch) {
			if (batch.base !== state.version) return { type: "reject", clientId: batch.clientId };
			try {
				state.value = applyOps(state.value, batch.ops);
			} catch {
				return { type: "reject", clientId: batch.clientId };
			}
			state.version++;
			save(structuredClone(state));
			return { type: "batch", clientId: batch.clientId, version: state.version, ops: batch.ops };
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
