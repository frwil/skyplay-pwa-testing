// Live-watch the 4 mode candidates during combat. Records distinct values per player.
// True mode byte = STABLE the whole match AND matches the announced mode.
// Dynamic bytes (facing direction, gauge stock) will FLUCTUATE and get eliminated.
// argv[2] = seconds (default 25).
import { createSocket } from "dgram";
const HOST="127.0.0.1", PORT=55355;
const DUR=(parseInt(process.argv[2])||25)*1000;
const sock=createSocket("udp4"); const mem=new Map(); let buf="";
sock.on("message",(m)=>{buf+=m.toString();const L=buf.split("\n");buf=L.pop()||"";for(const l of L){const p=l.trim().split(/\s+/);if(p[0]!=="READ_CORE_RAM")continue;const a=parseInt(p[1],16);const h=p.slice(2).join("");if(h==="-1")continue;for(let i=0;i<h.length/2;i++)mem.set(a+i,parseInt(h.substr(i*2,2),16));}});
const cands=[0x821e,0x8255,0x82d4,0x824c];
const hist={}; for(const a of cands){hist[a]=new Set();hist[a+0x200]=new Set();}
let samples=0;
const iv=setInterval(()=>{
  // read two small chunks covering all candidates for P1 (0x8210-0x8260) and P2 (0x8410-0x8460)
  sock.send(Buffer.from("READ_CORE_RAM 8210 80\n"),PORT,HOST);
  sock.send(Buffer.from("READ_CORE_RAM 8410 80\n"),PORT,HOST);
  sock.send(Buffer.from("READ_CORE_RAM 82d0 10\n"),PORT,HOST);
  sock.send(Buffer.from("READ_CORE_RAM 84d0 10\n"),PORT,HOST);
  sock.send(Buffer.from("READ_CORE_RAM a840 1\n"),PORT,HOST);
  setTimeout(()=>{
    const flag=mem.get(0xa840);
    if(flag===0x40||flag===0x48){ // only sample in steady combat
      samples++;
      for(const a of cands){ if(mem.has(a))hist[a].add(mem.get(a)); if(mem.has(a+0x200))hist[a+0x200].add(mem.get(a+0x200)); }
    }
  },300);
},800);
setTimeout(()=>{
  clearInterval(iv);
  console.log(`\nSamples in combat: ${samples}`);
  for(const a of cands){
    const p1=[...hist[a]], p2=[...hist[a+0x200]];
    const fluct=p1.length>1||p2.length>1;
    console.log(`0x${a.toString(16)}: P1={${p1.join(",")}} P2={${p2.join(",")}} ${fluct?"⚠️ FLUCTUATES → not mode":"✅ STABLE → mode candidate"}`);
  }
  sock.close();
}, DUR);
console.log(`Watching mode candidates for ${DUR/1000}s — MOVE around (cross-up) and CHARGE your gauge...`);
