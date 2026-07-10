// Find P1 team storage: P1 = Leona/Chang/Vice was IDENTICAL in both snapshots.
// Real team storage holds {09,13,1d} at the SAME address in A and B (stable across frames).
// Coincidental noise bytes won't match the same rare value in two independent-time captures.
import { readFileSync } from "fs";
const NAMES={0x00:"Kyo",0x01:"Beni",0x02:"Daimon",0x03:"Terry",0x04:"Andy",0x05:"Joe",0x06:"Ryo",0x07:"Robert",0x08:"Yuri",0x09:"Leona",0x0A:"Ralf",0x0B:"Clark",0x0C:"Athena",0x0D:"Kensou",0x0E:"Chin",0x0F:"Chizuru",0x10:"Mai",0x11:"King",0x12:"Kim",0x13:"Chang",0x14:"Choi",0x15:"Yashiro",0x16:"Shermie",0x17:"Chris",0x18:"Yamazaki",0x19:"BlueMary",0x1A:"Billy",0x1B:"Iori",0x1C:"Mature",0x1D:"Vice",0x1E:"Heidern",0x1F:"Takuma",0x20:"Saisyu",0x21:"HeavyD",0x22:"Lucky",0x23:"Brian",0x24:"Rugal",0x25:"Shingo"};
const nm=(v)=>NAMES[v]!==undefined?NAMES[v]:`0x${v.toString(16)}`;
const A=readFileSync("/tmp/ram-matchA.bin");
const B=readFileSync("/tmp/ram-matchB.bin");

const P1=new Set([0x09,0x13,0x1d]); // Leona, Chang, Vice

// 1. Stable rare-ID locations (A==B) for Chang(13) and Vice(1d)
console.log("=== Stable (A==B) locations of rare P1 IDs ===");
for(const id of [0x13,0x1d,0x09]){
  const locs=[];
  for(let a=0;a<A.length;a++) if(A[a]===id && B[a]===id) locs.push(a);
  console.log(`  ${nm(id)} (0x${id.toString(16)}): ${locs.map(a=>"0x"+a.toString(16)).join(" ")||"none"}`);
}

// 2. Contiguous triplet with stride 1/2/4 that = {09,13,1d} in BOTH A and B
const setEq=(arr)=>arr.length===3 && new Set(arr).size===3 && arr.every(v=>P1.has(v));
console.log("\n=== Contiguous/strided triplets = {Leona,Chang,Vice} in BOTH A and B ===");
let found=0;
for(const stride of [1,2,4]){
  for(let a=0;a<A.length-2*stride;a++){
    const aa=[A[a],A[a+stride],A[a+2*stride]];
    const bb=[B[a],B[a+stride],B[a+2*stride]];
    if(setEq(aa) && setEq(bb)){
      console.log(`  stride ${stride} @0x${a.toString(16)}: A=[${aa.map(nm)}] B=[${bb.map(nm)}]`);
      found++;
    }
  }
}
if(!found)console.log("  none");

// 3. Show A/B side-by-side around each stable Chang/Vice location for manual layout read
console.log("\n=== Context around stable rare-ID hits ===");
const seeds=[];
for(let a=0;a<A.length;a++) if((A[a]===0x13&&B[a]===0x13)||(A[a]===0x1d&&B[a]===0x1d)) seeds.push(a);
const shown=new Set();
for(const s of seeds){
  const base=s-4;
  if(shown.has(base>>2))continue; shown.add(base>>2);
  let line=`  @0x${s.toString(16)}: `;
  for(let a=s-4;a<=s+4;a++){
    const eq=A[a]===B[a]?"=":"≠";
    line+=`${a.toString(16)}:${nm(A[a])}${eq}${nm(B[a])} `;
  }
  console.log(line);
}
