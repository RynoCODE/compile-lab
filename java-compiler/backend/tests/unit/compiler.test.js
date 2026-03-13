'use strict';

/**
 * Unit tests for compiler.js
 *
 * These tests exercise the compileAndRun() engine directly (no HTTP).
 * They require a real JDK (`javac` / `java`) to be on PATH.
 *
 * Covered scenarios:
 *  1.  Hello World — successful compilation and execution
 *  2.  Syntax error — javac error messages returned, success=false
 *  3.  Runtime exception — execution error returned, success=false
 *  4.  Infinite loop — timeout after ≤5 s, success=false, stage='timeout'
 *  5.  Deep recursion (StackOverflow) — caught and reported
 *  6.  Scanner stdin — program reads from stdin correctly
 *  7.  Multi-class file — package-private inner class compiles fine
 *  8.  Arithmetic output — verifies println output
 *  9.  extractClassName helper — public/unnamed/main-hosting classes
 * 10.  Empty source — validation rejection
 * 11.  Missing class — validation rejection
 */

const { compileAndRun, extractClassName } = require('../../src/compiler');

// ─── extractClassName ─────────────────────────────────────────────────────────

describe('extractClassName()', () => {
  test('returns name from `public class Foo`', () => {
    expect(extractClassName('public class HelloWorld {}')).toBe('HelloWorld');
  });

  test('returns name when no public class but main() present', () => {
    const src = `
      class Runner {
        public static void main(String[] args) {}
      }
    `;
    expect(extractClassName(src)).toBe('Runner');
  });

  test('returns name of first class when no main()', () => {
    expect(extractClassName('class Foo {} class Bar {}')).toBe('Foo');
  });

  test('returns null when no class keyword exists', () => {
    expect(extractClassName('int x = 5;')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(extractClassName('')).toBeNull();
  });

  test('handles underscores and dollar signs in class names', () => {
    expect(extractClassName('public class My_Class$2 {}')).toBe('My_Class$2');
  });
});

// ─── compileAndRun() ──────────────────────────────────────────────────────────

describe('compileAndRun()', () => {

  // ── 1. Hello World ──────────────────────────────────────────────────────────
  test('1. compiles and runs Hello World successfully', async () => {
    const source = `
      public class HelloWorld {
          public static void main(String[] args) {
              System.out.println("Hello, World!");
          }
      }
    `;
    const result = await compileAndRun(source);

    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('Hello, World!');
    expect(result.error).toBe('');
    expect(result.stage).toBe('execution');
  });

  // ── 2. Syntax error ─────────────────────────────────────────────────────────
  test('2. returns compilation error for syntax mistake', async () => {
    const source = `
      public class SyntaxError {
          public static void main(String[] args) {
              System.out.println("missing semicolon")   // <-- no semicolon
          }
      }
    `;
    const result = await compileAndRun(source);

    expect(result.success).toBe(false);
    expect(result.stage).toBe('compilation');
    expect(result.error).toMatch(/error/i);
    // Temp path should be stripped from error message
    expect(result.error).not.toMatch(/java_compiler_/);
  });

  // ── 3. Runtime exception ────────────────────────────────────────────────────
  test('3. captures runtime exception in stderr', async () => {
    const source = `
      public class RuntimeErr {
          public static void main(String[] args) {
              int[] arr = new int[3];
              System.out.println(arr[10]); // ArrayIndexOutOfBoundsException
          }
      }
    `;
    const result = await compileAndRun(source);

    expect(result.success).toBe(false);
    expect(result.stage).toBe('execution');
    expect(result.error).toMatch(/ArrayIndexOutOfBoundsException/i);
  });

  // ── 4. Infinite loop timeout ────────────────────────────────────────────────
  test('4. kills infinite loop and returns timeout error', async () => {
    const source = `
      public class InfiniteLoop {
          public static void main(String[] args) {
              while (true) {
                  // spin forever
              }
          }
      }
    `;
    const start  = Date.now();
    const result = await compileAndRun(source);
    const elapsed = Date.now() - start;

    expect(result.success).toBe(false);
    expect(result.stage).toBe('timeout');
    expect(result.error).toMatch(/timed out/i);
    // Should terminate well within 10 seconds
    expect(elapsed).toBeLessThan(10_000);
  }, 20_000); // generous Jest timeout for this test

  // ── 5. Stack overflow ───────────────────────────────────────────────────────
  test('5. captures StackOverflowError', async () => {
    const source = `
      public class DeepRecursion {
          public static void recurse() { recurse(); }
          public static void main(String[] args) { recurse(); }
      }
    `;
    const result = await compileAndRun(source);

    expect(result.success).toBe(false);
    expect(result.stage).toBe('execution');
    expect(result.error).toMatch(/StackOverflowError/i);
  });

  // ── 6. Scanner stdin ────────────────────────────────────────────────────────
  test('6. reads from stdin and prints correct output', async () => {
    const source = `
      import java.util.Scanner;
      public class EchoName {
          public static void main(String[] args) {
              Scanner sc = new Scanner(System.in);
              String name = sc.nextLine();
              System.out.println("Hello, " + name + "!");
          }
      }
    `;
    const result = await compileAndRun(source, 'Alice');

    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('Hello, Alice!');
  });

  // ── 7. Multiple (package-private) classes in one file ───────────────────────
  test('7. compiles file with multiple package-private classes', async () => {
    const source = `
      class Helper {
          static String greet(String name) { return "Hi " + name; }
      }
      public class MultiClass {
          public static void main(String[] args) {
              System.out.println(Helper.greet("World"));
          }
      }
    `;
    const result = await compileAndRun(source);

    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('Hi World');
  });

  // ── 8. Arithmetic output ─────────────────────────────────────────────────────
  test('8. computes and prints correct arithmetic result', async () => {
    const source = `
      public class Arithmetic {
          public static void main(String[] args) {
              int a = 17, b = 5;
              System.out.println(a + " + " + b + " = " + (a + b));
              System.out.println(a + " * " + b + " = " + (a * b));
          }
      }
    `;
    const result = await compileAndRun(source);

    expect(result.success).toBe(true);
    expect(result.output).toContain('17 + 5 = 22');
    expect(result.output).toContain('17 * 5 = 85');
  });

  // ── 9. Empty source ──────────────────────────────────────────────────────────
  test('9. rejects empty source code', async () => {
    const result = await compileAndRun('   ');

    expect(result.success).toBe(false);
    expect(result.stage).toBe('validation');
    expect(result.error).toMatch(/empty/i);
  });

  // ── 10. No class found ───────────────────────────────────────────────────────
  test('10. rejects source with no class definition', async () => {
    const result = await compileAndRun('int x = 5 + 3;');

    expect(result.success).toBe(false);
    expect(result.stage).toBe('validation');
  });

  // ── 11. Null / non-string input ──────────────────────────────────────────────
  test('11. rejects null source code', async () => {
    const result = await compileAndRun(null);

    expect(result.success).toBe(false);
    expect(result.stage).toBe('validation');
  });

  // ── 12. Output-flood guard ────────────────────────────────────────────────────
  test('12. terminates output-flooding program', async () => {
    const source = `
      public class OutputFlood {
          public static void main(String[] args) {
              // Print a 200-char line 100000 times → far exceeds 100 KB cap
              String line = "A".repeat(200);
              for (int i = 0; i < 100_000; i++) {
                  System.out.println(line);
              }
          }
      }
    `;
    const result = await compileAndRun(source);

    // Either killed (timeout or output cap) or succeeded but output is capped
    // The key assertion: server remains responsive and output is bounded
    expect(result.output.length).toBeLessThanOrEqual(110_000);
  }, 20_000);

});
