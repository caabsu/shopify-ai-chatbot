import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import fs from 'fs';

// Plugin to inject CSS into the JS bundle so only one <script> tag is needed
function cssInjectPlugin(): Plugin {
  return {
    name: 'css-inject',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      let cssContent = '';
      const cssFiles: string[] = [];

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (fileName.endsWith('.css')) {
          cssContent += (chunk as { source: string }).source;
          cssFiles.push(fileName);
        }
      }

      // Remove CSS files from bundle
      for (const f of cssFiles) {
        delete bundle[f];
      }

      // Inject CSS into JS
      if (cssContent) {
        for (const [, chunk] of Object.entries(bundle)) {
          if (chunk.type === 'chunk' && chunk.isEntry) {
            const injection = `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(cssContent)};document.head.appendChild(s)})();`;
            chunk.code = injection + chunk.code;
            break;
          }
        }
      }
    },
  };
}

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/widget.ts'),
      name: 'ShopifyChatWidget',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
    outDir: 'dist',
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    minify: 'esbuild',
  },
  plugins: [cssInjectPlugin()],
});
