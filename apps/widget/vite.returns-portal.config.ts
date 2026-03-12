import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/returns-portal.ts'),
      name: 'ReturnsPortal',
      formats: ['iife'],
      fileName: () => 'returns-portal.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: 'esbuild',
  },
});
