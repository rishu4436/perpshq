import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  root: 'apps/web',
  build: {
    // Small font subsets must remain same-origin files under font-src 'self'.
    assetsInlineLimit(filePath) {
      if (/\.(woff2?|ttf|otf)$/i.test(filePath)) return false;
    },
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['lightweight-charts'],
          react: ['react', 'react-dom', '@tanstack/react-query'],
        },
      },
    },
  },
  server: { host: '127.0.0.1' },
});
