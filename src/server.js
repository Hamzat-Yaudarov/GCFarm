import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, initAdsSchema } from './db.js';
import { initBot } from './bot.js';
import { api } from './api.js';
import { adsGramRouter } from './adsgram.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', api);
app.use('/', adsGramRouter);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/app.html'));
});
app.get('/', (_req, res) => res.redirect('/app'));
app.get('/miniapp', (_req, res) => res.redirect('/app'));
app.get('/miniapp/', (_req, res) => res.redirect('/app'));
app.use('/', express.static(path.join(__dirname, '../public')));

const port = process.env.PORT || 3000;

initDb()
  .then(initAdsSchema)
  .then(async () => {
    await initBot(app);
    app.listen(port, () => console.log(`Server listening on :${port}`));
  })
  .catch((e) => {
    console.error('Failed to init server', e);
    process.exit(1);
  });
