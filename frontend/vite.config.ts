import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // `npm run analyze` writes an interactive treemap of the bundle to stats.html.
    Boolean(process.env.ANALYZE) && visualizer({ filename: 'stats.html', gzipSize: true, brotliSize: true, template: 'treemap' }),
  ],
  build: {
    // The only chunk above 500 kB is PDFKit (~530 kB), lazy-loaded when a
    // receipt or report PDF is downloaded — never on page load.
    chunkSizeWarningLimit: 560,
    rolldownOptions: {
      output: {
        // Framework code changes far less often than the app: separate files
        // stay cached in the browser across deploys.
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            { name: 'supabase-vendor', test: /node_modules[\\/]@supabase[\\/]/ },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0', // Listen on all interfaces for LAN access
  },
})
