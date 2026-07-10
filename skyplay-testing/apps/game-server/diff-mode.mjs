// Find the ADVANCED/EXTRA mode byte per player.
// Match 1 ("p1extra"): P1=EXTRA  P2=ADVANCED.  Match 2 ("p1adv"): P1=ADVANCED  P2=EXTRA.
// So P1 byte: value X in snap p1extra → value Y in snap p1adv  (EXTRA→ADVANCED)
//    P2 byte: value Y in snap p1extra → value X in snap p1adv  (ADVANCED→EXTRA)
// with P2 = P1 + 0x200 (struct mirror). Unknown X and Y — search for all pairs.
import { readFileSync } from "fs";
const A = readFileSync("/tmp/ram-p1extra.bin"); // P1=EXTRA P2=ADV
const B = readFileSync("/tmp/ram-p1adv.bin");   // P1=ADV  P2=EXTRA

console.log("=== Mode-byte candidates: P1 mode byte + its P2 mirror (+0x200) swap values between the two snapshots ===");
// Look at the player struct region more precisely
const hits = [];
for (let a = 0x8200; a < 0x82F0; a++) {
  const p1A = A[a], p1B = B[a];
  const p2A = A[a + 0x200], p2B = B[a + 0x200];
  if (p1A === p2B && p1B === p2A && p1A !== p1B) {
    hits.push({ addr: a, p1A, p1B, p2A, p2B });
    console.log(`  0x${a.toString(16)}: P1 ${p1A}→${p1B}  P2(+0x200) ${p2A}→${p2B}  (EXTRA <-> ADV?)`);
  }
}
console.log(`\n(${hits.length} candidates)`);

if (hits.length === 0) {
  // Fallback: look for any byte in P1 that changed where its P2 mirror made the opposite change
  console.log("\nNo exact swap found. Trying softer constraint: P1 changed AND P2 changed oppositely, values are small (0-2 likely for mode flag)...");
  for (let a = 0x8200; a < 0x8300; a++) {
    const p1A = A[a], p1B = B[a];
    const p2A = A[a + 0x200], p2B = B[a + 0x200];
    if (p1A !== p1B && p2A !== p2B && p1A <= 2 && p1B <= 2 && p2A <= 2 && p2B <= 2 && p1A !== p2A && p1B === p2A && p2B === p1A) {
      console.log(`  0x${a.toString(16)}: P1 ${p1A}→${p1B}  P2(+0x200) ${p2A}→${p2B}`);
    }
  }
}

// Also show what the current 0x81F0/0x83F0 bytes look like
console.log(`\nCurrent (wrong) mode addresses: P1 81F0: ${A[0x81f0]}→${B[0x81f0]}  P2 83F0: ${A[0x83f0]}→${B[0x83f0]}`);
