'use strict';

/**
 * Integration tests for the Express API (/api/compile and /health).
 *
 * These tests spin up the Express app (without binding a real port) via
 * supertest and make HTTP requests against every endpoint.
 *
 * Run inside Docker OR on any machine with a JDK installed.
 */

const request = require('supertest');
const app     = require('../../src/server');

// ─── /health ─────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('responds 200 with status ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

// ─── POST /api/compile — happy paths ─────────────────────────────────────────

describe('POST /api/compile — successful compilation', () => {

  test('returns 200 and correct stdout for Hello World', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        sourceCode: `
          public class HelloWorld {
            public static void main(String[] args) {
              System.out.println("Hello, World!");
            }
          }
        `,
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output.trim()).toBe('Hello, World!');
    expect(res.body.stage).toBe('execution');
    expect(typeof res.body.executionTime).toBe('number');
  });

  test('passes stdin to the running program', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        sourceCode: `
          import java.util.Scanner;
          public class ReadInput {
            public static void main(String[] args) {
              Scanner sc = new Scanner(System.in);
              int n = sc.nextInt();
              System.out.println("Square: " + (n * n));
            }
          }
        `,
        stdin: '7',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output).toContain('Square: 49');
  });

  test('returns multiline output correctly', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        sourceCode: `
          public class MultiLine {
            public static void main(String[] args) {
              for (int i = 1; i <= 5; i++) {
                System.out.println("Line " + i);
              }
            }
          }
        `,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    for (let i = 1; i <= 5; i++) {
      expect(res.body.output).toContain(`Line ${i}`);
    }
  });
});

// ─── POST /api/compile — compilation errors ───────────────────────────────────

describe('POST /api/compile — compilation errors', () => {

  test('returns success=false and error message for syntax error', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        sourceCode: `
          public class BadSyntax {
            public static void main(String[] args) {
              System.out.println("oops"   // missing closing paren + semicolon
            }
          }
        `,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('compilation');
    expect(res.body.error).toMatch(/error/i);
  });

  test('returns error for undeclared variable', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        sourceCode: `
          public class UndeclaredVar {
            public static void main(String[] args) {
              System.out.println(undeclaredVariable);
            }
          }
        `,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('compilation');
  });

  test('does not leak temp-directory path in error messages', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({ sourceCode: 'public class Broken { public static void main(String[] a) { x } }' });

    expect(res.body.error).not.toMatch(/java_compiler_/);
  });
});

// ─── POST /api/compile — runtime errors ──────────────────────────────────────

describe('POST /api/compile — runtime errors', () => {

  test('captures NullPointerException', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        sourceCode: `
          public class NPE {
            public static void main(String[] args) {
              String s = null;
              System.out.println(s.length());
            }
          }
        `,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('execution');
    expect(res.body.error).toMatch(/NullPointerException/i);
  });

  test('captures System.exit(1) and marks success=false', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        sourceCode: `
          public class SystemExit {
            public static void main(String[] args) {
              System.out.println("before exit");
              System.exit(1);
            }
          }
        `,
      });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('before exit');
    // exit code 1 → success should be false
    expect(res.body.success).toBe(false);
  });
});

// ─── POST /api/compile — timeout ─────────────────────────────────────────────

describe('POST /api/compile — timeout', () => {

  test('kills infinite loop and returns timeout within 10 s', async () => {
    const start = Date.now();
    const res   = await request(app)
      .post('/api/compile')
      .send({
        sourceCode: `
          public class Spin {
            public static void main(String[] args) {
              while (true) {}
            }
          }
        `,
      })
      .timeout(15_000); // supertest's own socket timeout

    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('timeout');
    expect(res.body.error).toMatch(/timed out/i);
    expect(elapsed).toBeLessThan(10_000);
  }, 20_000);
});

// ─── POST /api/compile — input validation ────────────────────────────────────

describe('POST /api/compile — input validation', () => {

  test('returns 400 when sourceCode is missing', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 when sourceCode is not a string', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({ sourceCode: 12345 });

    expect(res.status).toBe(400);
  });

  test('returns 413 when sourceCode exceeds 50 KB', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({ sourceCode: 'A'.repeat(51_000) });

    expect(res.status).toBe(413);
  });

  test('returns validation error for source with no class', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({ sourceCode: 'int x = 5;' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('validation');
  });

  test('returns 404 for unknown routes (not SPA assets)', async () => {
    // Unknown API routes return 404 via Express default
    const res = await request(app).get('/api/unknown-endpoint');
    expect(res.status).toBe(404);
  });
});
