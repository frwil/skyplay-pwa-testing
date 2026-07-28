import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer } from "ws";
import { handleConnection, handleGiftNotify } from "./ws-handler.js";

const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";

// ── Internal auth token for REST endpoints (same as STATS_API_TOKEN) ─
const API_TOKEN = process.env.STATS_API_TOKEN || process.env.API_TOKEN || "dev";

/** Read the full request body as a UTF-8 string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// ── HTTP Server ────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  // CORS headers for internal API calls
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── POST /gift-notify — forward gift events to all session viewers ─
  if (req.method === "POST" && req.url === "/gift-notify") {
    try {
      // Auth check
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${API_TOKEN}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
        return;
      }

      const body = await readBody(req);
      const payload = JSON.parse(body);
      const result = handleGiftNotify(payload);

      if (result.success) {
        res.writeHead(200, { "Content-Type": "application/json" });
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Invalid request body" }));
    }
    return;
  }

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
