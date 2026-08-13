// discover-dino-v2.cjs — CPS1 RAM discovery for Cadillacs and Dinosaurs
// Improved methodology:
//   1. 16-bit word-aligned scanning (M68000 big-endian)
//   2. BCD-aware value comparison
//   3. Idle stability blacklist (10s in-game, no input)
//   4. Strict event-correlated delta validation
//   5. WRITE_CORE_RAM final confirmation
//
// Usage:
//   node discover-dino-v2.cjs <phase> [duration_sec]
//
// Phases:
//   idle    — 10s idle in-game, blacklist fluctuating addresses
//   combat  — play normally for N seconds, track changes
//   death   — deliberately die N times, track -1 decrements
//   write   — write-test a single candidate address
//   full     — run all phases sequentially (default)

const dgram = require('dgram');
const readline = require('readline');

// ── Configuration ──────────────────────────────────────────────────────────
const RA_HOST = '127.0.0.1';
const RA_PORT = 55355;
const CHUNK_SIZE = 256; // bytes per READ_CORE_RAM chunk
const POLL_INTERVAL = 300; // ms between polls
const WORK_RAM_SIZE = 0x10000; // 64KB CPS1 work RAM

// CPS1 work RAM mapped by FBNeo at 0x000000-0x00FFFF
const RAM_START = 0x0000;
const RAM_END = 0xFFFF;

// ── UDP helpers ────────────────────────────────────────────────────────────

function readRam(addr, size) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
    let buf = '';
    const t = setTimeout(() => { try { sock.close(); } catch {} resolve(null); }, 2000);
    sock.on('message', (m) => {
      buf += m.toString();
      const parts = buf.trim().split(/\s+/);
      if ((parts[0] === 'READ_CORE_RAM' || parts[0] === 'READ_CORE_MEMORY') &&
          parseInt(parts[1], 16) === addr) {
        clearTimeout(t);
        try { sock.close(); } catch {}
        resolve(parts.slice(2).join(''));
      }
    });
    sock.send(cmd, RA_PORT, RA_HOST);
  });
}

function writeRam(addr, value) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const cmd = Buffer.from(`WRITE_CORE_RAM ${addr.toString(16)} ${value.toString(16)}\n`);
    let buf = '';
    const t = setTimeout(() => { try { sock.close(); } catch {} resolve(false); }, 2000);
    sock.on('message', (m) => {
      buf += m.toString();
      if (buf.includes('WRITE_CORE_RAM')) {
        clearTimeout(t);
        try { sock.close(); } catch {}
        resolve(true);
      }
    });
    sock.send(cmd, RA_PORT, RA_HOST);
  });
}

// Parse hex string into array of 16-bit BE values.
// CPS1 M68000 is big-endian — each word = [high_byte, low_byte].
// FBNeo returns LE bytes from READ_CORE_RAM: byte at addr N is hex_chars[2N..2N+2].
// A 16-bit value at addr N is: (byte[N] as low) | (byte[N+1] << 8) in LE interpretation.
// Wait — actually FBNeo returns raw bytes in address order. The 68000 stores
// big-endian, so a 16-bit value at 0x100 = [0x100:high, 0x101:low].
// READ_CORE_RAM returns bytes in address order: [addr+0, addr+1, addr+2, ...].
// So to read a 16-bit BE value at addr: val = (byte[addr] << 8) | byte[addr+1].
function hexToWords(hexStr) {
  const words = [];
  for (let i = 0; i < hexStr.length - 2; i += 4) {
    const hi = parseInt(hexStr.substring(i, i + 2), 16);     // byte at addr+i/2
    const lo = parseInt(hexStr.substring(i + 2, i + 4), 16); // byte at addr+i/2+1
    words.push((hi << 8) | lo); // M68000 big-endian
  }
  return words;
}

// BCD helpers: CPS1 often stores values as Binary Coded Decimal.
// 99 health = 0x99 (not 0x63).
function isBcd(b) { return (b >> 4) <= 9 && (b & 0xF) <= 9; }
function bcdToDec(b) { return ((b >> 4) * 10) + (b & 0xF); }
function decToBcd(d) { return (((d / 10) | 0) << 4) | (d % 10); }

