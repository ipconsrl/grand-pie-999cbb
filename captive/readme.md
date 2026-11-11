# Captive Portal — Email + OTP con MikroTik, pfSense, Ruijie Reyee

Captive portal completo con autenticazione passwordless via email + OTP.
Supporta tre modalità di integrazione hardware: MikroTik RouterOS, pfSense e Ruijie Reyee.

---

## Struttura del progetto

```
captive-portal/
├── src/
│   ├── config/          # database.js, logger.js, app.js
│   ├── controllers/     # auth.controller.js, network.controller.js
│   ├── middleware/       # auth, error, rateLimit, validation
│   ├── models/          # user, otp, session, accessLog
│   ├── routes/          # auth.routes.js, network.routes.js, index.js
│   ├── services/        # email, otp, mikrotik, pfsense, ruijie
│   └── utils/           # helpers.js
├── public/              # CSS, JS, immagini
├── views/               # HTML pages (index, register, login, verify, success)
├── templates/           # email-otp.html
├── network-configs/
│   ├── mikrotik/        # login.html, alogin.html, logout.html, error.html, status.html, setup-commands.rsc
│   ├── pfsense/         # captive-portal-config.xml, README.md
│   └── ruijie/          # setup-guide.md
├── migrations/          # 001_initial.sql, run.js
├── .env.example
├── server.js
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
└── ecosystem.config.js
```

---

## Installazione rapida

### Prerequisiti
- Node.js 18+
- npm 9+

### 1. Clona e installa

```bash
cd captive-portal
npm install
```

### 2. Configura l'ambiente

```bash
cp .env.example .env
# Edita .env con i tuoi valori (vedi sezioni sotto)
```

### 3. Esegui le migrazioni database

```bash
npm run migrate
```

### 4. Avvia in modalità sviluppo

```bash
npm run dev
```

Il portale sarà disponibile su **http://localhost:3000**

> **Modalità demo** (default): non richiede apparati di rete reali. Imposta `NETWORK_MODE=demo` nel `.env`.

---

## Configurazione Brevo (SMTP)

