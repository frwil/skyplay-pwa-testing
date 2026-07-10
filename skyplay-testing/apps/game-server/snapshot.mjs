// Full 64KB work-RAM snapshot with retransmission → saves raw bin to /tmp for later diffing.
import { createSocket } from "dgram";
import { writeFileSync } from "fs";

const HOST="127.0.0.1", PORT=55355;
const label = process.argv[2] || "snap";
const CHUNK=64, START=0, END=0x10000;
const addrs=[]; for(let a=START;a<END;a+=CHUNK) addrs.push(a);
const sock=createSocket("udp4");
const data=new Map(); let buf="";
sock.on("message",(m)=>{buf+=m.toString();const ls=buf.split("\n");buf=ls.pop()||"";for(const l of ls){if(!l.trim())continue;const p=l.trim().split(/\s+/);if(p[0]!=="READ_CORE_RAM")continue;const a=parseInt(p[1],16);const h=p.slice(2).join("");if(h==="-1")continue;try{data.set(a,Buffer.from(h,"hex"));}catch{}}});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  for(let round=0;round<8;round++){
    const missing=addrs.filter(a=>!data.has(a));
    if(!missing.length) break;
    for(const a of missing) sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${CHUNK}\n`),PORT,HOST);
    await sleep(1200);
    console.log(`round ${round+1}: ${data.size}/${addrs.length}`);
  }
  const bytes=Buffer.alloc(END);
  for(const [a,b] of data) b.copy(bytes,a);
  const path=`/tmp/ram-${label}.bin`;
  writeFileSync(path,bytes);
  console.log(`saved ${path} (${data.size}/${addrs.length} chunks = ${(100*data.size/addrs.length).toFixed(1)}%)`);
  sock.close();
})();
