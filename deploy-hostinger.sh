#!/bin/bash
# ==============================================================================
# Hostinger Production Deployment Script
# Run this script on your Hostinger server / VPS to update and restart the app
# ==============================================================================

set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo "==> 1. Pulling latest code from GitHub..."
git pull origin main

echo "==> 2. Checking Python Virtual Environment..."
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

echo "==> 3. Activating virtual environment..."
source venv/bin/activate

echo "==> 4. Upgrading pip and installing requirements..."
pip install --upgrade pip
pip install -r requirements.txt

echo "==> 5. Ensuring required directories exist..."
mkdir -p uploads output temp tmp

# Restart method 1: If using Phusion Passenger (cPanel / hPanel)
if [ -d "tmp" ]; then
    touch tmp/restart.txt
    echo "Restarted Passenger application via tmp/restart.txt"
fi

# Restart method 2: If using Systemd / Gunicorn (Hostinger VPS)
if systemctl is-active --quiet pdfwatermark 2>/dev/null; then
    sudo systemctl restart pdfwatermark
    echo "Restarted systemd service: pdfwatermark"
fi

echo "======================================================================"
echo " Deployment to Hostinger completed successfully! "
echo "======================================================================"
