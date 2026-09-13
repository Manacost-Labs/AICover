import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {visualizer} from 'rollup-plugin-visualizer';

export default defineConfig(({mode}) => {
  const analyze = mode === 'analyze';

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(analyze
        ? [
            visualizer({
              filename: 'dist/stats.html',
              gzipSize: true,
              brotliSize: true,
              template: 'treemap',
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const moduleId = id.replaceAll('\\', '/');
            if (moduleId.includes('/node_modules/react/') ||
                moduleId.includes('/node_modules/react-dom/') ||
                moduleId.includes('/node_modules/scheduler/')) {
              return 'vendor-react';
            }
            if (moduleId.includes('/node_modules/motion/') ||
                moduleId.includes('/node_modules/motion-dom/') ||
                moduleId.includes('/node_modules/motion-utils/') ||
                moduleId.includes('/node_modules/framer-motion/')) {
              return 'vendor-motion';
            }
            if (moduleId.includes('/node_modules/@google/genai/')) return 'vendor-genai';
            if (moduleId.includes('/node_modules/lucide-react/') ||
                moduleId.includes('/node_modules/idb-keyval/')) {
              return 'vendor-ui';
            }
            if (moduleId.includes('/node_modules/deckstrings/')) return 'vendor-hs';
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
