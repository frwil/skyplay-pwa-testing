// Diff two RAM snapshots to isolate team storage.
// Finds addresses whose value went from a member of TEAM_A to a member of TEAM_B.
import { readFileSync } from "fs";
const NAMES={0x00:"Kyo",0x01:"Beni",0x02:"Daimon",0x03:"Terry",0x04:"Andy",0x05:"Joe",0x06:"Ryo",0x07:"Robert",0x08:"Yuri",0x09:"Leona",0x0A:"Ralf",0x0B:"Clark",0x0C:"Athena",0x0D:"Kensou",0x0E:"Chin",0x0F:"Chizuru",0x10:"Mai",0x11:"King",0x12:"Kim",0x13:"Chang",0x14:"Choi",0x15:"Yashiro",0x16:"Shermie",0x17:"Chris",0x18:"Yamazaki",0x19:"BlueMary",0x1A:"Billy",0x1B:"Iori",0x1C:"Mature",0x1D:"Vice",0x1E:"Heidern",0x1F:"Takuma",0x20:"Saisyu",0x21:"HeavyD",0x22:"Lucky",0x23:"Brian",0x24:"Rugal",0x25:"Shingo"};
const nm=(v)=>NAMES[v]!==undefined?NAMES[v]:`0x${v.toString(16)}`;

const A=readFileSync("/tmp/ram-matchA.bin");
const B=readFileSync("/tmp/ram-matchB.bin");

// P2 changed: A = Ralf/Leona/Clark, B = Kyo/Beni/Daimon
const TEAM_A=new Set([0x09,0x0a,0x0b]);
const TEAM_B=new Set([0x00,0x01,0x02]);

// 1. Addresses that transitioned from a TEAM_A member to a TEAM_B member
const hits=[];
for(let a=0;a<A.length;a++){
  if(TEAM_A.has(A[a]) && TEAM_B.has(B[a]) && A[a]!==B[a]) hits.push(a);
}
console.log(`=== Transitions {Leona/Ralf/Clark} -> {Kyo/Beni/Daimon} : ${hits.length} addresses ===`);
// group into clusters (consecutive or near-consecutive within 8 bytes)
let cluster=[];
const clusters=[];
for(const a of hits){
  if(cluster.length && a-cluster[cluster.length-1]>8){clusters.push(cluster);cluster=[];}
  cluster.push(a);
}
if(cluster.length)clusters.push(cluster);
for(const c of clusters){
  const s=c[0]-2, e=c[c.length-1]+3;
  let line=`  cluster @0x${c[0].toString(16)} (${c.length} hits): `;
  for(let a=s;a<e;a++){
    const mark=c.includes(a)?"*":" ";
    line+=`${a.toString(16)}:${mark}${nm(A[a])}->${nm(B[a])} | `;
  }
  console.log(line);
}

// 2. Also: any address where BOTH snapshots hold a valid char ID but value differs
//    (broader net; helps see the real team array even if my A/B sets are imperfect)
console.log(`\n=== All char-ID changes near 0xA800-0xA900 (live match region) ===`);
for(let a=0xA800;a<0xA900;a++){
  if(A[a]!==B[a] && A[a]<=0x25 && B[a]<=0x25){
    console.log(`  0x${a.toString(16)}: ${nm(A[a])} -> ${nm(B[a])}`);
  }
}

// 3. Contiguous 3-byte P2 team arrays: A holds {09,0a,0b} perm AND B holds {00,01,02} perm
console.log(`\n=== Contiguous 3-byte P2 arrays (A={Ralf,Leona,Clark} & B={Kyo,Beni,Daimon}) ===`);
const setEq=(arr,set)=>arr.length===set.size && arr.every(v=>set.has(v)) && new Set(arr).size===arr.length;
let found=0;
for(let a=0;a<A.length-2;a++){
  const aa=[A[a],A[a+1],A[a+2]], bb=[B[a],B[a+1],B[a+2]];
  if(setEq(aa,TEAM_A) && setEq(bb,TEAM_B)){
    console.log(`  @0x${a.toString(16)}: [${aa.map(nm)}] -> [${bb.map(nm)}]`);
    found++;
  }
}
if(!found)console.log("  none (team may use a stride != 1)");
