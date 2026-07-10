// Triple-snapshot isolation of P1 team storage.
// A,B: P1 = Leona/Chang/Vice {09,13,1d}.  C: P1 = Kyo/Choi/Ralf {00,14,0a}.
// A real P1 slot holds a {09,13,1d} member in A AND B, then a {00,14,0a} member in C.
import { readFileSync } from "fs";
const NAMES={0x00:"Kyo",0x01:"Beni",0x02:"Daimon",0x03:"Terry",0x04:"Andy",0x05:"Joe",0x06:"Ryo",0x07:"Robert",0x08:"Yuri",0x09:"Leona",0x0A:"Ralf",0x0B:"Clark",0x0C:"Athena",0x0D:"Kensou",0x0E:"Chin",0x0F:"Chizuru",0x10:"Mai",0x11:"King",0x12:"Kim",0x13:"Chang",0x14:"Choi",0x15:"Yashiro",0x16:"Shermie",0x17:"Chris",0x18:"Yamazaki",0x19:"BlueMary",0x1A:"Billy",0x1B:"Iori",0x1C:"Mature",0x1D:"Vice",0x1E:"Heidern",0x1F:"Takuma",0x20:"Saisyu",0x21:"HeavyD",0x22:"Lucky",0x23:"Brian",0x24:"Rugal",0x25:"Shingo"};
const nm=(v)=>NAMES[v]!==undefined?NAMES[v]:`0x${v.toString(16)}`;
const A=readFileSync("/tmp/ram-matchA.bin");
const B=readFileSync("/tmp/ram-matchB.bin");
const C=readFileSync("/tmp/ram-matchC.bin");

const P1_AB=new Set([0x09,0x13,0x1d]); // Leona,Chang,Vice
const P1_C =new Set([0x00,0x14,0x0a]); // Kyo,Choi,Ralf

console.log("=== P1 slot candidates: A&B in {Leona,Chang,Vice} AND C in {Kyo,Choi,Ralf} ===");
const cands=[];
for(let a=0;a<A.length;a++){
  if(P1_AB.has(A[a]) && P1_AB.has(B[a]) && P1_C.has(C[a])) cands.push(a);
}
for(const a of cands){
  console.log(`  0x${a.toString(16)}: A=${nm(A[a])} B=${nm(B[a])} C=${nm(C[a])}`);
}
console.log(`  (${cands.length} candidates)`);

// Cluster candidates + show context across all 3
console.log("\n=== Context (A|B|C) around each candidate ===");
const shown=new Set();
for(const s of cands){
  const key=s>>3; if(shown.has(key))continue; shown.add(key);
  let line=`  @0x${s.toString(16)}: `;
  for(let a=s-3;a<=s+5;a++){
    line+=`${a.toString(16)}:${nm(A[a])}/${nm(B[a])}/${nm(C[a])} `;
  }
  console.log(line);
}

// Rare Choi(0x14) locations in C that were Leona/Chang/Vice in A&B → pinpoints a P1 slot
console.log("\n=== Choi(0x14) in C where A&B were a P1 char ===");
for(let a=0;a<C.length;a++){
  if(C[a]===0x14 && P1_AB.has(A[a]) && P1_AB.has(B[a]))
    console.log(`  0x${a.toString(16)}: A=${nm(A[a])} B=${nm(B[a])} C=Choi`);
}
