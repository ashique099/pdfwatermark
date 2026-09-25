# Vercel Deployment & Serverless Rules

When writing code or configuring deployments for Vercel, enforce the following guidelines:

1. **Stateless Operations & Ephemeral Storage**:
   - The application root on Vercel Serverless is read-only. Never write to `./uploads/`, `./output/`, or the project root.
   - Always route temporary scratch files to `/tmp` via `tempfile.gettempdir()`.
   - Prefer in-memory byte streams (`io.BytesIO()`) over disk I/O whenever possible.
   - Assume any file written to `/tmp` will disappear between requests. Return generated artifacts (PDFs, images) directly in the response as binary streams or Base64 data.

2. **Bundle & Dependency Management**:
   - Keep `requirements.txt` strictly trimmed to required libraries to stay well within Vercel's 250 MB uncompressed limit.
   - Avoid compiling binary extensions during build; use pre-built manylinux wheels.

3. **Performance & Timeout Budget**:
   - Keep request processing under 10 seconds for standard tiers, or configure `"maxDuration": 60` in `vercel.json` if heavy PDF processing is required.
   - Implement streaming or immediate client feedback during long operations.

4. **Static Asset Optimization**:
   - Configure cache headers for static resources (`/static/*`) with long max-age and immutable flags in `vercel.json`.
