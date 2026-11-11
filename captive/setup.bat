@echo off
echo === Captive Portal Setup ===
echo.

REM Crea .env da .env.example se non esiste
if not exist .env (
    echo [1/3] Creazione .env da .env.example...
    copy .env.example .env >nul
    echo       .env creato. Aprilo e compila i valori prima di continuare.
    echo.
    notepad .env
) else (
    echo [1/3] .env gia presente. OK.
)

REM Crea directory data e logs se non esistono
if not exist data mkdir data
if not exist logs mkdir logs
echo [2/3] Directory data/ e logs/ OK.

REM Avvia con Docker
echo [3/3] Avvio Docker...
docker compose up -d

echo.
echo === Completato ===
echo Captive Portal: http://localhost:3000
echo Admin Portal:   http://localhost:3000/admin
echo.
pause
