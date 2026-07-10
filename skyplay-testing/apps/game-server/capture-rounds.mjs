// Auto-capture one full 64KB RAM snapshot per round of the current match.
// Tracks rounds by watching P1 get KO'd (hpP1 spikes high) then combat resuming.
// Saves /tmp/ram-round1.bin, round2.bin, ... Diff afterwards for the active-char signature.
import { createSocket } from "dgram";
import { writeFileSync } from "fs";
const HOST="127.0.0.1", PORT=55355;
const sock=createSocket("udp4"); let buf=""; const mem=new Map();
sock.on("message",(m)=>{buf+=m.toString();const ls=buf.split("\n");buf=ls.pop()||"";for(const l of ls){const p=l.trim().split(/\s+/);if(p[0]!=="READ_CORE_RAM")continue;const a=parseInt(p[1],16);const h=p.slice(2).join("");if(h==="-1")continue;for(let i=0;i<h.length/2;i++)mem.set(a+i,parseInt(h.substr(i*2,2),16));}});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
function read(a,c){return new Promise(res=>{sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${c}\n`),PORT,HOST);setTimeout(res,120);});}

async function snapshot(label){
  const CHUNK=64, END=0x10000; const data=new Map();
  const addrs=[]; for(let a=0;a<END;a+=CHUNK) addrs.push(a);
  const grab=(m)=>{const ls=(""+m).split("\n");for(const l of ls){const p=l.trim().split(/\s+/);if(p[0]!=="READ_CORE_RAM")continue;const a=parseInt(p[1],16);const h=p.slice(2).join("");if(h==="-1")continue;try{data.set(a,Buffer.from(h,"hex"));}catch{}}};
  const lst=(m)=>grab(m); sock.on("message",lst);
  for(let r=0;r<8;r++){const miss=addrs.filter(a=>!data.has(a));if(!miss.length)break;for(const a of miss)sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${CHUNK}\n`),PORT,HOST);await sleep(900);}
  sock.removeListener("message",lst);
  const bytes=Buffer.alloc(END);for(const [a,b] of data)b.copy(bytes,a);
  writeFileSync(`/tmp/ram-${label}.bin`,bytes);
  console.log(`  📸 saved /tmp/ram-${label}.bin (${(100*data.size/addrs.length).toFixed(0)}%)`);
}

(async()=>{
  const DUR=(parseInt(process.argv[2])||300)*1000; const t0=Date.now();
  let round=0, inCombat=false, capturedThisRound=false, p1WasLow=false;
  console.log("Capturing rounds... let P1 keep losing so its active char cycles 00→0a→14");
  while(Date.now()-t0<DUR){
    await read(0x8238,1); await read(0x8438,1); await read(0xA840,1);
    const flag=mem.get(0xa840)??0, hp1=mem.get(0x8238)??0, hp2=mem.get(0x8438)??0;
    const steady=(flag===0x40||flag===0x48)&&hp1>0&&hp1<=103&&hp2>0&&hp2<=103;
    if(steady && !inCombat){ // entered a new round of combat
      inCombat=true; capturedThisRound=false; round++;
      console.log(`\n[round ${round}] combat started (hpP1=${hp1} hpP2=${hp2}) — waiting to snapshot`);
    }
    if(steady && !capturedThisRound && hp1<=103){
      capturedThisRound=true;
      await snapshot(`round${round}`);
    }
    if(!steady && inCombat && (hp1>200||hp1===0||flag===0)) inCombat=false; // round ended
    await sleep(600);
  }
  console.log("\nDONE capturing");
  sock.close();
})();
