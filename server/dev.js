import { createServer } from './index.js';
const app=await createServer({development:true,port:5175});
console.log(`卡坦岛好友桌 http://localhost:${app.port}`);
const stop=async()=>{await app.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
