// Host-platform detection shared by the event-modifier wrappers (anode.js)
// and the `e.<member>` conveniences (value.js): both map cmd on mac to ctrl.
export const isMac = (globalThis.navigator?.userAgent ?? "").toLowerCase().includes("mac");
