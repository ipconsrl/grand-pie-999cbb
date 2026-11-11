// Utility condivise tra tutte le pagine del portale

// I18n minima: IT (default) ed EN
const I18N = {
  it: {
    loading:         'Caricamento...',
    error_generic:   'Si è verificato un errore. Riprova.',
    required:        'Campo obbligatorio',
    email_invalid:   'Inserisci un\'email valida',
    otp_invalid:     'Inserisci un codice a 6 cifre',
  },
  en: {
    loading:         'Loading...',
    error_generic:   'An error occurred. Please try again.',
    required:        'Required field',
    email_invalid:   'Please enter a valid email',
    otp_invalid:     'Please enter a 6-digit code',
  }
};

const lang = document.documentElement.lang || navigator.language?.split('-')[0] || 'it';
const t = (key) => (I18N[lang] || I18N.it)[key] || key;

// Legge i parametri del captive portal dall'URL e li salva in sessionStorage
function capturePortalParams() {
  const params = new URLSearchParams(window.location.search);
  const portalData = {
    mac:       params.get('mac')        || params.get('userMac')   || params.get('wlanusermac') || params.get('wlan_user_mac'),
    ip:        params.get('ip')         || params.get('userip')    || params.get('user_ip'),
    gwAddress: params.get('gwAddress')  || params.get('gw_address') || params.get('gw-address'),
    gwPort:    params.get('gwPort')     || params.get('gw_port')   || params.get('gw-port'),
    token:     params.get('token') || params.get('chap_challenge'),
    chapId:    params.get('chap_id'),
    ssid:      params.get('ssid'),
    apMac:     params.get('apMac')      || params.get('ap-mac')    || params.get('ap_mac'),
    linkLogin: params.get('link-login-only') || params.get('linkLogin'),
    linkOrig:  params.get('link-orig')  || params.get('linkOrig')  || params.get('url') || params.get('userurl'),
  };

  // Salva solo se ci sono parametri utili
  if (Object.values(portalData).some(v => v)) {
    sessionStorage.setItem('portalData', JSON.stringify(portalData));
  }
  return portalData;
}

function getPortalData() {
  try {
    return JSON.parse(sessionStorage.getItem('portalData') || '{}');
  } catch { return {}; }
}

// Chiamata API unificata con gestione errori
async function apiCall(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(endpoint, opts);
  const data = await res.json();

  if (!res.ok) {
    const err = new Error(data.error || t('error_generic'));
    err.code = data.code;
    err.data = data;
    throw err;
  }
  return data;
}

// Mostra/nasconde un alert
function showAlert(elId, message, type = 'error') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.className = `alert alert-${type} visible`;
}

function hideAlert(elId) {
  const el = document.getElementById(elId);
  if (el) el.className = 'alert';
}

// Imposta lo stato di caricamento di un bottone
function setButtonLoading(btn, loading) {
  const spinner = btn.querySelector('.spinner');
  const text    = btn.querySelector('.btn-text');
  btn.disabled  = loading;
  if (spinner) spinner.classList.toggle('visible', loading);
  if (text)    text.style.opacity = loading ? '0.5' : '1';
}

// Salva il token JWT in localStorage (alternativa ai cookie)
function saveToken(token) {
  if (token) localStorage.setItem('captive_token', token);
}

function getToken() {
  return localStorage.getItem('captive_token');
}

function clearToken() {
  localStorage.removeItem('captive_token');
  sessionStorage.removeItem('portalData');
  sessionStorage.removeItem('verifyContext');
}

// Init: cattura i parametri del captive portal all'avvio di ogni pagina
capturePortalParams();
