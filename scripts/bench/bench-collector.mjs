// Collects camera-bench results POSTed by the viewer (?benchPost=8123).
// Usage: node bench-collector.mjs <results-dir>
import http from 'node:http'
import fs from 'node:fs'

const dir = process.argv[2] ?? './bench-results'
fs.mkdirSync(dir, { recursive: true })

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/bench-result') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try {
        const r = JSON.parse(body)
        const file = `${dir}/result-${r.bench}-${r.order}${r.exactCull ? '-x' : ''}.json`
        fs.writeFileSync(file, body)
        console.log(`[collector] wrote ${file}`)
      } catch (e) {
        console.error('[collector] bad payload:', e.message)
      }
      res.writeHead(204)
      res.end()
    })
  } else {
    res.writeHead(404)
    res.end()
  }
}).listen(8123, () => console.log('[collector] listening on 8123'))
