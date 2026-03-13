/**
 * app.js — Java Online Compiler frontend
 *
 * Responsibilities:
 *   - Bootstrap Monaco Editor with Java syntax highlighting + dark theme.
 *   - Load code examples into the editor.
 *   - POST to /api/compile and render stdout / stderr results.
 *   - Keyboard shortcut: Ctrl+Enter / Cmd+Enter → Run.
 *   - Drag-to-resize panel splitter.
 *   - Dark / Light theme toggle.
 *   - Stdin toggle panel.
 */

'use strict';

// ─── Example code snippets ──────────────────────────────────────────────────
const EXAMPLES = {
  hello: {
    label : 'Hello World',
    code  : `public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}`,
  },

  fibonacci: {
    label : 'Fibonacci Series',
    code  : `public class Fibonacci {
    public static void main(String[] args) {
        int n = 10, a = 0, b = 1;
        System.out.print("Fibonacci: " + a + " " + b);
        for (int i = 2; i < n; i++) {
            int c = a + b;
            System.out.print(" " + c);
            a = b;
            b = c;
        }
        System.out.println();
    }
}`,
  },

  scanner: {
    label : 'Read User Input',
    code  : `import java.util.Scanner;

public class ReadInput {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.print("Enter your name: ");
        String name = sc.nextLine();
        System.out.println("Welcome, " + name + "!");
        sc.close();
    }
}`,
    stdin: 'Alice',
  },

  bubbleSort: {
    label : 'Bubble Sort',
    code  : `import java.util.Arrays;

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

  factorial: {
    label : 'Factorial (Recursion)',
    code  : `public class Factorial {
    static long factorial(int n) {
        return (n <= 1) ? 1 : n * factorial(n - 1);
    }

    public static void main(String[] args) {
        for (int i = 0; i <= 12; i++)
            System.out.println(i + "! = " + factorial(i));
    }
}`,
  },

  infiniteLoop: {
    label : 'Infinite Loop (timeout demo)',
    code  : `public class InfiniteLoop {
    public static void main(String[] args) {
        System.out.println("Starting infinite loop...");
        while (true) {
            // This will be killed after 5 seconds
        }
    }
}`,
  },
};

// ─── DOM references ─────────────────────────────────────────────────────────
const $btnRun      = document.getElementById('btn-run');
const $btnTheme    = document.getElementById('btn-theme');
const $btnClear    = document.getElementById('btn-clear-output');
const $btnCopy     = document.getElementById('btn-copy-code');
const $btnStdin    = document.getElementById('btn-toggle-stdin');
const $exampleSel  = document.getElementById('example-select');
const $outputTerm  = document.getElementById('output-terminal');
const $stdinSection= document.getElementById('stdin-section');
const $stdinArea   = document.getElementById('stdin-textarea');
const $footerLang  = document.getElementById('footer-lang');
const $footerPos   = document.getElementById('footer-pos');
const $footerStatus= document.getElementById('footer-status');
const $editorPanel = document.getElementById('editor-panel');
const $outputPanel = document.getElementById('output-panel');
const $resizer     = document.getElementById('resizer');

// ─── State ───────────────────────────────────────────────────────────────────
let monacoEditor = null;
let isRunning    = false;
let isDarkTheme  = true;

// ─── Monaco bootstrap ────────────────────────────────────────────────────────
require.config({
  paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs' },
});

require(['vs/editor/editor.main'], () => {
  monacoEditor = monaco.editor.create(document.getElementById('monaco-editor'), {
    value             : EXAMPLES.hello.code,
    language          : 'java',
    theme             : 'vs-dark',
    fontSize          : 14,
    fontFamily        : "'JetBrains Mono','Fira Code','Cascadia Code','Consolas',monospace",
    fontLigatures     : true,
    minimap           : { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout   : true,
    tabSize           : 4,
    wordWrap          : 'on',
    renderLineHighlight: 'line',
    smoothScrolling   : true,
    cursorBlinking    : 'smooth',
    padding           : { top: 12, bottom: 12 },
    lineNumbersMinChars: 3,
  });

  // ── Cursor position in footer ─────────────────────────────────────────────
  monacoEditor.onDidChangeCursorPosition((e) => {
    const { lineNumber, column } = e.position;
    $footerPos.textContent = `Ln ${lineNumber}, Col ${column}`;
  });

  // ── Keyboard shortcut: Ctrl+Enter / Cmd+Enter ─────────────────────────────
  monacoEditor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
    runCode
  );

  // ── Keyboard shortcut: Ctrl+L — clear output ─────────────────────────────
  monacoEditor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL,
    clearOutput
  );
});

// ─── Run code ────────────────────────────────────────────────────────────────
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
      body   : JSON.stringify({ sourceCode, stdin }),
    });

    if (!response.ok && response.status !== 200) {
      // HTTP-level error (400, 413, 429, 500 …)
      let body;
      try { body = await response.json(); } catch (_) { body = {}; }
      renderOutput({
        success: false,
        error  : body.error || `Server returned HTTP ${response.status}`,
        stage  : body.stage || 'server',
      });
      return;
    }

    const result = await response.json();
    renderOutput(result);

  } catch (err) {
    renderOutput({
      success: false,
      error  : `Network error: ${err.message}`,
      stage  : 'network',
    });
  } finally {
    setRunning(false);
  }
}

// ─── Render output ───────────────────────────────────────────────────────────
function renderOutput(result) {
  const { success, output = '', error = '', stage = '', executionTime } = result;

  let html = '';

  // Stage badge
  if (stage === 'timeout') {
    html += badge('timeout', '⏱ Timeout');
  } else if (stage === 'compilation') {
    html += badge('error', '✖ Compilation Error');
  } else if (stage === 'validation') {
    html += badge('error', '✖ Validation Error');
  } else if (stage === 'execution' && !success) {
    html += badge('error', '✖ Runtime Error');
  } else if (success) {
    html += badge('success', '✔ Success');
  } else {
    html += badge('error', '✖ Error');
  }

  // stdout
  if (output) {
    const cls = success ? 'out-success' : 'out-success'; // stdout is always white
    html += `<span class="${cls}">${escHtml(output)}</span>`;
  }

  // stderr / error message
  if (error) {
    const cls = stage === 'timeout' ? 'out-timeout' : 'out-error';
    if (output) html += '\n';
    html += `<span class="${cls}">${escHtml(error)}</span>`;
  }

  // Nothing at all
  if (!output && !error) {
    html += '<span class="out-info">Program produced no output.</span>';
  }

  // Execution time
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
  $outputTerm.innerHTML =
    '<div class="stage-badge running">● Running…</div>' +
    '<span class="out-info">Compiling and executing your Java code…</span>';
}

function clearOutput() {
  $outputTerm.innerHTML = '<span class="out-placeholder">Output will appear here after you click Run.</span>';
  updateFooterStatus(null);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

// ─── Event listeners ─────────────────────────────────────────────────────────
$btnRun.addEventListener('click', runCode);

$btnTheme.addEventListener('click', () => {
  isDarkTheme = !isDarkTheme;
  document.body.classList.toggle('theme-light', !isDarkTheme);
  if (monacoEditor) {
    monaco.editor.setTheme(isDarkTheme ? 'vs-dark' : 'vs');
  }
  $btnTheme.title = isDarkTheme ? 'Switch to Light Theme' : 'Switch to Dark Theme';
  $btnTheme.innerHTML = isDarkTheme ? sunIcon() : moonIcon();
});

$btnClear.addEventListener('click', clearOutput);

$btnCopy.addEventListener('click', async () => {
  if (!monacoEditor) return;
  try {
    await navigator.clipboard.writeText(monacoEditor.getValue());
    const original = $btnCopy.textContent;
    $btnCopy.textContent = 'Copied!';
    setTimeout(() => ($btnCopy.textContent = original), 1500);
  } catch (_) { /* clipboard denied */ }
});

$btnStdin.addEventListener('click', () => {
  $stdinSection.classList.toggle('open');
  const isOpen = $stdinSection.classList.contains('open');
  $btnStdin.textContent = isOpen ? 'Hide Input' : 'Input (stdin)';
});

$exampleSel.addEventListener('change', () => {
  const key = $exampleSel.value;
  if (!key || !EXAMPLES[key] || !monacoEditor) return;
  const ex = EXAMPLES[key];
  monacoEditor.setValue(ex.code);
  if (ex.stdin) {
    $stdinArea.value = ex.stdin;
    $stdinSection.classList.add('open');
    $btnStdin.textContent = 'Hide Input';
  } else {
    $stdinArea.value = '';
  }
  $exampleSel.value = ''; // reset selector
  clearOutput();
});

// ─── Drag-to-resize splitter ─────────────────────────────────────────────────
(function initResizer() {
  let dragging = false;
  let startX, startEditorW, startOutputW;
  const isVertical = () => window.innerWidth <= 700;

  $resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startEditorW  = $editorPanel.offsetWidth;
    startOutputW  = $outputPanel.offsetWidth;
    $resizer.classList.add('dragging');
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx     = e.clientX - startX;
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
      // Trigger Monaco layout recalculation
      if (monacoEditor) monacoEditor.layout();
    }
  });
})();

// ─── SVG icons ───────────────────────────────────────────────────────────────
function moonIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
  </svg>`;
}
function sunIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>`;
}
