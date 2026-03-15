'use strict';

/**
 * Integration tests for the Express API (/api/compile and /health).
 *
 * Spins up the Express app via supertest (no real port).
 * All toolchains (javac/java, python3, gcc, g++, node, tsc) must be on PATH.
 *
 * Sections:
 *   • /health
 *   • Java  — success, stdin, multiline, compile error, runtime error, timeout, validation
 *   • Python — success, stdin, error, timeout
 *   • C      — success, stdin, compile error, timeout
 *   • C++    — success, stdin, compile error, timeout
 *   • JavaScript — success, syntax error
 *   • TypeScript  — success, type error
 *   • C strictWarnings — warning-as-error
 *   • Multi-language validation — unsupported language, missing fields
 */

const request = require('supertest');
const app     = require('../../src/server');

// ═════════════════════════════════════════════════════════════════════════════
// /health
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /health', () => {
  test('responds 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// JAVA — existing tests (unchanged)
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/compile — Java: successful compilation', () => {

  test('returns 200 and correct stdout for Hello World', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'java',
        sourceCode: `
          public class HelloWorld {
            public static void main(String[] args) {
              System.out.println("Hello, World!");
            }
          }
        `,
      });

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
        language  : 'java',
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
        language  : 'java',
        sourceCode: `
          public class MultiLine {
            public static void main(String[] args) {
              for (int i = 1; i <= 5; i++) System.out.println("Line " + i);
            }
          }
        `,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    for (let i = 1; i <= 5; i++) expect(res.body.output).toContain(`Line ${i}`);
  });
});

