// Defines <tutuca-playground> for the site's pages, with the vendored CodeMirror and margaui.
import * as fc from "fast-check";
import { compile } from "margaui";
import { definePlayground } from "tutuca/playground";
import * as codemirror from "../deps/codemirror.js";

definePlayground(window, { codemirror, fc, compile });
