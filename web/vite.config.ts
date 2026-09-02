import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  /* The app is served from a folder on the domain rather than from its root,
     so every generated URL needs that prefix. */
  base: '/brick-like-this-online/',
  plugins: [react()],
  build: {
    /* Nested so the folder layout on disk matches the URL exactly: a request
       for /brick-like-this-online/assets/x.js is then answered straight off
       disk by any static host, with no rewriting and no Worker script. It also
       leaves the domain's root empty, which is the point — the game is one
       thing living at one path, not the whole site. */
    outDir: 'dist/brick-like-this-online',
  },
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
