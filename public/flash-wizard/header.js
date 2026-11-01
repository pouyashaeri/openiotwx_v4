// The wordmark types itself away on hover and spells a short phrase, then types the name back on leave.
// Same behaviour as the main site's header (src/components/site-header.tsx).
(function () {
  var link = document.querySelector('a.site-logo');
  var label = link && link.querySelector('.site-logo-text');
  if (!link || !label) return;
  var IDLE = 'openiotwx/';
  // A different short phrase about the work each time the name is hovered.
  var PHRASES = ['plan-it-out', 'sense-local'];
  var HOVER = PHRASES[0];
  var count = 0;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var text = IDLE;
  var want = IDLE;
  var timer = null;

  link.setAttribute('aria-label', 'OpenIoTwx home');
  label.setAttribute('aria-hidden', 'true');

  function render() {
    label.textContent = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '/') {
        var em = document.createElement('em');
        em.textContent = '/';
        label.appendChild(em);
      } else {
        label.appendChild(document.createTextNode(ch));
      }
    }
    if (want === HOVER || text !== want) {
      var caret = document.createElement('span');
      caret.className = 'type-caret';
      label.appendChild(caret);
    }
  }

  function tick() {
    timer = null;
    if (text === want) return render();
    var typing = want.indexOf(text) === 0;
    text = typing ? want.slice(0, text.length + 1) : text.slice(0, -1);
    render();
    timer = setTimeout(tick, typing ? 55 : 28);
  }

  function go(next) {
    want = next;
    if (reduced) { text = next; render(); return; }
    if (!timer) timer = setTimeout(tick, 0);
  }

  // A page that loads with the pointer already on the logo makes the browser report a hover.
  // Only react once the pointer has really moved, so it never starts on its own.
  var moved = false;
  window.addEventListener('pointermove', function () { moved = true; }, { passive: true });
  var hovering = false;
  function start() { hovering = true; link.classList.add('is-morph'); HOVER = PHRASES[count++ % PHRASES.length]; go(HOVER); }
  function stop() { hovering = false; link.classList.remove('is-morph'); go(IDLE); }
  function maybe() { if (moved && !hovering) start(); }
  link.addEventListener('mouseenter', maybe);
  link.addEventListener('mousemove', maybe);
  link.addEventListener('mouseleave', stop);
  // Keyboard focus only: a mouse click also focuses the link, and that must not replay it.
  link.addEventListener('focus', function () { if (link.matches(':focus-visible')) start(); });
  link.addEventListener('blur', stop);
})();