// Parse a 16-bit word as a CPS1 value — try multiple interpretations:
//   raw:  raw 16-bit integer
//   lo:   low byte only (common for 1-byte values)
//   hi:   high byte only
//   bcd8: low byte as 8-bit BCD (e.g. 0x99 = 99)
//   bcd16hi: high byte BCD * 100 + low byte BCD (for scores > 99)
function interpretWord(w) {
  const lo = w & 0xFF;
  const hi = (w >> 8) & 0xFF;
  return {
    raw: w,
    lo,
    hi,
    bcd8: isBcd(lo) ? bcdToDec(lo) : -1,
    bcd16: (isBcd(hi) && isBcd(lo)) ? bcdToDec(hi) * 100 + bcdToDec(lo) : -1,
  };
}

// ── Full scan (read entire 64KB, track changes) ───────────────────────────

async function fullScan(durationMs, label) {
  console.log(`\n🔍 Full scan: ${label} (${durationMs / 1000}s)`);
  console.log(`   Scanning ${RAM_START.toString(16)}-${RAM_END.toString(16)} in ${CHUNK_SIZE}B chunks`);

  const chunkCount = Math.ceil(WORK_RAM_SIZE / CHUNK_SIZE);
  const snapshots = []; // each snapshot is { addr, words[] } for all chunks
  const start = Date.now();

  // Read all chunks once to establish baseline
  console.log('   Reading baseline...');
  const baseline = [];
  for (let chunk = 0; chunk < chunkCount; chunk++) {
    const addr = RAM_START + chunk * CHUNK_SIZE;
    const size = Math.min(CHUNK_SIZE, RAM_END - addr + 1);
    const hex = await readRam(addr, size);
    if (hex) {
      const words = hexToWords(hex);
      baseline.push({ addr, words });
    }
    if (chunk % 32 === 0) {
      process.stdout.write(`\r   Baseline: ${chunk}/${chunkCount} chunks`);
    }
  }
  console.log(`\r   Baseline: ${baseline.length} chunks read`);

  // Take differential snapshots at intervals
  const intervalMs = Math.max(POLL_INTERVAL, Math.floor(durationMs / 10));
  let snapCount = 0;
  while (Date.now() - start < durationMs) {
    snapCount++;
    const snapshot = [];
    for (const { addr } of baseline) {
      const size = Math.min(CHUNK_SIZE, RAM_END - addr + 1);
      const hex = await readRam(addr, size);
      if (hex) {
        snapshot.push({ addr, words: hexToWords(hex) });
      }
    }
    snapshots.push(snapshot);
    process.stdout.write(`\r   Snapshot ${snapCount}...`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  console.log(`\r   ${snapCount} snapshots taken`);

  return { baseline, snapshots };
}

// ── Targeted monitoring (fast poll of specific addresses) ──────────────────

async function monitorAddresses(addrs, durationMs, label) {
  console.log(`\n👁️  Monitoring ${addrs.length} addresses: ${label} (${durationMs / 1000}s)`);

  const history = {}; // addr -> array of values over time
  for (const a of addrs) history[a] = [];

  const start = Date.now();
  while (Date.now() - start < durationMs) {
    for (const addr of addrs) {
      const hex = await readRam(addr, 2); // read 2 bytes (1 word)
      if (hex && hex.length >= 4) {
        const hi = parseInt(hex.substring(0, 2), 16);
        const lo = parseInt(hex.substring(2, 4), 16);
        const word = (hi << 8) | lo; // big-endian
        history[addr].push(word);
      } else {
        history[addr].push(null);
      }
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  // Compute stats for each address
  const stats = {};
  for (const addr of addrs) {
    const vals = history[addr].filter(v => v !== null);
    if (vals.length === 0) { stats[addr] = { stable: false, reason: 'no data' }; continue; }
    const unique = new Set(vals);
    const changes = [];
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[i - 1]) changes.push({ from: vals[i - 1], to: vals[i] });
    }
    stats[addr] = {
      stable: unique.size === 1,
      uniqueValues: unique.size,
      values: [...unique].slice(0, 10),
      changeCount: changes.length,
      changes: changes.slice(0, 20),
      firstVal: vals[0],
      lastVal: vals[vals.length - 1],
    };
  }

  return { history, stats };
}

// ── Stability analysis ─────────────────────────────────────────────────────

function analyzeStability(baseline, snapshots) {
  console.log('\n📊 Stability analysis...');

  const wordAddrs = []; // word-aligned addresses (0,2,4,...)
  const fluctuations = {}; // addr -> { changeCount, valuesSeen }

  for (let addr = RAM_START; addr <= RAM_END; addr += 2) {
    fluctuations[addr] = { changeCount: 0, values: new Set() };
  }

  // Track baseline values
  for (const chunk of baseline) {
    for (let wi = 0; wi < chunk.words.length; wi++) {
      const addr = chunk.addr + wi * 2;
      if (addr <= RAM_END) {
        fluctuations[addr]?.values.add(chunk.words[wi]);
      }
    }
  }

  // Track changes across snapshots
  for (const snap of snapshots) {
    for (const chunk of snap) {
      for (let wi = 0; wi < chunk.words.length; wi++) {
        const addr = chunk.addr + wi * 2;
        if (addr <= RAM_END && fluctuations[addr]) {
          const prevSize = fluctuations[addr].values.size;
          fluctuations[addr].values.add(chunk.words[wi]);
          if (fluctuations[addr].values.size > prevSize) {
            fluctuations[addr].changeCount++;
          }
        }
      }
    }
  }

  return fluctuations;
}

// ── Find candidates ────────────────────────────────────────────────────────

function findCandidates(fluctuations, stableAddrs, options = {}) {
  const { maxChanges = 0, valueRange = [0, 200], addrRange = [0, 0xFFFF] } = options;

  console.log(`\n🎯 Finding candidates: maxChanges=${maxChanges}, valueRange=[${valueRange[0]},${valueRange[1]}], addrRange=[0x${addrRange[0].toString(16)},0x${addrRange[1].toString(16)}]`);

  const candidates = [];

  for (let addr = addrRange[0]; addr <= addrRange[1]; addr += 2) {
    const f = fluctuations[addr];
    if (!f) continue;

    // Stability check: no changes during the monitoring period
    if (f.changeCount > maxChanges) continue;

    // Value range check: values should be in a reasonable range for health/lives
    const vals = [...f.values];
    const allInRange = vals.every(v => v >= valueRange[0] && v <= valueRange[1]);
    if (!allInRange) continue;

    // Skip if this address is in the blacklist (fluctuates during idle)
    if (stableAddrs && !stableAddrs.has(addr)) continue;

    // Interpret values
    const interpretations = vals.map(v => interpretWord(v));

    candidates.push({
      addr,
      addrHex: '0x' + addr.toString(16).padStart(4, '0'),
      values: vals.slice(0, 10),
      bcd8: interpretations.map(i => i.bcd8).filter(v => v >= 0),
      bcd16: interpretations.map(i => i.bcd16).filter(v => v >= 0),
      loVals: interpretations.map(i => i.lo),
    });
  }

  return candidates;
}

// ── WRITE_CORE_RAM verification ────────────────────────────────────────────

async function verifyByWrite(addr, testValue) {
  console.log(`\n✏️  WRITE verification: address 0x${addr.toString(16)}, test value ${testValue}`);

  // Read current value
  const before = await readRam(addr, 2);
  if (!before) { console.log('   ❌ Read failed'); return false; }
  const beforeWord = (parseInt(before.substring(0, 2), 16) << 8) | parseInt(before.substring(2, 4), 16);
  console.log(`   Before: 0x${beforeWord.toString(16)} (${beforeWord})`);

  // Write test value
  const ok = await writeRam(addr, testValue);
  if (!ok) { console.log('   ❌ Write failed'); return false; }

  // Wait a frame
  await new Promise(r => setTimeout(r, 100));

  // Read back
  const after = await readRam(addr, 2);
  if (!after) { console.log('   ❌ Read-back failed'); return false; }
  const afterWord = (parseInt(after.substring(0, 2), 16) << 8) | parseInt(after.substring(2, 4), 16);
  console.log(`   After:  0x${afterWord.toString(16)} (${afterWord})`);

  // Restore original
  await writeRam(addr, beforeWord);
  console.log(`   Restored: 0x${beforeWord.toString(16)}`);

  return afterWord === testValue;
}

// ── Phases ─────────────────────────────────────────────────────────────────

async function phaseIdle(durationSec = 10) {
  console.log('\n' + '='.repeat(70));
  console.log('PHASE 1: IDLE STABILITY TEST');
  console.log('='.repeat(70));
  console.log('⚠️  Start a game, then STAND STILL for the duration.');
  console.log('   Do NOT move, attack, or take damage.');
  console.log('   Any address that changes during this phase is NOT health/lives/score.');

  // Wait for user to ready up
  await waitForEnter('Press ENTER when you are IN-GAME and STANDING STILL...');

  const { baseline, snapshots } = await fullScan(durationSec * 1000, 'idle');
  const fluctu = analyzeStability(baseline, snapshots);

  // Build blacklist of fluctuating addresses (any change during idle)
  const blacklist = new Set();
  const stableSet = new Set();
  for (let addr = RAM_START; addr <= RAM_END; addr += 2) {
    const f = fluctu[addr];
    if (f && f.changeCount === 0) {
      stableSet.add(addr);
    } else if (f && f.changeCount > 0) {
      blacklist.add(addr);
    }
  }

  console.log(`\n📋 Results:`);
  console.log(`   Stable addresses (no change):  ${stableSet.size}`);
  console.log(`   Blacklisted (fluctuating):     ${blacklist.size}`);

  return { blacklist, stableSet, fluctu };
}

async function phaseCombat(stableSet, durationSec = 60) {
  console.log('\n' + '='.repeat(70));
  console.log('PHASE 2: COMBAT MONITORING');
  console.log('='.repeat(70));
  console.log('⚠️  Play normally for the duration. Take damage, kill enemies.');
  console.log('   We track ONLY addresses that were stable during idle.');

  await waitForEnter('Press ENTER when ready to fight...');

  const { baseline, snapshots } = await fullScan(durationSec * 1000, 'combat');
  const fluctu = analyzeStability(baseline, snapshots);

  // Candidate categories
  const healthCandidates = []; // decreases gradually, BCD-encoded, 0-144 range
  const livesCandidates = [];  // decrements by exactly 1, values 0-9
  const scoreCandidates = [];  // only increases, large range

  for (let addr = RAM_START; addr <= RAM_END; addr += 2) {
    // Only consider addresses that were stable during idle
    if (stableSet && !stableSet.has(addr)) continue;

    const f = fluctu[addr];
    if (!f || f.values.size < 2) continue; // no changes during combat = not interesting

    const vals = [...f.values];
    const loVals = vals.map(v => v & 0xFF);

    // Health candidate: low byte varies, BCD-encoded, in 0-144 range
    const allBcd = loVals.every(v => isBcd(v));
    const inHealthRange = loVals.every(v => v <= 0x90); // max health 144 = 0x90
    if (allBcd && inHealthRange && vals.length >= 3) {
      const decoded = loVals.map(v => bcdToDec(v));
      const maxVal = Math.max(...decoded);
      if (maxVal >= 40 && maxVal <= 144) {
        healthCandidates.push({
          addr,
          addrHex: '0x' + addr.toString(16).padStart(4, '0'),
          bcdValues: decoded,
          rawValues: vals.slice(0, 10),
          changes: f.changeCount,
        });
      }
    }

    // Lives candidate: low byte 0-9, small value set
    const loUnique = [...new Set(loVals)];
    if (loUnique.every(v => v <= 9) && loUnique.length >= 2 && loUnique.length <= 5) {
      livesCandidates.push({
        addr,
        addrHex: '0x' + addr.toString(16).padStart(4, '0'),
        values: loUnique,
        rawWords: vals.slice(0, 10),
        changes: f.changeCount,
      });
    }

    // Score candidate: value increases monotonically
    let increasing = true;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] < vals[i - 1]) { increasing = false; break; }
    }
    if (increasing && vals.length >= 3 && vals[vals.length - 1] > vals[0]) {
      scoreCandidates.push({
        addr,
        addrHex: '0x' + addr.toString(16).padStart(4, '0'),
        firstVal: vals[0],
        lastVal: vals[vals.length - 1],
        rawValues: vals.slice(0, 10),
      });
    }
  }

  console.log(`\n📋 Combat Candidates:`);
  console.log(`   Health-like:   ${healthCandidates.length} (BCD, 40-144 range)`);
  console.log(`   Lives-like:    ${livesCandidates.length} (0-9 range, few values)`);
  console.log(`   Score-like:    ${scoreCandidates.length} (monotonically increasing)`);

  if (healthCandidates.length > 0) {
    console.log(`\n🏥 Top health candidates:`);
    healthCandidates.slice(0, 15).forEach(c => {
      console.log(`   ${c.addrHex}: BCD=${c.bcdValues.join('→')} (raw=${c.rawValues.map(v=>'0x'+v.toString(16)).join(',')}) changes=${c.changes}`);
    });
  }

  if (livesCandidates.length > 0) {
    console.log(`\n💚 Top lives candidates:`);
    livesCandidates.slice(0, 15).forEach(c => {
      console.log(`   ${c.addrHex}: values=${c.values.join(',')} raw=${c.rawWords.map(v=>'0x'+v.toString(16)).join(',')} changes=${c.changes}`);
    });
  }

  if (scoreCandidates.length > 0) {
    console.log(`\n🏆 Top score candidates:`);
    scoreCandidates.slice(0, 10).forEach(c => {
      console.log(`   ${c.addrHex}: ${c.firstVal}→${c.lastVal} (${c.rawValues.length} samples)`);
    });
  }

  return { healthCandidates, livesCandidates, scoreCandidates };
}

