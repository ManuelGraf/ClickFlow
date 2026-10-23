import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { offline } from './build/offline.ts'

// GitHub Pages serves project sites under /<repository>/. The deploy workflow
// passes the path GitHub itself reports (actions/configure-pages → base_path),
// so neither the repository name nor a custom domain is hardcoded here. Local
// builds default to the server root.
function resolveBase(): string {
  const raw = process.env.BASE_PATH?.trim()
  if (!raw) return '/'
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

// Strict CSP on the built index.html only — the dev server needs inline
// preambles and an HMR websocket that this policy would block.
// `connect-src 'none'` makes the privacy claim enforceable: the page cannot
// issue fetch/XHR/WebSocket requests at all, so screenshots cannot leave it.
function csp(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: [
                "default-src 'none'",
                "script-src 'self'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' blob: data:",
                "font-src 'self'",
                "worker-src 'self'",
                "manifest-src 'self'",
                "connect-src 'none'",
                "base-uri 'none'",
                "form-action 'none'",
              ].join('; '),
            },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

export default defineConfig({
  base: resolveBase(),
  plugins: [react(), csp(), offline()],
  build: {
    target: 'es2022',
    // The polyfill would fetch() module URLs, which connect-src 'none' blocks;
    // every browser that can run this app supports modulepreload natively.
    modulePreload: { polyfill: false },
  },
})
