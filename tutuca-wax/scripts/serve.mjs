// A static file server for this directory: the demos (`just demos`), and the
// pages the browser tests open. No caching, so a rebuild shows on reload.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const TYPES = {
	".html": "text/html; charset=utf-8",
	".mjs": "text/javascript",
	".js": "text/javascript",
	".css": "text/css",
	".wasm": "application/wasm",
	".wax": "text/plain; charset=utf-8",
	".wat": "text/plain; charset=utf-8",
};

// A server for root's files; routes maps a path to a page served as HTML.
export function createStaticServer(routes = {}) {
	return createServer(async (req, res) => {
		const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
		const headers = { "cache-control": "no-store" };
		if (path in routes) {
			res.writeHead(200, { ...headers, "content-type": TYPES[".html"] }).end(routes[path]);
			return;
		}
		if (path.endsWith("/")) {
			res.writeHead(302, { ...headers, location: `${path}index.html` }).end();
			return;
		}
		const file = normalize(join(root, path));
		if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
			res.writeHead(403, headers).end();
			return;
		}
		try {
			const body = await readFile(file);
			res.writeHead(200, { ...headers, "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
		} catch {
			res.writeHead(404, headers).end("not found");
		}
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const port = Number(process.argv[2] ?? 8002);
	createStaticServer().listen(port, "127.0.0.1", () => {
		console.log(`serving ${root} at http://127.0.0.1:${port}/demos/`);
	});
}
