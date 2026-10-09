/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
