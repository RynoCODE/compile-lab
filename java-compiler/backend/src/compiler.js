'use strict';

/**
 * compiler.js
 * Core Java compilation and execution engine.
 *
 * Pipeline:
 *   1. Extract the public class name from source (determines filename).
 *   2. Write source to an isolated temp directory.
 *   3. Compile with `javac` (COMPILE_TIMEOUT).
 *   4. Execute with `java`  (RUN_TIMEOUT — kills infinite loops).
 *   5. Clean up temp dir unconditionally.
 *   6. Return structured result: { success, output, error, stage }.
 *
 * Security notes:
 *   - Uses child_process.spawn (no shell: true) to prevent injection.
 *   - JVM flags: -Xmx256m limits heap; -Xss512k limits stack depth.
 *   - Output is capped at MAX_OUTPUT_BYTES to prevent memory exhaustion.
 *   - Temp dir is UUID-namespaced to prevent filename collisions.
 */

const { spawn }  = require('child_process');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');
const { v4: uuidv4 } = require('uuid');

// ─── Tuneable constants ────────────────────────────────────────────────────────

const COMPILE_TIMEOUT_MS  = 10_000;   // javac gets 10 s
const RUN_TIMEOUT_MS      = 5_000;    // java   gets  5 s  (catches infinite loops)
const MAX_OUTPUT_BYTES    = 100_000;  // 100 KB cap on stdout + stderr combined
const TEMP_ROOT           = os.tmpdir();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the entry-point class name from Java source.
 *
 * Strategy (in priority order):
 *   1. `public class Foo`  → must be the filename
 *   2. Any class containing `public static void main`
 *   3. First `class Foo` found
 *
 * Returns null when no class is found at all.
 */
function extractClassName(source) {
  // 1. Public class — required filename match
  const publicMatch = source.match(/public\s+class\s+([A-Za-z_$][A-Za-z\d_$]*)/);
  if (publicMatch) return publicMatch[1];

  // 2. Class that hosts main()
  const mainBlock = source.match(
    /class\s+([A-Za-z_$][A-Za-z\d_$]*)[\s\S]*?public\s+static\s+void\s+main/
  );
  if (mainBlock) return mainBlock[1];

  // 3. First class encountered
  const anyClass = source.match(/\bclass\s+([A-Za-z_$][A-Za-z\d_$]*)/);
  if (anyClass) return anyClass[1];

  return null;
}

/**
 * Spawn a child process and return a promise that resolves to
 * { stdout, stderr, code } or rejects with { type: 'TIMEOUT', message }.
 *
 * @param {string}   cmd
 * @param {string[]} args
 * @param {object}   opts  - { cwd, timeoutMs, stdinData? }
 */
function spawnAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const { cwd, timeoutMs, stdinData = '' } = opts;

    const child = spawn(cmd, args, {
      cwd,
      shell: false,               // Never use shell — prevents injection
      env : { PATH: process.env.PATH }, // Minimal env
    });

    let stdout      = '';
    let stderr      = '';
    let outputBytes = 0;
    let timedOut    = false;

    // Kill the process after timeoutMs
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    // Pipe optional stdin (e.g., Scanner input)
    if (stdinData) {
      child.stdin.write(stdinData);
    }
    child.stdin.end();

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf8');
      } else {
        // Output flood — kill the process
        child.kill('SIGKILL');
      }
    });

    child.stderr.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_OUTPUT_BYTES) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return reject({
          type   : 'TIMEOUT',
          message: 'Execution timed out after 5 seconds. Your program may contain an infinite loop.',
        });
      }
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Strip the (UUID) temp directory prefix from javac error messages so the
 * user sees clean paths like  `Main.java:4: error: ...`  instead of
 * `/tmp/java_compiler_<uuid>/Main.java:4: error: ...`.
 */
function sanitizePaths(text, tempDir) {
  // Escape special regex chars in the path, then replace globally
  const escaped = tempDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped + path.sep + '?', 'g'), '').trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compile and run Java source code.
 *
 * @param {string} sourceCode  - Raw Java source.
 * @param {string} [stdin=''] - Data to pipe to the running program's stdin.
 *
 * @returns {Promise<{
 *   success : boolean,
 *   output  : string,   // stdout from the running program
 *   error   : string,   // stderr (compile errors, runtime exceptions, timeout)
 *   stage   : 'validation' | 'compilation' | 'execution' | 'timeout'
 * }>}
 */
async function compileAndRun(sourceCode, stdin = '') {
  // ── 1. Validate ─────────────────────────────────────────────────────────────
  if (!sourceCode || typeof sourceCode !== 'string') {
    return { success: false, output: '', error: 'No source code provided.', stage: 'validation' };
  }

  const trimmed = sourceCode.trim();
  if (trimmed.length === 0) {
    return { success: false, output: '', error: 'Source code is empty.', stage: 'validation' };
  }

  const className = extractClassName(trimmed);
  if (!className) {
    return {
      success: false,
      output : '',
      error  : 'Could not detect a Java class. Make sure your code contains at least one `class` definition.',
      stage  : 'validation',
    };
  }

  // ── 2. Set up isolated temp directory ───────────────────────────────────────
  const tempDir  = path.join(TEMP_ROOT, `java_compiler_${uuidv4()}`);
  const javaFile = path.join(tempDir, `${className}.java`);

  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(javaFile, trimmed, 'utf8');

    // ── 3. Compile ─────────────────────────────────────────────────────────────
    let compileResult;
    try {
      compileResult = await spawnAsync('javac', [javaFile], {
        cwd      : tempDir,
        timeoutMs: COMPILE_TIMEOUT_MS,
      });
    } catch (err) {
      if (err.type === 'TIMEOUT') {
        return { success: false, output: '', error: 'Compilation timed out.', stage: 'timeout' };
      }
      throw err;
    }

    // javac exits non-zero and writes to stderr on error
    if (compileResult.code !== 0 || compileResult.stderr) {
      const cleanError = sanitizePaths(compileResult.stderr, tempDir);
      return { success: false, output: '', error: cleanError, stage: 'compilation' };
    }

    // ── 4. Execute ─────────────────────────────────────────────────────────────
    let runResult;
    try {
      runResult = await spawnAsync(
        'java',
        [
          '-cp'    , tempDir,
          '-Xmx256m',          // 256 MB max heap
          '-Xss512k',          // 512 KB stack (prevents deep recursion DoS)
          className,
        ],
        {
          cwd      : tempDir,
          timeoutMs: RUN_TIMEOUT_MS,
          stdinData: stdin,
        }
      );
    } catch (err) {
      if (err.type === 'TIMEOUT') {
        return { success: false, output: '', error: err.message, stage: 'timeout' };
      }
      throw err;
    }

    return {
      success: runResult.code === 0,
      output : runResult.stdout,
      error  : runResult.stderr,
      stage  : 'execution',
    };

  } finally {
    // ── 5. Always clean up — even on unhandled errors ─────────────────────────
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {
      // Best-effort cleanup; do not surface cleanup errors to the caller
    }
  }
}

module.exports = { compileAndRun, extractClassName };
