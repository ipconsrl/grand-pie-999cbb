# pfSense — Configurazione Captive Portal

## Prerequisiti
- pfSense 2.6+ o pfSense Plus 22.x+
- Pacchetto **pfSense-pkg-API** installato (per modalità voucher)
- Accesso SSH o console per la configurazione RADIUS

---

## MODALITÀ A — RADIUS (consigliata)

### 1. Configura il Captive Portal su pfSense

1. Vai su **Services → Captive Portal**
2. Clicca **Add** per creare una nuova zona
3. Compila i campi:
   - **Zone Name**: `captiveportal`
   - **Interface**: seleziona l'interfaccia WiFi guest
   - **Maximum concurrent connections**: `0` (illimitato)
   - **Idle timeout**: `60` minuti
   - **Hard timeout**: `1440` minuti (24h)
   - **Enable**: ✓

### 2. Configura il redirect al portale esterno

Nella scheda **Portal Page Contents**:
- Seleziona **External authentication portal**
- **Authentication server URL**: `https://TUO_SERVER/portal?gwAddress=$GATEWAY_ADDRESS&gwPort=$GATEWAY_PORT`

In **Pre-authentication redirect URL**:
```
https://TUO_SERVER/?gwAddress=$GATEWAY_ADDRESS&gwPort=$GATEWAY_PORT&userMac=$CLIENT_MAC&userip=$CLIENT_IP
```

### 3. Configura RADIUS

1. Vai su **System → User Manager → Authentication Servers**
2. Clicca **Add**:
   - **Type**: `RADIUS`
   - **Hostname or IP**: IP del server captive portal
   - **Shared Secret**: valore di `RADIUS_SECRET` nel tuo `.env`
   - **Services offered**: `Authentication`
   - **Authentication port**: `1812`
   - **Authentication timeout**: `5`

3. Torna su **Services → Captive Portal → [zona]**
4. Scheda **Authentication**:
   - **Authentication method**: `RADIUS Authentication`
   - **Authentication server**: seleziona il server appena creato

### 4. Avvia il server RADIUS

Il server RADIUS è integrato nel captive portal. In `server.js` viene avviato
automaticamente quando `PFSENSE_MODE=radius` e `NETWORK_MODE=pfsense`.

Verifica che la porta UDP 1812 sia aperta sul firewall del server.

---

## MODALITÀ B — VOUCHER

### 1. Abilita i voucher su pfSense

1. **Services → Captive Portal → [zona] → Vouchers**
2. Abilita **Enable voucher support**
3. Crea un **roll** (serie di voucher):
   - **Roll #**: `1`
   - **Minutes per ticket**: `1440` (24h)
   - **Count**: `1000`
   - **Comment**: `Auto-generated`
4. Salva e genera il CSV dei voucher

### 2. Importa i voucher nel database locale

```bash
# Copia il CSV dei voucher nella tabella pfsense_vouchers
node scripts/import-vouchers.js --file vouchers.csv
```

### 3. Configura l'API pfSense

Installa il pacchetto **pfSense-pkg-API**:
1. **System → Package Manager → Available Packages**
2. Cerca `API` e installa
3. Vai su **System → API → Settings**:
   - **Enable API**: ✓
   - **API key**: copia in `PFSENSE_API_KEY`
   - **API secret**: copia in `PFSENSE_API_SECRET`

---

## Whitelist domini (entrambe le modalità)

In **Services → Captive Portal → [zona] → Allowed IP Addresses** o **Allowed Hostnames**:

```
TUO_SERVER_IP          # Il captive portal
smtp-relay.brevo.com   # Brevo SMTP
```

---

## Troubleshooting

- **Client non reindirizzato**: verifica che il gateway pfSense sia il default gateway della VLAN guest
- **RADIUS timeout**: controlla che la porta 1812/UDP sia raggiungibile dal pfSense al server
- **Voucher non trovato**: verifica la sincronizzazione con `/api/v1/services/captiveportal/voucher`
