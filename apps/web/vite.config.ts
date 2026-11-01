import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue(), react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src/engine/webgal', import.meta.url)) },
    dedupe: ['react', 'react-dom', 'pixi.js'],
  },
  define: { global: 'globalThis' },
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000',
      '/healthz': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000',
      '/readyz': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000',
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        legacy: fileURLToPath(new URL('./legacy.html', import.meta.url)),
        webgal: fileURLToPath(new URL('./webgal.html', import.meta.url)),
      },
    },
  },
});
