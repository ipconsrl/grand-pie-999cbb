// PM2 — Configurazione processo per deployment in produzione
// Avvio: pm2 start ecosystem.config.js --env production
// Gestione: pm2 status | pm2 logs captive-portal | pm2 restart captive-portal

module.exports = {
    apps: [{
        name:        'captive-portal',
        script:      'server.js',
        instances:   1,               // 1 istanza (SQLite non supporta multi-processo)
        exec_mode:   'fork',
        watch:       false,
        max_memory_restart: '256M',

        // Variabili d'ambiente per sviluppo
        env: {
            NODE_ENV: 'development',
            PORT:     3000
        },

        // Variabili d'ambiente per produzione
        env_production: {
            NODE_ENV: 'production',
            PORT:     3000
        },

        // Log
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
        error_file:  './logs/pm2-error.log',
        out_file:    './logs/pm2-out.log',
        merge_logs:  true,

        // Riavvio automatico in caso di crash
        autorestart:      true,
        restart_delay:    3000,
        max_restarts:     10,
        min_uptime:       '10s',

        // Graceful shutdown
        kill_timeout:     5000,
        listen_timeout:   8000,
    }]
};
