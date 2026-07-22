/**
 * Cleanup obsolete escrow rooms via the admin REST API.
 *
 * Usage:
 *   npx tsx scripts/cleanup-escrow.ts [--dry-run]
 *
 * Authenticates via the admin login endpoint (POST /api/auth/login) with
 * a configured admin username/password, then lists open escrow rooms and
 * resolves each one with "refund_both".
 *
 * Prerequisites: Vercel dev server running (npm run dev) or
 * set BASE_URL to the production URL.
 *
 * Environment variables:
 *   ADMIN_USER     — admin username (default: "admin")
 *   ADMIN_PASS     — admin password (required)
 *   BASE_URL       — base URL of the server (default: http://localhost:3000)
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_USER = process.env.ADMIN_USER ?? "admin";
const ADMIN_PASS = process.env.ADMIN_PASS;
const DRY_RUN = process.argv.includes("--dry-run");

/** Login to the admin API and return the auth cookie string. */
async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS ?? "" }),
    redirect: "manual",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status}): ${body.slice(0, 300)}`);
  }
  // Extract the auth_token cookie from the Set-Cookie header.
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("No Set-Cookie header in login response");
  // Find the auth_token=... part (may be preceded by other cookies)
  const match = setCookie.match(/(auth_token=[^;]+)/);
  if (!match) throw new Error(`No auth_token cookie in: ${setCookie.slice(0, 100)}`);
  return match[1];
}

/** Fetch open escrow disputes. */
async function fetchDisputes(cookie: string): Promise<any[]> {
  const res = await fetch(`${BASE_URL}/api/admin/duel/disputes`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch disputes (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { disputes: any[] };
  return data.disputes;
}

/** Resolve a single escrow room by refunding both players. */
async function resolveRoom(cookie: string, sessionId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/admin/duel/dispute/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ sessionId, action: "refund_both" }),
  });
  const result = await res.json();
  if (res.ok) {
    console.log(`    ✅ Resolved: ${JSON.stringify(result)}`);
  } else {
    console.log(`    ❌ Failed (${res.status}): ${JSON.stringify(result)}`);
  }
}

async function main() {
  if (!ADMIN_PASS) {
    console.error("❌ Set ADMIN_PASS environment variable.");
    process.exit(1);
  }

  console.log(`🔗 Connecting to ${BASE_URL}...`);
  console.log(`👤 Authenticating as "${ADMIN_USER}"...`);
  const cookie = await login();
  console.log("✅ Authenticated.\n");

  // Fetch open disputes
  const disputes = await fetchDisputes(cookie);
  console.log(`📋 Open escrow rooms: ${disputes.length}`);

  if (disputes.length === 0) {
    console.log("✅ Nothing to clean up.");
    return;
  }

  for (const d of disputes) {
    console.log(`\n  Room: ${d.sessionId}`);
    console.log(`    P1=${d.player1Name ?? "?"}  P2=${d.player2Name ?? "?"}  |  ${d.amount ?? "?"} SKY`);

    if (DRY_RUN) {
      console.log("    ⏸️  [DRY RUN] Would refund both.");
    } else {
      await resolveRoom(cookie, d.sessionId);
    }
  }

  console.log(`\n${DRY_RUN ? "⏸️  [DRY RUN] " : ""}✅ Done — ${disputes.length} rooms processed.`);
}

main().catch((err) => {
  console.error("💥 Fatal:", err.message);
  process.exit(1);
});
