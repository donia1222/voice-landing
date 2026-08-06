/**
 * BuyVoice — generador estático
 *
 * Lee las plantillas de src/ y el contenido de src/contenido/*.json,
 * y escribe en dist/ una copia de cada página por idioma, con su metadata,
 * su hreflang y su sitemap. Sin dependencias: solo `node build.mjs`.
 */

import {
  readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, cpSync, existsSync,
  renameSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = dirname(fileURLToPath(import.meta.url))
const SRC = join(raiz, 'src')
const DIST = join(raiz, 'dist')
const CONTENIDO = join(SRC, 'contenido')

/**
 * Dominio canónico. Tiene que ser EXACTAMENTE el que sirve Vercel: hoy el
 * principal es www y el ápice redirige con un 308. Si algún día se invierte
 * en Vercel, hay que cambiarlo aquí también, o los canonical apuntarán a una
 * URL que redirige.
 */
const SITIO = process.env.SITIO ?? 'https://www.buyvoice.app'

/** Idioma en la raíz del dominio. El resto cuelga de /es/, /de/, ... */
const PRINCIPAL = 'en'

/** Las páginas del sitio. El orden manda en el sitemap. */
const PAGINAS = [
  { plantilla: 'index',            ruta: '',                   prioridad: '1.0', frecuencia: 'weekly'  },
  { plantilla: 'support',          ruta: 'support',            prioridad: '0.7', frecuencia: 'monthly' },
  { plantilla: 'contact',          ruta: 'contact',            prioridad: '0.7', frecuencia: 'monthly' },
  // Los textos legales existen solo en inglés y viven en una única URL:
  // publicarlos traducidos a medias sería contenido duplicado en 5 idiomas.
  { plantilla: 'privacy-policy',   ruta: 'privacy-policy',     prioridad: '0.3', frecuencia: 'yearly', soloIdioma: 'en' },
  { plantilla: 'terms-of-service', ruta: 'terms-of-service',   prioridad: '0.3', frecuencia: 'yearly', soloIdioma: 'en' },
]

/** Idiomas que se escriben de derecha a izquierda. */
const RTL = new Set(['ar', 'he', 'fa', 'ur'])

// ---------------------------------------------------------------- contenido

const idiomas = readdirSync(CONTENIDO)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .map((f) => f.replace('.json', ''))
  .sort((a, b) => (a === PRINCIPAL ? -1 : b === PRINCIPAL ? 1 : a.localeCompare(b)))

const leerJSON = (p) => JSON.parse(readFileSync(p, 'utf8'))

const textos = Object.fromEntries(idiomas.map((l) => [l, leerJSON(join(CONTENIDO, `${l}.json`))]))
const seo = leerJSON(join(CONTENIDO, '_seo.json'))
const nombres = leerJSON(join(CONTENIDO, '_idiomas.json'))
const faq = leerJSON(join(CONTENIDO, '_faq.json'))
const subtitulos = leerJSON(join(CONTENIDO, '_subtitulos.json'))
const formulario = leerJSON(join(CONTENIDO, '_formulario.json'))
const soporte = leerJSON(join(CONTENIDO, '_soporte.json'))
const capturas = leerJSON(join(CONTENIDO, '_capturas.json'))

// ---------------------------------------------------------------- plantillas

/**
 * Sustituye {{clave}} por su valor y {{> parcial}} por el archivo
 * src/parciales/parcial.html. Los parciales se resuelven antes, de forma
 * recursiva, para que puedan contener sus propias claves.
 */
function render(plantilla, datos, profundidad = 0) {
  if (profundidad > 10) throw new Error('Parciales anidados demasiado profundo — ¿un bucle?')

  const conParciales = plantilla.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, nombre) => {
    const ruta = join(SRC, 'parciales', `${nombre}.html`)
    if (!existsSync(ruta)) throw new Error(`Falta el parcial: src/parciales/${nombre}.html`)
    return render(readFileSync(ruta, 'utf8'), datos, profundidad + 1)
  })

  const buscar = (clave) => clave.split('.').reduce((o, k) => (o == null ? undefined : o[k]), datos)

  // {{{clave}}} inserta HTML tal cual — solo para bloques que generamos nosotros.
  // {{clave}} escapa, que es lo que quieren los textos traducidos.
  return conParciales
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, clave) => {
      const valor = buscar(clave)
      if (valor === undefined) { avisos.push(`clave sin valor: {{{${clave}}}}`); return '' }
      return String(valor)
    })
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, clave) => {
      const valor = buscar(clave)
      if (valor === undefined) { avisos.push(`clave sin valor: {{${clave}}}`); return '' }
      return esc(valor)
    })
}

