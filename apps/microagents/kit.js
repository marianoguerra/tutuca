// The kit: everything an agent's module gets from the app, through define(kit), since agent
// modules import nothing. One tutuca for every agent, so their views render with the host's.
import * as tutuca from "../../src/tutuca.js";
import { checkAgent, reportText } from "./core/check.js";
import {
	AGENT_KIND,
	agentMessage,
	EMPTY_SAMPLE,
	MANIFEST_KEYS,
	PART,
	unpackAgent,
} from "./core/pack.js";
import * as tdata from "./core/tdata.js";
import * as expect from "./lib/expect.js";
import * as grid from "./lib/grid.js";
import * as json from "./lib/json.js";
import * as parts from "./lib/parts.js";
import * as table from "./lib/table.js";
import * as time from "./lib/time.js";
import * as ui from "./ui.js";

// Heavy libraries, bundled by scripts/vendor.js into demos/deps/ and loaded the first time an
// agent asks for them (define(kit) may be async and await one).
const deps = (name) => import(`../../demos/deps/${name}.js`);
const once = (load) => {
	let p = null;
	return () => (p ??= load());
};
export const ENGINES = {
	// { Ajv2020, addFormats }: JSON Schema 2020-12 validation.
	ajv: once(() => deps("ajv")),
	// jq-wasm: { json(input, filter), raw(input, filter, flags), … }.
	jq: once(() => deps("jq")),
	// { JSONPath }: jsonpath-plus.
	jsonpath: once(() => deps("jsonpath")),
	// { default: picomatch } (posix paths).
	picomatch: once(() => deps("picomatch")),
	// { vega, compile (vega-lite), embed (vega-embed) }.
	vega: once(() => deps("vega")),
	// echarts: init, …; init(null, null, { ssr: true, renderer: "svg" }) renders without a DOM.
	echarts: once(() => deps("echarts")),
};

// What an agent that makes agents needs (the Agent Builder): the agent message's format and the
// checks the app runs on one. check(msg) uses this kit.
const agentsWith = (kit) => ({
	AGENT_KIND,
	EMPTY_SAMPLE,
	MANIFEST_KEYS,
	PART,
	agentMessage,
	unpackAgent,
	check: (msg) => checkAgent(msg, kit),
	reportText,
});

// What agents share instead of copying (they import nothing): lib, plain helpers for JSON,
// tables, parts, expectations, status grids and times; ui, components (list kit.ui.components
// among the agent's own) and view fragments.
export const LIB = Object.freeze({ json, table, parts, expect, grid, time });

export const makeKit = ({ engines = ENGINES } = {}) => {
	const kit = { tutuca, tdata, lib: LIB, ui, engines };
	kit.agents = agentsWith(kit);
	return Object.freeze(kit);
};
