// Server minimale per preview locale — solo UI, nessun database
const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.static(path.join(__dirname, 'public')));

const views = path.join(__dirname, 'views');
app.get('/',        (req, res) => res.sendFile(path.join(views, 'index.html')));
app.get('/register',(req, res) => res.sendFile(path.join(views, 'register.html')));
app.get('/login',   (req, res) => res.sendFile(path.join(views, 'login.html')));
app.get('/verify',  (req, res) => res.sendFile(path.join(views, 'verify.html')));
app.get('/success', (req, res) => res.sendFile(path.join(views, 'success.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(views, 'privacy.html')));
app.get('/terms',   (req, res) => res.sendFile(path.join(views, 'terms.html')));
app.get('/health',  (req, res) => res.json({ status: 'ok' }));

app.listen(3000, () => console.log('Preview su http://localhost:3000'));
