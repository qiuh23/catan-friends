import { defineConfig } from 'vite';
import { siteEdition } from './shared/site-policy.js';
export default defineConfig(({command})=>{
  const edition=siteEdition(process.env.SITE_EDITION,process.env.BACKEND_ID||(command==='build'?'build':'local'));
  return {
  define: {__SITE_EDITION__:JSON.stringify(edition)},
  server: { host: '0.0.0.0', port: 5175, strictPort: true },
  build: { chunkSizeWarningLimit: 650, rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  };
});
