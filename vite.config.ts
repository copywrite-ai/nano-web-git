import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    basicSsl(),
    nodePolyfills(),
  ],
  server: {
    https: {},
  },
  preview: {
    https: {},
  },
  define: {
    // Vite uses import.meta.env, but we map process.env for compatibility with existing code
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
  }
});
