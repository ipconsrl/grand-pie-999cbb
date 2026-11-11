// Logica pagina registrazione
document.addEventListener('DOMContentLoaded', () => {
  const form    = document.getElementById('registerForm');
  const btnSubmit = document.getElementById('btnSubmit');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('alertMsg');
    if (!validateForm()) return;

    setButtonLoading(btnSubmit, true);

    const portalData = getPortalData();
    const payload = {
      nome:              form.nome.value.trim(),
      cognome:           form.cognome.value.trim(),
      email:             form.email.value.trim().toLowerCase(),
      telefono:          form.telefono?.value.trim() || '',
      gdprConsent:       form.gdprConsent.checked,
      marketingConsent:  form.marketingConsent?.checked || false,
      lingua:            document.documentElement.lang || 'it',
      mac:               portalData.mac || ''
    };

    try {
      const res = await apiCall('/api/auth/register', 'POST', payload);

      // Salva il contesto per la pagina verify
      sessionStorage.setItem('verifyContext', JSON.stringify({
        userId:  res.data.userId,
        purpose: res.data.purpose,
        email:   payload.email,
        nome:    payload.nome
      }));

      // Passa i parametri portale nell'URL così iOS li trova anche dopo ricarica
      const verifyParams = new URLSearchParams();
      if (portalData.mac)       verifyParams.set('mac',       portalData.mac);
      if (portalData.token)     verifyParams.set('token',     portalData.token);
      if (portalData.gwAddress) verifyParams.set('gwAddress', portalData.gwAddress);
      if (portalData.gwPort)    verifyParams.set('gwPort',    portalData.gwPort);
      const qs = verifyParams.toString();
      window.location.href = '/verify' + (qs ? '?' + qs : '');
    } catch (err) {
      showAlert('alertMsg', err.message || t('error_generic'), 'error');
    } finally {
      setButtonLoading(btnSubmit, false);
    }
  });

  function validateForm() {
    let valid = true;

    // Nome
    const nome = form.nome.value.trim();
    setFieldError('nome', !nome ? t('required') : '');
    if (!nome) valid = false;

    // Cognome
    const cognome = form.cognome.value.trim();
    setFieldError('cognome', !cognome ? t('required') : '');
    if (!cognome) valid = false;

    // Email
    const email = form.email.value.trim();
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    setFieldError('email', !emailRx.test(email) ? t('email_invalid') : '');
    if (!emailRx.test(email)) valid = false;

    // GDPR
    if (!form.gdprConsent.checked) {
      setFieldError('gdprConsent', 'Devi accettare i termini e la privacy policy');
      valid = false;
    } else {
      setFieldError('gdprConsent', '');
    }

    return valid;
  }

  function setFieldError(name, msg) {
    const input = form[name];
    const errEl = document.getElementById(`err_${name}`);
    if (input) input.classList.toggle('error', !!msg);
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.toggle('visible', !!msg);
    }
  }

  // Pulisce l'errore quando l'utente inizia a digitare
  form.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      inp.classList.remove('error');
      const errEl = document.getElementById(`err_${inp.name}`);
      if (errEl) errEl.classList.remove('visible');
    });
  });
});
