// batch-collect.mjs — Run N SFA2 matches with retroarch kills between, collecting portrait samples
// Usage: node batch-collect.mjs [count] [--kill-every N]
import { execSync, spawn } from "child_process";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOTAL = parseInt(process.argv.find(a => /^\d+$/.test(a)) || "9");
const KILL_EVERY = parseInt(process.argv.find((a,i) => process.argv[i-1] === "--kill-every") || "2");

const SAMPLES_PATH = join(__dirname, "recordings", "calibration", "portrait-samples.json");
const CONTAINER = "game-server-game-server-1";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function killRetroarch() {
  try {
    execSync(`docker exec ${CONTAINER} sh -c "pkill -9 retroarch 2>/dev/null; echo killed"`, { stdio: "pipe" });
    console.log("  🔪 retroarch killed");
  } catch (e) {}
}

function sampleCount() {
  if (!existsSync(SAMPLES_PATH)) return 0;
  const data = JSON.parse(readFileSync(SAMPLES_PATH, "utf-8"));
  return data.samples?.length || 0;
}

function runMatch(matchNum) {
  return new Promise((resolve) => {
    const child = spawn("node", ["test-match.mjs"], {
      cwd: __dirname,
      stdio: "inherit",
      timeout: 300000,
    });
    const start = Date.now();
    child.on("close", (code) => {
      const elapsed = Math.round((Date.now() - start) / 1000);
      resolve({ matchNum, code, elapsed });
    });
    child.on("error", (err) => {
      resolve({ matchNum, code: -1, elapsed: 0, error: err.message });
    });
  });
}

async function main() {
  console.log(`=== Batch Portrait Collection ===`);
  console.log(`Target: ${TOTAL} matches, killing retroarch every ${KILL_EVERY}`);
  console.log(`Samples before: ${sampleCount()}\n`);

  let successes = 0;

  for (let i = 1; i <= TOTAL; i++) {
    const before = sampleCount();
    console.log(`\n=== Batch match ${i}/${TOTAL} (samples: ${before}) ===`);

    // Kill retroarch every N matches to keep display clean
    if ((i - 1) % KILL_EVERY === 0 && i > 1) {
      killRetroarch();
      await sleep(5000);
    }

    const result = await runMatch(i);
    const after = sampleCount();
    const gained = after - before;

    if (result.code === 0 && gained > 0) {
      console.log(`  ✅ Match ${i} done in ${result.elapsed}s — +${gained} samples (total: ${after})`);
      successes++;
    } else {
      console.log(`  ⚠️  Match ${i}: exit=${result.code}, gained=${gained}, samples=${after}`);
      killRetroarch();
      await sleep(5000);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Successes: ${successes}/${TOTAL}`);
  console.log(`Final samples: ${sampleCount()}`);

  // Check threshold
  if (existsSync(SAMPLES_PATH)) {
    const data = JSON.parse(readFileSync(SAMPLES_PATH, "utf-8"));
    const perChar = {};
    for (const s of data.samples) perChar[s.charName] = (perChar[s.charName] || 0) + 1;
    const minSamples = Math.min(...Object.values(perChar));
    console.log(`Min samples/char: ${minSamples}/10`);
    if (minSamples >= 10) {
      console.log(`✅ Consensus templates will auto-generate next match!`);
      console.log(`   Run one more match to trigger: node test-match.mjs`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
