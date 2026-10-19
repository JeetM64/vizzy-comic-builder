import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': { target: 'http://localhost:4000', timeout: 240000, proxyTimeout: 240000 },
      '/health': { target: 'http://localhost:4000', timeout: 30000, proxyTimeout: 30000 },
      '/generated': { target: 'http://localhost:4000', timeout: 60000, proxyTimeout: 60000 }
    }
  }
});
