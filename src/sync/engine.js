// What the sync engines are built with: a change's ops, an engine's first ops, and applying ops
// or a whole projection from elsewhere so they fit this version of the components.
import { project } from "./codec.js";
import { diff } from "./diff.js";
import { applyFitting, rebuild } from "./migrate.js";

const memo = new WeakMap(); // change → level → ops
// The ops of a committed change at level, computed once for all the engines that ask.
export const opsOf = (change, level, scope) => {
	if (!memo.has(change)) memo.set(change, new Map());
	const byLevel = memo.get(change);
	if (!byLevel.has(level)) byLevel.set(level, diff(change.prev, change.next, { level, scope }));
	return byLevel.get(level);
};
// The ops that start an engine's copy from root: its whole projection at level.
export const rootOps = (root, level) => [{ op: "set", path: [], value: project(root, { level }) }];
// Applies plain ops to a state draft, made to fit this version's components (applyFitting):
// ops from a peer on another version keep the state valid. onMigrate(report) gets what that
// changed, { added, reset, dropped }, when it changed anything. Returns the root.
export const applyStateOps = (root, ops, scope, { level = "shared", onMigrate = null } = {}) => {
	const report = { added: [], reset: [], dropped: [] };
	for (const op of ops) root = applyFitting(root, op, scope, report, { level });
	reportMigration(report, onMigrate);
	return root;
};
// Brings the fields level sees to what plain, an engine's whole copy of the state, means to
// this version of the components (rebuild), through link and as ops, so the fields other levels
// see stay as they are: a reload, a resync. onMigrate(report) gets what didn't fit as is.
export const applyProjection = (
	link,
	plain,
	{ level = "shared", onMigrate = null, info = null },
) => {
	const { scope } = link.host;
	const rebuilt = rebuild(plain, scope, { level });
	const ops = diff(link.root(), rebuilt.root, { scope, level });
	if (ops.length > 0) link.apply((draft) => applyStateOps(draft, ops, scope, { level }), info);
	reportMigration(rebuilt, onMigrate);
};
// Gives onMigrate what a migration changed, { added, reset, dropped }, if it changed anything.
export const reportMigration = ({ added, reset, dropped }, onMigrate) => {
	if (onMigrate === null || added.length + reset.length + dropped.length === 0) return;
	onMigrate({ added, reset, dropped });
};