const avisos = []

// ---------------------------------------------------------------- utilidades

/**
 * URL absoluta de una página en un idioma dado.
 *
 * Sin barra final, porque vercel.json declara trailingSlash:false y Vercel
 * redirige con un 308 cualquier URL que la lleve. La única excepción es la
 * portada en el idioma principal, que es la raíz del dominio.
 */
function url(lang, ruta) {
  const base = lang === PRINCIPAL ? SITIO : `${SITIO}/${lang}`
  if (ruta) return `${base}/${ruta}`
  return lang === PRINCIPAL ? `${base}/` : base
}

/** Ruta relativa, para los enlaces internos dentro del HTML. */
function href(lang, ruta) {
  const base = lang === PRINCIPAL ? '' : `/${lang}`
  if (ruta) return `${base}/${ruta}`
  return base || '/'
}

/** El bloque <link rel="alternate"> completo de una página. */
function hreflang(ruta, soloIdioma) {
  if (soloIdioma) return ''
  const enlaces = idiomas.map(
    (l) => `<link rel="alternate" hreflang="${l}" href="${url(l, ruta)}">`
  )
  enlaces.push(`<link rel="alternate" hreflang="x-default" href="${url(PRINCIPAL, ruta)}">`)
  return enlaces.join('\n  ')
}

/** Escapa texto que va dentro de un atributo o del cuerpo del HTML. */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Un <script type="application/ld+json"> seguro.
 * JSON.stringify puede producir "</script>" dentro de una cadena y cerrar
 * la etiqueta antes de tiempo; por eso se escapa la barra.
 */
function jsonld(obj) {
  const texto = JSON.stringify(obj, null, 2).replace(/<\//g, '<\\/')
  return `<script type="application/ld+json">\n${texto}\n</script>`
}

/** El bloque <details> del FAQ, y su equivalente en datos estructurados. */
function bloqueFaq(lang) {
  const preguntas = faq[lang] ?? faq[PRINCIPAL]
  const html = preguntas
    .map(
      ({ q, a }) =>
        `<details>\n          <summary>${esc(q)}</summary>\n          <p>${esc(a)}</p>\n        </details>`
    )
    .join('\n        ')

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: preguntas.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  }

  return { html, schema }
}

/**
 * Convierte los textos legales en HTML.
 *
 * Vienen como texto plano con bloques separados por línea en blanco. Un bloque
 * de una sola línea corta y sin punto final es un título; las líneas que
 * empiezan por viñeta forman una lista; el resto son párrafos.
 */
function legalHtml(nombre, lang) {
  const carpeta = join(CONTENIDO, 'legal')
  let ruta = join(carpeta, `${nombre}.${lang}.txt`)
  let idiomaUsado = lang

  if (!existsSync(ruta)) {
    ruta = join(carpeta, `${nombre}.${PRINCIPAL}.txt`)
    idiomaUsado = PRINCIPAL
    avisos.push(`legal: no hay ${nombre} en "${lang}" — se sirve en ${PRINCIPAL}`)
  }
  if (!existsSync(ruta)) return { html: '', idiomaUsado: null }

  const bloques = readFileSync(ruta, 'utf8').trim().split(/\n\s*\n/)
  const partes = []

  for (const bloque of bloques) {
    const lineas = bloque.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lineas.length) continue

    const vinetas = lineas.filter((l) => /^[•·-]\s/.test(l))
    if (vinetas.length === lineas.length) {
      partes.push(
        '<ul>\n' +
          lineas.map((l) => `        <li>${esc(l.replace(/^[•·-]\s*/, ''))}</li>`).join('\n') +
          '\n      </ul>'
      )
      continue
    }

    const esTitulo =
      lineas.length === 1 && lineas[0].length < 70 && !/[.:;!?]$/.test(lineas[0])
    if (esTitulo) {
      partes.push(`<h2>${esc(lineas[0])}</h2>`)
      continue
    }

    partes.push(`<p>${esc(lineas.join(' '))}</p>`)
  }

  return { html: partes.join('\n      '), idiomaUsado }
}


