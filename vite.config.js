import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA -> deploys to Cloudflare Pages (build: `npm run build`, output: `dist`).
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
});
