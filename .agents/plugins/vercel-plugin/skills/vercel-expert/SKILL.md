---
name: vercel-expert
description: >-
  Expert guidance, architectural patterns, configuration schemas, and deployment runbooks for Vercel.
  Use this skill whenever building, deploying, configuring, or troubleshooting applications on Vercel,
  including Serverless Functions (Python, Node.js), Next.js, Edge Middleware, vercel.json configurations,
  environment variables, and CI/CD pipelines.
---

# Vercel Expert Skill

This skill provides complete operational knowledge, best practices, and diagnostics for building and deploying production-grade applications on **Vercel**.

---

## 1. Vercel Architecture & Runtime Fundamentals

### Filesystem Constraints
* **Read-Only Root**: On Vercel Serverless Functions, the project root directory is strictly **read-only**.
* **Writable `/tmp`**: Only `/tmp` (available via `tempfile.gettempdir()` in Python or `os.tmpdir()` in Node.js) is writable. Max capacity is 512 MB.
* **Statelessness**: Serverless instances are ephemeral. Files written to `/tmp` are discarded when instances terminate or scale. Always return results directly as stream/base64 or persist to cloud storage (e.g., S3, Vercel Blob, Supabase).

### Execution Limits
* **Timeout Limits**:
  * Hobby (Free): 10 seconds default (max 60 seconds with `maxDuration` in `vercel.json`).
  * Pro / Enterprise: 15–300 seconds.
* **Payload Limits**: Max request body size is **4.5 MB** on Serverless Functions and **10 MB** on Edge. For larger files (e.g. 50 MB PDFs), stream directly or upload client-side to Vercel Blob / S3 presigned URLs.
* **Bundle Limits**: Uncompressed function size limit is 250 MB; compressed zip is 50 MB.

---

## 2. Python Serverless on Vercel

### Recommended Project Layouts

#### Option A: Single App (e.g. Flask / FastAPI) via `vercel.json`
```text
my-project/
├── app.py
├── vercel.json
├── requirements.txt
├── templates/
└── static/
```
In `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "app.py",
      "use": "@vercel/python",
      "config": {
        "maxDuration": 60
      }
    }
  ],
  "routes": [
    {
      "src": "/static/(.*)",
      "dest": "/static/$1"
    },
    {
      "src": "/(.*)",
      "dest": "app.py"
    }
  ]
}
```

#### Option B: Standalone API Directory (`api/`)
```text
my-project/
├── api/
│   └── index.py
├── public/
└── requirements.txt
```
Vercel automatically detects files under `api/` as serverless entry points without requiring `vercel.json`.

---

## 3. `vercel.json` Configuration Reference

### Common Schema Blocks

```json
{
  "version": 2,
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/static/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        }
      ]
    }
  ],
  "env": {
    "PYTHON_VERSION": "3.11"
  }
}
```

---

## 4. Vercel CLI Commands Cheat Sheet

| Command | Description |
| :--- | :--- |
| `vercel login` | Authenticate with your Vercel account |
| `vercel link` | Link local repository to a Vercel project |
| `vercel dev` | Start local development environment simulating Vercel serverless |
| `vercel` | Deploy a preview build |
| `vercel --prod` | Deploy directly to production |
| `vercel env pull` | Pull production/preview environment variables into `.env.local` |
| `vercel logs <url>` | Stream real-time function logs |
| `vercel inspect <deployment>` | View build logs, timings, and deployment metadata |

---

## 5. Troubleshooting & Diagnostics Runbook

### Error: `[Errno 30] Read-only file system`
* **Root Cause**: Attempting to write files to `./uploads` or `./output` in project root.
* **Fix**: Route all file creation to `tempfile.gettempdir()` (`/tmp`) or process purely in memory with `io.BytesIO`.

### Error: `FUNCTION_INVOCATION_TIMEOUT`
* **Root Cause**: Processing exceeded default 10s execution window.
* **Fix**: Add `"config": { "maxDuration": 60 }` to `vercel.json` under `@vercel/python`.

### Error: `413 Payload Too Large`
* **Root Cause**: Uploading files larger than Vercel's 4.5 MB request body limit on serverless functions.
* **Fix**: Use client-side processing (e.g. PDF.js canvas) or upload directly to cloud storage (Vercel Blob / S3) via presigned URLs.

### Error: `ModuleNotFoundError`
* **Root Cause**: Missing dependency in `requirements.txt`.
* **Fix**: Ensure all imports are listed in `requirements.txt` with appropriate version bounds.
