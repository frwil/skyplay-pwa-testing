// Watch for the ACTIVE-fighter byte. Polls player structs + roster every ~700ms and prints,
// only when something changes, which addresses hold a current-team char ID.
// The active-char address is the one that flips to the next team member on each KO.
// Runs until argv[2] seconds elapse (default 240). Edit team sets per match.
import { createSocket } from "dgram";
const HOST="127.0.0.1", PORT=55355;
const NAMES={0x00:"Kyo",0x01:"Beni",0x02:"Daimon",0x03:"Terry",0x04:"Andy",0x05:"Joe",0x06:"Ryo",0x07:"Robert",0x08:"Yuri",0x09:"Leona",0x0A:"Ralf",0x0B:"Clark",0x0C:"Athena",0x0D:"Kensou",0x0E:"Chin",0x0F:"Chizuru",0x10:"Mai",0x11:"King",0x12:"Kim",0x13:"Chang",0x14:"Choi",0x15:"Yashiro",0x16:"Shermie",0x17:"Chris",0x18:"Yamazaki",0x19:"BlueMary",0x1A:"Billy",0x1B:"Iori",0x1C:"Mature",0x1D:"Vice",0x1E:"Heidern",0x1F:"Takuma",0x20:"Saisyu",0x21:"HeavyD",0x22:"Lucky",0x23:"Brian",0x24:"Rugal",0x25:"Shingo"};
const nm=(v)=>NAMES[v]!==undefined?NAMES[v]:`0x${v.toString(16)}`;
const DUR=(parseInt(process.argv[2])||240)*1000;
// CURRENT match teams (rare IDs are the reliable signal).
const P1=new Set([0x0a,0x14]);            // Ralf, Choi (Kyo=0x00 excluded: too common)
const P2=new Set([0x15,0x16,0x17]);       // Yashiro, Shermie, Chris (all rare — primary signal)

const sock=createSocket("udp4"); let buf=""; const mem=new Map();
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
// Track, per player, the set of "hit" addresses (addr holding a team ID) and their values.
let lastP1="", lastP2="", lastState="", t=0;
const snap=(lo,hi,set)=>{
  const hits=[];
  for(let a=lo;a<hi;a++){ if(mem.has(a)&&set.has(mem.get(a))) hits.push(`${a.toString(16)}=${nm(mem.get(a))}`); }
  return hits.join(" ");
};
function poll(){
  for(const [a,c] of [[0x8200,0x100],[0x8400,0x100],[0xA840,0x40]])
    sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${c}\n`),PORT,HOST);
  setTimeout(()=>{
    const flag=(mem.get(0xa840)??0), hp1=mem.get(0x8238)??0, hp2=mem.get(0x8438)??0;
    const state=`flag=0x${flag.toString(16)} hpP1=${hp1} hpP2=${hp2}`;
    const p1=snap(0x8200,0x8300,P1), p2=snap(0x8400,0x8500,P2);
    if(p1!==lastP1||p2!==lastP2||state!==lastState){
      console.log(`[t+${(t/1000).toFixed(1)}s] ${state}`);
      if(p1!==lastP1) console.log(`   P1 struct hits: ${p1||"(none)"}`);
      if(p2!==lastP2) console.log(`   P2 struct hits: ${p2||"(none)"}`);
      lastP1=p1; lastP2=p2; lastState=state;
    }
  },250);
}
console.log(`Watching active-char for ${DUR/1000}s...  P1={Ralf,Choi} P2={Yuri,Kim,Chang}`);
const iv=setInterval(()=>{t+=700; poll(); if(t>=DUR){clearInterval(iv); setTimeout(()=>{console.log("DONE");sock.close();},500);}},700);
poll();
