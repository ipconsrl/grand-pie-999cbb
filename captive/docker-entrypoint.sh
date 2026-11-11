#!/bin/sh
# Crea e corregge permessi directory dati (eseguito come root)
mkdir -p /app/data /app/logs
chown -R node:node /app/data /app/logs
# Passa a utente node ed esegui il comando
exec su-exec node "$@"
