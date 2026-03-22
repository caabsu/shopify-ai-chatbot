import { defineConfig, Plugin } from 'vite';
import path from 'path';

function cssInjectPlugin(): Plugin {
  let cssContent = '';
  return {
    name: 'css-inject',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const key of Object.keys(bundle)) {
        if (key.endsWith('.css')) {
          const chunk = bundle[key];
          if (chunk.type === 'asset' && typeof chunk.source === 'string') {
            cssContent = chunk.source;
            delete bundle[key];
          }
        }
      }
    },
    renderChunk(code) {
      if (cssContent) {
        const escaped = cssContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
        const injection = `(function(){var s=document.createElement('style');s.id='orw-styles';s.textContent=\`${escaped}\`;document.head.appendChild(s);})();`;
        return injection + code;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [cssInjectPlugin()],
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
});
