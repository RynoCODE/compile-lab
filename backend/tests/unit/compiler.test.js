'use strict';

/**
 * Unit tests for compiler.js — multi-language execution engine.
 *
 * These tests bypass HTTP and call compileAndRun() directly.
 * All language toolchains must be available on PATH:
 *   Java  → javac, java
 *   Python → python3
 *   C     → gcc
 *   C++   → g++
 *
 * ─── Java (original suite — unchanged) ────────────────────────────────────
 *  1.  Hello World — successful compilation and execution
 *  2.  Syntax error — javac error messages returned
 *  3.  Runtime exception — stderr captured
 *  4.  Infinite loop — timeout after ≤5 s
 *  5.  StackOverflow — deep recursion caught
 *  6.  Scanner stdin — reads from stdin
 *  7.  Multi-class file — package-private classes
 *  8.  Arithmetic output — correct values
 *  9.  Empty source — validation rejection
 * 10.  No class found — validation rejection
 * 11.  Null input — validation rejection
 * 12.  Output-flood guard — output bounded
 * ─── Python ────────────────────────────────────────────────────────────────
 * 13. Hello World
 * 14. Syntax error in Python
 * 15. Runtime error (ZeroDivisionError)
 * 16. Infinite loop — timeout
 * 17. stdin → input() reads correctly
 * ─── C ──────────────────────────────────────────────────────────────────────
 * 18. Hello World
 * 19. Compile error (missing semicolon)
 * 20. Runtime error (segfault / abort)
 * 21. Infinite loop — timeout
 * 22. stdin → scanf reads correctly
 * ─── C++ ────────────────────────────────────────────────────────────────────
 * 23. Hello World
 * 24. Compile error (bad syntax)
 * 25. Runtime error (out-of-bounds via std::vector::at)
 * 26. Infinite loop — timeout
 * 27. stdin → cin reads correctly
 * ─── extractClassName() helpers ────────────────────────────────────────────
 */

const { compileAndRun, extractClassName } = require('../../src/compiler');

// ═════════════════════════════════════════════════════════════════════════════
// extractClassName()
// ═════════════════════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════════════════════
// JAVA
// ═════════════════════════════════════════════════════════════════════════════

