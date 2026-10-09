/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // GD_WEB_PORT / GD_API_PORT let several checkouts run side by side.
  server: {
    port: Number(process.env.GD_WEB_PORT || 5173),
    strictPort: true,
    proxy: { '/api': `http://localhost:${process.env.GD_API_PORT || 8787}` },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
