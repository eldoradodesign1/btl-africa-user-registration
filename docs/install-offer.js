// Proposition d'installation, quand on arrive depuis le tracker avec ?installer=1.
// L'appli ouverte dans un onglet propose de s'installer pour s'ouvrir ensuite sans l'interface du navigateur.
(function () {
  var params = new URLSearchParams(location.search);
  if (!params.has('installer')) return;
  params.delete('installer');
  var clean = location.pathname + (params.toString() ? '?' + params : '') + location.hash;
  history.replaceState(history.state, '', clean);

  var standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
  if (standalone) return;

  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var name = (document.querySelector('meta[name="apple-mobile-web-app-title"]') || {}).content || document.title;
  var deferred = null;

  var css = '.io-sheet{position:fixed;z-index:2147483000;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));max-width:440px;margin:0 auto;padding:16px;border-radius:22px;background:rgba(18,20,28,.92);color:#f4f6fb;border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 50px rgba(0,0,0,.45);-webkit-backdrop-filter:blur(22px) saturate(1.5);backdrop-filter:blur(22px) saturate(1.5);font:500 14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;align-items:center;gap:12px;animation:io-in .32s cubic-bezier(.16,1,.3,1) both}' +
    '.io-sheet img{width:44px;height:44px;border-radius:12px;flex:none}.io-sheet b{display:block;font-size:15px}.io-sheet span{color:rgba(244,246,251,.7);font-size:13px}' +
    '.io-sheet .io-text{flex:1;min-width:0}.io-sheet button{flex:none;min-height:40px;padding:0 16px;border-radius:12px;border:0;font:700 14px system-ui,sans-serif;cursor:pointer}' +
    '.io-go{background:#fff;color:#111}.io-x{background:transparent;color:rgba(244,246,251,.7);padding:0 8px!important}' +
    '@keyframes io-in{from{transform:translateY(24px);opacity:0}}@media (prefers-reduced-motion:reduce){.io-sheet{animation:none}}';

  function sheet(text, action) {
    if (document.querySelector('.io-sheet')) document.querySelector('.io-sheet').remove();
    if (!document.getElementById('io-style')) { var s = document.createElement('style'); s.id = 'io-style'; s.textContent = css; document.head.appendChild(s); }
    var icon = document.querySelector('link[rel="apple-touch-icon"]');
    var box = document.createElement('div');
    box.className = 'io-sheet'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Installer ' + name);
    box.innerHTML = (icon ? '<img alt="" src="' + icon.href + '">' : '') + '<div class="io-text"><b></b><span></span></div>' + (action ? '<button type="button" class="io-go">Installer</button>' : '') + '<button type="button" class="io-x" aria-label="Fermer">✕</button>';
    box.querySelector('b').textContent = name;
    box.querySelector('span').textContent = text;
    box.querySelector('.io-x').onclick = function () { box.remove(); };
    if (action) box.querySelector('.io-go').onclick = function () { action(); box.remove(); };
    document.body.appendChild(box);
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferred = event;
    sheet('Installez l’appli pour l’ouvrir en plein écran.', function () { deferred.prompt(); });
  });

  window.addEventListener('load', function () {
    if (ios) { sheet('Touchez Partager puis « Sur l’écran d’accueil ».', null); return; }
    // Sans proposition du navigateur, l'appli est sans doute déjà installée.
    setTimeout(function () { if (!deferred) sheet('Déjà installée : ouvrez-la depuis vos applis pour la voir en plein écran.', null); }, 2500);
  });
})();
