import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { setRoomCode, generateRoomCode } from "./room-codes";

/**
 * POST /api/cloud-session
 *
 * Creates a cloud gaming session by provisioning a Docker container
 * on Northflank (production) or returning a local WebSocket URL (dev).
 *
 * Body: { system: "neogeo" | "ps1", rom: string }
 * Returns: { sessionId: string, wsUrl: string, roomCode: string }
 */
export async function POST(req: NextRequest) {
  try {
    // ── Auth check (skipped in local dev without Northflank) ─
    const isLocalDev = !process.env.NORTHFLANK_API_KEY;
    const wsHost = process.env.WS_HOST || 'localhost:8080';
    if (!isLocalDev) {
      const token = (await cookies()).get("auth_token")?.value;
      if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      try {
        const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret");
        await jwtVerify(token, secret);
      } catch {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
    }

    // ── Parse request ───────────────────────────────────────
    const body = await req.json() as { system: string; rom: string; mode?: "cpu" | "pvp" };
    const { system, rom, mode = "cpu" } = body;

    if (!system || !rom) {
      return NextResponse.json({ error: "Missing system or rom" }, { status: 400 });
    }

    if (system !== "neogeo" && system !== "ps1" && system !== "snes" && system !== "cps1") {
      return NextResponse.json({ error: `System '${system}' is not cloud-enabled` }, { status: 400 });
    }

    // ── Validate ROM exists ─────────────────────────────────
    const romFilename = rom.split("/").pop();
    if (!romFilename) {
      return NextResponse.json({ error: "Invalid ROM path" }, { status: 400 });
    }

    // ── Session ID ──────────────────────────────────────────
    const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // ── Determine WebSocket URL ─────────────────────────────
    let wsUrl: string;
    console.log(process.env.GAME_SERVER_PUBLIC_URL);

    if (process.env.NORTHFLANK_API_KEY && process.env.NORTHFLANK_GAME_SERVICE_ID) {
      // ── Production: provision container on Northflank ────
      wsUrl = await provisionNorthflank(sessionId, system, romFilename);
    } else if (process.env.GAME_SERVER_PUBLIC_URL) {
      // ── Public tunnel (ngrok, localtunnel, cloudflared) ──
      // Strip BOM, newlines, and surrounding whitespace that may
      // sneak in via CLI piping on Windows.
      const base = process.env.GAME_SERVER_PUBLIC_URL
        .replace(/^﻿/, "")
        .replace(/[\r\n]+/g, "")
        .trim();
      wsUrl = `${base}?sessionId=${sessionId}`;
    } else {
      // ── Development: connect to local Docker ─────────────
      const localHost = process.env.GAME_SERVER_HOST || "localhost";
      const localPort = process.env.GAME_SERVER_PORT || "8080";
      wsUrl = `ws://${localHost}:${localPort}?sessionId=${sessionId}`;
    }

    // ── Get user ID from auth cookie ─────────────────────────
    let sessionUserId: string | undefined;
    try {
      const token = (await cookies()).get("auth_token")?.value;
      if (token) {
        const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret");
        const { payload } = await jwtVerify(token, secret);
        sessionUserId = String(payload.userId ?? "");
      }
    } catch { /* non-fatal */ }

    // ── Room code for P2 join ──
    const roomCode = generateRoomCode();
    await setRoomCode(roomCode, sessionId, sessionUserId);

    return NextResponse.json({ sessionId, wsUrl, roomCode });
  } catch (err) {
    console.error("[cloud-session] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Provision a container on Northflank and return the WebSocket URL.
 *
 * Uses the Northflank REST API to:
 * 1. Deploy a new instance of the game-server service
 * 2. Wait for it to be healthy
 * 3. Return the public WebSocket URL
 *
 * Reference: https://northflank.com/docs/api
 */
async function provisionNorthflank(
  sessionId: string,
  system: string,
  rom: string,
): Promise<string> {
  const apiKey = process.env.NORTHFLANK_API_KEY!;
  const projectId = process.env.NORTHFLANK_PROJECT_ID!;
  const serviceId = process.env.NORTHFLANK_GAME_SERVICE_ID!;
  const sessionToken = process.env.SESSION_TOKEN_SECRET || "dev-secret";

  const baseUrl = `https://api.northflank.com/v1/projects/${projectId}/services/${serviceId}`;

  // Deploy a new instance with session-specific env vars
  const deployRes = await fetch(`${baseUrl}/deployments`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      env: {
        SESSION_ID: sessionId,
        SESSION_TOKEN: sessionToken,
        SYSTEM: system,
        ROM_FILE: rom,
      },
    }),
  });

  if (!deployRes.ok) {
    const err = await deployRes.json().catch(() => ({}));
    throw new Error(`Northflank deployment failed: ${(err as { message?: string }).message || deployRes.statusText}`);
  }

  const deploy = await deployRes.json() as {
    deployment: { id: string; status: string; domain?: string };
  };

  if (!deploy.deployment?.id) {
    throw new Error("Northflank returned no deployment ID");
  }

  // Poll for deployment readiness
  const deploymentId = deploy.deployment.id;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const statusRes = await fetch(`${baseUrl}/deployments/${deploymentId}`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });

    if (!statusRes.ok) continue;

    const status = await statusRes.json() as {
      deployment: { status: string; domain?: string };
    };

    if (status.deployment?.status === "running" && status.deployment?.domain) {
      return `wss://${status.deployment.domain}:8080?sessionId=${sessionId}`;
    }

    if (status.deployment?.status === "failed") {
      throw new Error("Northflank deployment failed");
    }
  }

  throw new Error("Northflank deployment timed out");
}
