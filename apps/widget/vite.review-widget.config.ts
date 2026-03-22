import { defineConfig, type Plugin } from 'vite';
import path from 'path';

// Same CSS injection pattern as the working chat widget (vite.config.ts)
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

      for (const f of cssFiles) {
        delete bundle[f];
      }

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
      entry: path.resolve(__dirname, 'src/review-widget.ts'),
      name: 'OutlightReviewWidget',
      formats: ['iife'],
      fileName: () => 'review-widget.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
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