describe('POST /api/compile — Java: compilation errors', () => {

  test('returns success=false and error for syntax error', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'java',
        sourceCode: `
          public class BadSyntax {
            public static void main(String[] args) {
              System.out.println("oops"
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
        language  : 'java',
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
      .send({
        language  : 'java',
        sourceCode: 'public class Broken { public static void main(String[] a) { x } }',
      });

    // The sanitizePaths() function must strip the UUID temp dir from errors
    expect(res.body.error).not.toMatch(/compiler_java_/);
    expect(res.body.error).not.toMatch(/\/tmp\//);
  });
});

describe('POST /api/compile — Java: runtime errors', () => {

  test('captures NullPointerException', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'java',
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
        language  : 'java',
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
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/compile — Java: timeout', () => {

  test('kills infinite loop within 10 s', async () => {
    const start = Date.now();
    const res   = await request(app)
      .post('/api/compile')
      .send({
        language  : 'java',
        sourceCode: `
          public class Spin {
            public static void main(String[] args) { while (true) {} }
          }
        `,
      })
      .timeout(15_000);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('timeout');
    expect(res.body.error).toMatch(/timed out/i);
    expect(Date.now() - start).toBeLessThan(10_000);
  }, 20_000);
});

// ═════════════════════════════════════════════════════════════════════════════
// PYTHON
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/compile — Python', () => {

  test('runs Hello World and returns correct output', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({ language: 'python', sourceCode: 'print("Hello, World!")' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output.trim()).toBe('Hello, World!');
    expect(res.body.stage).toBe('execution');
    expect(typeof res.body.executionTime).toBe('number');
  });

  test('reads from stdin via input()', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'python',
        sourceCode: 'n = int(input())\nprint(n * n)',
        stdin     : '12',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output.trim()).toBe('144');
  });

  test('captures NameError and returns success=false', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'python',
        sourceCode: 'print(undefined_variable)',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('execution');
    expect(res.body.error).toMatch(/NameError/i);
  });

  test('kills Python infinite loop within 10 s', async () => {
    const start = Date.now();
    const res   = await request(app)
      .post('/api/compile')
      .send({ language: 'python', sourceCode: 'while True: pass' })
      .timeout(15_000);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('timeout');
    expect(Date.now() - start).toBeLessThan(10_000);
  }, 20_000);
});

// ═════════════════════════════════════════════════════════════════════════════
// C
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/compile — C', () => {

  test('compiles and runs Hello World', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'c',
        sourceCode: '#include <stdio.h>\nint main() { printf("Hello, World!\\n"); return 0; }',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output.trim()).toBe('Hello, World!');
    expect(res.body.stage).toBe('execution');
  });

  test('reads from stdin via scanf', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'c',
        sourceCode: '#include <stdio.h>\nint main() { int n; scanf("%d",&n); printf("%d\\n", n+n); return 0; }',
        stdin     : '21',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output.trim()).toBe('42');
  });

  test('returns compile error for missing semicolon', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'c',
        sourceCode: '#include <stdio.h>\nint main() { printf("bad") return 0; }',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('compilation');
    expect(res.body.error).toMatch(/error/i);
    expect(res.body.error).not.toMatch(/compiler_c_/);
  });

  test('kills C infinite loop within 10 s', async () => {
    const start = Date.now();
    const res   = await request(app)
      .post('/api/compile')
      .send({
        language  : 'c',
        sourceCode: '#include <stdio.h>\nint main() { while(1){} return 0; }',
      })
      .timeout(15_000);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('timeout');
    expect(Date.now() - start).toBeLessThan(10_000);
  }, 20_000);
});

// ═════════════════════════════════════════════════════════════════════════════
// C++
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/compile — C++', () => {

  test('compiles and runs Hello World', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'cpp',
        sourceCode: '#include <iostream>\nint main() { std::cout << "Hello, World!" << std::endl; return 0; }',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output.trim()).toBe('Hello, World!');
    expect(res.body.stage).toBe('execution');
  });

  test('reads from stdin via cin', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'cpp',
        sourceCode: '#include <iostream>\nint main() { int n; std::cin>>n; std::cout<<n*n<<std::endl; return 0; }',
        stdin     : '7',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output.trim()).toBe('49');
  });

  test('returns compile error for undeclared identifier', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'cpp',
        sourceCode: '#include <iostream>\nint main() { std::cout << unknownVar; return 0; }',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('compilation');
    expect(res.body.error).toMatch(/error/i);
    expect(res.body.error).not.toMatch(/compiler_cpp_/);
  });

  test('kills C++ infinite loop within 10 s', async () => {
    const start = Date.now();
    const res   = await request(app)
      .post('/api/compile')
      .send({
        language  : 'cpp',
        sourceCode: '#include <iostream>\nint main() { while(true){} return 0; }',
      })
      .timeout(15_000);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('timeout');
    expect(Date.now() - start).toBeLessThan(10_000);
  }, 20_000);
});

// ═════════════════════════════════════════════════════════════════════════════
// JAVASCRIPT
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/compile — JavaScript', () => {

  test('runs Hello World and returns correct output', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'javascript',
        sourceCode: 'console.log("Hello, World!");',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output.trim()).toBe('Hello, World!');
    expect(res.body.stage).toBe('execution');
    expect(typeof res.body.executionTime).toBe('number');
  });

  test('returns success=false for JS syntax error', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'javascript',
        sourceCode: 'function bad( { console.log("oops"); }',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('execution');
    expect(res.body.error).toMatch(/SyntaxError/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TYPESCRIPT
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/compile — TypeScript', () => {

  test('compiles and runs typed Hello World', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'typescript',
        sourceCode: 'const msg: string = "Hello, World!";\nconsole.log(msg);',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output.trim()).toBe('Hello, World!');
    expect(res.body.stage).toBe('execution');
    expect(typeof res.body.executionTime).toBe('number');
  });

  test('returns success=false and compilation stage for TS type error', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language  : 'typescript',
        sourceCode: 'const x: number = "hello";',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('compilation');
    expect(res.body.error).toMatch(/error/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C — strictWarnings
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/compile — C strictWarnings', () => {

  test('unused variable + strictWarnings:true shows warning but still runs', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({
        language       : 'c',
        sourceCode     : '#include <stdio.h>\nint main() { int x; printf("Hello\\n"); return 0; }',
        strictWarnings : true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stage).toBe('execution');
    expect(res.body.output.trim()).toBe('Hello');
    // -Wall surfaces the unused-variable warning in the error field
    expect(res.body.error).toMatch(/unused/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Multi-language validation
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/compile — input validation (multi-language)', () => {

  test('returns 400 for an unsupported language', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({ language: 'ruby', sourceCode: 'puts "hello"' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/unsupported language/i);
  });

  test('returns 400 when sourceCode is missing', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({ language: 'python' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 when sourceCode is not a string', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({ language: 'c', sourceCode: 12345 });

    expect(res.status).toBe(400);
  });

  test('returns 413 when sourceCode exceeds 50 KB', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({ language: 'python', sourceCode: 'A'.repeat(51_000) });

    expect(res.status).toBe(413);
  });

  test('defaults language to java and returns validation error for no class', async () => {
    // No language field — should default to java
    const res = await request(app)
      .post('/api/compile')
      .send({ sourceCode: 'int x = 5;' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('validation');
  });

  test('returns 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/unknown-endpoint');
    expect(res.status).toBe(404);
  });
});
