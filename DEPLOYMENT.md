# CloudVault Production Deployment Guide

This document details the production deployment requirements, environment variables, health checking, and configuration for CloudVault.

---

## 1. System Architecture

CloudVault is built on a decoupled architecture containing:
- **Backend Service**: Express.js server exposing REST APIs under `/api`.
- **Frontend App**: Next.js client communicating with the backend APIs.
- **Database**: MongoDB (Atlas) for metadata storage, activity logs, and system states.
- **Storage**: Supabase Storage / S3-compatible object storage for file versions.
- **AI Processing Pipeline**: Background workers that process uploaded files asynchronously.

---

## 2. Environment Variables Configuration

The following variables must be configured in the deployment environment:

### Backend Service (`.env`)
| Variable | Description | Required | Example / Recommended |
| :--- | :--- | :--- | :--- |
| `PORT` | Port for the backend service to run on | Yes | `3000` |
| `MONGO_URI` | MongoDB connection URI | Yes | `mongodb+srv://<user>:<password>@cluster0.mongodb.net/cloudvault` |
| `JWT_SECRET` | Secret key for signing and verifying Auth tokens | Yes | *Use a secure 32-character hex string* |
| `SUPABASE_URL` | Supabase project URL for object storage | Yes (prod) | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) | Yes (prod) | *Service role key* |
| `SUPABASE_BUCKET`| Supabase Storage bucket name for files | No | `cloudvault-files` |
| `STORAGE_USE_MOCK` | Force in-memory storage (local/dev) | No | `true` |
| `NODE_ENV` | Running environment mode | Yes | `production` |
| `AI_PROVIDER` | AI backend (`mock` or `openrouter`) | No | `openrouter` |
| `OPENROUTER_API_KEY` | OpenRouter API key (server only) | Yes if `AI_PROVIDER=openrouter` | *Paste key; never commit* |
| `OPENROUTER_BASE_URL` | OpenRouter OpenAI-compatible base URL | No | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | Chat/summary/tag model id | No | `openrouter/free` (free) |
| `OPENROUTER_EMBEDDING_MODEL` | Embedding model id, or `local` | No | `local` (no paid embeddings) |

> Copy [`.env.example`](.env.example) to `.env`. If `AI_PROVIDER=openrouter` but `OPENROUTER_API_KEY` is empty, the worker falls back to **MockAIProvider** and logs a warning.
>
> Prefer free OpenRouter models (ids ending in `:free`, or `openrouter/free`). Do **not** set `openai/gpt-4o-mini` / paid embedding models unless you intend to spend credits.
> `OPENROUTER_EMBEDDING_MODEL=local` uses a deterministic local vector so semantic search works without a paid embedding API.

### Enable OpenRouter (after you generate a key)

1. Put the key in `.env`:
   ```
   AI_PROVIDER=openrouter
   OPENROUTER_API_KEY=sk-or-v1-...
   ```
2. Restart API (`npm run dev`) and worker (`npm run worker:dev`).
3. In the UI: enable workspace AI → **Reprocess Insights** on a file.
4. AI panel should show OpenRouter model metadata (not “Dev Mock” / `mock-summarizer`).
5. Live mode downloads the file and extracts text (PDF/text). Empty/unsupported files fail permanently with a clear error.

---

## Local development runbook (API + Worker + Frontend)

CloudVault AI jobs do **not** run inside `npm run dev`. Run three processes:

```bash
# Terminal 1 — API
npm run dev

# Terminal 2 — AI worker (required for summaries / READY status)
npm run worker:dev

# Terminal 3 — Frontend
cd frontend && npm run dev -- -p 3001
```

Then in the UI: enable workspace AI (OWNER/ADMIN) → upload or **Reprocess** a file → wait for READY.

- Without `OPENROUTER_API_KEY`: mock summary/tags (local/dev).
- With OpenRouter configured: real summary/tags/embeddings from extracted document text.

Account switching: always **Sign Out** (or open `/login?switch=1`) before logging in as another user in the same browser. Prefer a second profile/incognito for invitee testing.


### Frontend Application (`.env.production`)
| Variable | Description | Required | Example / Recommended |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_API_URL` | Base URL of the deployed Backend API service | Yes | `https://api.cloudvault.com` |

---

## 3. Health Monitoring & Status Checks

The backend exposes the following endpoint to monitor service health and connection statuses:

### `GET /health`
- **Response status**: `200 OK` (if all systems are healthy) / `503 Service Unavailable` (if MongoDB or Supabase connection is down).
- **Format**:
```json
{
  "status": "healthy",
  "timestamp": "2026-06-10T16:20:00Z",
  "services": {
    "mongodb": "connected",
    "supabase": "connected"
  }
}
```

---

## 4. Production Log Sanitization & Security

To protect user privacy and secure credentials in production:
1. **No Sensitive Leaks**: Ensure all loggers exclude request/response headers containing `Authorization`, `Cookie`, or `Set-Cookie`.
2. **PII Masking**: Ensure passwords, credit cards, and JWT tokens are filtered and replaced with `[REDACTED]` in application logging middlewares.
3. **Log Level**: Use `info` or `warn` level in production environments to minimize IO bottlenecks and limit debugging log output.

---

## 5. Deployment Targets

### Backend Service & Worker
- **Target**: Render, Heroku, AWS ECS, or DigitalOcean App Platform.
- **Process Configuration**:
  - Web service: Runs `npm run start` (Express.js server).
  - Background worker: Runs `npm run worker` (`node dist/workers/ai.worker.js`).

### Frontend Client
- **Target**: Vercel, Netlify, or AWS Amplify.
- **Process Configuration**:
  - Build command: `npm run build`
  - Output directory: `.next`

### Database & Storage
- **Database**: MongoDB Atlas (Shared or Serverless cluster).
- **Storage**: Supabase Storage Bucket with appropriate policy permissions.
