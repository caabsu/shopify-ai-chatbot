import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/contact-form.ts'),
      name: 'SupportContactForm',
      formats: ['iife'],
      fileName: () => 'contact-form.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: 'esbuild',
  },
});
