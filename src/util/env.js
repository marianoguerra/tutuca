// Host-platform detection shared by the event-modifier wrappers (anode.js)
// and input-event name lookup (transactor.js): both map cmd on mac to ctrl.
export const isMac = (globalThis.navigator?.userAgent ?? "").toLowerCase().includes("mac");
