import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import type { Plugin } from 'vite'

const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co; base-uri 'none'; form-action 'none'"

/**
 * Die strenge Regel gehört nur in den fertigen Build: im Entwicklungsmodus
 * würde `connect-src 'none'` die Live-Aktualisierung von Vite blockieren.
 */
function cspPlugin(): Plugin {
  return {
    name: 'federball-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
  }
}

/**
 * Standard-Build: normale Seite unter dist/.
 * Build mit `--mode live`: eine einzige, in sich geschlossene HTML-Datei
 * unter dist-live/ – Grundlage für die geteilte Live-Seite.
 */
export default defineConfig(({ mode }) => ({
  // Die Live-Seite bekommt keine eigene CSP: sie muss mit der Plattform
  // sprechen dürfen, und die Plattform setzt ihre eigenen Regeln.
  plugins: mode === 'live' ? [react(), viteSingleFile()] : [react(), cspPlugin()],
  base: './',
  build: {
    outDir: mode === 'live' ? 'dist-live' : 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
