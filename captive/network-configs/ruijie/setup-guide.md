# Ruijie Reyee — Guida configurazione External Portal

## Prerequisiti
- Gateway/AP Ruijie Reyee con firmware recente
- Account Ruijie Cloud (cloud.ruijienetworks.com)
- API key ottenuta dal pannello sviluppatori Ruijie Cloud

---

## 1. Ottieni le credenziali API Ruijie Cloud

1. Accedi su **https://cloud.ruijienetworks.com**
2. Vai su **Account → Developer Settings → API Keys**
3. Crea una nuova API key:
   - **Name**: `CaptivePortal`
   - **Permissions**: `Network Read`, `Portal Auth`
4. Copia **API Key** → `RUIJIE_API_KEY` nel file `.env`
5. Copia **API Secret** → `RUIJIE_API_SECRET` nel file `.env`
6. Vai su **Organization → Settings**:
   - Copia **Tenant ID** → `RUIJIE_TENANT_ID`
7. Vai su **Networks** e seleziona la tua rete:
   - Copia **Network ID** → `RUIJIE_NETWORK_ID`

---

## 2. Configura l'External Portal nel pannello Ruijie Cloud

1. **Networks → [seleziona rete] → WiFi → SSID**
2. Seleziona l'SSID guest e clicca **Edit**
3. Scheda **Authentication**:
   - **Authentication Type**: `Portal`
   - **Portal Type**: `External Portal`
4. Compila il campo **Portal URL**:
   ```
   https://TUO_SERVER/?userMac={user_mac}&apMac={ap_mac}&ssid={ssid}&gwAddress={gw_ip}&gwPort={gw_port}
   ```
   Sostituire `TUO_SERVER` con il dominio del tuo captive portal.

5. **Success URL** (dopo autenticazione):
   ```
   https://TUO_SERVER/success
   ```

6. **Walled Garden** — aggiungi questi domini raggiungibili prima del login:
   ```
   TUO_DOMINIO.it
   smtp-relay.brevo.com
   fonts.googleapis.com
   fonts.gstatic.com
   ```

7. Salva e applica.

---

## 3. Configura i parametri nel file .env

```env
NETWORK_MODE=ruijie

RUIJIE_CLOUD_API_URL=https://openapi.ruijienetworks.com
RUIJIE_API_KEY=la_tua_api_key
RUIJIE_API_SECRET=il_tuo_api_secret
RUIJIE_TENANT_ID=il_tuo_tenant_id
RUIJIE_NETWORK_ID=il_tuo_network_id
RUIJIE_AUTH_DURATION=86400
```

---

## 4. Flusso di autenticazione

```
Utente si connette al WiFi
        ↓
Ruijie AP intercetta la prima richiesta HTTP
        ↓
Redirect a: TUO_SERVER/?userMac=AA:BB:CC:DD:EE:FF&apMac=...&ssid=GuestWiFi
        ↓
Utente si registra / fa login con email
        ↓
Verifica OTP via Brevo
        ↓
Server chiama: POST https://openapi.ruijienetworks.com/v1/portal/auth
  con userMac, tenantId, networkId, duration, sign
        ↓
Ruijie autorizza il MAC address
        ↓
Utente può navigare (redirect a successUrl)
```

---

## 5. Test della configurazione

```bash
# Verifica che il server risponda correttamente ai parametri Ruijie
curl "https://TUO_SERVER/api/network/portal-params?userMac=AA:BB:CC:DD:EE:FF&apMac=11:22:33:44:55:66&ssid=GuestWiFi&gwAddress=192.168.1.1&gwPort=8080"
```

Risposta attesa:
```json
{
  "success": true,
  "data": {
    "portalData": {
      "mac": "aa:bb:cc:dd:ee:ff",
      "apMac": "11:22:33:44:55:66",
      "ssid": "GuestWiFi",
      "gwAddress": "192.168.1.1",
      "gwPort": "8080"
    }
  }
}
```

---

## 6. Troubleshooting

| Problema | Soluzione |
|---|---|
| Client non reindirizzato | Verifica che il SSID abbia Portal Auth abilitato |
| Errore firma API | Controlla che i timestamp del server siano sincronizzati (NTP) |
| MAC non autorizzato | Verifica RUIJIE_TENANT_ID e RUIJIE_NETWORK_ID |
| Timeout API | Controlla che il server raggiunga openapi.ruijienetworks.com |
| Walled garden non funziona | Aggiorna il firmware dell'AP alla versione più recente |
