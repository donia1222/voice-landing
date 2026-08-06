/* BuyVoice — lo mínimo que necesita la página. Sin dependencias. */
;(function () {
  'use strict'

  var raiz = document.documentElement
  var reducido = matchMedia('(prefers-reduced-motion: reduce)').matches

  // ---------------------------------------------------------------- tema
  var boton = document.getElementById('cambia-tema')
  if (boton) {
    boton.addEventListener('click', function () {
      // Si no hay tema fijado aún, partimos del que muestre el sistema.
      var actual =
        raiz.dataset.theme ||
        (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      var nuevo = actual === 'dark' ? 'light' : 'dark'
      raiz.dataset.theme = nuevo
      try { localStorage.setItem('tema', nuevo) } catch (e) {}
    })
  }

  // ------------------------------------------------------ borde cabecera
  var cabecera = document.getElementById('cabecera')
  var barra = document.getElementById('barra-movil')
  var hero = document.querySelector('.hero')

  function alDesplazar() {
    if (cabecera) cabecera.dataset.desplazada = window.scrollY > 8 ? 'si' : 'no'
    if (barra && hero) {
      // La barra de descarga aparece cuando el hero ya no se ve.
      barra.dataset.visible = window.scrollY > hero.offsetHeight * 0.75 ? 'si' : 'no'
    }
  }
  addEventListener('scroll', alDesplazar, { passive: true })
  alDesplazar()

  // ----------------------------- la barra apunta a la tienda del dispositivo
  // El HTML ya trae App Store; aquí solo se corrige si es Android.
  var enlaceBarra = document.getElementById('barra-enlace')
  if (enlaceBarra && /Android/.test(navigator.userAgent || '')) {
    enlaceBarra.href = 'https://play.google.com/store/apps/details?id=com.lwebch.VoiceList'
  }

  // ----------------------------------------- cierre del menú de idiomas
  var menu = document.querySelector('.idiomas')
  if (menu) {
    document.addEventListener('click', function (e) {
      if (menu.open && !menu.contains(e.target)) menu.open = false
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus() }
    })
  }

  // -------------------------------------------------- vídeo + subtítulos
  // Con movimiento reducido no arrancamos solos, pero el botón de play sigue
  // ahí: quien quiera verlo, puede.
  var observador = null
  if (!reducido && 'IntersectionObserver' in window) {
    observador = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (e) {
          var v = e.target
          // Si lo pausó la persona a mano, no se lo volvemos a arrancar.
          if (e.isIntersecting) { if (!v.dataset.pausadoAMano) intentarPlay(v) }
          else v.pause()
        })
      },
      { threshold: 0.25 }
    )
  }

  function intentarPlay(v) {
    var p = v.play()
    if (p && p.catch) p.catch(function () {})
  }

  Array.prototype.forEach.call(document.querySelectorAll('.video-marco'), function (marco) {
    var video = marco.querySelector('video')
    var pie = marco.querySelector('.subtitulo')
    var datos = marco.querySelector('script.cues')
    if (!video) return

    var cues = []
    if (datos) { try { cues = JSON.parse(datos.textContent) } catch (e) { cues = [] } }

    if (pie && cues.length) {
      var ultimo = null
      video.addEventListener('timeupdate', function () {
        var t = video.currentTime
        var cue = null
        for (var i = 0; i < cues.length; i++) {
          if (t >= cues[i].desde && t < cues[i].hasta) { cue = cues[i]; break }
        }
        if (cue === ultimo) return
        ultimo = cue
        if (cue) { pie.textContent = cue.texto; pie.dataset.visible = 'si' }
        else { pie.dataset.visible = 'no' }
      })
    }

    // El marco sabe si está sonando, y con eso el CSS enseña u oculta el play.
    video.addEventListener('play', function () { marco.dataset.reproduciendo = 'si' })
    video.addEventListener('pause', function () { marco.dataset.reproduciendo = 'no' })
    marco.dataset.reproduciendo = 'no'

    var play = marco.querySelector('.video-play')
    if (play) {
      play.addEventListener('click', function () {
        delete video.dataset.pausadoAMano
        intentarPlay(video)
      })
    }
    // Un clic en el vídeo lo pausa, como en cualquier reproductor.
    video.addEventListener('click', function () {
      if (video.paused) { delete video.dataset.pausadoAMano; intentarPlay(video) }
      else { video.dataset.pausadoAMano = 'si'; video.pause() }
    })

    // Solo se reproduce cuando está a la vista, para no gastar batería ni datos.
    if (observador) observador.observe(video)
    else if (!reducido) intentarPlay(video)
  })
})()
