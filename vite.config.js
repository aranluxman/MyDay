import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA -> deploys to Cloudflare Pages (build: `npm run build`, output: `dist`).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Third-party code changes rarely: separate chunks download in
        // parallel and stay cached across app updates.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
