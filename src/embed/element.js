// An isolated tutuca app inside another: <tutuca-app app-key="..."> asks its ancestors for
// an app to mount in its shadow root. The outer render never morphs shadow content and
// events leaving it are retargeted to the element, so the outer Host never sees inside.
//
// Protocol, both as bubbling CustomEvents on the element:
// - REQUEST, on connect and when app-key changes. Its detail is { key, element, rootNode,
//   document, adoptCss(text) → <style>, adoptLink(href), emit(type, data), mount(controller) }; a
//   listener mounts an app on rootNode and passes mount a controller with dispose().
// - REPORT, sent by emit, with detail { key, type, data }. An outer view can handle it
//   like any event: h("tutuca-app", { "app-key": ..., "on:tutucareport": send(...) }).
//   Reports go out in a microtask, in order: a request answered during the outer render,
//   or a call from an outer task, never reenters the outer Host.
// The outer side calls the app through element.controller or its own registry by key.
import { Host } from "../tutuca.js";

export const REQUEST = "tutucarequest";
export const REPORT = "tutucareport";

// Defines the element in window once; returns its class.
export const defineTutucaApp = (window, tagName = "tutuca-app") => {
	const existing = window.customElements.get(tagName);
	if (existing !== undefined) return existing;
	class TutucaApp extends window.HTMLElement {
		static observedAttributes = ["app-key"];
		controller = null;
		mountedKey = null;
		current = null; // The detail of the live request; emits from older ones are dropped.
		get key() {
			return this.getAttribute("app-key");
		}
		// A keyed move (insertBefore) disconnects and reconnects; keep the app through it.
		connectedCallback() {
			if (this.current === null || this.mountedKey !== this.key) this.request();
		}
		disconnectedCallback() {
			queueMicrotask(() => {
				if (!this.isConnected) this.dispose();
			});
		}
		attributeChangedCallback() {
			if (this.isConnected) this.request();
		}
		request() {
			this.dispose();
			const doc = this.ownerDocument;
			const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
			const rootNode = doc.createElement("div");
			shadow.replaceChildren(rootNode);
			const key = this.key;
			let controller = null;
			const detail = {
				key,
				element: this,
				rootNode,
				document: doc,
				adoptCss: (text) => {
					const style = doc.createElement("style");
					style.textContent = text;
					shadow.insertBefore(style, rootNode);
					return style; // To update as the app needs more.
				},
				adoptLink: (href) => {
					const link = doc.createElement("link");
					link.rel = "stylesheet";
					link.href = href;
					shadow.insertBefore(link, rootNode);
				},
				emit: (type, data) =>
					queueMicrotask(() => {
						if (this.current !== detail) return;
						const init = { bubbles: true, detail: { key, type, data } };
						this.dispatchEvent(new window.CustomEvent(REPORT, init));
					}),
				mount: (c) => {
					controller = c;
				},
			};
			this.current = detail;
			this.mountedKey = key;
			this.dispatchEvent(new window.CustomEvent(REQUEST, { bubbles: true, detail }));
			if (controller === null) rootNode.textContent = `no app for ${key}`;
			this.controller = controller;
		}
		dispose() {
			const { controller } = this;
			this.controller = null;
			this.current = null;
			this.mountedKey = null;
			controller?.dispose();
		}
	}
	window.customElements.define(tagName, TutucaApp);
	return TutucaApp;
};

// Mounts a plain Host for a request: register(scope) registers its components, make(C)
// makes the root from them. Returns the controller, already passed to detail.mount.
export const mountTutucaApp = (detail, { register, make, dev = false, onNotify }) => {
	const host = new Host({ document: detail.document, rootNode: detail.rootNode, dev });
	register(host.scope);
	if (onNotify !== undefined) host.onNotify = onNotify;
	host.start(make(host.scope.components));
	const controller = {
		host,
		dispose() {
			host.stop();
		},
	};
	detail.mount(controller);
	return controller;
};
