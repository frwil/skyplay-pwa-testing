// Find the ACTIVE-fighter byte by matching the per-round active-char sequence.
// P1 loses rounds so its active char cycles through its picks in ORDER.
// Pass expected sequences as args, e.g.:  node diff-active.mjs 00,0a,14  13,13,13
// argv[2]=P1 seq (hex ids per round), argv[3]=P2 seq. Reads /tmp/ram-round1..N.bin.
import { readFileSync, existsSync } from "fs";
const NAMES={0x00:"Kyo",0x01:"Beni",0x02:"Daimon",0x03:"Terry",0x04:"Andy",0x05:"Joe",0x06:"Ryo",0x07:"Robert",0x08:"Yuri",0x09:"Leona",0x0A:"Ralf",0x0B:"Clark",0x0C:"Athena",0x0D:"Kensou",0x0E:"Chin",0x0F:"Chizuru",0x10:"Mai",0x11:"King",0x12:"Kim",0x13:"Chang",0x14:"Choi",0x15:"Yashiro",0x16:"Shermie",0x17:"Chris",0x18:"Yamazaki",0x19:"BlueMary",0x1A:"Billy",0x1B:"Iori",0x1C:"Mature",0x1D:"Vice",0x1E:"Heidern",0x1F:"Takuma",0x20:"Saisyu",0x21:"HeavyD",0x22:"Lucky",0x23:"Brian",0x24:"Rugal",0x25:"Shingo"};
const nm=(v)=>NAMES[v]!==undefined?NAMES[v]:`0x${v.toString(16)}`;
const parseSeq=(s)=>s.split(",").map(x=>parseInt(x,16));
const p1seq=parseSeq(process.argv[2]||"00,0a,14");
const p2seq=parseSeq(process.argv[3]||"13,13,13");

const snaps=[];
for(let i=1;i<=8;i++){const p=`/tmp/ram-round${i}.bin`; if(existsSync(p)) snaps.push(readFileSync(p)); }
console.log(`Loaded ${snaps.length} round snapshots.`);
const N=Math.min(snaps.length,p1seq.length);

const findSeq=(label,seq)=>{
  console.log(`\n=== ${label}: address matching per-round sequence [${seq.slice(0,N).map(nm).join(" -> ")}] over ${N} rounds ===`);
  const hits=[];
  for(let a=0;a<0x10000;a++){
    let ok=true;
    for(let r=0;r<N;r++){ if(snaps[r][a]!==seq[r]){ok=false;break;} }
    if(ok) hits.push(a);
  }
  // prefer ones where the sequence actually varies (not all identical) unless seq is constant
  const varies=new Set(seq.slice(0,N)).size>1;
  for(const a of hits){
    let ctx=snaps.map((s,i)=>`R${i+1}:${nm(s[a])}`).join(" ");
    console.log(`  0x${a.toString(16)} : ${ctx}`);
  }
  console.log(`  (${hits.length} exact matches${varies?"":" — NOTE: constant sequence, many false positives expected"})`);
  return hits;
};
findSeq("P1 active", p1seq);
findSeq("P2 active", p2seq);
