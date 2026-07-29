// Local-dev reverse proxy for the mobile APK: mirrors the path-routing rules
// the real VPS nginx applies (each backend registers its routes differently —
// some keep the /api prefix, some expect it stripped, some expect /api/betting
// collapsed to just the sub-resource) so a single host:port works for the app.
const http = require('http')
const httpProxy = require('http-proxy')

const PORT = process.env.PROXY_PORT || 8090

const CORE_API = 'http://127.0.0.1:3001'
const WALLET = 'http://127.0.0.1:3003'
const GATEWAY = 'http://127.0.0.1:3004'
const ADMIN = 'http://127.0.0.1:3008'
const APP_MONITOR = 'http://127.0.0.1:3015'

const proxy = httpProxy.createProxyServer({})
proxy.on('error', (err, req, res) => {
  console.error('[proxy error]', req.url, err.message)
  if (res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Local backend unavailable', detail: err.message }))
  }
})

// [matchPrefix, rewrite(path) => newPath, target]
const rules = [
  ['/api/admin/', p => p, ADMIN],
  ['/api/monitor/', p => p, APP_MONITOR],
  ['/api/wallet/', p => p.replace('/api', ''), WALLET],
  ['/api/betting/matka/', p => p.replace('/api/betting', ''), CORE_API],
  ['/api/betting/lottery/', p => p.replace('/api/betting', ''), CORE_API],
  ['/api/betting/cricket/', p => p.replace('/api/betting', ''), CORE_API],
  ['/api/users/', p => p.replace('/api', ''), CORE_API],
  ['/api/notifications/', p => p.replace('/api', ''), CORE_API],
  ['/api/support/', p => p.replace('/api', ''), CORE_API],
  ['/api/auth/', p => p.replace('/api', ''), CORE_API],
  ['/auth/', p => p, CORE_API],
]

function resolve(pathname) {
  for (const [prefix, rewrite, target] of rules) {
    if (pathname.startsWith(prefix)) return { target, path: rewrite(pathname) }
  }
  return null
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const match = resolve(url.pathname)
  if (!match) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'No local route for ' + url.pathname }))
    return
  }
  req.url = match.path + url.search
  proxy.web(req, res, { target: match.target })
})

// WebSocket upgrade: only /ws (game-gateway) is used by the app.
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws')) {
    proxy.ws(req, socket, head, { target: GATEWAY })
  } else {
    socket.destroy()
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Local dev proxy listening on 0.0.0.0:${PORT}`)
})
