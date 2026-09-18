import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

const port = Number(process.env.PORT ?? 5173);
const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: false,
    host: '0.0.0.0',
  },
  preview: {
    port,
    host: '0.0.0.0',
  },
  test: {
    // The legacy schema script is a standalone console runner with no test
    // suites; keep `npm run test` focused on real suites.
    exclude: [
      'src/schemas/glimmr.schema.test.ts',
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
});
