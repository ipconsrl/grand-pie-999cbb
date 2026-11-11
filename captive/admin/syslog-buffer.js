// Buffer condiviso per gli ultimi messaggi syslog raw (debug)
// Importato sia da test-local.js (scrittura) che da admin/routes.js (lettura)
const MAX = 100;
const buffer = [];

function push(entry) {
    if (buffer.length >= MAX) buffer.shift();
    buffer.push(entry);
}

module.exports = { buffer, push };