async function phaseDeath(targetedAddrs, deathCount = 2) {
  console.log('\n' + '='.repeat(70));
  console.log('PHASE 3: DEATH VALIDATION');
  console.log('='.repeat(70));
  console.log(`⚠️  You will die ${deathCount} times. We monitor ONLY candidate addresses.`);
  console.log('   A valid lives counter must decrement by exactly 1 on each death.');
  console.log('   A valid health counter must drop >20 points on significant damage.');

  if (targetedAddrs.length === 0) {
    console.log('   No candidates from Phase 2 — nothing to validate.');
    return [];
  }

  await waitForEnter('Press ENTER when ready to die...');

  // Monitor candidates at high frequency
  const history = {};
  for (const a of targetedAddrs) history[a] = [];

  // Run for up to 3 minutes or until user stops
  const durationMs = 180000;
  const start = Date.now();

  console.log('   Monitoring... (Ctrl+C to stop early)');
  let pollCount = 0;
  while (Date.now() - start < durationMs) {
    pollCount++;
    for (const addr of targetedAddrs) {
      const hex = await readRam(addr, 2);
      if (hex && hex.length >= 4) {
        const hi = parseInt(hex.substring(0, 2), 16);
        const lo = parseInt(hex.substring(2, 4), 16);
        const word = (hi << 8) | lo;
        history[addr].push({ time: Date.now() - start, word, lo, hi });
      }
    }
    if (pollCount % 20 === 0) {
      // Print live status of candidates
      const status = targetedAddrs.map(addr => {
        const last = history[addr]?.[history[addr].length - 1];
        if (!last) return `${addr.toString(16)}=?`;
        const bcd = isBcd(last.lo) ? bcdToDec(last.lo) : '?';
        return `${addr.toString(16)}=${last.lo}/${bcd}`;
      }).join(' ');
      process.stdout.write(`\r   [${Math.floor((Date.now()-start)/1000)}s] ${status}    `);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  console.log('');

  // Analyze for death patterns: values that decrement by exactly 1
  const validated = [];
  for (const addr of targetedAddrs) {
    const events = history[addr];
    if (!events || events.length < 10) continue;

    // Find decrement-by-exactly-1 events
    const decrements = [];
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];
      if (prev.word === null || curr.word === null) continue;

      // Check low byte decrement (most common for 1-byte lives)
      if (prev.lo === curr.lo + 1 && prev.lo > 0) {
        decrements.push({
          time: (curr.time / 1000).toFixed(1),
          from: prev.lo,
          to: curr.lo,
          fromWord: prev.word,
          toWord: curr.word,
        });
      }
      // Check full word decrement (for 16-bit lives/hp)
      if (prev.word === curr.word + 1 && prev.word > 0 && prev.word !== prev.lo) {
        decrements.push({
          time: (curr.time / 1000).toFixed(1),
          from: prev.word,
          to: curr.word,
          type: '16-bit',
        });
      }
    }

    if (decrements.length > 0) {
      validated.push({
        addr,
        addrHex: '0x' + addr.toString(16).padStart(4, '0'),
        decrements,
        totalPolls: events.length,
        finalValue: events[events.length - 1]?.lo ?? -1,
      });
    }
  }

  console.log(`\n📋 Death Validation Results:`);
  console.log(`   Addresses with -1 decrements: ${validated.length}`);

  validated.forEach(v => {
    console.log(`\n   ${v.addrHex} (${v.totalPolls} polls, final=${v.finalValue}):`);
    v.decrements.forEach(d => {
      console.log(`     t=${d.time}s: ${d.from}→${d.to} (word: 0x${d.fromWord?.toString(16)}→0x${d.toWord?.toString(16)})`);
    });
  });

  return validated;
}

