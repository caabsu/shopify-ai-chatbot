import { defineConfig, type Plugin } from 'vite';
import path from 'path';

/**
 * Shared widget build config (Stage 5 of the overhaul). Every widget bundle used
 * to copy this ~35-line CSS-inject plugin + identical build block; they now call
 * widgetLib() instead. Output is byte-identical to the old per-config builds.
 *
 * css-inject: fold the bundle's CSS into the JS so a storefront needs only one
 * <script> tag (no separate stylesheet link).
 */
export function cssInjectPlugin(styleAttr?: [name: string, value: string]): Plugin {
  // Optional attribute on the injected <style> (e.g. ['data-wbd-rv','1'] for the
  // Warm reviews widget's scoping). Built with single quotes to match the original
  // hand-written injections byte-for-byte. Values are fixed internal literals.
  const attrJs = styleAttr ? `s.setAttribute('${styleAttr[0]}','${styleAttr[1]}');` : '';
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
            const injection = `(function(){var s=document.createElement('style');${attrJs}s.textContent=${JSON.stringify(cssContent)};document.head.appendChild(s)})();`;
            chunk.code = injection + chunk.code;
            break;
          }
        }
      }
    },
  };
}

/**
 * Build one IIFE widget bundle with CSS inlined.
 * @param clearDist - true only for the FIRST bundle built per app (it wipes dist);
 *                    subsequent bundles must leave it false so they accumulate.
 */
export function widgetLib(opts: {
  entry: string;
  name: string;
  fileName: string;
  clearDist?: boolean;
  styleAttr?: [name: string, value: string];
}) {
  return defineConfig({
    build: {
      lib: {
        entry: path.resolve(__dirname, opts.entry),
        name: opts.name,
        formats: ['iife'],
        fileName: () => opts.fileName,
      },
      outDir: 'dist',
      emptyOutDir: opts.clearDist === true,
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
      minify: 'esbuild',
    },
    plugins: [cssInjectPlugin(opts.styleAttr)],
  });
}