1. Crea un account su [brevo.com](https://brevo.com)
2. Vai su **Settings → SMTP & API → SMTP**
3. Crea un nuovo SMTP key
4. Compila nel `.env`:

```env
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=la_tua_email@esempio.it
BREVO_SMTP_PASSWORD=xsmtpib-XXXXXXXXXXXXXXXXXX
BREVO_SENDER_EMAIL=noreply@tuodominio.it
BREVO_SENDER_NAME=WiFi Guest
```

5. Verifica che il dominio mittente sia autenticato (SPF + DKIM) su Brevo.

---

## Setup MikroTik

### Configurazione rapida

```bash
# 1. Modifica setup-commands.rsc sostituendo i placeholder MAIUSCOLI
# 2. Esegui via SSH o terminal RouterOS:
/import file-name=setup-commands.rsc

# 3. Carica i template HTML via FTP:
ftp admin@IP_MIKROTIK
cd hotspot/
put network-configs/mikrotik/login.html
put network-configs/mikrotik/alogin.html
put network-configs/mikrotik/logout.html
put network-configs/mikrotik/error.html
put network-configs/mikrotik/status.html
```

### Modifica login.html

Apri `network-configs/mikrotik/login.html` e sostituisci `CAPTIVE_PORTAL_URL` con l'URL reale del tuo server, es. `https://wifi.tuodominio.it`.

### Variabili .env richieste

```env
NETWORK_MODE=mikrotik
MIKROTIK_HOST=192.168.88.1
MIKROTIK_USER=admin
MIKROTIK_PASSWORD=la_tua_password
MIKROTIK_PORT=8728
MIKROTIK_HOTSPOT_PROFILE=default
MIKROTIK_SESSION_TIMEOUT=24h
MIKROTIK_RATE_LIMIT=10M/10M
```

### Flusso MikroTik

```
Client → WiFi → MikroTik intercetta HTTP
  → mostra login.html (redirect al portale esterno)
  → utente si registra/logga con email
  → OTP verificato → POST /api/network/authorize
  → server chiama RouterOS API → crea utente hotspot
  → MikroTik autorizza il client
```

---

## Setup pfSense

Vedi la guida dettagliata in [`network-configs/pfsense/README.md`](network-configs/pfsense/README.md).

### Modalità RADIUS (consigliata)

```env
NETWORK_MODE=pfsense
PFSENSE_MODE=radius
RADIUS_SECRET=segreto_sicuro_almeno_20_caratteri
RADIUS_PORT=1812
```

Il server RADIUS UDP viene avviato automaticamente insieme all'app.
Assicurarsi che la porta 1812/UDP sia aperta nel firewall del server.

### Modalità Voucher

```env
NETWORK_MODE=pfsense
PFSENSE_MODE=voucher
PFSENSE_HOST=https://192.168.1.1
PFSENSE_API_KEY=la_tua_api_key
PFSENSE_API_SECRET=il_tuo_api_secret
```

---

## Setup Ruijie Reyee

Vedi la guida completa in [`network-configs/ruijie/setup-guide.md`](network-configs/ruijie/setup-guide.md).

```env
NETWORK_MODE=ruijie
RUIJIE_CLOUD_API_URL=https://openapi.ruijienetworks.com
RUIJIE_API_KEY=la_tua_api_key
RUIJIE_API_SECRET=il_tuo_api_secret
RUIJIE_TENANT_ID=il_tuo_tenant_id
RUIJIE_NETWORK_ID=il_tuo_network_id
RUIJIE_AUTH_DURATION=86400
```

**URL portale da configurare sul pannello Ruijie Cloud:**
```
https://TUO_SERVER/?userMac={user_mac}&apMac={ap_mac}&ssid={ssid}&gwAddress={gw_ip}&gwPort={gw_port}
```

---

## Test in locale

```bash
# Avvia in modalità demo (nessun apparato reale)
NETWORK_MODE=demo npm run dev

# Test registrazione
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"nome":"Mario","cognome":"Rossi","email":"test@esempio.it","gdprConsent":true}'

# Il codice OTP viene stampato in console in modalità development
# Test verifica OTP
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"userId":1,"otp":"123456","purpose":"registration"}'

# Health check
curl http://localhost:3000/health
```

---

## Deploy in produzione

### Con PM2

```bash
npm install -g pm2

# Avvia
pm2 start ecosystem.config.js --env production

# Salva la configurazione per l'avvio automatico
pm2 save
pm2 startup

# Monitoraggio
pm2 status
pm2 logs captive-portal
```

### Con Docker

```bash
# Build e avvio solo Node.js
docker compose up -d captive-portal

# Con Nginx (SSL)
docker compose --profile production up -d
```

### SSL con Let's Encrypt

```bash
# Installa certbot
apt install certbot python3-certbot-nginx

# Ottieni il certificato (Nginx deve essere in ascolto sulla 80)
certbot --nginx -d wifi.tuodominio.it

# Il rinnovo automatico è già configurato da certbot
# Verifica: certbot renew --dry-run
```

### Configurazione Nginx

Modifica `nginx.conf` sostituendo `wifi.tuodominio.it` con il tuo dominio reale, poi:

```bash
# Senza Docker
cp nginx.conf /etc/nginx/conf.d/captive-portal.conf
nginx -t && systemctl reload nginx
```

---

## Sicurezza — Checklist produzione

- [ ] Cambia `SESSION_SECRET` e `JWT_SECRET` con valori casuali lunghi (32+ caratteri)
- [ ] Imposta `NODE_ENV=production`
- [ ] Configura HTTPS (Let's Encrypt)
- [ ] Aggiorna `ALLOWED_ORIGINS` con il dominio reale
- [ ] Configura `RADIUS_SECRET` con valore forte (solo per pfSense RADIUS)
- [ ] Abilita firewall: apri solo 80/443 (HTTP/HTTPS) e 1812/UDP (solo se RADIUS)
- [ ] Configura backup periodico del file SQLite in `data/`
- [ ] Imposta rotazione log in `logs/` (già configurata con winston-daily-rotate-file)

---

## Variabili .env — Riferimento completo

Vedi [`.env.example`](.env.example) per l'elenco completo con descrizioni.

---

## Licenza

MIT
