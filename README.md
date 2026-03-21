# Compile-Lab — Multi-Language Online Compiler

[![Build & Publish Docker Image](https://github.com/RynoCODE/compile-lab/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/RynoCODE/compile-lab/actions/workflows/docker-publish.yml)
[![Docker AMD64](https://img.shields.io/badge/docker-amd64-blue?logo=docker)](https://github.com/RynoCODE/compile-lab/pkgs/container/compile-lab)
[![Docker ARM64](https://img.shields.io/badge/docker-arm64-blue?logo=docker)](https://github.com/RynoCODE/compile-lab/pkgs/container/compile-lab-arm)

> A self-hosted, browser-based code compiler and runner supporting Java, Python, C, C++, JavaScript, and TypeScript. Built with Node.js, Monaco Editor, and Docker.

---

## Features

- **6 Languages** — Java 17, Python 3, C (GCC), C++ (G++), JavaScript (Node.js 20), TypeScript (tsc)
- **Monaco Editor** — VS Code's editor engine with full syntax highlighting per language
- **stdin Support** — pipe custom input to your programs
- **Split-panel UI** — resizable editor and output panels
- **Dark / Light theme** — toggle between themes
- **Show Warnings toggle** — for C/C++: enables `-Wall` so compiler warnings are surfaced to the user; the program still compiles and runs (opt-in)
- **Stage-aware output** — badges for Compile Error, Runtime Error, Timeout, and Success
- **Execution timing** — see how long your program ran
- **Keyboard shortcuts** — `Ctrl+Enter` to run, `Ctrl+L` to clear output
- **Security-hardened** — sandboxed Docker container, non-root execution, read-only filesystem

---

## Docker Images

Pre-built Docker images are published to GitHub Container Registry (GHCR) for both architectures:

| Architecture | Image Name | Use Case |
|--------------|------------|----------|
| **AMD64/x86_64** | `ghcr.io/rynocode/compile-lab:latest` | Intel/AMD processors, most cloud VMs |
| **ARM64** | `ghcr.io/rynocode/compile-lab-arm:latest` | Apple Silicon (M1/M2/M3), AWS Graviton, Raspberry Pi |

Both images are built natively (no QEMU emulation) on GitHub Actions, ensuring optimal performance and faster build times.

**Version Tags:**
- `latest` — latest stable release
- `v1.2.3` — specific version tag
- `sha-abc1234` — specific commit SHA

---

## Supported Languages

| Language     | Runtime                 | Compiler / Interpreter        |
|--------------|-------------------------|-------------------------------|
| Java         | Eclipse Temurin 17      | `javac` + `java`              |
| Python 3     | Python 3 (system)       | `python3`                     |
| C            | GCC                     | `gcc` with `-lm`              |
| C++          | G++                     | `g++`                         |
| JavaScript   | Node.js 20              | `node` (interpreted directly) |
| TypeScript   | Node.js 20 + tsc        | `tsc` → `node`                |

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/)

### Option 1: Run with Pre-built Docker Images

Pre-built images are available on GitHub Container Registry for both architectures:

**For AMD64/x86_64 systems:**
```bash
docker pull ghcr.io/rynocode/compile-lab:latest
docker run -d -p 3000:3000 --name code-compiler \
  --security-opt=no-new-privileges:true \
  --cap-drop=ALL \
  --read-only \
  --tmpfs /tmp:rw,exec,nosuid,size=100m \
  --memory=512m \
  --cpus=2 \
  ghcr.io/rynocode/compile-lab:latest
```

**For ARM64 systems (e.g., Apple Silicon, AWS Graviton):**
```bash
docker pull ghcr.io/rynocode/compile-lab-arm:latest
docker run -d -p 3000:3000 --name code-compiler \
  --security-opt=no-new-privileges:true \
  --cap-drop=ALL \
  --read-only \
  --tmpfs /tmp:rw,exec,nosuid,size=100m \
  --memory=512m \
  --cpus=2 \
  ghcr.io/rynocode/compile-lab-arm:latest
```

Then open **http://localhost:3000** in your browser.

### Option 2: Build and Run with Docker Compose

```bash
git clone https://github.com/RynoCODE/compile-lab.git
cd compile-lab

docker compose up -d --build
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

| Field            | Type    | Required | Limits   | Description                                                              |
|------------------|---------|----------|----------|--------------------------------------------------------------------------|
| `sourceCode`     | string  | yes      | max 50 KB| Source code to compile and run                                           |
| `language`       | string  | no       | —        | `java` \| `python` \| `c` \| `cpp` \| `javascript` \| `typescript` (default: `java`) |
| `stdin`          | string  | no       | max 4 KB | Standard input for the program                                           |
| `strictWarnings` | boolean | no       | —        | When `true` and language is `c` or `cpp`, appends `-Wall` so compiler warnings are shown to the user. The program still compiles and runs; warnings appear in the `error` field alongside any runtime errors. Ignored for all other languages. |

**Response** (JSON):

```json
{
  "success": true,
  "output": "Hello, World!\n",
  "error": "",
  "stage": "execution",
  "executionTime": 312
}
```

| Field           | Description                                                               |
|-----------------|---------------------------------------------------------------------------|
| `success`       | `true` if program ran without error                                       |
| `output`        | stdout from the program                                                   |
| `error`         | Compiler or runtime error message (empty string if none)                  |
| `stage`         | `validation` \| `compilation` \| `execution` \| `timeout` \| `internal`  |
| `executionTime` | Wall-clock time in milliseconds                                           |

**Rate limit:** 15 requests / minute / IP

### `GET /health`

Returns `{ "status": "ok", "timestamp": "..." }` — used by Docker healthcheck.

---

## Architecture

```
compile-lab/
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
        ├── compiler.js        # Core compile/run engine (all 6 languages)
        └── routes/
            └── compile.js     # POST /api/compile (rate limiting, validation)
```

### How It Works

1. The frontend sends a `POST /api/compile` request with `sourceCode`, `language`, optional `stdin`, and optional `strictWarnings`.
2. The backend creates a UUID-namespaced temp directory under `/tmp`, writes the source file, and spawns the appropriate process.
3. **Execution pipelines by language:**
   - **Java** — `javac <ClassName>.java` → `java -cp <dir> -Xmx256m -Xss512k <ClassName>`
   - **Python** — `python3 program.py` (interpreted; syntax errors surface at runtime)
   - **C** — `gcc program.c -o program -lm` → `./program`
   - **C++** — `g++ program.cpp -o program` → `./program`
   - **JavaScript** — `node program.js` (interpreted; syntax errors surface at runtime)
   - **TypeScript** — `tsc --strict --target ES2020 --module commonjs program.ts` → `node program.js`
4. Output is streamed and capped at **100 KB**. Processes that exceed the limit are killed.
5. A **5-second execution timeout** (SIGKILL) and a **10-second compile timeout** protect the host from runaway code.
6. The temp directory is always cleaned up in a `finally` block.

---

## Security

| Measure                     | Detail                                                       |
|-----------------------------|--------------------------------------------------------------|
| Non-root user               | Container runs as `appuser` (UID 1001)                       |
| No privilege escalation     | `no-new-privileges: true`                                    |
| All capabilities dropped    | `cap_drop: ALL`                                              |
| Read-only root filesystem   | Only `/tmp` is writable (RAM-backed tmpfs)                   |
| No shell injection          | All `spawn()` calls use `shell: false`                       |
| Minimal process environment | Only `PATH` is passed to child processes                     |
| Output flood protection     | 100 KB cap; process killed on excess                         |
| Rate limiting               | 15 compile requests / minute / IP                            |
| Input size limits           | Source ≤ 50 KB, stdin ≤ 4 KB, body ≤ 60 KB                  |
| JVM memory limits           | `-Xmx256m` (heap), `-Xss512k` (stack)                        |
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

> **Note:** TypeScript unit and integration tests call `tsc` as a subprocess. Ensure `tsc` is on your system PATH before running tests: `npm install -g typescript`.

### Running Tests

```bash
cd backend

npm test                 # all tests (40 unit + integration tests)
npm run test:unit        # unit tests only (compiler.js directly, tests 1–40)
npm run test:integration # integration tests (HTTP via supertest)
npm run test:coverage    # with coverage report
```

Tests cover all 6 languages including:
- Hello World execution, syntax/compile errors, runtime errors, infinite loop timeouts
- stdin reading for Java, Python, C, C++
- TypeScript type error detection at the `compilation` stage
- JavaScript syntax error detection at the `execution` stage
- `strictWarnings` opt-in for C and C++ (tests 35–40)
- Output flood protection, path-leak prevention, and rate limiting

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
# Pull the latest pre-built image (AMD64)
docker pull ghcr.io/rynocode/compile-lab:latest

# Pull the latest pre-built image (ARM64)
docker pull ghcr.io/rynocode/compile-lab-arm:latest

# Rebuild after code changes
docker compose down && docker compose up -d --build

# View server logs
docker logs code-compiler --tail 50 -f

# Verify tsc is available in the container
docker exec code-compiler tsc --version

# Verify /tmp is mounted with exec flag (required for C/C++)
docker exec code-compiler mount | grep /tmp

# Check container resource usage
docker stats code-compiler
```

> **Note on tmpfs:** Docker mounts tmpfs with `noexec` by default. The `exec` flag is explicitly set in `docker-compose.yml` so that C/C++ binaries compiled into `/tmp` can be executed. JavaScript and TypeScript execution is unaffected since `node` itself is a system binary — only the source/output files live in `/tmp`.

---

## Browser Support

Any modern browser (Chrome, Firefox, Edge, Safari). The UI is responsive and stacks vertically on screens narrower than 700 px.

---

## License

MIT
