// Locate the ACTIVE-fighter byte per player + selection-order array.
// Reads player-struct regions + roster, prints every address holding a team-member ID.
// Run across KOs: the active-char byte flips to the next member when the current fighter is KO'd.
// argv[2] = label. Team IDs below must match the CURRENT match.
import { createSocket } from "dgram";
const HOST="127.0.0.1", PORT=55355;
const NAMES={0x00:"Kyo",0x01:"Beni",0x02:"Daimon",0x03:"Terry",0x04:"Andy",0x05:"Joe",0x06:"Ryo",0x07:"Robert",0x08:"Yuri",0x09:"Leona",0x0A:"Ralf",0x0B:"Clark",0x0C:"Athena",0x0D:"Kensou",0x0E:"Chin",0x0F:"Chizuru",0x10:"Mai",0x11:"King",0x12:"Kim",0x13:"Chang",0x14:"Choi",0x15:"Yashiro",0x16:"Shermie",0x17:"Chris",0x18:"Yamazaki",0x19:"BlueMary",0x1A:"Billy",0x1B:"Iori",0x1C:"Mature",0x1D:"Vice",0x1E:"Heidern",0x1F:"Takuma",0x20:"Saisyu",0x21:"HeavyD",0x22:"Lucky",0x23:"Brian",0x24:"Rugal",0x25:"Shingo"};
const nm=(v)=>NAMES[v]!==undefined?NAMES[v]:`0x${v.toString(16)}`;
const LABEL=process.argv[2]||"scan";
// CURRENT match teams (edit per match). Rare IDs = strong signal.
const P1=new Set([0x0a,0x00,0x14]);       // Ralf, Kyo, Choi
const P2=new Set([0x08,0x12,0x13]);       // Yuri, Kim, Chang
const P1R=new Set([0x0a,0x14]);           // Ralf, Choi (rare)
const P2R=new Set([0x08,0x12,0x13]);      // Yuri, Kim, Chang (all rare)

const sock=createSocket("udp4");
const mem=new Map(); let buf="";
sock.on("message",(msg)=>{
  buf+=msg.toString(); const lines=buf.split("\n"); buf=lines.pop()||"";
  for(const line of lines){
    const p=line.trim().split(/\s+/);
    if(p.length<3||p[0]!=="READ_CORE_RAM")continue;
    const addr=parseInt(p[1],16); const hex=p.slice(2).join("");
    if(hex==="-1")continue;
    for(let i=0;i<hex.length/2;i++){const b=parseInt(hex.substr(i*2,2),16); if(!Number.isNaN(b))mem.set(addr+i,b);}
  }
});
const regions=[[0x8200,0x100],[0x8400,0x100],[0xA750,0x40],[0xA840,0x40]];
for(const [a,c] of regions) sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${c}\n`),PORT,HOST);

setTimeout(()=>{
  const ctx=(a)=>{let s="";for(let x=a-1;x<=a+2;x++)s+=`${x.toString(16)}:${nm(mem.get(x)??0)} `;return s.trim();};
  const rep=(name,lo,hi,set)=>{
    console.log(`\n[${LABEL}] ${name} 0x${lo.toString(16)}-0x${hi.toString(16)} matching {${[...set].map(nm).join(",")}}:`);
    let n=0;
    for(let a=lo;a<hi;a++){ if(mem.has(a)&&set.has(mem.get(a))){console.log(`  0x${a.toString(16)} = ${nm(mem.get(a))}   [${ctx(a)}]`);n++;} }
    if(!n)console.log("  (none)");
  };
  console.log(`\n######## ${LABEL} ########`);
  rep("P1 struct",0x8200,0x8300,P1R);
  rep("P2 struct",0x8400,0x8500,P2R);
  rep("A750 region P1",0xA750,0xA790,P1R);
  rep("A750 region P2",0xA750,0xA790,P2R);
  rep("roster P1",0xA840,0xA880,P1);
  rep("roster P2",0xA840,0xA880,P2);
  // Named candidates + the locked slots
  const cands=[0x823f,0x8241,0x8243,0x8245,0x8247,0x843f,0x8441,0x8443,0x8445,0x8447,0xa84e,0xa84f,0xa850,0xa851,0xa85e,0xa85f,0xa860,0xa861];
  console.log(`\n[${LABEL}] named candidates:`);
  for(const a of cands) console.log(`  0x${a.toString(16)} = ${nm(mem.get(a)??0)}`);
  // matchFlag + health context
  console.log(`\n[${LABEL}] state: A840=0x${(mem.get(0xa840)??0).toString(16)} health P1(8238)=${mem.get(0x8238)} P2(8438)=${mem.get(0x8438)}`);
  sock.close();
},1200);
console.log(`Scanning [${LABEL}]...`);
