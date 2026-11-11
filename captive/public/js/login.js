// Logica pagina login (passwordless via OTP)
document.addEventListener('DOMContentLoaded', () => {
  const form      = document.getElementById('loginForm');
  const btnSubmit = document.getElementById('btnSubmit');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('alertMsg');

    const email = form.email.value.trim().toLowerCase();
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRx.test(email)) {
      showAlert('alertMsg', t('email_invalid'), 'error');
      return;
    }

    setButtonLoading(btnSubmit, true);

    const portalData = getPortalData();

    try {
      const res = await apiCall('/api/auth/login', 'POST', {
        email,
        mac: portalData.mac || ''
      });

      sessionStorage.setItem('verifyContext', JSON.stringify({
        userId:  res.data.userId,
        purpose: res.data.purpose || 'login',
        email:   email,
        nome:    ''
      }));

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
});
