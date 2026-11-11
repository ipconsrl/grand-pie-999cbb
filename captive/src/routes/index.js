// Router principale: aggrega tutte le route dell'applicazione
const express  = require('express');
const path     = require('path');
const router   = express.Router();
const authRoutes    = require('./auth.routes');
const networkRoutes = require('./network.routes');

// API REST
router.use('/api/auth',    authRoutes);
router.use('/api/network', networkRoutes);

// Pagine HTML del portale (serve i file statici dalla cartella views/)
const viewsDir = path.join(process.cwd(), 'views');

router.get('/',          (req, res) => res.sendFile(path.join(viewsDir, 'index.html')));
router.get('/register',  (req, res) => res.sendFile(path.join(viewsDir, 'register.html')));
router.get('/login',     (req, res) => res.sendFile(path.join(viewsDir, 'login.html')));
router.get('/verify',    (req, res) => res.sendFile(path.join(viewsDir, 'verify.html')));
router.get('/success',   (req, res) => res.sendFile(path.join(viewsDir, 'success.html')));
router.get('/privacy',   (req, res) => res.sendFile(path.join(viewsDir, 'privacy.html')));
router.get('/terms',     (req, res) => res.sendFile(path.join(viewsDir, 'terms.html')));

// Endpoint di redirect del captive portal (MikroTik, Ruijie)
// Il router del dispositivo manda l'utente qui con i parametri di rete
router.get('/portal',    (req, res) => {
    const query = new URLSearchParams(req.query).toString();
    res.redirect(`/?${query}`);
});

module.exports = router;
