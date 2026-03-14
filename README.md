# CodeRun — Multi-Language Online Compiler

> A self-hosted, browser-based code compiler and runner supporting Java, Python, C, and C++. Built with Node.js, Monaco Editor, and Docker.

---

## Features

- **4 Languages** — Java 17, Python 3, C (GCC), C++ (G++)
- **Monaco Editor** — VS Code's editor engine with full syntax highlighting
- **stdin Support** — pipe custom input to your programs
- **Split-panel UI** — resizable editor and output panels
- **Dark / Light theme** — toggle between themes
- **Stage-aware output** — badges for Compile Error, Runtime Error, Timeout, and Success
- **Execution timing** — see how long your program ran
- **Keyboard shortcuts** — `Ctrl+Enter` to run, `Ctrl+L` to clear output
- **Security-hardened** — sandboxed Docker container, non-root execution, read-only filesystem

---

## Supported Languages

| Language   | Runtime              | Compiler / Interpreter |
|------------|----------------------|------------------------|
| Java       | Eclipse Temurin 17   | `javac` + `java`       |
| Python 3   | Python 3 (system)    | `python3`              |
| C          | GCC                  | `gcc` with `-lm`       |
| C++        | G++                  | `g++`                  |

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/)

### Run with Docker Compose

```bash
git clone <your-repo-url>
cd java-compiler

docker compose up -d
```

Then open **http://localhost:3000** in your browser.

### Stop

```bash
docker compose down
```

---

## API

### `POST /api/compile`

Compile and run source code.

**Request body** (JSON):

| Field        | Type   | Required | Limits   | Description                     |
|--------------|--------|----------|----------|---------------------------------|
| `sourceCode` | string | yes      | max 50 KB| Source code to compile and run  |
| `language`   | string | no       | —        | `java` \| `python` \| `c` \| `cpp` (default: `java`) |
| `stdin`      | string | no       | max 4 KB | Standard input for the program  |

**Response** (JSON):

```json
{
  "success": true,
  "output": "Hello, World!\n",
  "error": null,
  "stage": "execution",
  "executionTime": 312
}
```

| Field           | Description                                                  |
|-----------------|--------------------------------------------------------------|
| `success`       | `true` if program ran without error                          |
| `output`        | Combined stdout/stderr                                       |
| `error`         | Error message (if any)                                       |
| `stage`         | `validation` \| `compilation` \| `execution` \| `timeout`   |
| `executionTime` | Wall-clock time in milliseconds                              |

**Rate limit:** 15 requests / minute / IP

### `GET /health`

Returns `{ "status": "ok", "timestamp": "..." }` — used by Docker healthcheck.

---

## Architecture

```
java-compiler/
├── Dockerfile                 # Multi-stage build (deps → runtime)
├── docker-compose.yml         # Container config with security hardening
├── frontend/
│   ├── index.html             # Split-panel UI shell
│   ├── css/style.css          # Styles + themes
│   └── js/app.js              # Monaco editor + language switching + API calls
└── backend/
    ├── package.json
    └── src/
        ├── server.js          # Express app (helmet, CORS, static serving)
        ├── compiler.js        # Core compile/run engine
        └── routes/
            └── compile.js     # POST /api/compile (rate limiting, validation)
```

### How It Works

1. The frontend sends a `POST /api/compile` request with `sourceCode`, `language`, and optional `stdin`.
2. The backend creates a UUID-namespaced temp directory under `/tmp`, writes the source file, and spawns the appropriate process.
3. For compiled languages (Java, C, C++), it compiles first, then runs the binary. For Python, it runs directly.
4. Output is streamed and capped at **100 KB**. Processes that exceed the limit are killed.
5. A **5-second execution timeout** (SIGKILL) and a **10-second compile timeout** protect the host from runaway code.
6. The temp directory is always cleaned up in a `finally` block.

---

## Security

| Measure                     | Detail                                                       |
|-----------------------------|--------------------------------------------------------------|
| Non-root user               | Container runs as `appuser` (UID 1001)                      |
| No privilege escalation     | `no-new-privileges: true`                                    |
| All capabilities dropped    | `cap_drop: ALL`                                              |
| Read-only root filesystem   | Only `/tmp` is writable (RAM-backed tmpfs)                   |
| No shell injection          | All `spawn()` calls use `shell: false`                       |
| Minimal process environment | Only `PATH` is passed to child processes                     |
| Output flood protection     | 100 KB cap; process killed on excess                         |
| Rate limiting               | 15 compile requests / minute / IP                            |
| Input size limits           | Source ≤ 50 KB, stdin ≤ 4 KB, body ≤ 60 KB                 |
| JVM memory limits           | `-Xmx256m` (heap), `-Xss512k` (stack)                       |
| Container resource limits   | 2 vCPU max, 512 MB RAM max                                   |

---

## Development

### Run the backend locally (without Docker)

```bash
cd backend
npm install
npm run dev        # starts with nodemon (auto-reload)
```

The server listens on `http://localhost:3000`. The frontend is served as static files from the same server.

### Running Tests

```bash
cd backend

npm test                 # all tests
npm run test:unit        # unit tests only (compiler.js directly)
npm run test:integration # integration tests (HTTP via supertest)
npm run test:coverage    # with coverage report
```

Tests cover all 4 languages including Hello World, syntax errors, runtime errors, infinite loops, stdin, output flooding, rate limiting, and path-leak prevention.

---

## Configuration

Environment variables (set in `docker-compose.yml` or a `.env` file):

| Variable      | Default       | Description                   |
|---------------|---------------|-------------------------------|
| `PORT`        | `3000`        | Port the server listens on    |
| `NODE_ENV`    | `production`  | Node.js environment           |
| `CORS_ORIGIN` | `*`           | Allowed CORS origin(s)        |

---

## Docker Tips

```bash
# Rebuild after code changes
docker compose down && docker compose up -d --build

# View server logs
docker logs code-compiler --tail 50 -f

# Verify /tmp is mounted with exec flag (required for C/C++)
docker exec code-compiler mount | grep /tmp

# Check container resource usage
docker stats code-compiler
```

> **Note:** Docker mounts tmpfs with `noexec` by default. The `exec` flag is explicitly set in `docker-compose.yml` so that C/C++ binaries compiled into `/tmp` can actually be executed.

---

## Browser Support

Any modern browser (Chrome, Firefox, Edge, Safari). The UI is responsive and stacks vertically on screens narrower than 700 px.

---

## License

MIT
