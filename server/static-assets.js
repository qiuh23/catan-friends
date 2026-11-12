import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2','.glb':'model/gltf-binary'};
const revalidate='public, max-age=0, must-revalidate';
export async function staticAssets(directory){
  const root=path.resolve(directory);let manifest={files:{},models:{}};
  try{manifest=JSON.parse(await readFile(path.join(root,'asset-cache-manifest.json'),'utf8'));if(manifest.schema!==1||!manifest.files||!manifest.models)throw Error('Invalid asset cache manifest.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  return async function serve(req,res,url){
    const error=status=>{res.writeHead(status,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?'':status===404?'Not found':'Request rejected');};
    if(!['GET','HEAD'].includes(req.method))return error(405);
    let relative;try{relative=decodeURIComponent(url.pathname);}catch{return error(400);}
    let file=path.resolve(root,`.${relative}`);
    if(!file.startsWith(root+path.sep)&&file!==root)return error(403);
    if(relative==='/_headers'||relative==='/_redirects')return error(404);
    const redirect=manifest.models[relative];
    if(redirect){res.writeHead(302,{'Location':redirect,'Cache-Control':revalidate});return res.end();}
    if(relative==='/'||!path.extname(relative)&&!relative.startsWith('/assets/'))file=path.join(root,'index.html');
    let data;try{data=await readFile(file);}catch{return error(404);}
    const etag=`"${createHash('sha256').update(data).digest('hex')}"`;
    // Manifest membership plus exact byte identity: never grant immutable caching
    // to a mutable fixed path, unknown asset or a mismatched/partial deployment.
    const immutable=manifest.files[relative]?.etag===etag;
    const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':data.byteLength,'ETag':etag,'Cache-Control':immutable?'public, max-age=31536000, immutable':revalidate,'X-Content-Type-Options':'nosniff'};
    const matches=(req.headers['if-none-match']||'').split(',').map(x=>x.trim().replace(/^W\//,''));
    if(matches.includes(etag)||matches.includes('*')){delete headers['Content-Length'];res.writeHead(304,headers);return res.end();}
    res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:data);
  };
}
