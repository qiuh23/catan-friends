// Run through HTTPS or a loopback SSH tunnel. Credentials never enter argv/URL.
import { randomUUID } from 'node:crypto';
const [target,code]=process.argv.slice(2);
let url;
try{url=new URL(target);}catch{throw Error('Provide an HTTPS origin and six-character room code.');}
if((url.protocol!=='https:' && !(url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname!=='/' || !/^[A-HJ-NP-Z2-9]{6}$/.test(code||''))throw Error('Use an HTTPS origin or a loopback SSH tunnel, followed by a room code.');
const secret=process.env.SECURITY_ADMIN_TOKEN;
if(typeof secret!=='string' || !/^[A-Za-z0-9_-]{32,256}$/.test(secret))throw Error('Set SECURITY_ADMIN_TOKEN in this protected process environment.');
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>8192)throw Error('Input too large.');}
let input;try{input=JSON.parse(raw);}catch{throw Error('Provide one JSON disposition on stdin.');}
input.id ||= randomUUID();
const response=await fetch(new URL(`/api/stationmaster/rooms/${code}`,url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify(input)});
if(!response.ok)throw Error(`Stationmaster request failed (HTTP ${response.status}).`);
console.log(JSON.stringify(await response.json(),null,2));
