import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Capacitor serves assets from capacitor://localhost — keep paths relative
    // so the iOS bundle works without a server.
    assetsDir: 'assets',
  },
});
