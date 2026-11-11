/* ============================================================
   IPCON srl – Gestione consenso cookie
   - Banner con "Rifiuta" e "Accetta" di pari evidenza (linee guida Garante)
   - La scelta si ricorda per 6 mesi (localStorage, solo tecnico)
   - Gli strumenti non tecnici vanno scritti così e partono solo dopo il consenso:

       <script type="text/plain" data-consent="analytics" src="https://..."></script>
       <script type="text/plain" data-consent="marketing"> ...codice inline... </script>

     Categorie: "analytics" (statistiche) e "marketing".
   - Per riaprire le preferenze: <a href="#" data-cookie-settings>Gestisci cookie</a>
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'ipcon_consent_v1';
  var MAX_AGE = 180 * 24 * 60 * 60 * 1000; // 6 mesi

  // Percorso della radice del sito, ricavato da questo script (funziona in root e in lp/)
  var me = document.currentScript;
  var base = me && me.src ? me.src.replace(/assets\/js\/consent\.js.*$/, '') : '';

  function read() {
    try {
      var r = JSON.parse(localStorage.getItem(KEY));
      if (r && r.v === 1 && Date.now() - r.ts < MAX_AGE) return r;
    } catch (e) {}
    return null;
  }

  function write(c) {
    var r = { v: 1, ts: Date.now(), analytics: !!c.analytics, marketing: !!c.marketing };
    try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) {}
    return r;
  }

  // Attiva gli script bloccati delle categorie consentite
  function activate(c) {
    var list = document.querySelectorAll('script[type="text/plain"][data-consent]');
    Array.prototype.forEach.call(list, function (s) {
      if (s.getAttribute('data-done')) return;
      if (!c[s.getAttribute('data-consent')]) return;
      var n = document.createElement('script');
      Array.prototype.forEach.call(s.attributes, function (a) {
        if (a.name !== 'type' && a.name !== 'data-consent' && a.name !== 'data-done') n.setAttribute(a.name, a.value);
      });
      n.text = s.text;
      s.setAttribute('data-done', '1');
      s.parentNode.insertBefore(n, s.nextSibling);
    });
  }

  var saved = read();
  if (saved) activate(saved);

  var el = null;
  var lastFocus = null;

  function build() {
    el = document.createElement('div');
    el.className = 'cc';
    el.id = 'cc';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Preferenze cookie');
    el.hidden = true;
    el.innerHTML =
      '<button type="button" class="cc__close" aria-label="Chiudi e continua senza accettare">' +
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
      '<p class="cc__title">La tua privacy</p>' +
      '<p class="cc__text">Usiamo strumenti tecnici necessari al funzionamento del sito. Con il tuo consenso possiamo usare anche statistiche e marketing. Puoi scegliere e cambiare idea quando vuoi. ' +
        '<a href="' + base + 'cookie-policy.html">Cookie policy</a> · <a href="' + base + 'privacy-policy.html">Privacy</a></p>' +
      '<div class="cc__prefs" id="ccPrefs" hidden>' +
        '<div class="cc__row"><div><strong>Necessari</strong><span>Servono al sito e a ricordare questa scelta. Sempre attivi.</span></div>' +
          '<label class="cc-switch"><input type="checkbox" checked disabled aria-label="Cookie necessari, sempre attivi"><span></span></label></div>' +
        '<div class="cc__row"><div><strong>Statistiche</strong><span>Ci aiutano a capire come viene usato il sito, in forma aggregata.</span></div>' +
          '<label class="cc-switch"><input type="checkbox" id="ccAnalytics" aria-label="Cookie statistici"><span></span></label></div>' +
        '<div class="cc__row"><div><strong>Marketing</strong><span>Misurano le campagne e mostrano annunci pertinenti.</span></div>' +
          '<label class="cc-switch"><input type="checkbox" id="ccMarketing" aria-label="Cookie di marketing"><span></span></label></div>' +
        '<button type="button" class="cc__btn cc__btn--save" id="ccSave">Salva le mie scelte</button>' +
      '</div>' +
      '<div class="cc__actions">' +
        '<button type="button" class="cc__btn cc__btn--ghost" id="ccReject">Rifiuta</button>' +
        '<button type="button" class="cc__btn cc__btn--solid" id="ccAccept">Accetta tutti</button>' +
      '</div>' +
      '<button type="button" class="cc__link" id="ccCustomize" aria-expanded="false" aria-controls="ccPrefs">Personalizza</button>';
    document.body.appendChild(el);

    var prefs = el.querySelector('#ccPrefs');
    var customize = el.querySelector('#ccCustomize');

    function showPrefs(open) {
      prefs.hidden = !open;
      customize.setAttribute('aria-expanded', String(open));
      customize.textContent = open ? 'Nascondi dettagli' : 'Personalizza';
    }

    function decide(c) {
      var before = read();
      var r = write(c);
      hide();
      activate(r);
      document.dispatchEvent(new CustomEvent('ipcon:consent', { detail: r }));
      // Se un consenso già dato viene ritirato, ricarico per fermare gli strumenti già avviati
      if (before && ((before.analytics && !r.analytics) || (before.marketing && !r.marketing))) location.reload();
    }

    el.querySelector('#ccAccept').addEventListener('click', function () { decide({ analytics: true, marketing: true }); });
    el.querySelector('#ccReject').addEventListener('click', function () { decide({ analytics: false, marketing: false }); });
    el.querySelector('.cc__close').addEventListener('click', function () { decide({ analytics: false, marketing: false }); });
    el.querySelector('#ccSave').addEventListener('click', function () {
      decide({ analytics: el.querySelector('#ccAnalytics').checked, marketing: el.querySelector('#ccMarketing').checked });
    });
    customize.addEventListener('click', function () { showPrefs(prefs.hidden); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape' && read()) hide(); });

    el._showPrefs = showPrefs;
  }

  function show(openPrefs) {
    if (!el) build();
    var cur = read() || { analytics: false, marketing: false };
    el.querySelector('#ccAnalytics').checked = !!cur.analytics;
    el.querySelector('#ccMarketing').checked = !!cur.marketing;
    el._showPrefs(!!openPrefs);
    lastFocus = document.activeElement;
    el.hidden = false;
    if (openPrefs) el.querySelector('#ccCustomize').focus();
  }

  function hide() {
    if (el) el.hidden = true;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function init() {
    if (!saved) show(false);
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-cookie-settings]') : null;
      if (t) { e.preventDefault(); show(true); }
    });
  }

  window.IPCONConsent = { get: read, open: function () { show(true); } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