/** La tira de capturas de la app, con scroll y anclaje. */
function galeria(lang) {
  const c = capturas[lang] ?? capturas[PRINCIPAL]
  const tomas = c.tomas
    .map(
      (t, i) => `<figure class="toma">
            <img src="/img/capturas/${t.archivo}.webp" alt="${esc(t.titulo)}"
                 width="360" height="782" loading="lazy" decoding="async">
            <figcaption>
              <h3>${esc(t.titulo)}</h3>
              <p>${esc(t.pie)}</p>
            </figcaption>
          </figure>`
    )
    .join('\n          ')
  // El spread va primero: si no, c.tomas (el array original) pisaría el HTML.
  return { ...c, tomas }
}

/** El selector de idioma, ya resuelto para la página actual. */
function selectorIdiomas(langActual, ruta) {
  return idiomas
    .map((l) => {
      const activo = l === langActual
      return `<a href="${href(l, ruta)}" hreflang="${l}" lang="${l}"${
        activo ? ' aria-current="true"' : ''
      } class="lang-opt${activo ? ' is-activa' : ''}">${nombres[l].name}</a>`
    })
    .join('\n        ')
}

// ---------------------------------------------------------------- generación

rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

const hoy = new Date().toISOString().slice(0, 10)
let escritas = 0

for (const lang of idiomas) {
  const t = textos[lang]

  for (const pagina of PAGINAS) {
    if (pagina.soloIdioma && lang !== pagina.soloIdioma) continue

    const rutaPlantilla = join(SRC, `${pagina.plantilla}.html`)
    if (!existsSync(rutaPlantilla)) {
      avisos.push(`falta la plantilla src/${pagina.plantilla}.html — página omitida`)
      continue
    }

    const meta = seo[lang]?.[pagina.plantilla] ?? seo[PRINCIPAL][pagina.plantilla]
    const esInicio = pagina.plantilla === 'index'
    const { html: faqHtml, schema: faqSchema } = bloqueFaq(lang)

    // Datos estructurados: la app siempre; el FAQ y el vídeo solo en la portada.
    const esquemas = [
      {
        '@context': 'https://schema.org',
        '@type': 'MobileApplication',
        name: 'BuyVoice',
        applicationCategory: 'LifestyleApplication',
        operatingSystem: 'iOS, Android',
        inLanguage: idiomas,
        description: meta.description,
        url: url(lang, ''),
        installUrl: [
          'https://apps.apple.com/app/voice-shopping-list/id6505125372',
          'https://play.google.com/store/apps/details?id=com.lwebch.VoiceList',
        ],
        publisher: { '@type': 'Organization', name: 'lweb.ch', url: 'https://lweb.ch' },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'CHF' },
      },
    ]

    if (esInicio) {
      esquemas.push(faqSchema, {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: meta.title,
        description: meta.description,
        thumbnailUrl: `${SITIO}/img/cartel-hero.jpg`,
        uploadDate: hoy,
        contentUrl: `${SITIO}/video/hero.mp4`,
        transcript: (subtitulos.hero[lang] ?? subtitulos.hero[PRINCIPAL]).map((c) => c.texto).join(' '),
      })
    }

    const datos = {
      ...t,
      t,
      meta,
      lang,
      dir: RTL.has(lang) ? 'rtl' : 'ltr',
      sitio: SITIO,
      anyo: new Date().getFullYear(),
      canonical: url(lang, pagina.ruta),
      hreflang: hreflang(pagina.ruta, pagina.soloIdioma),
      selectorIdiomas: selectorIdiomas(lang, pagina.ruta),
      f: formulario[lang] ?? formulario[PRINCIPAL],
      s: soporte[lang] ?? soporte[PRINCIPAL],
      g: galeria(lang),
      faq: faqHtml,
      legal: /^(privacy-policy|terms-of-service)$/.test(pagina.plantilla)
        ? legalHtml(pagina.plantilla, lang).html
        : '',
      datosEstructurados: esquemas.map(jsonld).join('\n  '),
      subsHero: JSON.stringify(subtitulos.hero[lang] ?? subtitulos.hero[PRINCIPAL]),
      subsCompartir: JSON.stringify(subtitulos.compartir[lang] ?? subtitulos.compartir[PRINCIPAL]),
      subsSuper: JSON.stringify(subtitulos.supermercado[lang] ?? subtitulos.supermercado[PRINCIPAL]),
      // enlaces internos, ya con el prefijo de idioma correcto
      inicio: href(lang, ''),
      soporte: href(lang, 'support'),
      contacto: href(lang, 'contact'),
      privacidad: href('en', 'privacy-policy'),
      terminos: href('en', 'terms-of-service'),
    }

    const html = render(readFileSync(rutaPlantilla, 'utf8'), datos)

    const carpeta = join(DIST, lang === PRINCIPAL ? '' : lang, pagina.ruta)
    mkdirSync(carpeta, { recursive: true })
    writeFileSync(join(carpeta, 'index.html'), html)
    escritas++
  }
}

