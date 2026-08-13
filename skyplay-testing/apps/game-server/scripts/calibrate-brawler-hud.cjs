/**
 * Brawler HUD calibration helper.
 *
 * Captures a full 1152×672 game-frame screenshot from the running Docker
 * container and saves it locally for manual HUD coordinate identification.
 *
 * Usage:
 *   1. Start a dino brawler game in the browser (play a bit so health bars are visible).
 *   2. Run:  node scripts/calibrate-brawler-hud.cjs
 *   3. Open the saved PNG and identify the health bar + lives icon ROIs.
 *   4. Update BRAWLER_PIXEL_CONFIGS["dino.zip"] in src/game-config.ts.
 */

const { execSync } = require("child_process");
const { existsSync, mkdirSync } = require("fs");
const path = require("path");

const CONTAINER = process.env.CONTAINER || "game-server-game-server-1";
const OUT_DIR = path.resolve(__dirname, "..");
const OUT_FILE = path.join(OUT_DIR, "brawler-calib.png");

// Ensure output directory exists
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

console.log("📸 Capturing brawler HUD from Docker container...");
console.log(`   Container: ${CONTAINER}`);

try {
  // Capture just the game window (1152×672 at 0,0 on Xvfb :99)
  execSync(
    `docker exec ${CONTAINER} sh -c "DISPLAY=:99 import -window root -crop 1152x672+0+0 /tmp/brawler-calib.png"`,
    { stdio: "inherit", timeout: 10000 }
  );
  console.log("   ✅ Screenshot captured inside container.");

  // Copy to host
  execSync(`docker cp ${CONTAINER}:/tmp/brawler-calib.png "${OUT_FILE}"`, {
    stdio: "inherit",
    timeout: 10000,
  });
  console.log(`   ✅ Saved to: ${OUT_FILE}`);
} catch (err) {
  console.error("❌ Failed to capture screenshot:", err.message);
  console.error("   Is the container running? Is a brawler game active?");
  process.exit(1);
}

console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Open the image and identify these HUD elements:");
console.log("");
console.log("  HEALTH BARS (at 3× upscale = 1152×672):");
console.log("    p1Bar: { x, y, w, h } — P1 health bar rectangle");
console.log("    p2Bar: { x, y, w, h } — P2 health bar rectangle");
console.log("");
console.log("  LIVES ICONS (beside each health bar):");
console.log("    p1Lives: { x, y, w, h } — P1 lives icon row");
console.log("    p2Lives: { x, y, w, h } — P2 lives icon row");
console.log("");
console.log("  FILL DIRECTION:");
console.log("    fillFrom.p1: 'left' or 'right' — which end the bar fills from");
console.log("    fillFrom.p2: 'left' or 'right'");
console.log("    (The bar shrinks TOWARD the fill-from end as health depletes)");
console.log("");
console.log("  Update BRAWLER_PIXEL_CONFIGS['dino.zip'] in");
console.log("  src/game-config.ts with the measured values.");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");
console.log("💡 Tip: Use an image editor that shows pixel coordinates");
console.log("   (GIMP, VS Code with image preview, or browser DevTools).");
console.log("   The top-left of the image is (0, 0).");
