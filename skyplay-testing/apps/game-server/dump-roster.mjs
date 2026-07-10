// Targeted dump of the promising roster region 0xE9E0-0xEA90 with char names.
import { createSocket } from "dgram";
const HOST="127.0.0.1", PORT=55355;
const NAMES={0x00:"Kyo",0x01:"Beni",0x02:"Daimon",0x03:"Terry",0x04:"Andy",0x05:"Joe",0x06:"Ryo",0x07:"Robert",0x08:"Yuri",0x09:"Leona",0x0A:"Ralf",0x0B:"Clark",0x0C:"Athena",0x0D:"Kensou",0x0E:"Chin",0x0F:"Chizuru",0x10:"Mai",0x11:"King",0x12:"Kim",0x13:"Chang",0x14:"Choi",0x15:"Yashiro",0x16:"Shermie",0x17:"Chris",0x18:"Yamazaki",0x19:"BlueMary",0x1A:"Billy",0x1B:"Iori",0x1C:"Mature",0x1D:"Vice",0x1E:"Heidern",0x1F:"Takuma",0x20:"Saisyu",0x21:"HeavyD",0x22:"Lucky",0x23:"Brian",0x24:"Rugal",0x25:"Shingo"};
const REGIONS=[[0xE9E0,0xEA90],[0xE800,0xE8D0]];
const sock=createSocket("udp4");
const data=new Map(); let buf="";
sock.on("message",(m)=>{buf+=m.toString();const ls=buf.split("\n");buf=ls.pop()||"";for(const l of ls){if(!l.trim())continue;const p=l.trim().split(/\s+/);if(p[0]!=="READ_CORE_RAM")continue;const a=parseInt(p[1],16);const h=p.slice(2).join("");if(h==="-1")continue;try{data.set(a,Buffer.from(h,"hex"));}catch{}}});
setTimeout(()=>{
  for(const [s,e] of REGIONS){
    console.log(`\n--- 0x${s.toString(16)}-0x${e.toString(16)} ---`);
    const bytes=new Uint8Array(0x10000); const pres=new Uint8Array(0x10000);
    for(const [a,b] of data)for(let i=0;i<b.length;i++){bytes[a+i]=b[i];pres[a+i]=1;}
    for(let a=s;a<e;a+=16){
      let line=`0x${a.toString(16)}: `;
      for(let i=0;i<16;i++){const v=bytes[a+i];const nm=(pres[a+i]&&NAMES[v])?NAMES[v]:(pres[a+i]?"..":"??");line+=`${v.toString(16).padStart(2,"0")}(${nm}) `;}
      console.log(line);
    }
  }
  sock.close();
},2500);
for(const [s,e] of REGIONS)for(let a=s;a<e;a+=64)sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} 64\n`),PORT,HOST);
console.log("dumping...");