describe('Java — compileAndRun()', () => {

  test('1. compiles and runs Hello World successfully', async () => {
    const result = await compileAndRun(`
      public class HelloWorld {
          public static void main(String[] args) {
              System.out.println("Hello, World!");
          }
      }
    `);
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('Hello, World!');
    expect(result.error).toBe('');
    expect(result.stage).toBe('execution');
  });

  test('2. returns compilation error for syntax mistake', async () => {
    const result = await compileAndRun(`
      public class SyntaxError {
          public static void main(String[] args) {
              System.out.println("missing semicolon")
          }
      }
    `);
    expect(result.success).toBe(false);
    expect(result.stage).toBe('compilation');
    expect(result.error).toMatch(/error/i);
    expect(result.error).not.toMatch(/compiler_java_/);
  });

  test('3. captures runtime exception in stderr', async () => {
    const result = await compileAndRun(`
      public class RuntimeErr {
          public static void main(String[] args) {
              int[] arr = new int[3];
              System.out.println(arr[10]);
          }
      }
    `);
    expect(result.success).toBe(false);
    expect(result.stage).toBe('execution');
    expect(result.error).toMatch(/ArrayIndexOutOfBoundsException/i);
  });

  test('4. kills infinite loop and returns timeout error', async () => {
    const start  = Date.now();
    const result = await compileAndRun(`
      public class InfiniteLoop {
          public static void main(String[] args) {
              while (true) {}
          }
      }
    `);
    expect(result.success).toBe(false);
    expect(result.stage).toBe('timeout');
    expect(result.error).toMatch(/timed out/i);
    expect(Date.now() - start).toBeLessThan(10_000);
  }, 20_000);

  test('5. captures StackOverflowError', async () => {
    const result = await compileAndRun(`
      public class DeepRecursion {
          public static void recurse() { recurse(); }
          public static void main(String[] args) { recurse(); }
      }
    `);
    expect(result.success).toBe(false);
    expect(result.stage).toBe('execution');
    expect(result.error).toMatch(/StackOverflowError/i);
  });

  test('6. reads from stdin and prints correct output', async () => {
    const result = await compileAndRun(
      `import java.util.Scanner;
      public class EchoName {
          public static void main(String[] args) {
              Scanner sc = new Scanner(System.in);
              String name = sc.nextLine();
              System.out.println("Hello, " + name + "!");
          }
      }`,
      'Alice'
    );
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('Hello, Alice!');
  });

  test('7. compiles file with multiple package-private classes', async () => {
    const result = await compileAndRun(`
      class Helper {
          static String greet(String name) { return "Hi " + name; }
      }
      public class MultiClass {
          public static void main(String[] args) {
              System.out.println(Helper.greet("World"));
          }
      }
    `);
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('Hi World');
  });

  test('8. computes and prints correct arithmetic result', async () => {
    const result = await compileAndRun(`
      public class Arithmetic {
          public static void main(String[] args) {
              int a = 17, b = 5;
              System.out.println(a + " + " + b + " = " + (a + b));
              System.out.println(a + " * " + b + " = " + (a * b));
          }
      }
    `);
    expect(result.success).toBe(true);
    expect(result.output).toContain('17 + 5 = 22');
    expect(result.output).toContain('17 * 5 = 85');
  });

  test('9. rejects empty source code', async () => {
    const result = await compileAndRun('   ');
    expect(result.success).toBe(false);
    expect(result.stage).toBe('validation');
    expect(result.error).toMatch(/empty/i);
  });

  test('10. rejects source with no class definition', async () => {
    const result = await compileAndRun('int x = 5 + 3;');
    expect(result.success).toBe(false);
    expect(result.stage).toBe('validation');
  });

  test('11. rejects null source code', async () => {
    const result = await compileAndRun(null);
    expect(result.success).toBe(false);
    expect(result.stage).toBe('validation');
  });

  test('12. terminates output-flooding program within bounds', async () => {
    const result = await compileAndRun(`
      public class OutputFlood {
          public static void main(String[] args) {
              String line = "A".repeat(200);
              for (int i = 0; i < 100_000; i++) System.out.println(line);
          }
      }
    `);
    expect(result.output.length).toBeLessThanOrEqual(110_000);
  }, 20_000);
});

// ═════════════════════════════════════════════════════════════════════════════
// PYTHON
// ═════════════════════════════════════════════════════════════════════════════

