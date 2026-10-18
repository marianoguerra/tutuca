import assert from "node:assert/strict";
import test from "node:test";
import { Driver } from "../../src/test/pbt.js";
import { component, DispatchPath, testEnv } from "../../src/tutuca.js";
import { scopeWith } from "../helpers.js";

const Stamp = component({
	name: "Stamp",
	fields: (t) => ({ at: t.number(), roll: t.number(), id: t.string() }),
	on: {
		stamp(draft, _args, ctx) {
			draft.at = ctx.now();
			draft.roll = ctx.random();
			draft.id = ctx.uuid();
		},
	},
	view: "stamp",
});
const stamped = (env) => {
	const driver = new Driver({ root: scopeWith({ Stamp }).components.Stamp(), env });
	driver.send(new DispatchPath(), "stamp", []);
	return driver;
};

test("handlers read the world through ctx, so a Driver's runs repeat", () => {
	const [a, b] = [stamped(), stamped()];
	const fields = ({ at, roll, id }) => ({ at, roll, id });
	assert.deepEqual(fields(a.state), fields(b.state));
	assert.equal(a.state.at, Date.UTC(2026, 0, 1));
	assert.ok(a.state.roll >= 0 && a.state.roll < 1);
	assert.equal(a.state.id, "00000000-0000-4000-8000-000000000001");
	assert.notEqual(stamped(testEnv({ seed: 2 })).state.roll, a.state.roll);
});

test("a test env's clock only moves when advanced", () => {
	const env = testEnv({ start: 1000 });
	const driver = stamped(env);
	assert.equal(driver.state.at, 1000);
	env.advance(250);
	driver.send(new DispatchPath(), "stamp", []);
	assert.equal(driver.state.at, 1250);
	assert.equal(driver.state.id, "00000000-0000-4000-8000-000000000002");
});
