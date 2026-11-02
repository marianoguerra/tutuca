// A router (docs/spec.md §4.4): routes in registration order, each a spec (`on`) or a tq query
// (`when`, §6) with its handler. dispatch returns every route that matches a message; handlers
// get the original message, the `or` picks of a spec and the bindings of a query.

import type { Message, Value } from "./model.ts";
import type { Bindings, Query } from "./query.ts";
import type { Pick, Registry } from "./spec.ts";

export type Handler<R> = (msg: Message, picks: Pick[], bindings: Bindings) => R;

export interface Match<R> {
	/** The route's spec, for a route added with `on`. */
	spec?: Value;
	/** The route's query, for a route added with `when`. */
	query?: string;
	handler: Handler<R>;
	picks: Pick[];
	bindings: Bindings;
}

type Route<R> = { spec: Value; handler: Handler<R> } | { query: string; handler: Handler<R> };

export class Router<R = unknown> {
	readonly registry: Registry;
	readonly queries: Query | undefined;
	#routes: Route<R>[] = [];

	/** `queries` runs the routes added with `when`. */
	constructor(registry: Registry, queries?: Query) {
		this.registry = registry;
		this.queries = queries;
	}

	on(spec: Value, handler: Handler<R>): this {
		this.#routes.push({ spec, handler });
		return this;
	}

	/** A route that matches when the query does; the handler gets its first match's bindings. */
	when(query: string, handler: Handler<R>): this {
		if (!this.queries) throw new Error("Router.when needs a Query: new Router(registry, query)");
		this.queries.parse(query);
		this.#routes.push({ query, handler });
		return this;
	}

	#match(route: Route<R>, msg: Message): Match<R> | undefined {
		if ("spec" in route) {
			const r = this.registry.check(route.spec, msg);
			return r.ok ? { ...route, picks: r.picks, bindings: new Map() } : undefined;
		}
		const s = this.queries?.match(route.query, msg);
		return s ? { ...route, picks: [], bindings: s.bindings } : undefined;
	}

	/** Every route that matches `msg`, in registration order. */
	dispatch(msg: Message): Match<R>[] {
		const out: Match<R>[] = [];
		for (const route of this.#routes) {
			const m = this.#match(route, msg);
			if (m) out.push(m);
		}
		return out;
	}

	/** The first route that matches `msg`. */
	first(msg: Message): Match<R> | undefined {
		for (const route of this.#routes) {
			const m = this.#match(route, msg);
			if (m) return m;
		}
		return undefined;
	}

	/** Calls the handlers of every matching route, returning their results. */
	handle(msg: Message): R[] {
		return this.dispatch(msg).map((m) => m.handler(msg, m.picks, m.bindings));
	}
}
