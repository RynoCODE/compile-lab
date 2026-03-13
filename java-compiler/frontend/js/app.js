/**
 * app.js — Multi-language Online Compiler frontend
 *
 * Responsibilities:
 *   - Bootstrap Monaco Editor with per-language syntax highlighting.
 *   - Language selector: switches Monaco mode, boilerplate, filename, footer.
 *   - Example selector: language-filtered snippets.
 *   - POST to /api/compile with { sourceCode, language, stdin }.
 *   - Render stdout / stderr results with stage badges.
 *   - Keyboard shortcut: Ctrl+Enter → Run, Ctrl+L → Clear.
 *   - Drag-to-resize panel splitter.
 *   - Dark / Light theme toggle.
 *   - Stdin toggle panel.
 */

'use strict';

// ─── Language configuration ──────────────────────────────────────────────────
// monacoId  : language identifier used by Monaco Editor
// label     : display text in the footer
// filename  : shown in the editor panel header
// tabSize   : sensible default per language convention
const LANG_CONFIG = {
  java  : { monacoId: 'java',   label: 'Java 17',    filename: 'HelloWorld.java', tabSize: 4 },
  python: { monacoId: 'python', label: 'Python 3',   filename: 'program.py',     tabSize: 4 },
  c     : { monacoId: 'c',      label: 'C (gcc)',    filename: 'program.c',       tabSize: 4 },
  cpp   : { monacoId: 'cpp',    label: 'C++ (g++)', filename: 'program.cpp',     tabSize: 4 },
};

// ─── Code examples (keyed by example ID, include data-lang) ─────────────────
const EXAMPLES = {
  // ── Java ──────────────────────────────────────────────────────────────────
  java_hello: {
    lang : 'java',
    code : `public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}`,
  },
  java_fibonacci: {
    lang : 'java',
    code : `public class Fibonacci {
    public static void main(String[] args) {
        int n = 10, a = 0, b = 1;
        System.out.print("Fibonacci: " + a + " " + b);
        for (int i = 2; i < n; i++) {
            int c = a + b;
            System.out.print(" " + c);
            a = b; b = c;
        }
        System.out.println();
    }
}`,
  },
  java_scanner: {
    lang : 'java',
    stdin: 'Alice',
    code : `import java.util.Scanner;

public class ReadInput {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.print("Enter your name: ");
        String name = sc.nextLine();
        System.out.println("Welcome, " + name + "!");
        sc.close();
    }
}`,
  },
  java_bubbleSort: {
    lang : 'java',
    code : `import java.util.Arrays;

public class BubbleSort {
    static void bubbleSort(int[] arr) {
        int n = arr.length;
        for (int i = 0; i < n - 1; i++)
            for (int j = 0; j < n - i - 1; j++)
                if (arr[j] > arr[j + 1]) {
                    int tmp = arr[j]; arr[j] = arr[j+1]; arr[j+1] = tmp;
                }
    }
    public static void main(String[] args) {
        int[] arr = {64, 34, 25, 12, 22, 11, 90};
        bubbleSort(arr);
        System.out.println("Sorted: " + Arrays.toString(arr));
    }
}`,
  },
  java_factorial: {
    lang : 'java',
    code : `public class Factorial {
    static long factorial(int n) {
        return (n <= 1) ? 1 : n * factorial(n - 1);
    }
    public static void main(String[] args) {
        for (int i = 0; i <= 12; i++)
            System.out.println(i + "! = " + factorial(i));
    }
}`,
  },
  java_infinite: {
    lang : 'java',
    code : `public class InfiniteLoop {
    public static void main(String[] args) {
        System.out.println("Starting infinite loop...");
        while (true) { /* killed after 5 s */ }
    }
}`,
  },

  // ── Python ────────────────────────────────────────────────────────────────
  py_hello: {
    lang : 'python',
    code : `print("Hello, World!")`,
  },
  py_fibonacci: {
    lang : 'python',
    code : `a, b = 0, 1
result = []
for _ in range(10):
    result.append(a)
    a, b = b, a + b
print("Fibonacci:", result)`,
  },
  py_input: {
    lang : 'python',
    stdin: 'Alice',
    code : `name = input("Enter your name: ")
print(f"Welcome, {name}!")`,
  },
  py_infinite: {
    lang : 'python',
    code : `print("Starting infinite loop...")
while True:
    pass  # killed after 5 s`,
  },

  // ── C ─────────────────────────────────────────────────────────────────────
  c_hello: {
    lang : 'c',
    code : `#include <stdio.h>

int main() {
    printf("Hello, World!\\n");
    return 0;
}`,
  },
  c_scanf: {
    lang : 'c',
    stdin: '7',
    code : `#include <stdio.h>

int main() {
    int n;
    printf("Enter a number: ");
    scanf("%d", &n);
    printf("Square of %d = %d\\n", n, n * n);
    return 0;
}`,
  },
  c_infinite: {
    lang : 'c',
    code : `#include <stdio.h>

int main() {
    printf("Starting infinite loop...\\n");
    while (1) { /* killed after 5 s */ }
    return 0;
}`,
  },

  // ── C++ ───────────────────────────────────────────────────────────────────
  cpp_hello: {
    lang : 'cpp',
    code : `#include <iostream>

int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}`,
  },
  cpp_cin: {
    lang : 'cpp',
    stdin: 'Alice',
    code : `#include <iostream>
#include <string>

int main() {
    std::string name;
    std::cout << "Enter your name: ";
    std::getline(std::cin, name);
    std::cout << "Welcome, " << name << "!" << std::endl;
    return 0;
}`,
  },
  cpp_infinite: {
    lang : 'cpp',
    code : `#include <iostream>

int main() {
    std::cout << "Starting infinite loop..." << std::endl;
    while (true) { /* killed after 5 s */ }
    return 0;
}`,
  },
};

