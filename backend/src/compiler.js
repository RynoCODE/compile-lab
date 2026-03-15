'use strict';

/**
 * compiler.js  —  Multi-language execution engine.
 *
 * Supported languages and their pipelines:
 *   java       → javac <ClassName>.java  → java -cp <dir> <ClassName>
 *   python     → python3 program.py      (interpreted; no compile step)
 *   c          → gcc program.c -o program -lm  → ./program
 *   cpp        → g++ program.cpp -o program    → ./program
 *   javascript → node program.js               (interpreted; no compile step)
 *   typescript → tsc --strict … program.ts → node program.js
 *
 * Security notes:
 *   - spawn() with shell:false prevents shell injection on all paths.
 *   - JVM flags: -Xmx256m limits heap; -Xss512k limits stack depth.
 *   - Output is capped at MAX_OUTPUT_BYTES (100 KB) to prevent exhaustion.
 *   - UUID-namespaced temp dirs prevent filename/race collisions.
 *   - 5-second SIGKILL timeout kills infinite loops in every language.
 *   - temp dir is always deleted in a finally block.
 *
 * strictWarnings (C / C++ only):
 *   When options.strictWarnings === true, -Wall is appended to the gcc/g++
 *   compile command so that common warnings are surfaced to the user.
 *   Warnings do NOT block execution — the binary is still built and run,
 *   and warning text is forwarded alongside the program's output.
 *   All other languages silently ignore this option.
 */

const { spawn }      = require('child_process');
const fs             = require('fs');
const path           = require('path');
const os             = require('os');
const { v4: uuidv4 } = require('uuid');

// ── Constants ─────────────────────────────────────────────────────────────────
const COMPILE_TIMEOUT_MS = 10_000;  // javac / gcc / g++ / tsc get 10 s
const RUN_TIMEOUT_MS     =  5_000;  // execution gets  5 s  (kills infinite loops)
const MAX_OUTPUT_BYTES   = 100_000; // 100 KB combined stdout+stderr cap
const TEMP_ROOT          = os.tmpdir();

const SUPPORTED_LANGUAGES = ['java', 'python', 'c', 'cpp', 'javascript', 'typescript'];

// ── Core spawn helper ─────────────────────────────────────────────────────────

/**
 * Spawn a child process and resolve with { stdout, stderr, code }.
 * Rejects with { type: 'TIMEOUT', message } when the process is killed.
 *
 * @param {string}   cmd
 * @param {string[]} args
 * @param {{ cwd: string, timeoutMs: number, stdinData?: string }} opts
 */
function spawnAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const { cwd, timeoutMs, stdinData = '' } = opts;

    const child = spawn(cmd, args, {
      cwd,
      shell: false,               // Never use shell — prevents injection
      env  : { PATH: process.env.PATH }, // Minimal environment
    });

    let stdout      = '';
    let stderr      = '';
    let outputBytes = 0;
    let timedOut    = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    if (stdinData) child.stdin.write(stdinData);
    child.stdin.end();

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf8');
      } else {
        child.kill('SIGKILL'); // Output-flood guard
      }
    });

    child.stderr.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_OUTPUT_BYTES) stderr += chunk.toString('utf8');
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

// ── Path sanitizer ────────────────────────────────────────────────────────────

/**
 * Strip the UUID temp-dir prefix from compiler error messages so users see
 * clean paths like `program.c:4: error: ...` instead of filesystem paths.
 */
function sanitizePaths(text, tempDir) {
  const escaped = tempDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped + path.sep + '?', 'g'), '').trim();
}

// ── Java-specific helper ──────────────────────────────────────────────────────

/**
 * Extract the entry-point class name from Java source.
 * Strategy (priority order):
 *   1. `public class Foo`  — required filename match in Java
 *   2. Any class containing `public static void main`
 *   3. First `class Foo` found
 * Returns null when no class at all is found.
 */
function extractClassName(source) {
  const publicMatch = source.match(/public\s+class\s+([A-Za-z_$][A-Za-z\d_$]*)/);
  if (publicMatch) return publicMatch[1];

  const mainBlock = source.match(
    /class\s+([A-Za-z_$][A-Za-z\d_$]*)[\s\S]*?public\s+static\s+void\s+main/
  );
  if (mainBlock) return mainBlock[1];

  const anyClass = source.match(/\bclass\s+([A-Za-z_$][A-Za-z\d_$]*)/);
  if (anyClass) return anyClass[1];

  return null;
}

// ── Language runners ──────────────────────────────────────────────────────────

