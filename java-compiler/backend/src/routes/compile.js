'use strict';

const express                             = require('express');
const rateLimit                           = require('express-rate-limit');
const { compileAndRun, SUPPORTED_LANGUAGES } = require('../compiler');

const router = express.Router();

// ─── Rate limiter: max 15 compile requests per minute per IP ─────────────────
const compileLimiter = rateLimit({
  windowMs       : 60 * 1000,
  max            : 15,
  standardHeaders: true,
  legacyHeaders  : false,
  message        : {
    success: false,
    error  : 'Too many requests. Please wait a moment before trying again.',
  },
});

// ─── POST /api/compile ────────────────────────────────────────────────────────
/**
 * Body (JSON):
 *   sourceCode {string}  — required, max 50 KB
 *   language   {string}  — optional, default "java"
 *                          one of: java | python | c | cpp
 *   stdin      {string}  — optional, max 4 KB
 *
 * Response (JSON):
 *   { success, output, error, stage, executionTime }
 */
router.post('/', compileLimiter, async (req, res) => {
  const { sourceCode, stdin = '', language = 'java' } = req.body;

  // ── sourceCode validation ─────────────────────────────────────────────────
  if (!sourceCode || typeof sourceCode !== 'string') {
    return res.status(400).json({
      success: false,
      output : '',
      error  : '`sourceCode` is required and must be a string.',
      stage  : 'validation',
    });
  }

  if (sourceCode.length > 50_000) {
    return res.status(413).json({
      success: false,
      output : '',
      error  : 'Source code exceeds the 50 KB limit.',
      stage  : 'validation',
    });
  }

  // ── language validation ───────────────────────────────────────────────────
  if (typeof language !== 'string' || !SUPPORTED_LANGUAGES.includes(language)) {
    return res.status(400).json({
      success: false,
      output : '',
      error  : `Unsupported language: "${language}". Supported languages are: ${SUPPORTED_LANGUAGES.join(', ')}.`,
      stage  : 'validation',
    });
  }

  // ── stdin validation ──────────────────────────────────────────────────────
  if (typeof stdin !== 'string') {
    return res.status(400).json({
      success: false,
      output : '',
      error  : '`stdin` must be a string.',
      stage  : 'validation',
    });
  }

  if (stdin.length > 4_000) {
    return res.status(413).json({
      success: false,
      output : '',
      error  : 'stdin input exceeds the 4 KB limit.',
      stage  : 'validation',
    });
  }

  // ── Compile & run ─────────────────────────────────────────────────────────
  const startTime = Date.now();

  try {
    const result        = await compileAndRun(sourceCode, stdin, language);
    const executionTime = Date.now() - startTime;

    return res.status(200).json({ ...result, executionTime });
  } catch (err) {
    console.error('[/api/compile] Unexpected error:', err);
    return res.status(500).json({
      success: false,
      output : '',
      error  : 'An internal server error occurred. Please try again.',
      stage  : 'internal',
    });
  }
});

module.exports = router;
