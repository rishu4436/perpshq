import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  root: 'apps/web',
  build: {
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
