'use strict';

require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const path         = require('path');
const compileRoute = require('./routes/compile');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Security middleware ─────────────────────────────────────────────────────
app.use(
  helmet({
    // Disable HSTS — this server runs over plain HTTP; HSTS would cause
    // browsers to refuse future HTTP connections and force HTTPS instead.
    strictTransportSecurity: false,

    // Allow Monaco Editor to load from CDN (required for CSP)
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc             : ["'self'"],
        scriptSrc              : [
          "'self'",
          "'unsafe-eval'",           // Monaco Editor requires eval()
          'https://cdn.jsdelivr.net',
        ],
        workerSrc              : ["'self'", 'blob:'],  // Monaco Editor web workers
        styleSrc               : ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        fontSrc                : ["'self'", 'https://cdn.jsdelivr.net'],
        connectSrc             : ["'self'"],
        imgSrc                 : ["'self'", 'data:'],
        baseUri                : ["'self'"],
        formAction             : ["'self'"],
        frameAncestors         : ["'self'"],
        objectSrc              : ["'none'"],
        scriptSrcAttr          : ["'none'"],
      },
    },
  })
);

app.use(
  cors({
    origin : process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  })
);

// ─── Body parsing (50 KB max) ────────────────────────────────────────────────
app.use(express.json({ limit: '60kb' }));
app.use(express.urlencoded({ extended: false, limit: '60kb' }));

// ─── Static frontend ─────────────────────────────────────────────────────────
const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

// ─── API routes ──────────────────────────────────────────────────────────────
app.use('/api/compile', compileRoute);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── 404 for unknown /api/* routes ───────────────────────────────────────────
// Must be registered BEFORE the SPA fallback so that requests like
// GET /api/unknown-endpoint return a JSON 404 instead of index.html.
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: 'Not Found.' });
});

// ─── SPA fallback: serve index.html for any unknown route ────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Java Compiler API running on http://0.0.0.0:${PORT}`);
  });
}

module.exports = app; // exported for supertest in integration tests
