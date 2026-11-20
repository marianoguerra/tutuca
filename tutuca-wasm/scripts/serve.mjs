// A static file server: for the assembled site (_site/, which site.sh makes, with only what a
// page reads) by default, or for another directory. No caching, so a rebuild shows on reload.
// Files and directories whose names start with a dot (.env, .git) are never served.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SITE = fileURLToPath(new URL("../_site", import.meta.url));

const TYPES = {
	".html": "text/html; charset=utf-8",
	".mjs": "text/javascript",
	".js": "text/javascript",
	".ts": "text/plain; charset=utf-8",
	".css": "text/css",
	".wasm": "application/wasm",
	".json": "application/json",
	".md": "text/plain; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".jpg": "image/jpeg",
	".woff2": "font/woff2",
	".map": "application/json",
	".pdf": "application/pdf",
	".txt": "text/plain; charset=utf-8",
};

/**
 * A server for base's files; handle(req, res), when given, answers first, resolving true when
 * it did (the inference API, inference-api.mjs). Files whose names start with a dot aren't
 * served.
 */
export function createStaticServer(handle = null, base = SITE) {
	return createServer(async (req, res) => {
		if (handle && (await handle(req, res))) return;
		const url = new URL(req.url, "http://x");
		const path = decodeURIComponent(url.pathname);
		const headers = { "cache-control": "no-store" };
		if (path.endsWith("/")) {
			res.writeHead(302, { ...headers, location: `${path}index.html${url.search}` }).end();
			return;
		}
		const file = normalize(join(base, path));
		const inside = file.startsWith(base.endsWith(sep) ? base : base + sep);
		if (!inside || path.split("/").some((part) => part.startsWith("."))) {
			res.writeHead(403, headers).end();
			return;
		}
		try {
			const body = await readFile(file);
			const type = TYPES[extname(file)] ?? "application/octet-stream";
			res.writeHead(200, { ...headers, "content-type": type }).end(body);
		} catch {
			res.writeHead(404, headers).end("not found");
		}
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const port = Number(process.argv[2] ?? 8002);
	createStaticServer().listen(port, "127.0.0.1", () => {
		console.log(`serving ${SITE} at http://127.0.0.1:${port}/`);
	});
}