// ── Default boilerplate per language (shown when switching) ──────────────────
const BOILERPLATES = {
  java  : EXAMPLES.java_hello.code,
  python: EXAMPLES.py_hello.code,
  c     : EXAMPLES.c_hello.code,
  cpp   : EXAMPLES.cpp_hello.code,
};

// ─── DOM references ──────────────────────────────────────────────────────────
const $langSel     = document.getElementById('lang-select');
const $btnRun      = document.getElementById('btn-run');
const $btnTheme    = document.getElementById('btn-theme');
const $btnClear    = document.getElementById('btn-clear-output');
const $btnCopy     = document.getElementById('btn-copy-code');
const $btnStdin    = document.getElementById('btn-toggle-stdin');
const $exampleSel  = document.getElementById('example-select');
const $outputTerm  = document.getElementById('output-terminal');
const $stdinSection= document.getElementById('stdin-section');
const $stdinArea   = document.getElementById('stdin-textarea');
const $footerLangTxt = document.getElementById('footer-lang-text');
const $footerPos   = document.getElementById('footer-pos');
const $footerStatus= document.getElementById('footer-status');
const $editorPanel = document.getElementById('editor-panel');
const $outputPanel = document.getElementById('output-panel');
const $resizer     = document.getElementById('resizer');
const $editorFilename = document.getElementById('editor-filename');

// ─── State ───────────────────────────────────────────────────────────────────
let monacoEditor   = null;
let isRunning      = false;
let isDarkTheme    = true;
let currentLanguage = 'java';

// ─── Monaco bootstrap ─────────────────────────────────────────────────────────
require.config({
  paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs' },
});

require(['vs/editor/editor.main'], () => {
  monacoEditor = monaco.editor.create(document.getElementById('monaco-editor'), {
    value              : BOILERPLATES.java,
    language           : 'java',
    theme              : 'vs-dark',
    fontSize           : 14,
    fontFamily         : "'JetBrains Mono','Fira Code','Cascadia Code','Consolas',monospace",
    fontLigatures      : true,
    minimap            : { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout    : true,
    tabSize            : 4,
    wordWrap           : 'on',
    renderLineHighlight: 'line',
    smoothScrolling    : true,
    cursorBlinking     : 'smooth',
    padding            : { top: 12, bottom: 12 },
    lineNumbersMinChars: 3,
  });

  monacoEditor.onDidChangeCursorPosition((e) => {
    const { lineNumber, column } = e.position;
    $footerPos.textContent = `Ln ${lineNumber}, Col ${column}`;
  });

  monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runCode);
  monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL,  clearOutput);
});

