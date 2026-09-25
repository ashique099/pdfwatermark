"""
Hostinger Passenger WSGI Entry Point
This file serves as the gateway for Hostinger's Python application runner (Phusion Passenger / cPanel / hPanel).
"""
import sys
import os

# Ensure the application root directory is at the beginning of sys.path
APP_DIR = os.path.dirname(os.path.abspath(__file__))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

# Import the Flask instance as `application` (the WSGI standard identifier)
from app import app as application
