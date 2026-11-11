// Route integrazione apparati di rete
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/network.controller');
const { requireAuth } = require('../middleware/auth.middleware');

// Riceve i parametri dal redirect del captive portal (GET da MikroTik/Ruijie)
router.get('/portal-params', ctrl.receivePortalParams);

// Autorizza l'accesso alla rete (richiede JWT valido)
router.post('/authorize', requireAuth, ctrl.authorizeAccess);

// Disconnette dalla rete
router.post('/logout', requireAuth, ctrl.revokeAccess);

// Stato sessione corrente
router.get('/status', requireAuth, ctrl.getStatus);

module.exports = router;
