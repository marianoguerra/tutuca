// Writes tdata/vectors/{values,messages}.json from the sources below: for each JSON text, the
// CBOR hex the JS encoder gives. A `cbor` given here is a hand-checked expectation (most come from
// RFC 8949 Appendix A) and the script fails if the encoder disagrees. invalid.json and specs.json
// are written by hand.

import { writeFileSync } from "node:fs";
import {
	decodeMessage,
	decodeValue,
	encodeMessageCbor,
	encodeValueCbor,
	toHex,
} from "../src/index.ts";

type Src = { name: string; json: string; cbor?: string };

const values: Src[] = [
	{ name: "null", json: "null", cbor: "f6" },
	{ name: "false", json: "false", cbor: "f4" },
	{ name: "true", json: "true", cbor: "f5" },
	{ name: "int 0", json: "0", cbor: "00" },
	{ name: "int 1", json: "1", cbor: "01" },
	{ name: "int 10", json: "10", cbor: "0a" },
	{ name: "int 23", json: "23", cbor: "17" },
	{ name: "int 24", json: "24", cbor: "1818" },
	{ name: "int 100", json: "100", cbor: "1864" },
	{ name: "int 1000", json: "1000", cbor: "1903e8" },
	{ name: "int 1000000", json: "1000000", cbor: "1a000f4240" },
	{ name: "int 1000000000000", json: "1000000000000", cbor: "1b000000e8d4a51000" },
	{ name: "int -1", json: "-1", cbor: "20" },
	{ name: "int -10", json: "-10", cbor: "29" },
	{ name: "int -100", json: "-100", cbor: "3863" },
	{ name: "int -1000", json: "-1000", cbor: "3903e7" },
	{ name: "int 2^53+1", json: "9007199254740993", cbor: "1b0020000000000001" },
	{ name: "int max", json: "9223372036854775807", cbor: "1b7fffffffffffffff" },
	{ name: "int min", json: "-9223372036854775808", cbor: "3b7fffffffffffffff" },
	{ name: "double 0.0", json: "0.0", cbor: "f90000" },
	{ name: "double -0.0", json: '["num","-0"]', cbor: "f98000" },
	{ name: "double 1.0", json: "1.0", cbor: "f93c00" },
	{ name: "double 1.1", json: "1.1", cbor: "fb3ff199999999999a" },
	{ name: "double 1.5", json: "1.5", cbor: "f93e00" },
	{ name: "double 65504.0", json: "65504.0", cbor: "f97bff" },
	{ name: "double 100000.0", json: "100000.0", cbor: "fa47c35000" },
	{ name: "double max float32", json: "3.4028234663852886e+38", cbor: "fa7f7fffff" },
	{ name: "double 1e+300", json: "1e+300", cbor: "fb7e37e43c8800759c" },
	{ name: "double smallest half subnormal", json: "5.960464477539063e-8", cbor: "f90001" },
	{ name: "double smallest half normal", json: "0.00006103515625", cbor: "f90400" },
	{ name: "double -4.0", json: "-4.0", cbor: "f9c400" },
	{ name: "double -4.1", json: "-4.1", cbor: "fbc010666666666666" },
	{ name: "double 1e+21", json: "1e+21" },
	{ name: "double 5e-324", json: "5e-324" },
	{ name: "double 0.1", json: "0.1" },
	{ name: "double Infinity", json: '["num","Infinity"]', cbor: "f97c00" },
	{ name: "double NaN", json: '["num","NaN"]', cbor: "f97e00" },
	{ name: "double -Infinity", json: '["num","-Infinity"]', cbor: "f9fc00" },
	{ name: "string empty", json: '""', cbor: "60" },
	{ name: "string a", json: '"a"', cbor: "6161" },
	{ name: "string IETF", json: '"IETF"', cbor: "6449455446" },
	{ name: "string escapes", json: '"\\"\\\\"', cbor: "62225c" },
	{ name: "string u00fc", json: '"ü"', cbor: "62c3bc" },
	{ name: "string u6c34", json: '"水"', cbor: "63e6b0b4" },
	{ name: "string surrogate pair", json: '"𐅑"', cbor: "64f0908591" },
	{ name: "string control escapes", json: '"\\u0000\\b\\t\\n\\f\\r\\u001f"' },
	{ name: "string tilde and hash", json: '"~#x"' },
	{ name: "bytes empty", json: '["bytes",""]', cbor: "40" },
	{ name: "bytes 01020304", json: '["bytes","AQIDBA=="]', cbor: "4401020304" },
	{ name: "bytes 3 long", json: '["bytes","AAEC"]', cbor: "43000102" },
	{ name: "instant", json: '["inst","1730540000123456789"]', cbor: "d993451b18041cf618f68d15" },
	{ name: "instant before epoch", json: '["inst","-1000000000"]', cbor: "d993453a3b9ac9ff" },
	{
		name: "ref",
		json: '["ref","http://www.example.com"]',
		cbor: "d82076687474703a2f2f7777772e6578616d706c652e636f6d",
	},
	{ name: "array empty", json: "[[]]", cbor: "80" },
	{ name: "array 1 2 3", json: "[[1,2,3]]", cbor: "83010203" },
	{ name: "array nested", json: "[[1,[[2,3]],[[4,5]]]]", cbor: "8301820203820405" },
	{ name: "array of arrays", json: "[[[[]],[[[[]]]]]]" },
	{ name: "object empty", json: "{}", cbor: "a0" },
	{ name: "object a b", json: '{"a":1,"b":[[2,3]]}', cbor: "a26161016162820203" },
	{ name: "object keeps order", json: '{"b":1,"a":2,"10":3,"2":4}' },
	{ name: "object key looks like a tag", json: '{"#":1,"node":2,"__proto__":3}' },
	{ name: "set", json: '["set",[["a","b"]]]', cbor: "d9010282616161" + "62" },
	{ name: "set empty", json: '["set",[[]]]', cbor: "d9010280" },
	{ name: "set of int and double one", json: '["set",[[1,1.0]]]' },
	{ name: "typed", json: '["#","app/point",{"x":1.5,"y":2.0}]' },
	{ name: "typed unknown nested", json: '["#","x/outer",["#","x/inner",[[["bytes","AA=="]]]]]' },
	{ name: "typed reserved namespace", json: '["#","tdata.spec/keys",{"req":{"x":"int"}}]' },
	{ name: "node empty", json: '["node","br",{},[[]]]' },
	{ name: "node", json: '["node","p",{"class":"lead"},[["Hello ",["node","b",{},[["world"]]]]]]' },
	{
		name: "all kinds",
		json: '{"n":null,"b":true,"i":-7,"d":2.5,"s":"x","y":["bytes","/w=="],"t":["inst","0"],"r":["ref","urn:x"],"a":[[1]],"o":{"k":{}},"z":["set",[[1]]],"ty":["#","x/y",null],"no":["node","x",{"a":1},[[2]]]}',
	},
];