async function phaseWrite(candidates) {
  console.log('\n' + '='.repeat(70));
  console.log('PHASE 4: WRITE VERIFICATION');
  console.log('='.repeat(70));
  console.log('⚠️  We will WRITE test values to candidate addresses.');
  console.log('   If the on-screen display changes → CONFIRMED.');
  console.log('   Original values are restored immediately.');

  if (candidates.length === 0) {
    console.log('   No candidates to verify.');
    return [];
  }

  // Filter to most promising (top 10 by decrement count)
  const top10 = candidates
    .filter(c => c.decrements.length >= 1)
    .slice(0, 10);

  if (top10.length === 0) {
    console.log('   No candidates with decrements to test.');
    return [];
  }

  const confirmed = [];
  for (const c of top10) {
    console.log(`\n   Testing ${c.addrHex} (${c.decrements.length} decrements detected)...`);
    const testVal = c.finalValue > 0 ? c.finalValue + 3 : 5; // set to current+3 or just 5
    const ok = await verifyByWrite(c.addr, testVal);
    if (ok) {
      console.log(`   ✅ ${c.addrHex} CONFIRMED — write succeeded!`);
      confirmed.push(c);
    }

    // Ask user if they saw the change
    const answer = await askQuestion(`   Did the on-screen value change? (y/n/skip): `);
    if (answer.toLowerCase() === 'y') {
      console.log(`   🎉 VISUALLY CONFIRMED!`);
      confirmed.push({ ...c, visualConfirmed: true });
    }
  }

  return confirmed;
}