// ---------------------------------------------------------------- sitemap

const entradas = []
for (const pagina of PAGINAS) {
  for (const lang of idiomas) {
    if (pagina.soloIdioma && lang !== pagina.soloIdioma) continue
    const alternativas = pagina.soloIdioma ? '' : idiomas
      .map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${url(l, pagina.ruta)}"/>`)
      .join('\n')
    entradas.push(
      `  <url>\n` +
        `    <loc>${url(lang, pagina.ruta)}</loc>\n` +
        `    <lastmod>${hoy}</lastmod>\n` +
        `    <changefreq>${pagina.frecuencia}</changefreq>\n` +
        `    <priority>${pagina.prioridad}</priority>\n` +
        (pagina.soloIdioma
          ? ''
          : alternativas + '\n' +
            `    <xhtml:link rel="alternate" hreflang="x-default" href="${url(PRINCIPAL, pagina.ruta)}"/>\n`) +
        `  </url>`
    )
  }
}

writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
    `        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    entradas.join('\n') +
    `\n</urlset>\n`
)

writeFileSync(
  join(DIST, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITIO}/sitemap.xml\n`
)

// ---------------------------------------------------------------- estáticos

if (existsSync(join(raiz, 'public'))) {
  cpSync(join(raiz, 'public'), DIST, { recursive: true })
}

// ------------------------------------------------------------ huella digital
/**
 * Renombra los recursos con un hash de su contenido y reescribe las
 * referencias. Así se pueden cachear un año: si el archivo cambia, cambia el
 * nombre, y el navegador está obligado a pedirlo. Sin esto hay que elegir
 * entre caché larga (y ver la versión vieja) o caché corta (y ir lento).
 */
function huella() {
  const archivos = []
  const recorrer = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name)
      if (e.isDirectory()) recorrer(ruta)
      else archivos.push(ruta)
    }
  }
  recorrer(DIST)

  const versionable = (f) =>
    /\.(css|js|webp|png|jpg|jpeg|svg|mp4|webm)$/i.test(f) &&
    !/google[0-9a-f]+\.html$/i.test(f)

  const mapa = new Map()
  for (const abs of archivos.filter(versionable)) {
    const datos = readFileSync(abs)
    const hash = createHash('sha256').update(datos).digest('hex').slice(0, 8)
    const punto = abs.lastIndexOf('.')
    const nuevo = `${abs.slice(0, punto)}.${hash}${abs.slice(punto)}`
    renameSync(abs, nuevo)
    // La clave es la ruta pública, tal cual aparece en el HTML.
    mapa.set('/' + abs.slice(DIST.length + 1), '/' + nuevo.slice(DIST.length + 1))
  }

  // Las rutas más largas primero: si no, "/img/icono.png" podría alterar
  // una coincidencia parcial de otra más específica.
  const claves = [...mapa.keys()].sort((a, b) => b.length - a.length)

  for (const abs of archivos) {
    if (!/\.(html|css|json|xml)$/i.test(abs)) continue
    const real = existsSync(abs) ? abs : mapa.get('/' + abs.slice(DIST.length + 1))
      ? join(DIST, mapa.get('/' + abs.slice(DIST.length + 1)).slice(1))
      : null
    if (!real || !existsSync(real)) continue

    let texto = readFileSync(real, 'utf8')
    let tocado = false
    for (const k of claves) {
      if (texto.includes(k)) {
        texto = texto.split(k).join(mapa.get(k))
        tocado = true
      }
    }
    if (tocado) writeFileSync(real, texto)
  }

  return mapa.size
}

const versionados = huella()

// ---------------------------------------------------------------- resumen

console.log(`\n  ${escritas} páginas · ${idiomas.length} idiomas (${idiomas.join(', ')})`)
console.log(`  sitemap: ${entradas.length} URLs · ${versionados} recursos con huella`)

if (avisos.length) {
  const unicos = [...new Set(avisos)]
  console.log(`\n  ${unicos.length} aviso(s):`)
  for (const a of unicos.slice(0, 20)) console.log(`    · ${a}`)
  if (unicos.length > 20) console.log(`    · ...y ${unicos.length - 20} más`)
}
console.log('')