describe('Python — compileAndRun()', () => {

  test('13. runs Hello World successfully', async () => {
    const result = await compileAndRun(
      'print("Hello, World!")',
      '',
      'python'
    );
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('Hello, World!');
    expect(result.stage).toBe('execution');
  });

  test('14. reports syntax error', async () => {
    const result = await compileAndRun(
      'def foo(\n  print("bad")',
      '',
      'python'
    );
    expect(result.success).toBe(false);
    expect(result.stage).toBe('execution'); // Python surfaces syntax errors at runtime
    expect(result.error).toMatch(/SyntaxError/i);
  });

  test('15. captures ZeroDivisionError', async () => {
    const result = await compileAndRun(
      'x = 1 / 0',
      '',
      'python'
    );
    expect(result.success).toBe(false);
    expect(result.stage).toBe('execution');
    expect(result.error).toMatch(/ZeroDivisionError/i);
  });

  test('16. kills Python infinite loop (timeout)', async () => {
    const start  = Date.now();
    const result = await compileAndRun(
      'while True: pass',
      '',
      'python'
    );
    expect(result.success).toBe(false);
    expect(result.stage).toBe('timeout');
    expect(result.error).toMatch(/timed out/i);
    expect(Date.now() - start).toBeLessThan(10_000);
  }, 20_000);

  test('17. reads from stdin via input()', async () => {
    const result = await compileAndRun(
      'name = input()\nprint(f"Hello, {name}!")',
      'Bob',
      'python'
    );
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('Hello, Bob!');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C
// ═════════════════════════════════════════════════════════════════════════════

describe('C — compileAndRun()', () => {

  test('18. compiles and runs Hello World successfully', async () => {
    const result = await compileAndRun(
      '#include <stdio.h>\nint main() { printf("Hello, World!\\n"); return 0; }',
      '',
      'c'
    );
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('Hello, World!');
    expect(result.stage).toBe('execution');
  });

  test('19. returns compilation error for missing semicolon', async () => {
    const result = await compileAndRun(
      '#include <stdio.h>\nint main() { printf("oops") return 0; }',
      '',
      'c'
    );
    expect(result.success).toBe(false);
    expect(result.stage).toBe('compilation');
    expect(result.error).toMatch(/error/i);
    // Temp path must not leak
    expect(result.error).not.toMatch(/compiler_c_/);
  });

  test('20. captures non-zero exit on abort / assertion failure', async () => {
    const result = await compileAndRun(
      '#include <assert.h>\nint main() { assert(0); return 0; }',
      '',
      'c'
    );
    expect(result.success).toBe(false);
    expect(result.stage).toBe('execution');
  });

  test('21. kills C infinite loop (timeout)', async () => {
    const start  = Date.now();
    const result = await compileAndRun(
      '#include <stdio.h>\nint main() { while(1) {} return 0; }',
      '',
      'c'
    );
    expect(result.success).toBe(false);
    expect(result.stage).toBe('timeout');
    expect(result.error).toMatch(/timed out/i);
    expect(Date.now() - start).toBeLessThan(10_000);
  }, 20_000);

  test('22. reads from stdin via scanf', async () => {
    const result = await compileAndRun(
      '#include <stdio.h>\nint main() { int n; scanf("%d", &n); printf("Square: %d\\n", n*n); return 0; }',
      '9',
      'c'
    );
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('Square: 81');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C++
// ═════════════════════════════════════════════════════════════════════════════

describe('C++ — compileAndRun()', () => {

  test('23. compiles and runs Hello World successfully', async () => {
    const result = await compileAndRun(
      '#include <iostream>\nint main() { std::cout << "Hello, World!" << std::endl; return 0; }',
      '',
      'cpp'
    );
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('Hello, World!');
    expect(result.stage).toBe('execution');
  });

  test('24. returns compilation error for undeclared variable', async () => {
    const result = await compileAndRun(
      '#include <iostream>\nint main() { std::cout << undeclared; return 0; }',
      '',
      'cpp'
    );
    expect(result.success).toBe(false);
    expect(result.stage).toBe('compilation');
    expect(result.error).toMatch(/error/i);
    expect(result.error).not.toMatch(/compiler_cpp_/);
  });

  test('25. captures std::out_of_range (vector::at)', async () => {
    const result = await compileAndRun(
      '#include <iostream>\n#include <vector>\nint main() { std::vector<int> v = {1,2,3}; std::cout << v.at(99); return 0; }',
      '',
      'cpp'
    );
    expect(result.success).toBe(false);
    expect(result.stage).toBe('execution');
    expect(result.error).toMatch(/out_of_range|terminate|abort/i);
  });

  test('26. kills C++ infinite loop (timeout)', async () => {
    const start  = Date.now();
    const result = await compileAndRun(
      '#include <iostream>\nint main() { while(true) {} return 0; }',
      '',
      'cpp'
    );
    expect(result.success).toBe(false);
    expect(result.stage).toBe('timeout');
    expect(result.error).toMatch(/timed out/i);
    expect(Date.now() - start).toBeLessThan(10_000);
  }, 20_000);

  test('27. reads from stdin via cin', async () => {
    const result = await compileAndRun(
      '#include <iostream>\n#include <string>\nint main() { std::string s; std::cin >> s; std::cout << "Hi, " << s << "!" << std::endl; return 0; }',
      'Carol',
      'cpp'
    );
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('Hi, Carol!');
  });
});
