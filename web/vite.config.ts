import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    // shared/ lives outside web/, so Vite needs permission to read it.
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:8787' },
  },
});
