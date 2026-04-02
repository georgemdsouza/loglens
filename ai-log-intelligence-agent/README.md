# ai-log-intelligence-agent

Docker-first, local-first log analysis app for very large files.

- Backend streams logs line-by-line (including `.gz`) to avoid loading whole files into memory.
- Logs stay on each teammate's machine and are accessed **only** through a Docker volume mount.
- Backend scans mounted path `/data/logs` inside the container.

## Stack

- Backend: FastAPI (Python 3.11+)
- Frontend: React + TypeScript + Vite + Tailwind
- Runtime: Docker Compose

## Current capabilities

- Search very large `.log`, `.txt`, `.gz` files using streaming scan
- Date and time range filtering
- Fast multi-term search (AND / OR) without regex
- Regex mode for advanced matching
- Context lines: show X lines above/below each match
- Summary stats:
  - total files scanned
  - total lines scanned
  - total matches
  - top repeated patterns
- Export results as JSON or CSV
- Mounted path status panel (`exists`, `readable`, total files)

## Project structure

```txt
ai-log-intelligence-agent/
  backend/
    app/
      api/
      core/
      models/
      parsers/
      services/
      utils/
    Dockerfile
    requirements.txt
  frontend/
    src/
    Dockerfile
  sample-logs/
  docker-compose.yml
  .env.example
  .gitignore
  README.md
```

## Docker-first quick start

### 1) Prerequisites

- Docker Desktop (only required dependency)

### 2) Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set `LOG_FOLDER` to a host folder containing logs.

Examples:

- macOS/Linux:
  - `LOG_FOLDER=/Users/name/logs`
- Windows:
  - `LOG_FOLDER=C:/logs`
  - If your shell/Compose setup rejects that format, try `LOG_FOLDER=/c/logs`

### 3) Start the app

```bash
docker compose up --build
```

### 4) Open the app

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8000/health`
- Backend config: `http://localhost:8000/config`

## Mounted folder model

- Host log folder (`LOG_FOLDER`) is mounted read-only into backend at `/data/logs`.
- Backend default scan root comes from `LOG_MOUNT_PATH` (default `/data/logs`).
- UI currently searches directly under mounted root.
- App does **not** request arbitrary host machine paths from users.

## UI usage

### Search panel (left)

1. Set date/time filters (optional)
2. Choose either:
   - **Contains Terms (fast mode)** with AND/OR operator
   - **Regex mode** for advanced patterns
3. Select file extensions
4. Set **Context Lines (before/after)** if needed
5. Click **Search**

### Results panel (right)

- Summary cards and top repeated patterns
- Paginated matching lines
- Each match can include context lines above/below when enabled
- Export JSON / CSV

## Fast search vs regex

For large logs, prefer **Contains Terms (fast mode)** over regex lookaheads.

- Fast AND example:
  - term1: `857770`
  - term2: `3635623`
  - operator: `AND`
- Fast OR example:
  - same terms + operator `OR`

Regex is still available for complex matching but can be slower on huge files.

## API endpoints

- `GET /health`
- `GET /config`
- `POST /scan`
- `POST /search`
- `POST /export`

## Request model highlights

`POST /search` supports:

- `subfolder` (currently sent as empty from UI)
- `include_extensions`
- `date_range.start`, `date_range.end`
- `context_lines`
- `filters.keyword` (regex input)
- `filters.terms[]` (fast mode)
- `filters.terms_operator` (`and` or `or`)
- `filters.regex_mode`
- `filters.case_insensitive`
- `max_results`

## Environment variables

In `.env`:

- `LOG_FOLDER` (required host path)

Backend container env (`docker-compose.yml`):

- `LOG_MOUNT_PATH=/data/logs`
- `FRONTEND_ORIGIN=http://localhost:5173`

Frontend container env (`docker-compose.yml`):

- `VITE_API_BASE_URL=/api`
- `VITE_BACKEND_INTERNAL_URL=http://backend:8000`

## Troubleshooting

### No files or empty results

- Check `LOG_FOLDER` path in `.env`
- Confirm folder exists on host and has readable files
- Check `GET http://localhost:8000/config`
- Ensure selected file extensions match your files

### Date filter returns nothing

- Confirm log timestamp format is supported
- Try wider time range first
- Confirm timezone assumptions in your logs

### Slow search

- Avoid heavy regex when possible
- Use fast terms mode (AND/OR)
- Reduce time window or extensions
- Lower context lines and `max_results`

### Windows mount issues

- Try `C:/logs` or `/c/logs`
- Ensure drive sharing is enabled in Docker Desktop

## Notes and limitations

- Streaming scan avoids full-file memory load.
- Result list is capped by `max_results` to keep UI responsive.
- Export returns serialized content in response (large exports can still be heavy).
- Subfolder filtering is supported by backend and can be exposed in UI later.
- TODO(AI-summary): add AI summarization and anomaly insights.

---

Built by George D'Souza.
