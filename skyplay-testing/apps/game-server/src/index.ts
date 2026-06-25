import { createServer } from "http";
import { WebSocketServer } from "ws";
import { handleConnection } from "./ws-handler.js";

const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";

// ── HTTP Server ────────────────────────────────────────────────────

const server = createServer((_req, res) => {
  // Health check endpoint
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
});

// ── WebSocket Server ───────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  // Generate a session ID from URL path or assign one
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("sessionId") || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  console.log(`[index] New WebSocket connection: ${sessionId} (${wss.clients.size} connected)`);

  handleConnection(ws, sessionId);
});

wss.on("error", (err) => {
  console.error("[index] WebSocket server error:", err);
});

// ── Startup ────────────────────────────────────────────────────────

server.listen(PORT, HOST, () => {
  console.log(`[index] SkyPlay Game Server listening on http://${HOST}:${PORT}`);
  console.log(`[index] Cores dir: ${process.env.RETROARCH_CORES_DIR || "/usr/lib/libretro"}`);
  console.log(`[index] ROMs dir: ${process.env.ROMS_DIR || "/roms"}`);
});

// ── Graceful Shutdown ──────────────────────────────────────────────

function shutdown() {
  console.log("[index] Shutting down...");
  wss.close();
  server.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
