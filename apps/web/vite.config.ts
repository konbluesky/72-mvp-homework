import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000',
      '/healthz': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000',
      '/readyz': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000',
    },
  },
  build: { target: 'es2022' },
});
