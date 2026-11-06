import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:4000';

// The proxy makes the browser see ONE origin in dev, exactly like production (ADR-007),
// so cookies and the WebSocket work without CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,          // fixed, non-default port so it never clashes with other Vite apps
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/socket.io': { target: API, ws: true, changeOrigin: false },
    },
  },
  test: {
    environment: 'node',
  },
});
