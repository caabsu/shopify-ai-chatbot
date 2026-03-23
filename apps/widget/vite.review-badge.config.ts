import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/review-badge.ts'),
      name: 'OutlightReviewBadge',
      formats: ['iife'],
      fileName: () => 'review-badge.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: 'esbuild',
  },
});
