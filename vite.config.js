import { defineConfig } from 'vite';
import {collectModelAssets,modelAssetPlugin} from './scripts/asset-cache.mjs';
import { siteEdition } from './shared/site-policy.js';
export default defineConfig(async ({command})=>{
  const edition=siteEdition(process.env.SITE_EDITION,process.env.BACKEND_ID||(command==='build'?'build':'local'));
  const models=command==='build'?await collectModelAssets(new URL('./public',import.meta.url)):[];
  return {
  plugins:[modelAssetPlugin(models)],
  define: {__SITE_EDITION__:JSON.stringify(edition),__MODEL_ASSET_URLS__:JSON.stringify(Object.fromEntries(models.map(e=>[e.logical,e.url])))},
  server: { host: '0.0.0.0', port: 5175, strictPort: true },
  build: { chunkSizeWarningLimit: 650, rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  };
});