// ── UI helpers ─────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function askQuestion(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

function waitForEnter(msg) {
  return new Promise(resolve => {
    console.log(`\n${msg}`);
    rl.question('', () => resolve());
  });
}

// ── Main ───────────────────────────────────────────────────────────────────

(async () => {
  const phase = process.argv[2] || 'full';
  const duration = parseInt(process.argv[3]) || 60;

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   Cadillacs & Dinosaurs — CPS1 RAM Discovery v2                 ║');
  console.log('║   M68000 big-endian | BCD-aware | Idle-stability-filtered       ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`\nPhase: ${phase} | Duration: ${duration}s per scan`);

  let stableSet = null;
  let blacklist = null;
  let healthCands = [];
  let livesCands = [];
  let scoreCands = [];
  let validatedDeaths = [];
  let confirmed = [];

  if (phase === 'idle' || phase === 'full') {
    const result = await phaseIdle(phase === 'idle' ? duration : 10);
    stableSet = result.stableSet;
    blacklist = result.blacklist;
  }

  if (phase === 'combat' || phase === 'full') {
    const result = await phaseCombat(stableSet, phase === 'combat' ? duration : 60);
    healthCands = result.healthCandidates;
    livesCands = result.livesCandidates;
    scoreCands = result.scoreCandidates;
  }

  if (phase === 'death' || phase === 'full') {
    // Combine health + lives candidates for targeted monitoring
    const addrs = [
      ...healthCands.map(c => c.addr),
      ...livesCands.map(c => c.addr),
    ];
    // Deduplicate
    const uniqueAddrs = [...new Set(addrs)];
    validatedDeaths = await phaseDeath(uniqueAddrs, 2);
  }

  if (phase === 'write' || phase === 'full') {
    confirmed = await phaseWrite(validatedDeaths);
  }

  // ── Final report ──
  console.log('\n' + '='.repeat(70));
  console.log('FINAL REPORT');
  console.log('='.repeat(70));

  if (confirmed.length > 0) {
    console.log(`\n🎉 CONFIRMED ADDRESSES (${confirmed.length}):`);
    confirmed.forEach(c => {
      console.log(`   ${c.addrHex} — ${c.visualConfirmed ? 'VISUALLY CONFIRMED' : 'write OK'}`);
    });
  } else if (validatedDeaths.length > 0) {
    console.log(`\n📋 Death-validated (needs write confirmation):`);
    validatedDeaths.forEach(v => {
      console.log(`   ${v.addrHex}: ${v.decrements.length} decrements, final=${v.finalValue}`);
    });
  } else {
    console.log(`\n❌ No addresses validated.`);
    console.log(`   Health candidates: ${healthCands.length}`);
    console.log(`   Lives candidates:  ${livesCands.length}`);
    console.log(`   Score candidates:  ${scoreCands.length}`);
    console.log(`\n   Try running individual phases with longer durations:`);
    console.log(`     node discover-dino-v2.cjs idle 30`);
    console.log(`     node discover-dino-v2.cjs combat 120`);
    console.log(`     node discover-dino-v2.cjs death 120`);
  }

  rl.close();
  process.exit(0);
})();