const messages: Src[] = [
	{
		name: "minimal",
		json: '{"id":"m1","kind":"note","data":null}',
		cbor: "a3626964626d31646b696e64646e6f74656464617461f6",
	},
	{
		name: "with meta",
		json: '{"id":"m1","kind":"note","data":{"title":"Hi"},"meta":{"https://tutuca.dev/d/trace":{"at":["inst","1730540000000000000"],"by":"ana"}}}',
	},
	{ name: "empty dialect kept", json: '{"id":"m","kind":"k","data":1,"meta":{"urn:d":{}}}' },
	{
		name: "children",
		json: '{"id":"p","kind":"list","messages":[{"id":"a","kind":"item","data":1},{"id":"b","kind":"item","data":2.0}]}',
	},
	{ name: "no children", json: '{"id":"p","kind":"list","messages":[]}' },
	{
		name: "nested children",
		json: '{"id":"r","kind":"tree","messages":[{"id":"x","kind":"tree","messages":[{"id":"y","kind":"leaf","data":"y"}]}]}',
	},
	{
		name: "header scalars",
		json: '{"id":"m","kind":"k","data":null,"meta":{"urn:a":{"n":null,"b":false,"i":1,"d":1.0,"s":"s","y":["bytes","AQ=="],"t":["inst","1"],"r":["ref","urn:r"]},"urn:b":{"x":2}}}',
	},
	{
		name: "plan example",
		json: '{"id":"m1","kind":"note","data":{"n":9007199254740993,"ratio":1.0,"tags":["set",[["a","b"]]],"p":["#","app/point",{"x":1.5,"y":2.0}],"list":[[1,2,3]],"body":["node","p",{"class":"lead"},[["Hello ",["node","b",{},[["world"]]]]]]},"meta":{"https://tutuca.dev/d/trace":{"at":["inst","1730540000000000000"]}}}',
	},
];

const fill = (srcs: Src[], toCbor: (json: string) => Uint8Array) =>
	srcs.map(({ name, json, cbor }) => {
		const got = toHex(toCbor(json));
		if (cbor !== undefined && cbor !== got)
			throw new Error(`${name}: expected ${cbor}, the encoder gives ${got}`);
		return { name, json, cbor: got };
	});

const out = new URL("../../vectors/", import.meta.url);
const write = (file: string, data: unknown) =>
	writeFileSync(new URL(file, out), `${JSON.stringify(data, null, "\t")}\n`);

write(
	"values.json",
	fill(values, (j) => encodeValueCbor(decodeValue(j))),
);
write(
	"messages.json",
	fill(messages, (j) => encodeMessageCbor(decodeMessage(j))),
);
console.log(`wrote ${values.length} values and ${messages.length} messages`);