async function runJava(source, stdin, tempDir, className) {
  const javaFile = path.join(tempDir, `${className}.java`);
  fs.writeFileSync(javaFile, source, 'utf8');

  // ── Compile ────────────────────────────────────────────────────────────────
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

  if (compileResult.code !== 0 || compileResult.stderr) {
    return {
      success: false,
      output : '',
      error  : sanitizePaths(compileResult.stderr, tempDir),
      stage  : 'compilation',
    };
  }

  // ── Execute ────────────────────────────────────────────────────────────────
  let runResult;
  try {
    runResult = await spawnAsync(
      'java',
      ['-cp', tempDir, '-Xmx256m', '-Xss512k', className],
      { cwd: tempDir, timeoutMs: RUN_TIMEOUT_MS, stdinData: stdin }
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
}

async function runPython(source, stdin, tempDir) {
  const sourceFile = path.join(tempDir, 'program.py');
  fs.writeFileSync(sourceFile, source, 'utf8');

  // Python is interpreted — no separate compile phase.
  // Syntax errors surface as non-zero exit + stderr during execution.
  let result;
  try {
    result = await spawnAsync('python3', [sourceFile], {
      cwd      : tempDir,
      timeoutMs: RUN_TIMEOUT_MS,
      stdinData: stdin,
    });
  } catch (err) {
    if (err.type === 'TIMEOUT') {
      return { success: false, output: '', error: err.message, stage: 'timeout' };
    }
    throw err;
  }

  return {
    success: result.code === 0,
    output : result.stdout,
    error  : sanitizePaths(result.stderr, tempDir),
    stage  : 'execution',
  };
}

async function runJavaScript(source, stdin, tempDir) {
  const sourceFile = path.join(tempDir, 'program.js');
  fs.writeFileSync(sourceFile, source, 'utf8');

  // JavaScript is interpreted by Node — syntax errors surface at execution time.
  let result;
  try {
    result = await spawnAsync('node', [sourceFile], {
      cwd      : tempDir,
      timeoutMs: RUN_TIMEOUT_MS,
      stdinData: stdin,
    });
  } catch (err) {
    if (err.type === 'TIMEOUT') {
      return { success: false, output: '', error: err.message, stage: 'timeout' };
    }
    throw err;
  }

  return {
    success: result.code === 0,
    output : result.stdout,
    error  : sanitizePaths(result.stderr, tempDir),
    stage  : 'execution',
  };
}

async function runTypeScript(source, stdin, tempDir) {
  const sourceFile = path.join(tempDir, 'program.ts');
  fs.writeFileSync(sourceFile, source, 'utf8');

  // ── Compile with tsc ───────────────────────────────────────────────────────
  // --strict         : enables all strict type-checks (noImplicitAny etc.)
  // --noEmit false   : force JS emission even if a tsconfig sets noEmit:true
  // --target ES2020  : modern JS output compatible with Node 20
  // --module commonjs: Node.js CommonJS module format
  // --outDir tempDir : output program.js alongside the source
  let compileResult;
  try {
    compileResult = await spawnAsync(
      'tsc',
      [
        '--strict',
        '--noEmit', 'false',
        '--target', 'ES2020',
        '--module', 'commonjs',
        '--moduleResolution', 'node',
        '--outDir', tempDir,
        sourceFile,
      ],
      { cwd: tempDir, timeoutMs: COMPILE_TIMEOUT_MS }
    );
  } catch (err) {
    if (err.type === 'TIMEOUT') {
      return { success: false, output: '', error: 'Compilation timed out.', stage: 'timeout' };
    }
    throw err;
  }

  if (compileResult.code !== 0) {
    // tsc emits diagnostics to stdout; combine both streams to be safe.
    const rawErr = (compileResult.stdout + compileResult.stderr).trim();
    return {
      success: false,
      output : '',
      error  : sanitizePaths(rawErr, tempDir),
      stage  : 'compilation',
    };
  }

  // ── Execute compiled JS ────────────────────────────────────────────────────
  const outputJs = path.join(tempDir, 'program.js');
  let runResult;
  try {
    runResult = await spawnAsync('node', [outputJs], {
      cwd      : tempDir,
      timeoutMs: RUN_TIMEOUT_MS,
      stdinData: stdin,
    });
  } catch (err) {
    if (err.type === 'TIMEOUT') {
      return { success: false, output: '', error: err.message, stage: 'timeout' };
    }
    throw err;
  }

  return {
    success: runResult.code === 0,
    output : runResult.stdout,
    error  : sanitizePaths(runResult.stderr, tempDir),
    stage  : 'execution',
  };
}

/**
 * Factory that creates a runner for compile-then-execute languages (C, C++).
 *
 * @param {{ ext: string, compiler: string, extraFlags?: string[] }} options
 * @returns {(source: string, stdin: string, tempDir: string, strictWarnings?: boolean) => Promise}
 */
function makeCompiledRunner({ ext, compiler, extraFlags = [] }) {
  return async function runCompiled(source, stdin, tempDir, strictWarnings = false) {
    const sourceFile = path.join(tempDir, `program${ext}`);
    const outputBin  = path.join(tempDir, 'program');
    fs.writeFileSync(sourceFile, source, 'utf8');

    // When showWarnings is requested, append -Wall so the compiler surfaces
    // all common warnings. -Werror is intentionally NOT added — warnings do
    // not block execution; they are forwarded to the user alongside the output.
    const compileFlags = strictWarnings
      ? [...extraFlags, '-Wall']
      : extraFlags;

    // ── Compile ──────────────────────────────────────────────────────────────
    let compileResult;
    try {
      compileResult = await spawnAsync(
        compiler,
        [sourceFile, '-o', outputBin, ...compileFlags],
        { cwd: tempDir, timeoutMs: COMPILE_TIMEOUT_MS }
      );
    } catch (err) {
      if (err.type === 'TIMEOUT') {
        return { success: false, output: '', error: 'Compilation timed out.', stage: 'timeout' };
      }
      throw err;
    }

    // Only treat non-zero exit as a compile error (stderr may contain warnings)
    if (compileResult.code !== 0) {
      return {
        success: false,
        output : '',
        error  : sanitizePaths(compileResult.stderr, tempDir),
        stage  : 'compilation',
      };
    }

    // Capture any warnings emitted during successful compilation so they are
    // shown to the user alongside the program's output.
    const compileWarnings = compileResult.stderr.trim()
      ? sanitizePaths(compileResult.stderr, tempDir)
      : '';

    // ── Execute ──────────────────────────────────────────────────────────────
    let runResult;
    try {
      runResult = await spawnAsync(outputBin, [], {
        cwd      : tempDir,
        timeoutMs: RUN_TIMEOUT_MS,
        stdinData: stdin,
      });
    } catch (err) {
      if (err.type === 'TIMEOUT') {
        return { success: false, output: '', error: err.message, stage: 'timeout' };
      }
      throw err;
    }

    const runtimeErr    = sanitizePaths(runResult.stderr, tempDir);
    const combinedError = [compileWarnings, runtimeErr].filter(Boolean).join('\n');

    return {
      success: runResult.code === 0,
      output : runResult.stdout,
      error  : combinedError,
      stage  : 'execution',
    };
  };
}

// Pre-built runners for C and C++
const runC   = makeCompiledRunner({ ext: '.c',   compiler: 'gcc', extraFlags: ['-lm'] });
const runCpp = makeCompiledRunner({ ext: '.cpp',  compiler: 'g++'                      });

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compile (if applicable) and run source code for the given language.
 *
 * @param {string} sourceCode
 * @param {string} [stdin='']        - Data piped to the program's stdin.
 * @param {string} [language='java'] - One of SUPPORTED_LANGUAGES.
 * @param {{ strictWarnings?: boolean }} [options={}]
 *   strictWarnings: when true AND language is 'c' or 'cpp', appends
 *   -Wall to the compiler flags so warnings are surfaced to the user.
 *   The binary is still built and run; warning text is forwarded in the
 *   result error field. Ignored for all other languages.
 *
 * @returns {Promise<{
 *   success : boolean,
 *   output  : string,
 *   error   : string,
 *   stage   : 'validation' | 'compilation' | 'execution' | 'timeout'
 * }>}
 */
async function compileAndRun(sourceCode, stdin = '', language = 'java', options = {}) {
  const { strictWarnings = false } = options;

  // ── 1. Common validation ───────────────────────────────────────────────────
  if (!sourceCode || typeof sourceCode !== 'string') {
    return { success: false, output: '', error: 'No source code provided.', stage: 'validation' };
  }

  const trimmed = sourceCode.trim();
  if (trimmed.length === 0) {
    return { success: false, output: '', error: 'Source code is empty.', stage: 'validation' };
  }

  // ── 2. Java-specific: must have a class declaration (determines filename) ──
  let className = null;
  if (language === 'java') {
    className = extractClassName(trimmed);
    if (!className) {
      return {
        success: false,
        output : '',
        error  : 'Could not detect a Java class. Make sure your code contains at least one `class` definition.',
        stage  : 'validation',
      };
    }
  }

  // ── 3. Isolated temp directory ─────────────────────────────────────────────
  const tempDir = path.join(TEMP_ROOT, `compiler_${language}_${uuidv4()}`);

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    switch (language) {
      case 'java'      : return await runJava(trimmed, stdin, tempDir, className);
      case 'python'    : return await runPython(trimmed, stdin, tempDir);
      case 'javascript': return await runJavaScript(trimmed, stdin, tempDir);
      case 'typescript': return await runTypeScript(trimmed, stdin, tempDir);
      case 'c'         : return await runC(trimmed, stdin, tempDir, strictWarnings);
      case 'cpp'       : return await runCpp(trimmed, stdin, tempDir, strictWarnings);
      default:
        return {
          success: false,
          output : '',
          error  : `Unsupported language: "${language}". Supported: ${SUPPORTED_LANGUAGES.join(', ')}.`,
          stage  : 'validation',
        };
    }
  } finally {
    // ── 4. Always clean up — even on unexpected throws ─────────────────────
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) { /* best-effort */ }
  }
}

module.exports = { compileAndRun, extractClassName, SUPPORTED_LANGUAGES };
