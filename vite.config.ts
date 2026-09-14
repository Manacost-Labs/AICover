import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {visualizer} from 'rollup-plugin-visualizer';

export default defineConfig(({mode}) => {
  dotenvConfig({ path: process.env.COVER_IMAGE_ENV || '/etc/cover-image/cover-image.env' });
  const env = { ...loadEnv(mode, '.', ''), ...process.env };
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
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-motion': ['motion'],
            'vendor-genai': ['@google/genai'],
            'vendor-ui': ['lucide-react', 'idb-keyval'],
            'vendor-hs': ['deckstrings'],
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
