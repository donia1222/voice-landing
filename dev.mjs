/**
 * Servidor de desarrollo. `node dev.mjs` y a trabajar.
 *
 * Vigila src/ y public/, recompila al guardar y recarga el navegador solo.
 * Sin dependencias: usa el http de Node y un SSE de tres líneas.
 */

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { watch, createReadStream } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const raiz = dirname(fileURLToPath(import.meta.url))
const DIST = join(raiz, 'dist')
const PUERTO = Number(process.env.PUERTO ?? 3000)

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
}

/** Se inyecta en cada HTML servido: escucha /_recarga y refresca. */
const RECARGA = `
<script>
  (function () {
    var f = new EventSource('/_recarga')
    f.onmessage = function () { location.reload() }
    f.onerror = function () { setTimeout(function () { location.reload() }, 1200) }
  })()
</script>`

const clientes = new Set()

function compilar() {
  const t = Date.now()
  const r = spawnSync(process.execPath, [join(raiz, 'build.mjs')], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error('\n  ✗ error al compilar:\n' + (r.stderr || r.stdout))
    return false
  }
  const paginas = (r.stdout.match(/(\d+) páginas/) || [])[1] ?? '?'
  console.log(`  ✓ ${paginas} páginas en ${Date.now() - t} ms`)
  return true
}

// -------------------------------------------------------------- servidor

createServer(async (req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname)

  if (ruta === '/_recarga') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write('\n')
    clientes.add(res)
    req.on('close', () => clientes.delete(res))
    return
  }

  // /es/ -> dist/es/index.html ; /estilo.css -> dist/estilo.css
  let archivo = join(DIST, ruta)
  try {
    if ((await stat(archivo)).isDirectory()) archivo = join(archivo, 'index.html')
  } catch {
    // Sin extensión probamos como carpeta: /es/contact -> /es/contact/index.html
    if (!extname(ruta)) archivo = join(DIST, ruta, 'index.html')
  }

  try {
    const tipo = TIPOS[extname(archivo)] ?? 'application/octet-stream'

    if (tipo.startsWith('text/html')) {
      const cuerpo = await readFile(archivo)
      res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-store' })
      return res.end(cuerpo.toString().replace('</body>', RECARGA + '</body>'))
    }

    // Los navegadores piden el vídeo por trozos con la cabecera Range. Sin
    // responder 206 con el trozo pedido, Safari no reproduce nada y Chrome
    // se queda a medias. Por eso esto no es opcional.
    const info = await stat(archivo)
    const rango = req.headers.range

    if (rango && /^bytes=\d*-\d*$/.test(rango)) {
      const [ini, fin] = rango.replace('bytes=', '').split('-')
      const desde = ini === '' ? info.size - Number(fin) : Number(ini)
      const hasta = ini === '' || fin === '' ? info.size - 1 : Number(fin)

      if (desde >= info.size || hasta >= info.size || desde > hasta) {
        res.writeHead(416, { 'Content-Range': `bytes */${info.size}` })
        return res.end()
      }

      res.writeHead(206, {
        'Content-Type': tipo,
        'Content-Range': `bytes ${desde}-${hasta}/${info.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': hasta - desde + 1,
        'Cache-Control': 'no-store',
      })
      return createReadStream(archivo, { start: desde, end: hasta }).pipe(res)
    }

    res.writeHead(200, {
      'Content-Type': tipo,
      'Content-Length': info.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    })
    createReadStream(archivo).pipe(res)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<h1>404</h1><p>No existe <code>' + ruta + '</code></p>' + RECARGA)
  }
}).listen(PUERTO, () => {
  compilar()
  console.log(`\n  Voice Grocery en desarrollo\n`)
  console.log(`    http://localhost:${PUERTO}/       inglés`)
  console.log(`    http://localhost:${PUERTO}/es/    español`)
  console.log(`    http://localhost:${PUERTO}/de/    ·  /fr/  ·  /it/\n`)
  console.log(`  Guarda cualquier archivo de src/ o public/ y se recarga solo.`)
  console.log(`  Ctrl+C para parar.\n`)
})

// ------------------------------------------------------------- vigilancia

let pendiente = null
for (const carpeta of ['src', 'public']) {
  watch(join(raiz, carpeta), { recursive: true }, (_, archivo) => {
    if (!archivo || archivo.includes('.DS_Store')) return
    clearTimeout(pendiente)
    // Pequeña espera: al guardar saltan varios eventos seguidos.
    pendiente = setTimeout(() => {
      console.log(`\n  ${archivo}`)
      if (compilar()) {
        for (const c of clientes) c.write('data: recarga\n\n')
      }
    }, 120)
  })
}
