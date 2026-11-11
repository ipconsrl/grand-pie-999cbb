/* ============================================================
   IPCON srl – Assistenza Remota
   Protezione download con verifica SHA-256 lato client.

   COME CAMBIARE IL CODICE:
   1. Scegli il nuovo codice (es. "NUOVOCODICE")
   2. Calcola il suo SHA-256 su: https://emn178.github.io/online-tools/sha256.html
   3. Sostituisci il valore di ACCESS_CODE_HASH qui sotto
   ============================================================ */

(function () {
  'use strict';

  // SHA-256 del codice di accesso (attuale: "assistenza02.")
  // Per cambiarlo: vedi istruzioni sopra
  const ACCESS_CODE_HASH = '1256d6e67d43496cc8f6925a35410fc84a55ccbdc80aa87cbe560125cc1b59f6';

  // --- Elementi DOM ---
  const widget    = document.getElementById('supportWidget');
  const overlay   = document.getElementById('supportOverlay');
  const closeBtn  = document.getElementById('supportClose');
  const navBtn    = document.getElementById('navSupportBtn');
  const input     = document.getElementById('supportCode');
  const submitBtn = document.getElementById('supportSubmit');
  const errorMsg  = document.getElementById('supportError');
  const formWrap  = document.getElementById('supportForm');
  const successWrap = document.getElementById('supportSuccess');
  const fallbackLink = document.getElementById('supportFallback');

  if (!widget || !overlay) return;

  // Percorso del file preso dal link di fallback già presente in pagina,
  // cosi funziona a qualunque profondita si trovi la pagina (root o lp/*.html)
  const DOWNLOAD_FILE = fallbackLink ? fallbackLink.getAttribute('href') : 'assets/supporto-ipcon.exe';

  // --- Apri/chiudi modale ---
  function openModal() {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => input && input.focus(), 120);
  }

  function closeModal() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    // Reset stato dopo animazione chiusura
    setTimeout(() => {
      if (input) { input.value = ''; input.classList.remove('error'); }
      if (errorMsg) errorMsg.style.display = 'none';
      if (formWrap) formWrap.style.display = '';
      if (successWrap) successWrap.style.display = 'none';
    }, 300);
  }

  widget.addEventListener('click', openModal);
  if (navBtn) navBtn.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // --- Hashing SHA-256 via Web Crypto API ---
  async function sha256(text) {
    const encoded = new TextEncoder().encode(text.trim().toUpperCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const hashArray  = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // --- Verifica codice e avvia download ---
  async function verifyAndDownload() {
    if (!input) return;
    const code = input.value.trim();
    if (!code) {
      input.classList.add('error');
      input.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '…';

    try {
      const hash = await sha256(code);

      if (hash === ACCESS_CODE_HASH) {
        // ✅ Codice corretto — mostra successo e avvia download
        formWrap.style.display = 'none';
        successWrap.style.display = 'flex';

        // Avvia download automatico
        const link = document.createElement('a');
        link.href = DOWNLOAD_FILE;
        link.download = 'supporto-ipcon.exe';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

      } else {
        // ❌ Codice errato
        input.classList.add('error');
        errorMsg.style.display = 'block';
        // Shake animation
        input.animate(
          [{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' },
           { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' },
           { transform: 'translateX(0)' }],
          { duration: 350, easing: 'ease-out' }
        );
      }
    } catch (err) {
      errorMsg.textContent = 'Errore di verifica. Riprova o contatta il supporto.';
      errorMsg.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Scarica';
    }
  }

  submitBtn.addEventListener('click', verifyAndDownload);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifyAndDownload();
    input.classList.remove('error');
    errorMsg.style.display = 'none';
  });

})();
