// Defines <tutuca-playground> for a page (embed.js), with the compiler worker every playground
// on the page shares and the CodeMirror editor. A page imports this module and puts the
// elements where it likes; the margaui import map and theme are the page's.
import { workerCompiler } from "./compiler.js";
import { createEditor } from "./deps/editor.js";
import { definePlayground } from "./embed.js";

const here = (path) => new URL(path, import.meta.url);
let shared = null;
// The page's compiler: one worker, made on the first playground's first use.
export const sharedCompiler = () =>
	(shared ??= workerCompiler({
		workerUrl: here("./compiler.worker.js"),
		compilerUrl: here("./deps/moonc-web.cjs"),
		payloadUrl: here("./payload/"),
	}));

definePlayground({ compiler: sharedCompiler, createEditor });
