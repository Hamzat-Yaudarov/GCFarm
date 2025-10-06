const path = require('path');
const express = require('express');

function attachMiniappRoutes(app, { BASE_URL, BOT_USERNAME, BOT_WEBAPP_PATH }){
  app.use('/miniapp/static', express.static(path.join(__dirname, '..', '..', 'miniapp')));
  app.get('/miniapp/config.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    const safe = { BASE_URL, BOT_USERNAME, BOT_WEBAPP_PATH };
    res.send(`window.APP_CONFIG = ${JSON.stringify(safe)};`);
  });
  app.get('/miniapp', (req, res) => { res.sendFile(path.join(__dirname, '..', '..', 'miniapp', 'index.html')); });
  app.get('/', (req, res) => { res.redirect('/miniapp'); });
}

module.exports = { attachMiniappRoutes };
