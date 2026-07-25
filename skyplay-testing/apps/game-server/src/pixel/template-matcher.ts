import { spawn, ChildProcess } from "child_process";
import { writeFileSync, chmodSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * OpenCV-powered template matcher for text overlay identification.
 *
 * Delegates to a persistent Python subprocess running opencv-bridge.py,
 * which uses cv2.TM_CCOEFF_NORMED — invariant to global brightness.
 *
 * The Python script is embedded as a string and written to disk at startup
 * (the src/ directory is not available in the runtime container).
 */

const PYTHON_SCRIPT_PATH = "/tmp/opencv-bridge.py";

// Embedded Python script — written to /tmp at startup
const PYTHON_SCRIPT = `
import sys, os, struct, json
import numpy as np
import cv2

TEMPLATE_DIR = "/recordings/text-templates"
MIN_SCORE = 0.25  # FIXME: lowered from 0.40 — templates need re-capture for current Xvfb session

def load_templates():
    templates = []
    if not os.path.isdir(TEMPLATE_DIR):
        print(f"[opencv-bridge] No template dir: {TEMPLATE_DIR}", file=sys.stderr)
        return templates
    for fname in sorted(os.listdir(TEMPLATE_DIR)):
        if not fname.lower().endswith(".png"):
            continue
        name = fname.replace(".png", "").replace("-", " ").upper()
        path = os.path.join(TEMPLATE_DIR, fname)
        img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            print(f"[opencv-bridge] Failed: {path}", file=sys.stderr)
            continue
        img = img.astype(np.float32)
        img -= img.mean()
        std = img.std()
        if std > 0:
            img /= std
        templates.append((name, img))
        print(f"[opencv-bridge] Loaded \\"{name}\\": {img.shape[1]}x{img.shape[0]}", file=sys.stderr)
    print(f"[opencv-bridge] {len(templates)} templates loaded", file=sys.stderr)
    return templates

_frame_count = 0
def match_frame(frame_rgb, w, h, templates):
    global _frame_count
    _frame_count += 1
    try:
        frame = np.frombuffer(frame_rgb, dtype=np.uint8).reshape((h, w, 3))
    except Exception as e:
        print(f"[opencv-bridge] reshape({h},{w},3) failed on {len(frame_rgb)} bytes: {e}", file=sys.stderr)
        return None, 0.0
    # Save every frame for debug (overwrite)
    header = f"P6\\n{w} {h}\\n255\\n".encode()
    with open("/tmp/debug-frame.ppm", "wb") as f:
        f.write(header + frame_rgb)
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY).astype(np.float32)
    best_name = None
    best_score = 0.0
    scores = []
    for name, tmpl in templates:
        tw, th = tmpl.shape[1], tmpl.shape[0]
        if tw > w or th > h:
            continue
        result = cv2.matchTemplate(gray, tmpl, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, _ = cv2.minMaxLoc(result)
        scores.append(f"{name}={float(max_val):.3f}")
        if max_val > best_score:
            best_score = float(max_val)
            best_name = name
    # Log scores for first 5 frames
    if _frame_count <= 5:
        print(f"[opencv-bridge] Frame #{_frame_count} scores: {', '.join(scores)}", file=sys.stderr)
    best_score = max(0.0, min(1.0, best_score))
    if best_score >= MIN_SCORE:
        return best_name, best_score
    elif best_score > 0.25:
        print(f"[opencv-bridge] Near miss: \\"{best_name}\\" score={best_score:.3f}", file=sys.stderr)
    return None, 0.0

def main():
    print("[opencv-bridge] Starting...", file=sys.stderr)
    templates = load_templates()
    if not templates:
        print(json.dumps({"error": "No templates loaded"}), file=sys.stderr)
        sys.exit(1)
    print("[opencv-bridge] Ready", file=sys.stderr)
    sys.stderr.flush()
    while True:
        header = sys.stdin.buffer.read(12)
        if len(header) < 12:
            break
        fw = struct.unpack("<I", header[0:4])[0]
        fh = struct.unpack("<I", header[4:8])[0]
        data_len = struct.unpack("<I", header[8:12])[0]
        if data_len == 0:
            resp = json.dumps({"name": None, "confidence": 0})
            out = resp.encode("utf-8")
            sys.stdout.buffer.write(struct.pack("<I", len(out)))
            sys.stdout.buffer.write(out)
            sys.stdout.buffer.flush()
            continue
        frame_data = sys.stdin.buffer.read(data_len)
        if len(frame_data) < data_len:
            break
        name, score = match_frame(frame_data, fw, fh, templates)
        resp = json.dumps({"name": name, "confidence": score})
        out = resp.encode("utf-8")
        sys.stdout.buffer.write(struct.pack("<I", len(out)))
        sys.stdout.buffer.write(out)
        sys.stdout.buffer.flush()
    print("[opencv-bridge] Exiting", file=sys.stderr)

if __name__ == "__main__":
    main()
`;

export class TemplateMatcher {
  private process: ChildProcess | null = null;
  private pending: Map<
    number,
    { resolve: (r: { name: string; confidence: number } | null) => void }
  > = new Map();
  private reqId = 0;
  private buf = Buffer.alloc(0);
  private ready = false;
  private startPromise: Promise<void> | null = null;
  private restartCount = 0;
  private readonly MAX_RESTARTS = 3;

  constructor(
    _threshold: number = 180,
    _minScore: number = 0.55,
  ) {
    // Write Python bridge script to temp dir
    try {
      writeFileSync(PYTHON_SCRIPT_PATH, PYTHON_SCRIPT, "utf-8");
      chmodSync(PYTHON_SCRIPT_PATH, 0o755);
      console.log("[template-matcher] Python bridge written to", PYTHON_SCRIPT_PATH);
    } catch (e) {
      console.log("[template-matcher] Failed to write Python bridge:", (e as Error).message);
    }
    this.start();
  }

  hasTemplates(): boolean {
    return this.ready;
  }

  loadAllFromDir(_dir: string = "/recordings/text-templates"): number {
    return 1; // Python handles template loading
  }

  loadTemplate(_name: string, _pngPath: string): boolean {
    return true;
  }

  async identify(
    frame: Buffer, w: number, h: number,
  ): Promise<{ name: string; confidence: number } | null> {
    if (!this.ready) {
      await this.startPromise;
      if (!this.ready) return null;
    }

    const reqId = ++this.reqId;
    return new Promise((resolve) => {
      this.pending.set(reqId, { resolve });

      const header = Buffer.alloc(12);
      header.writeUInt32LE(w, 0);
      header.writeUInt32LE(h, 4);
      header.writeUInt32LE(frame.length, 8);

      try {
        this.process!.stdin!.write(Buffer.concat([header, frame]));
      } catch (e) {
        console.log(`[template-matcher] Write error: ${(e as Error).message}`);
        this.pending.delete(reqId);
        this.restart();
        resolve(null);
      }
    });
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private start(): void {
    this.startPromise = new Promise((resolve) => {
      try {
        this.process = spawn("python3", [PYTHON_SCRIPT_PATH], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        this.process.on("error", (e) => {
          console.log(`[template-matcher] Python spawn error: ${e.message}`);
          this.ready = false;
          resolve();
        });

        this.process.on("exit", (code, signal) => {
          console.log(`[template-matcher] Python exited (code=${code} signal=${signal})`);
          this.ready = false;
        });

        this.process.stderr!.on("data", (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) console.log(`[opencv] ${text}`);
        });

        this.process.stdout!.on("data", (chunk: Buffer) => {
          this.buf = Buffer.concat([this.buf, chunk]);
          this.tryReadResponse();
        });

        // Wait for "Ready" message from Python stderr
        const readyCheck = (chunk: Buffer) => {
          if (chunk.toString().includes("Ready")) {
            this.process!.stderr!.removeListener("data", readyCheck);
            this.ready = true;
            this.restartCount = 0;
            console.log("[template-matcher] ✅ OpenCV bridge ready");
            resolve();
          }
        };
        this.process.stderr!.on("data", readyCheck);

        // Timeout fallback
        setTimeout(() => {
          if (!this.ready) {
            this.ready = false;
            console.log("[template-matcher] ⚠️  OpenCV bridge timeout");
            resolve();
          }
        }, 5000);
      } catch (e) {
        console.log(`[template-matcher] Failed to start: ${(e as Error).message}`);
        this.ready = false;
        resolve();
      }
    });
  }

  private restart(): void {
    if (this.restartCount >= this.MAX_RESTARTS) {
      console.log("[template-matcher] Max restarts reached — giving up");
      return;
    }
    this.restartCount++;
    console.log(`[template-matcher] Restarting bridge (attempt ${this.restartCount}/${this.MAX_RESTARTS})`);
    if (this.process) {
      try { this.process.kill(); } catch { /* ok */ }
    }
    this.ready = false;
    this.buf = Buffer.alloc(0);
    this.start();
  }

  private tryReadResponse(): void {
    while (this.buf.length >= 4) {
      const jsonLen = this.buf.readUInt32LE(0);
      if (this.buf.length < 4 + jsonLen) return;

      const jsonStr = this.buf.subarray(4, 4 + jsonLen).toString("utf-8");
      this.buf = this.buf.subarray(4 + jsonLen);

      try {
        const result = JSON.parse(jsonStr);
        if (this.pending.size > 0) {
          const [reqId, entry] = this.pending.entries().next().value!;
          this.pending.delete(reqId);
          if (result.name && result.confidence > 0) {
            entry.resolve({ name: result.name, confidence: result.confidence });
          } else {
            entry.resolve(null);
          }
        }
      } catch {
        // malformed JSON
      }
    }
  }
}
