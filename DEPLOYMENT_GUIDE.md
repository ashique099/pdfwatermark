# Deployment Guide: Vercel & Hostinger

This guide covers deploying the **PDF Watermark Web App** to both **Vercel** and **Hostinger**, with automated code push workflows.

---

## 🚀 Part 1: Hosting on Vercel

Vercel provides serverless hosting directly connected to your GitHub repository.

### Configuration Included
* `vercel.json`: Directs API requests to `app.py` using `@vercel/python` and serves static assets efficiently.
* `app.py`: Automatically detects Vercel's serverless environment and routes temporary file storage to `/tmp`.
* `static/js/script.js`: Encodes processed PDFs in-memory as Base64 blobs so downloads are instant without relying on serverless disk persistence.

### Step-by-Step Vercel Deployment

1. **Commit and Push Code to GitHub**:
   ```bash
   git add .
   git commit -m "Prepare for Vercel and Hostinger deployment"
   git push origin main
   ```

2. **Connect to Vercel**:
   * Navigate to [vercel.com](https://vercel.com) and sign in (using GitHub).
   * Click **"Add New..."** → **"Project"**.
   * Locate your repository `ashique099/pdfwatermark` and click **"Import"**.

3. **Deploy**:
   * Leave the Framework Preset as **Other** (Vercel will detect `vercel.json`).
   * Click **"Deploy"**.
   * Vercel will install dependencies from `requirements.txt` and launch your live application at `https://pdfwatermark-xxxx.vercel.app`.

4. **Continuous Deployment**:
   * Any future `git push origin main` will automatically build and deploy the updated application on Vercel.

---

## 🌐 Part 2: Hosting & Code Push on Hostinger

Hostinger supports deployment either through **hPanel (Shared/Cloud Hosting with Python App)** or **Hostinger VPS**.

---

### Option A: Hostinger hPanel Git Auto-Deploy (Web & Cloud Hosting)

This is the easiest setup for automatic code push without managing a server.

#### Step 1: Create the Python App in Hostinger hPanel
1. Log in to [Hostinger hPanel](https://hpanel.hostinger.com).
2. Go to **Websites** → Select your domain → Click **Manage**.
3. Under the **Advanced** section, search for **Python Application**.
4. Configure your application settings:
   * **Python Version**: Select **3.10** or **3.11** (recommended).
   * **Application Root**: e.g., `pdfwatermark` (or `public_html`).
   * **Application URL**: Your domain or subdomain (e.g., `watermark.yourdomain.com`).
   * **Application Startup File**: `passenger_wsgi.py` (already created in the repository).
   * **Application Entry Point**: `application` (already configured).
5. Click **Create**.

#### Step 2: Set Up Git Auto-Deploy in hPanel
1. In hPanel, go to **Advanced** → **Git**.
2. Fill in the repository details:
   * **Repository URL**: `https://github.com/ashique099/pdfwatermark.git`
   * **Branch**: `main`
   * **Install Directory**: Match your Python Application Root (e.g., `/public_html` or `/pdfwatermark`).
3. Click **Create**.
4. Hostinger will generate a **Webhook URL** (e.g., `https://hpanel.hostinger.com/api/git-deploy/...`).
5. Copy this Webhook URL.

#### Step 3: Connect Webhook in GitHub for Instant Code Push
1. Open your repository on GitHub: [github.com/ashique099/pdfwatermark](https://github.com/ashique099/pdfwatermark).
2. Click **Settings** → **Webhooks** → **Add webhook**.
3. In **Payload URL**, paste the Hostinger Webhook URL.
4. Set **Content type** to `application/json`.
5. Under "Which events would you like to trigger this webhook?", select **Just the push event**.
6. Click **Add webhook**.

🎉 **Done!** Whenever you run `git push origin main`, GitHub immediately notifies Hostinger, which pulls the latest code and updates your live site.

---

### Option B: Automated Push via GitHub Actions (SSH or FTP)

If you prefer CI/CD pipelines, a ready-to-use GitHub Actions workflow has been added at [`.github/workflows/deploy-hostinger.yml`](file:///d:/Watermark/.github/workflows/deploy-hostinger.yml).

#### How to configure:
1. Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret** and add your Hostinger credentials:

* **For SSH deployment (VPS / SSH-enabled accounts)**:
  * `HOSTINGER_HOST`: Your server IP or domain.
  * `HOSTINGER_USER`: Your SSH username (e.g., `u123456789`).
  * `HOSTINGER_SSH_KEY`: Your private SSH key.
  * `HOSTINGER_TARGET_DIR`: Target folder on Hostinger (e.g., `domains/yourdomain.com/public_html`).

* **For FTP deployment**:
  * `HOSTINGER_FTP_SERVER`: Your Hostinger FTP host.
  * `HOSTINGER_FTP_USERNAME`: Your FTP username.
  * `HOSTINGER_FTP_PASSWORD`: Your FTP password.
  * `HOSTINGER_FTP_DIR`: `public_html/`.

Once added, pushing to `main` automatically uploads your changes to Hostinger.

---

### Option C: Hostinger VPS (Full Control with Nginx & Gunicorn)

If you are using a Hostinger Ubuntu/Debian VPS:

1. **SSH into your Hostinger VPS**:
   ```bash
   ssh root@your-server-ip
   ```

2. **Clone the repository**:
   ```bash
   git clone https://github.com/ashique099/pdfwatermark.git /var/www/pdfwatermark
   cd /var/www/pdfwatermark
   ```

3. **Run the deployment script**:
   ```bash
   chmod +x deploy-hostinger.sh
   ./deploy-hostinger.sh
   ```

4. **Setup Systemd Service** (`/etc/systemd/system/pdfwatermark.service`):
   ```ini
   [Unit]
   Description=PDF Watermark Web App
   After=network.target

   [Service]
   User=www-data
   WorkingDirectory=/var/www/pdfwatermark
   Environment="PATH=/var/www/pdfwatermark/venv/bin"
   ExecStart=/var/www/pdfwatermark/venv/bin/gunicorn -w 3 -b 127.0.0.1:5000 app:app

   [Install]
   WantedBy=multi-user.target
   ```
   Start the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now pdfwatermark
   ```

5. **Nginx Reverse Proxy**:
   Point Nginx `proxy_pass http://127.0.0.1:5000;` to serve on port 80/443.

---

## 📋 Summary of Files Added for Vercel & Hostinger

| File | Target Platform | Purpose |
| :--- | :--- | :--- |
| [`vercel.json`](file:///d:/Watermark/vercel.json) | Vercel | Configures serverless builds, static asset routes, and timeout limits. |
| [`passenger_wsgi.py`](file:///d:/Watermark/passenger_wsgi.py) | Hostinger | WSGI gateway for Hostinger's Phusion Passenger Python runner. |
| [`.github/workflows/deploy-hostinger.yml`](file:///d:/Watermark/.github/workflows/deploy-hostinger.yml) | Hostinger | GitHub Actions workflow for automated push on `git push`. |
| [`deploy-hostinger.sh`](file:///d:/Watermark/deploy-hostinger.sh) | Hostinger VPS | One-command update script (pull, install, and restart). |
| [`app.py`](file:///d:/Watermark/app.py) | Both | Auto-detects serverless `/tmp` directory and adds Base64 download compatibility. |
