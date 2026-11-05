import { defineConfig } from 'vite';
export default defineConfig({
  server: { host: '0.0.0.0', port: 5175, strictPort: true },
  build: { chunkSizeWarningLimit: 650, rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