// ─── Language switching ───────────────────────────────────────────────────────
function switchLanguage(lang) {
  if (!LANG_CONFIG[lang]) return;
  currentLanguage = lang;

  const cfg = LANG_CONFIG[lang];

  // Update Monaco language mode (doesn't reset content)
  if (monacoEditor) {
    monaco.editor.setModelLanguage(monacoEditor.getModel(), cfg.monacoId);
    monacoEditor.updateOptions({ tabSize: cfg.tabSize });
    monacoEditor.setValue(BOILERPLATES[lang]);
  }

  // Update visible metadata
  $editorFilename.textContent = cfg.filename;
  $footerLangTxt.textContent  = cfg.label;

  // Re-filter example options to show only relevant language
  filterExamples(lang);

  // Clear stdin and output
  $stdinArea.value = '';
  clearOutput();
}

/** Show only example <option> elements that match the active language */
function filterExamples(lang) {
  const options = $exampleSel.querySelectorAll('option[data-lang]');
  options.forEach((opt) => {
    opt.hidden = opt.dataset.lang !== lang;
  });
  $exampleSel.value = ''; // reset selection
}

// ─── Run code ─────────────────────────────────────────────────────────────────
async function runCode() {
  if (isRunning || !monacoEditor) return;

  const sourceCode = monacoEditor.getValue();
  const stdin      = $stdinArea.value;

  if (!sourceCode.trim()) {
    renderOutput({ success: false, error: 'Editor is empty.', stage: 'validation' });
    return;
  }

  setRunning(true);
  showRunningState();

  try {
    const response = await fetch('/api/compile', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ sourceCode, language: currentLanguage, stdin }),
    });

    if (!response.ok && response.status !== 200) {
      let body = {};
      try { body = await response.json(); } catch (_) {}
      renderOutput({
        success: false,
        error  : body.error || `Server returned HTTP ${response.status}`,
        stage  : body.stage || 'server',
      });
      return;
    }

    renderOutput(await response.json());

  } catch (err) {
    renderOutput({ success: false, error: `Network error: ${err.message}`, stage: 'network' });
  } finally {
    setRunning(false);
  }
}

// ─── Render output ────────────────────────────────────────────────────────────
function renderOutput(result) {
  const { success, output = '', error = '', stage = '', executionTime } = result;
  let html = '';

  if      (stage === 'timeout')                  html += badge('timeout', '⏱ Timeout');
  else if (stage === 'compilation')              html += badge('error',   '✖ Compile Error');
  else if (stage === 'validation')               html += badge('error',   '✖ Validation Error');
  else if (stage === 'execution' && !success)    html += badge('error',   '✖ Runtime Error');
  else if (success)                              html += badge('success', '✔ Success');
  else                                           html += badge('error',   '✖ Error');

  if (output) html += `<span class="out-success">${escHtml(output)}</span>`;

  if (error) {
    const cls = stage === 'timeout' ? 'out-timeout' : 'out-error';
    if (output) html += '\n';
    html += `<span class="${cls}">${escHtml(error)}</span>`;
  }

  if (!output && !error) html += '<span class="out-info">Program produced no output.</span>';

  if (typeof executionTime === 'number') {
    html += `\n<span class="exec-time">Finished in ${executionTime} ms</span>`;
  }

  $outputTerm.innerHTML = html;
  updateFooterStatus(success, stage);
}

function badge(type, text) {
  return `<div class="stage-badge ${type}">${text}</div>`;
}

function showRunningState() {
  const label = LANG_CONFIG[currentLanguage]?.label ?? currentLanguage;
  $outputTerm.innerHTML =
    '<div class="stage-badge running">● Running…</div>' +
    `<span class="out-info">Compiling and executing your ${label} code…</span>`;
}

