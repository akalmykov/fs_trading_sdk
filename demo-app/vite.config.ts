import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/fred': {
        target: 'https://fred.stlouisfed.org',
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/fred/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@functionspace/core': path.resolve(__dirname, '../packages/core/src'),
      '@functionspace/react': path.resolve(__dirname, '../packages/react/src'),
      '@functionspace/ui': path.resolve(__dirname, '../packages/ui/src'),
    },
  },
});
