#!/bin/bash
set -e
echo "======================================"
echo "  Captive Portal — Setup produzione"
echo "======================================"
echo ""

# Directory necessarie
mkdir -p data logs

# Genera .env se non esiste
if [ -f .env ]; then
  echo "[OK] .env già presente, salto la generazione."
else
  echo "[1/3] Generazione .env con segreti casuali..."

  # Genera segreti sicuri (openssl disponibile su qualsiasi Linux)
  SESSION_SECRET=$(openssl rand -hex 64)
  ADMIN_SECRET=$(openssl rand -hex 64)

  # Rileva IP locale
  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  BASE_URL="http://${SERVER_IP}:3000"

  cat > .env <<EOF
# ============================================================
# CAPTIVE PORTAL — CONFIGURAZIONE PRODUZIONE
# Generato automaticamente da setup.sh
# ============================================================

NODE_ENV=production
PORT=3000
BASE_URL=${BASE_URL}

# Segreti (generati automaticamente — NON modificare)
SESSION_SECRET=${SESSION_SECRET}
ADMIN_SECRET=${ADMIN_SECRET}

# Database
DB_PATH=./data/captive_portal.db

# ── SMTP Brevo ───────────────────────────────────────────────
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=
BREVO_SMTP_PASSWORD=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=WiFi Guest

# ── OTP ──────────────────────────────────────────────────────
OTP_LENGTH=6
OTP_EXPIRES_MINUTES=10
OTP_MAX_ATTEMPTS=3
OTP_RESEND_COOLDOWN_SECONDS=60

# ── Rete ─────────────────────────────────────────────────────
NETWORK_MODE=ruijie
SYSLOG_PORT=5514

# ── Portale ──────────────────────────────────────────────────
PORTAL_NAME=WiFi Guest
PORTAL_COMPANY_NAME=
ALLOWED_ORIGINS=${BASE_URL}
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000
OTP_RATE_LIMIT_MAX=50

# ── Admin Portal ─────────────────────────────────────────────
ADMIN_USER=admin
ADMIN_PASSWORD=changeme_admin
RETENTION_MONTHS=6

# ── Ruijie Cloud API (opzionale) ─────────────────────────────
RUIJIE_CLOUD_URL=https://cloud-eu.ruijienetworks.com
RUIJIE_APPID=
RUIJIE_SECRET=
EOF

  echo "      .env generato in: $(pwd)/.env"
  echo ""
  echo "[2/3] Apri .env e compila almeno questi campi:"
  echo "      - BREVO_SMTP_USER"
  echo "      - BREVO_SMTP_PASSWORD"
  echo "      - BREVO_SENDER_EMAIL"
  echo "      - ADMIN_PASSWORD (cambia con password sicura!)"
  echo "      - PORTAL_COMPANY_NAME"
  echo ""
  echo "      BASE_URL rilevato automaticamente: ${BASE_URL}"
  echo "      Premi INVIO quando hai finito di editare .env..."
  nano .env
fi

echo "[3/3] Avvio Docker..."
docker compose up -d --build

echo ""
echo "======================================"
echo "  Deploy completato!"
echo "======================================"
docker compose ps
echo ""
echo "  Captive Portal: $(grep BASE_URL .env | cut -d= -f2)"
echo "  Admin Portal:   $(grep BASE_URL .env | cut -d= -f2)/admin"
echo "  Health check:   $(grep BASE_URL .env | cut -d= -f2)/health"
echo ""
