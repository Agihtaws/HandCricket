import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/rpc-proxy': {
        target: 'https://rpc-testnet.onelabs.cc:443',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rpc-proxy/, ''),
        secure: true,
      },
    },
  },
  css: {
    postcss: './postcss.config.js',
  },
})