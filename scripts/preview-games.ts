import http from "node:http";
import { createLocalGamesPreview } from "./lib/local-games-preview.ts";

const preview = await createLocalGamesPreview();
const server = http.createServer(async (request, response) => {
    try {
        const url = new URL(request.url ?? "/games", "http://127.0.0.1");
        if (url.pathname === "/preview-games.js") {
            response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
            response.end(preview.javascript); return;
        }
        if (!/^\/(en\/)?games(?:\/[^/]+)?\/?$/.test(url.pathname)) { response.writeHead(404); response.end("Local games preview only"); return; }
        const html = await preview.html(url);
        response.writeHead(html ? 200 : 404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(html ?? "Game not found");
    } catch { response.writeHead(500); response.end("Local preview render failed"); }
});
server.listen(Number(process.argv[2] ?? 4322), "127.0.0.1", () => console.log(`Games-only local preview: http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/games`));
