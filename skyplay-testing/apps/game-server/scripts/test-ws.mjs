import WebSocket from "ws";

const WS_URL = "ws://localhost:8888?sessionId=test-kof98";
const FRAME_HEADER_SIZE = 9;
let frameCount = 0;
let receivedReady = false;

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("[test] Connected, sending init...");
  ws.send(JSON.stringify({
    type: "init",
    sessionId: "test-kof98",
    token: "",
    system: "neogeo",
    rom: "kof98.zip",
  }));
});

ws.on("message", (data, isBinary) => {
  // ws v8 sends text as string, binary as Buffer
  // Defensive: also check first byte for '{' (0x7b) to catch JSON-in-Buffer
  const raw = typeof data === "string" ? data : data.toString();
  if (!isBinary && (typeof data === "string" || raw.startsWith("{"))) {
    try {
      const msg = JSON.parse(typeof data === "string" ? data : raw);
      console.log(`[test] Text: type=${msg.type}`, msg.width ? `${msg.width}x${msg.height}` : "");

      if (msg.type === "ready") {
        receivedReady = true;
        console.log("[test] ✓ READY — stream started!");

        // Send some test inputs
        setTimeout(() => {
          console.log("[test] Sending test input: Start");
          ws.send(JSON.stringify({ type: "input", player: 1, button: 3, pressed: true }));
          setTimeout(() => ws.send(JSON.stringify({ type: "input", player: 1, button: 3, pressed: false })), 100);
        }, 500);

        // Collect frames for 5 seconds then stop
        setTimeout(() => {
          console.log(`[test] Received ${frameCount} frames in 5s (${Math.round(frameCount / 5)} fps)`);
          console.log("[test] Stopping...");
          ws.send(JSON.stringify({ type: "stop" }));
          ws.close();
          process.exit(frameCount > 0 ? 0 : 1);
        }, 5000);
      } else if (msg.type === "error") {
        console.error("[test] ✗ Server error:", msg.message);
        process.exit(1);
      } else if (msg.type === "status") {
        console.log(`[test] Status: ${msg.fps} fps, ${msg.frames} frames`);
      } else if (msg.type === "pong") {
        // silent
      } else {
        console.log(`[test] Unknown text msg:`, msg);
      }
    } catch {
      // Not JSON, could be binary
    }
  } else {
    // Binary frame
    frameCount++;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const magic = buf[0];
    if (frameCount <= 3) {
      const width = buf.readUInt16LE(1);
      const height = buf.readUInt16LE(3);
      const frameId = buf.readUInt32LE(5);
      const jpegSize = buf.length - FRAME_HEADER_SIZE;
      console.log(`[test] Frame #${frameId}: ${width}x${height}, JPEG ${jpegSize} bytes (magic=0x${magic.toString(16)})`);
    }
  }
});

ws.on("close", (code, reason) => {
  console.log(`[test] WS closed: code=${code}`);
  if (!receivedReady) {
    console.error("[test] ✗ Never received 'ready' message");
    process.exit(1);
  }
});

ws.on("error", (err) => {
  console.error("[test] ✗ WS error:", err.message);
  process.exit(1);
});

// Timeout safety
setTimeout(() => {
  if (!receivedReady) {
    console.error("[test] ✗ Timeout — no 'ready' after 30s");
    ws.close();
    process.exit(1);
  }
}, 30000);