function clearOutput() {
  $outputTerm.innerHTML = '<span class="out-placeholder">Output will appear here after you click Run.</span>';
  updateFooterStatus(null);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setRunning(state) {
  isRunning = state;
  $btnRun.disabled = state;
  $btnRun.classList.toggle('running', state);
}

function updateFooterStatus(success, stage) {
  const dot = $footerStatus.querySelector('.footer__dot');
  if (success === null) {
    dot.className = 'footer__dot';
    $footerStatus.lastChild.textContent = ' Ready';
  } else if (success) {
    dot.className = 'footer__dot green';
    $footerStatus.lastChild.textContent = ' Success';
  } else if (stage === 'timeout') {
    dot.className = 'footer__dot yellow';
    $footerStatus.lastChild.textContent = ' Timed out';
  } else {
    dot.className = 'footer__dot red';
    $footerStatus.lastChild.textContent = ' Error';
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────
$langSel.addEventListener('change', () => switchLanguage($langSel.value));

$btnRun.addEventListener('click', runCode);

$btnTheme.addEventListener('click', () => {
  isDarkTheme = !isDarkTheme;
  document.body.classList.toggle('theme-light', !isDarkTheme);
  if (monacoEditor) monaco.editor.setTheme(isDarkTheme ? 'vs-dark' : 'vs');
  $btnTheme.title     = isDarkTheme ? 'Switch to Light Theme' : 'Switch to Dark Theme';
  $btnTheme.innerHTML = isDarkTheme ? sunIcon() : moonIcon();
});

$btnClear.addEventListener('click', clearOutput);

$btnCopy.addEventListener('click', async () => {
  if (!monacoEditor) return;
  try {
    await navigator.clipboard.writeText(monacoEditor.getValue());
    const orig = $btnCopy.textContent;
    $btnCopy.textContent = 'Copied!';
    setTimeout(() => ($btnCopy.textContent = orig), 1500);
  } catch (_) {}
});

$btnStdin.addEventListener('click', () => {
  $stdinSection.classList.toggle('open');
  const isOpen = $stdinSection.classList.contains('open');
  $btnStdin.textContent  = isOpen ? 'Hide Input' : 'Input (stdin)';
  $btnStdin.setAttribute('aria-expanded', String(isOpen));
  $stdinSection.setAttribute('aria-hidden', String(!isOpen));
});

$exampleSel.addEventListener('change', () => {
  const key = $exampleSel.value;
  const ex  = key && EXAMPLES[key];
  if (!ex || !monacoEditor) return;

  // If the example belongs to a different language, switch first
  if (ex.lang !== currentLanguage) {
    $langSel.value = ex.lang;
    switchLanguage(ex.lang);
  }

  monacoEditor.setValue(ex.code);

  if (ex.stdin) {
    $stdinArea.value = ex.stdin;
    $stdinSection.classList.add('open');
    $btnStdin.textContent = 'Hide Input';
  } else {
    $stdinArea.value = '';
  }

  $exampleSel.value = ''; // reset dropdown
  clearOutput();
});

// ─── Initialise example filter for the default language ──────────────────────
filterExamples('java');

// ─── Drag-to-resize splitter ──────────────────────────────────────────────────
(function initResizer() {
  let dragging = false;
  let startX, startEditorW, startOutputW;

  $resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    startX        = e.clientX;
    startEditorW  = $editorPanel.offsetWidth;
    startOutputW  = $outputPanel.offsetWidth;
    $resizer.classList.add('dragging');
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const newEditor = startEditorW + dx;
    const newOutput = startOutputW - dx;
    const min = 220;
    if (newEditor < min || newOutput < min) return;
    $editorPanel.style.flex = `0 0 ${newEditor}px`;
    $outputPanel.style.flex = `0 0 ${newOutput}px`;
  });

  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      $resizer.classList.remove('dragging');
      document.body.style.cursor    = '';
      document.body.style.userSelect = '';
      if (monacoEditor) monacoEditor.layout();
    }
  });
})();

// ─── SVG icons ────────────────────────────────────────────────────────────────
function moonIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
  </svg>`;
}
function sunIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>`;
}
