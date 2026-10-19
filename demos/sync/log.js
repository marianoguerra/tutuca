// An engine that only shows what syncs: the ops of each change, sent ones (from this tab's
// tasks) and received ones (applied from elsewhere), newest first in list.
import { opsOf, opText } from "../../src/sync/index.js";

export const logEngine = (list, { level = "shared", max = 40 } = {}) => {
	let link = null;
	return {
		level,
		attach(l) {
			link = l;
		},
		prepare: (change) => opsOf(change, level, link.host.scope).map(opText),
		commit(change, lines) {
			if (lines.length === 0) return;
			const item = list.ownerDocument.createElement("li");
			item.className = change.task === null ? "received" : "sent";
			item.textContent = `${change.task === null ? "⬇ received" : "⬆ sent"}: ${lines.join("; ")}`;
			list.prepend(item);
			while (list.children.length > max) list.lastChild.remove();
		},
	};
};
