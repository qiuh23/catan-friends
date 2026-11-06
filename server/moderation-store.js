import { readFile,writeFile,rename,mkdir,readdir } from 'node:fs/promises';
import path from 'node:path';
import { emptyModeration,pruneModeration } from '../shared/moderation.js';
export class ModerationStore {
  constructor(directory){this.directory=directory;this.cache=new Map();}
  async read(code) {
    if(this.cache.has(code))return this.cache.get(code);
    let state;
    try{state=JSON.parse(await readFile(path.join(this.directory,code+'.json'),'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;state=emptyModeration();}
    if(state.version!==1 || !Array.isArray(state.audit))throw Error('Invalid moderation record');
    this.cache.set(code,state);return state;
  }
  async write(code,state) {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const file=path.join(this.directory,code+'.json');
    await writeFile(file+'.tmp',JSON.stringify(state),{mode:0o600});await rename(file+'.tmp',file);
    this.cache.set(code,state);
  }
  async prune(code,now) {
    const before=await this.read(code),next=pruneModeration(structuredClone(before),now);
    if(before.audit.length!==next.audit.length)await this.write(code,next);
  }
  async codes() {
    try{return (await readdir(this.directory)).filter(name=>/^[A-HJ-NP-Z2-9]{6}\.json$/.test(name)).map(name=>name.slice(0,-5));}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
  }
}
