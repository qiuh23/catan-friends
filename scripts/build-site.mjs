import { spawnSync } from 'node:child_process';
import { siteEdition } from '../shared/site-policy.js';
const edition=siteEdition(process.argv[2]||process.env.SITE_EDITION,'build');
const env={...process.env,SITE_EDITION:edition};
for(const [script,args] of [['node_modules/vite/bin/vite.js',['build']],['scripts/build-info.mjs',[]]]){
  const result=spawnSync(process.execPath,[script,...args],{env,stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
