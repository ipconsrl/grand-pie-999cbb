// Logica pagina verifica OTP: 6 input separati, reinvio con cooldown, max 3 tentativi
document.addEventListener('DOMContentLoaded', () => {
  let context = JSON.parse(sessionStorage.getItem('verifyContext') || '{}');

  // Recovery iOS: sessionStorage svuotato dopo chiusura captive browser
  // Il server passa email nell'URL quando riconosce il MAC con OTP in sospeso
  if (!context.userId) {
    const urlParams = new URLSearchParams(window.location.search);
    const emailFromUrl = urlParams.get('email');
    if (emailFromUrl) {
      context = { userId: emailFromUrl, email: emailFromUrl, purpose: 'login' };
      sessionStorage.setItem('verifyContext', JSON.stringify(context));
      // Assicura che i parametri portale siano salvati
      capturePortalParams();
    } else {
      window.location.href = '/';
      return;
    }
  }

  // Mostra l'email a cui è stato mandato il codice
  const emailEl = document.getElementById('emailDisplay');
  if (emailEl) emailEl.textContent = context.email || '';

  // ── OTP Input a 6 celle ───────────────────────────────────────────────────
  const inputs = document.querySelectorAll('.otp-input');
  const btnVerify = document.getElementById('btnVerify');
  const btnResend = document.getElementById('btnResend');
  const timerEl   = document.getElementById('resendTimer');

  // Focus automatico sul primo campo
  if (inputs[0]) inputs[0].focus();

  inputs.forEach((inp, idx) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && idx > 0) {
        inputs[idx - 1].focus();
        inputs[idx - 1].value = '';
        inputs[idx - 1].classList.remove('filled');
      }
    });

    inp.addEventListener('input', (e) => {
      // Accetta solo cifre
      inp.value = inp.value.replace(/\D/g, '').slice(-1);
      inp.classList.toggle('filled', !!inp.value);

      if (inp.value && idx < inputs.length - 1) {
        inputs[idx + 1].focus();
      }

      // Se tutte le celle sono compilate, avvia la verifica automaticamente
      const otp = getOtpValue();
      if (otp.length === 6) {
        setTimeout(() => verifyOtp(otp), 120);
      }
    });

    // Gestione incolla (es. autofill SMS)
    inp.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      if (pasted.length >= 6) {
        pasted.split('').slice(0, 6).forEach((ch, i) => {
          if (inputs[i]) {
            inputs[i].value = ch;
            inputs[i].classList.add('filled');
          }
        });
        inputs[5]?.focus();
        setTimeout(() => verifyOtp(getOtpValue()), 120);
      }
    });
  });

  function getOtpValue() {
    return Array.from(inputs).map(i => i.value).join('');
  }

  function resetInputs(shakeError = false) {
    inputs.forEach(inp => {
      inp.value = '';
      inp.classList.remove('filled');
      if (shakeError) {
        inp.classList.add('error-state');
        setTimeout(() => inp.classList.remove('error-state'), 500);
      }
    });
    if (inputs[0]) inputs[0].focus();
  }

  // ── Verifica OTP ─────────────────────────────────────────────────────────
  async function verifyOtp(otp) {
    if (otp.length !== 6) return;

    setButtonLoading(btnVerify, true);
    hideAlert('alertMsg');

    try {
      const portalData = JSON.parse(sessionStorage.getItem('portalData') || '{}');
      const res = await apiCall('/api/auth/verify-otp', 'POST', {
        userId:  context.userId,
        otp,
        purpose: context.purpose,
        mac:     portalData.mac || ''
      });

      // Salva token
      saveToken(res.data.token);
      sessionStorage.removeItem('verifyContext');

      // Autorizza la rete — authorizeNetwork si occupa anche del redirect finale
      // (al gateway WiFiDog se portalData è valido, altrimenti a /success)
      await authorizeNetwork(res.data);

    } catch (err) {
      resetInputs(true);
      showAlert('alertMsg', err.message, 'error');

      if (err.code === 'MAX_ATTEMPTS') {
        // Blocca i campi e mostra solo il tasto reinvia
        inputs.forEach(inp => inp.disabled = true);
        btnVerify.disabled = true;
        if (btnResend) btnResend.disabled = false;
      }
    } finally {
      setButtonLoading(btnVerify, false);
    }
  }

  // Verifica manuale al click del bottone
  if (btnVerify) {
    btnVerify.addEventListener('click', () => verifyOtp(getOtpValue()));
  }

  // ── Autorizzazione rete dopo OTP valido ───────────────────────────────────
  async function authorizeNetwork(userData) {
    const portalData = getPortalData();
    try {
      await apiCall('/api/network/authorize', 'POST', {
        ...portalData,
        userId: userData.user?.id
      });
    } catch {
      // Non bloccare il flusso se l'autorizzazione di rete fallisce
    }

    // Redirect al gateway per aprire la connessione (protocollo WiFiDog obbligatorio)
    const { gwAddress, gwPort, token } = portalData;
    if (gwAddress && token) {
      const port = gwPort || '2060';
      const gatewayAuthUrl = `http://${gwAddress}:${port}/wifidog/auth?token=${token}`;
      console.log('[WiFiDog] Redirect gateway:', gatewayAuthUrl);
      window.location.href = gatewayAuthUrl;
      return;
    }

    // Fallback diretto: usa URL configurato sul server
    try {
      const cfg = await fetch('/api/config').then(r => r.json());
      window.location.href = cfg.redirectUrl || '/success';
    } catch {
      window.location.href = '/success';
    }
  }

  // ── Reinvio OTP con cooldown ──────────────────────────────────────────────
  let countdownInterval = null;

  function startCooldown(seconds = 60) {
    if (btnResend) btnResend.disabled = true;
    let remaining = seconds;

    if (timerEl) timerEl.textContent = `Richiedi un nuovo codice tra ${remaining}s`;

    countdownInterval = setInterval(() => {
      remaining--;
      if (timerEl) timerEl.textContent = `Richiedi un nuovo codice tra ${remaining}s`;

      if (remaining <= 0) {
        clearInterval(countdownInterval);
        if (btnResend) btnResend.disabled = false;
        if (timerEl)   timerEl.textContent = '';
      }
    }, 1000);
  }

  // Avvia il cooldown al caricamento (il codice è appena stato inviato)
  startCooldown(parseInt(60));

  if (btnResend) {
    btnResend.addEventListener('click', async () => {
      btnResend.disabled = true;
      hideAlert('alertMsg');

      try {
        await apiCall('/api/auth/resend-otp', 'POST', {
          userId:  context.userId,
          purpose: context.purpose
        });
        showAlert('alertMsg', 'Nuovo codice inviato alla tua email.', 'success');
        resetInputs();
        startCooldown(60);
      } catch (err) {
        showAlert('alertMsg', err.message, 'error');
        if (err.data?.data?.remaining) {
          startCooldown(err.data.data.remaining);
        } else {
          btnResend.disabled = false;
        }
      }
    });
  }
});
