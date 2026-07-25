#!/usr/bin/env python3
"""
OpenCV template matching bridge for Node.js.

Protocol (binary, stdin/stdout):
  Node → Python:  [4 bytes: frame_len (uint32 LE)] [frame_len bytes: raw RGB24]
  Python → Node:  [4 bytes: json_len (uint32 LE)]  [json_len bytes: JSON]

JSON response:
  { "name": "FIGHT", "confidence": 0.85 }  — match found
  { "name": null, "confidence": 0 }         — no match
  { "error": "message" }                   — error

On startup, loads all PNG templates from /recordings/text-templates/.
Uses cv2.TM_CCOEFF_NORMED — invariant to global brightness.
"""

import sys
import os
import struct
import json
import numpy as np
import cv2

TEMPLATE_DIR = "/recordings/text-templates"
MIN_SCORE = 0.55  # NCC threshold (same as old minOverlap conceptually)

# ── Template loading ──────────────────────────────────────────────────

def load_templates():
    """Load all PNG templates from the templates directory."""
    templates = []
    if not os.path.isdir(TEMPLATE_DIR):
        print(f"[opencv-bridge] No template directory: {TEMPLATE_DIR}", file=sys.stderr)
        return templates

    for fname in sorted(os.listdir(TEMPLATE_DIR)):
        if not fname.lower().endswith(".png"):
            continue
        name = fname.replace(".png", "").replace("-", " ").upper()
        path = os.path.join(TEMPLATE_DIR, fname)
        img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            print(f"[opencv-bridge] Failed to load: {path}", file=sys.stderr)
            continue
        # Normalize template to zero mean, unit variance (required for CCOEFF_NORMED)
        img = img.astype(np.float32)
        img -= img.mean()
        std = img.std()
        if std > 0:
            img /= std
        templates.append((name, img))
        print(f"[opencv-bridge] Loaded \"{name}\": {img.shape[1]}x{img.shape[0]}", file=sys.stderr)

    print(f"[opencv-bridge] {len(templates)} templates loaded", file=sys.stderr)
    return templates


def match_frame(frame_rgb, w, h, templates):
    """Match all templates against the frame. Returns (name, best_score) or (None, 0)."""
    # Convert to grayscale
    frame = np.frombuffer(frame_rgb, dtype=np.uint8).reshape((h, w, 3))
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY).astype(np.float32)

    best_name = None
    best_score = 0

    for name, tmpl in templates:
        tw, th = tmpl.shape[1], tmpl.shape[0]
        if tw > w or th > h:
            continue

        # TM_CCOEFF_NORMED: score ∈ [-1, 1]
        result = cv2.matchTemplate(gray, tmpl, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, _ = cv2.minMaxLoc(result)

        if max_val > best_score:
            best_score = max_val
            best_name = name

    # NCC scores are in [-1, 1]; clamp to [0, 1]
    best_score = max(0.0, min(1.0, float(best_score)))

    if best_score >= MIN_SCORE:
        return best_name, best_score
    elif best_score > 0.25:
        print(f"[opencv-bridge] Near miss: \"{best_name}\" score={best_score:.3f}", file=sys.stderr)

    return None, 0.0


# ── Main loop ──────────────────────────────────────────────────────────

def main():
    print("[opencv-bridge] Starting...", file=sys.stderr)
    templates = load_templates()

    if not templates:
        print(json.dumps({"error": "No templates loaded"}), file=sys.stderr)
        sys.exit(1)

    # Signal readiness
    print("[opencv-bridge] Ready — waiting for frames on stdin", file=sys.stderr)
    sys.stderr.flush()

    while True:
        # Read 4-byte length prefix (little-endian uint32)
        header = sys.stdin.buffer.read(4)
        if len(header) < 4:
            break  # EOF — parent process closed stdin

        frame_len = struct.unpack("<I", header)[0]
        if frame_len == 0:
            # Keep-alive ping — respond with empty JSON
            response = json.dumps({"name": None, "confidence": 0})
            data = response.encode("utf-8")
            sys.stdout.buffer.write(struct.pack("<I", len(data)))
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
            continue

        # Read frame data
        frame_data = sys.stdin.buffer.read(frame_len)
        if len(frame_data) < frame_len:
            print(f"[opencv-bridge] Short read: {len(frame_data)} < {frame_len}", file=sys.stderr)
            break

        # Determine frame dimensions if first request includes them
        # Frame dimensions are sent as part of the protocol initially
        # For now, we expect 400x100 frames (matching SFA2 text crop)
        w, h = 400, 100
        expected = w * h * 3
        if frame_len == expected:
            pass
        elif frame_len == 400 * 100 * 3:
            w, h = 400, 100
        else:
            print(f"[opencv-bridge] Unexpected frame size: {frame_len} bytes", file=sys.stderr)
            continue

        name, score = match_frame(frame_data, w, h, templates)

        response = json.dumps({"name": name, "confidence": score})
        data = response.encode("utf-8")
        sys.stdout.buffer.write(struct.pack("<I", len(data)))
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()

    print("[opencv-bridge] Exiting", file=sys.stderr)


if __name__ == "__main__":
    main()
