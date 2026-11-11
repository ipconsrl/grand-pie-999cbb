# ============================================================
# MikroTik RouterOS — Comandi di configurazione Captive Portal
# Eseguire in: System → Terminal  oppure  via SSH
#
# SOSTITUIRE i valori MAIUSCOLI prima di eseguire:
#   CAPTIVE_PORTAL_URL  = URL del tuo server (es. https://wifi.esempio.it)
#   HOTSPOT_IFACE       = interfaccia WiFi (es. wlan1, bridge-lan)
#   HOTSPOT_IP_POOL     = range IP per gli ospiti (es. 192.168.99.2-192.168.99.254)
#   HOTSPOT_NETWORK     = rete con subnet mask (es. 192.168.99.0/24)
#   HOTSPOT_GATEWAY     = IP del gateway hotspot (es. 192.168.99.1)
#   DNS_SERVER          = DNS da usare (es. 8.8.8.8)
# ============================================================

# 1. Crea il pool di indirizzi IP per gli ospiti
/ip pool
add name=hotspot-pool ranges=HOTSPOT_IP_POOL

# 2. Crea il server DHCP per la rete hotspot
/ip dhcp-server
add address-pool=hotspot-pool disabled=no interface=HOTSPOT_IFACE name=dhcp-hotspot

/ip dhcp-server network
add address=HOTSPOT_NETWORK dns-server=DNS_SERVER gateway=HOTSPOT_GATEWAY

# 3. Assegna IP al gateway sull'interfaccia
/ip address
add address=HOTSPOT_GATEWAY/24 interface=HOTSPOT_IFACE

# 4. Crea il profilo hotspot (limiti di banda e timeout sessione)
/ip hotspot profile
add dns-name="" hotspot-address=HOTSPOT_GATEWAY html-directory=hotspot \
    http-cookie-lifetime=1d login-by=http-chap,http-pap \
    name=captive-profile rate-limit=10M/10M \
    session-timeout=1d smtp-server=0.0.0.0 split-user-domain=no

# 5. Crea il server hotspot
/ip hotspot
add address-pool=hotspot-pool disabled=no interface=HOTSPOT_IFACE \
    name=hotspot1 profile=captive-profile

# 6. Profilo utente ospite
/ip hotspot user profile
add name=guest idle-timeout=30m keepalive-timeout=2m \
    rate-limit=10M/10M session-timeout=24h

# 7. Whitelist domini necessari (accesso PRIMA dell'autenticazione)
#    Il captive portal e Brevo devono essere raggiungibili senza login
/ip hotspot walled-garden
add dst-host=CAPTIVE_PORTAL_HOSTNAME comment="Captive Portal server"
add dst-host=smtp-relay.brevo.com       comment="Brevo SMTP"
add dst-host=*.brevo.com                comment="Brevo services"
add dst-host=fonts.googleapis.com       comment="Google Fonts"
add dst-host=fonts.gstatic.com          comment="Google Fonts static"

# 8. Carica i template HTML personalizzati
#    Metodo 1: via FTP
#      ftp admin@ROUTER_IP
#      cd hotspot/
#      put login.html
#      put alogin.html
#      put logout.html
#      put error.html
#      put status.html
#
#    Metodo 2: via Winbox → Files → hotspot/

# 9. Imposta il redirect URL al nostro captive portal
#    Nel profilo hotspot, HTTP Redirect usa login.html che fa il redirect automatico

# 10. Verifica la configurazione
/ip hotspot print
/ip hotspot profile print
/ip hotspot user profile print

# ============================================================
# NOTA IMPORTANTE:
# Dopo aver caricato login.html, modifica il file sostituendo
# CAPTIVE_PORTAL_URL con l'URL reale del tuo server.
# ============================================================
