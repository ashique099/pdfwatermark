import os
import io
import re
import uuid
import time
import logging
from datetime import datetime
from werkzeug.utils import secure_filename
from flask import Flask, request, jsonify, render_template, send_file, abort, send_from_directory
from PIL import Image

try:
    import pymupdf as fitz
except ImportError:
    import fitz

import tempfile
import base64

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

# Base directories - auto-detect serverless (e.g. Vercel) to use writable /tmp
IS_SERVERLESS = bool(os.environ.get('VERCEL') or os.environ.get('VERCEL_ENV') or os.environ.get('AWS_LAMBDA_FUNCTION_NAME'))

if IS_SERVERLESS:
    TEMP_BASE = tempfile.gettempdir()
    UPLOAD_DIR = os.path.join(TEMP_BASE, 'pdf_uploads')
    OUTPUT_DIR = os.path.join(TEMP_BASE, 'pdf_output')
    TEMP_DIR = os.path.join(TEMP_BASE, 'pdf_temp')
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    UPLOAD_DIR = os.path.join(BASE_DIR, 'uploads')
    OUTPUT_DIR = os.path.join(BASE_DIR, 'output')
    TEMP_DIR = os.path.join(BASE_DIR, 'temp')

for folder in [UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR]:
    os.makedirs(folder, exist_ok=True)

# Application initialization
app = Flask(__name__)
application = app  # WSGI compatibility for Hostinger Passenger

# Configuration from environment with robust defaults
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'pdf-watermark-secret-key-2026')
MAX_MB = int(os.environ.get('MAX_UPLOAD_MB', 50))
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_CONTENT_LENGTH', MAX_MB * 1024 * 1024))
FILE_RETENTION_SECONDS = int(os.environ.get('FILE_RETENTION_SECONDS', 3600))  # 1 hour

# In-memory registry for file metadata (file_id -> dict)
FILE_REGISTRY = {}


# ============================================================================
# HELPER FUNCTIONS & VALIDATION
# ============================================================================

def cleanup_old_files():
    """Removes temporary and output files older than FILE_RETENTION_SECONDS."""
    now = time.time()
    for directory in [UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR]:
        try:
            for fname in os.listdir(directory):
                fpath = os.path.join(directory, fname)
                if os.path.isfile(fpath):
                    if now - os.path.getmtime(fpath) > FILE_RETENTION_SECONDS:
                        try:
                            os.remove(fpath)
                            logger.info(f"Cleaned up stale file: {fpath}")
                        except OSError as e:
                            logger.warning(f"Error removing {fpath}: {e}")
        except Exception as e:
            logger.warning(f"Error reading directory {directory} during cleanup: {e}")

    # Clean in-memory registry
    stale_ids = [fid for fid, meta in FILE_REGISTRY.items() if now - meta.get('created_at', 0) > FILE_RETENTION_SECONDS]
    for fid in stale_ids:
        FILE_REGISTRY.pop(fid, None)


def hex_to_rgb(hex_code):
    """
    Converts #RRGGBB or #RGB to normalized float tuple (r, g, b) where 0.0 <= c <= 1.0.
    Defaults to black (0.0, 0.0, 0.0).
    """
    if not hex_code:
        return (0.0, 0.0, 0.0)
    hex_clean = hex_code.strip().lstrip('#')
    if len(hex_clean) == 3:
        hex_clean = ''.join(c * 2 for c in hex_clean)
    if len(hex_clean) != 6:
        return (0.0, 0.0, 0.0)
    try:
        r = int(hex_clean[0:2], 16) / 255.0
        g = int(hex_clean[2:4], 16) / 255.0
        b = int(hex_clean[4:6], 16) / 255.0
        return (round(r, 4), round(g, 4), round(b, 4))
    except ValueError:
        return (0.0, 0.0, 0.0)


def get_font_code(font_family, is_bold=False, is_italic=False):
    """
    Maps font family and style to standard base-14 PyMuPDF font identifiers:
    - helv (Helvetica), hebo, heit, hebi
    - tiro (Times-Roman), tibo, tiit, tibi
    - cour (Courier), cobo, coit, cobi
    """
    base_map = {
        'helvetica': 'helv',
        'arial': 'helv',
        'sans-serif': 'helv',
        'times': 'tiro',
        'times new roman': 'tiro',
        'serif': 'tiro',
        'courier': 'cour',
        
        'courier new': 'cour',
        'monospace': 'cour'
    }
    key = str(font_family or 'helvetica').lower().strip()
    base = base_map.get(key, 'helv')

    if base == 'helv':
        if is_bold and is_italic:
            return 'hebi'
        if is_bold:
            return 'hebo'
        if is_italic:
            return 'heit'
        return 'helv'
    elif base == 'tiro':
        if is_bold and is_italic:
            return 'tibi'
        if is_bold:
            return 'tibo'
        if is_italic:
            return 'tiit'
        return 'tiro'
    elif base == 'cour':
        if is_bold and is_italic:
            return 'cobi'
        if is_bold:
            return 'cobo'
        if is_italic:
            return 'coit'
        return 'cour'
    return 'helv'


def parse_page_selection(selection_type, custom_str, total_pages):
    """
    Converts page selection into 0-indexed page numbers.
    Validates bounds against total_pages.
    Raises ValueError with a user-facing explanation on invalid input.
    """
    if total_pages <= 0:
        raise ValueError("The PDF document has no pages.")

    mode = (selection_type or "all").lower().strip()

    if mode == "all":
        return list(range(total_pages))
    elif mode == "first":
        return [0]
    elif mode == "last":
        return [total_pages - 1]
    elif mode == "custom":
        if not custom_str or not custom_str.strip():
            raise ValueError("Please enter custom page numbers (e.g. 1, 3, 5-8).")

        pages = set()
        clean_str = custom_str.replace(" ", "")
        parts = clean_str.split(",")

        for part in parts:
            if not part:
                continue
            if "-" in part:
                range_parts = part.split("-")
                if len(range_parts) != 2:
                    raise ValueError(f"Invalid range format: '{part}'. Example format: 2-5")
                start_str, end_str = range_parts
                if not start_str.isdigit() or not end_str.isdigit():
                    raise ValueError(f"Page range must consist of numbers: '{part}'")
                start, end = int(start_str), int(end_str)
                if start > end:
                    raise ValueError(f"Invalid page range {start}-{end}. Start page cannot be greater than end page.")
                if start < 1 or end > total_pages:
                    raise ValueError(f"Page range {start}-{end} is out of bounds. The document has {total_pages} page(s).")
                for p in range(start, end + 1):
                    pages.add(p - 1)
            else:
                if not part.isdigit():
                    raise ValueError(f"Invalid page number: '{part}'")
                p = int(part)
                if p < 1 or p > total_pages:
                    raise ValueError(f"Page number {p} is out of bounds. The document has {total_pages} page(s).")
                pages.add(p - 1)

        if not pages:
            raise ValueError("No valid pages were specified in your selection.")

        return sorted(list(pages))
    else:
        raise ValueError(f"Invalid page selection option: '{selection_type}'")


def calculate_watermark_position(position_name, page_width, page_height, custom_x=None, custom_y=None, margin=50.0):
    """
    Computes anchor center point (cx, cy) on the page for the watermark.
    Supports Top Left, Top Center, Top Right, Center, Bottom Left, Bottom Center, Bottom Right, and Custom.
    """
    pos = (position_name or "center").lower().replace(" ", "").replace("-", "").replace("_", "")

    # Standard positions
    if pos in ("topleft", "lefttop"):
        return (margin, margin)
    elif pos in ("topcenter", "centertop", "top"):
        return (page_width / 2.0, margin)
    elif pos in ("topright", "righttop"):
        return (page_width - margin, margin)
    elif pos in ("bottomleft", "leftbottom"):
        return (margin, page_height - margin)
    elif pos in ("bottomcenter", "centerbottom", "bottom"):
        return (page_width / 2.0, page_height - margin)
    elif pos in ("bottomright", "rightbottom"):
        return (page_width - margin, page_height - margin)
    elif pos == "custom":
        try:
            fx = float(custom_x) if custom_x is not None else 50.0
            fy = float(custom_y) if custom_y is not None else 50.0
            # Interpret values between 0 and 100 as percentages
            if 0 <= fx <= 100 and 0 <= fy <= 100:
                cx = (fx / 100.0) * page_width
                cy = (fy / 100.0) * page_height
            else:
                cx = fx
                cy = fy
            return (cx, cy)
        except (ValueError, TypeError):
            return (page_width / 2.0, page_height / 2.0)
    else:
        # Default: Center
        return (page_width / 2.0, page_height / 2.0)


def validate_pdf(stream):
    """
    Checks if stream is a valid, readable, unencrypted PDF.
    Returns (doc, error_message)
    """
    try:
        header = stream.read(1024)
        stream.seek(0)
        if b"%PDF" not in header:
            return None, "Invalid PDF file. The uploaded file is not a valid PDF document."

        doc = fitz.open(stream=stream.read(), filetype="pdf")
        if doc.is_encrypted:
            doc.close()
            return None, "The PDF file is password protected. Please remove the password and try again."
        if len(doc) == 0:
            doc.close()
            return None, "The PDF document contains no pages."

        return doc, None
    except Exception as e:
        logger.error(f"Error validating PDF: {e}")
        return None, "Invalid PDF file. The document is corrupted or could not be read."


def validate_image(image_file):
    """
    Validates uploaded image format and integrity using Pillow.
    Returns (pil_image, error_message)
    """
    try:
        allowed_formats = {'PNG', 'JPEG', 'JPG', 'WEBP'}
        img = Image.open(image_file)
        if img.format.upper() not in allowed_formats:
            return None, f"Unsupported image format: {img.format}. Please upload a PNG, JPG, JPEG, or WEBP."
        return img, None
    except Exception as e:
        logger.error(f"Error validating image: {e}")
        return None, "Invalid image file. Please upload a valid PNG, JPG, JPEG, or WEBP image."


# ============================================================================
# WATERMARK APPLIERS
# ============================================================================

def apply_text_watermark(doc, target_pages, text, font_family, font_size,
                         color_hex, opacity, rotation, position,
                         custom_x=None, custom_y=None):
    """
    Inserts rotated and styled text watermark on selected pages using PyMuPDF.
    """
    font_code = get_font_code(font_family, False, False)
    # Check if bold/italic is part of request
    color_rgb = hex_to_rgb(color_hex)
    opacity = max(0.05, min(1.0, float(opacity)))
    rotation_deg = float(rotation)
    font_size = max(8.0, min(200.0, float(font_size)))

    for page_idx in target_pages:
        page = doc[page_idx]
        pw = page.rect.width
        ph = page.rect.height

        # Calculate anchor center
        cx, cy = calculate_watermark_position(position, pw, ph, custom_x, custom_y)

        # Measure text length
        try:
            text_len = fitz.get_text_length(text, fontname=font_code, fontsize=font_size)
        except Exception:
            text_len = len(text) * font_size * 0.55

        # Font vertical metrics (approximate baseline offset)
        ascent = font_size * 0.75
        descent = font_size * 0.25

        # Position unrotated baseline so (cx, cy) is geometric center of text
        base_x = cx - (text_len / 2.0)
        base_y = cy + ((ascent - descent) / 2.0)

        # PyMuPDF morph parameter rotates around center point (cx, cy)
        center_pt = fitz.Point(cx, cy)
        rot_mat = fitz.Matrix(rotation_deg)

        page.insert_text(
            fitz.Point(base_x, base_y),
            text,
            fontname=font_code,
            fontsize=font_size,
            color=color_rgb,
            fill_opacity=opacity,
            morph=(center_pt, rot_mat)
        )


def apply_image_watermark(doc, target_pages, pil_img, target_width,
                          opacity, rotation, position,
                          custom_x=None, custom_y=None):
    """
    Applies image watermark to target pages using Pillow for alpha/rotation and PyMuPDF for vector insertion.
    Preserves full PNG transparency.
    """
    opacity = max(0.0, min(1.0, float(opacity)))
    rotation_deg = float(rotation)
    target_width = max(20.0, min(1200.0, float(target_width)))

    # Convert to RGBA to preserve/add alpha transparency
    img = pil_img.convert("RGBA")
    orig_w, orig_h = img.size

    if orig_w == 0 or orig_h == 0:
        raise ValueError("Image dimensions must be non-zero.")

    # Calculate target height keeping aspect ratio
    aspect = orig_h / orig_w
    target_height = target_width * aspect

    # Resize cleanly with high-quality resampling
    img_resized = img.resize((int(round(target_width)), int(round(target_height))), Image.Resampling.LANCZOS)

    # Adjust alpha channel for opacity
    r, g, b, a = img_resized.split()
    a = a.point(lambda p: int(round(p * opacity)))
    img_with_opacity = Image.merge("RGBA", (r, g, b, a))

    # Rotate image with transparent fill
    # In Pillow, rotate(angle) rotates counter-clockwise in Cartesian.
    # To match CSS rotate(angle deg) where positive is clockwise:
    rotated_img = img_with_opacity.rotate(-rotation_deg, expand=True, resample=Image.Resampling.BICUBIC)

    # Export rotated image to PNG byte stream
    img_buffer = io.BytesIO()
    rotated_img.save(img_buffer, format="PNG")
    img_bytes = img_buffer.getvalue()

    rw, rh = rotated_img.size

    for page_idx in target_pages:
        page = doc[page_idx]
        pw = page.rect.width
        ph = page.rect.height

        # Compute center anchor
        cx, cy = calculate_watermark_position(position, pw, ph, custom_x, custom_y)

        # Place image rect centered at (cx, cy)
        rect = fitz.Rect(cx - (rw / 2.0), cy - (rh / 2.0), cx + (rw / 2.0), cy + (rh / 2.0))
        page.insert_image(rect, stream=img_bytes)


# ============================================================================
# API ROUTES
# ============================================================================

@app.route('/')
def index():
    """Renders the main single-page application."""
    cleanup_old_files()
    return render_template('index.html')


@app.route('/static/<path:filename>')
def serve_static(filename):
    """Fallback static handler checking public/static and static folders."""
    for folder in ['public/static', 'static']:
        path = os.path.join(app.root_path, folder)
        target = os.path.join(path, filename)
        if os.path.exists(target):
            return send_from_directory(path, filename)
    return abort(404)


@app.route('/favicon.ico')
def favicon_ico():
    for folder in ['public', 'static']:
        path = os.path.join(app.root_path, folder)
        if os.path.exists(os.path.join(path, 'favicon.ico')):
            return send_from_directory(path, 'favicon.ico', mimetype='image/vnd.microsoft.icon')
    return abort(404)


@app.route('/favicon.png')
def favicon_png():
    for folder in ['public', 'static']:
        path = os.path.join(app.root_path, folder)
        if os.path.exists(os.path.join(path, 'favicon.png')):
            return send_from_directory(path, 'favicon.png', mimetype='image/png')
    return abort(404)


@app.route('/favicon.svg')
def favicon_svg():
    for folder in ['public', 'static']:
        path = os.path.join(app.root_path, folder)
        if os.path.exists(os.path.join(path, 'favicon.svg')):
            return send_from_directory(path, 'favicon.svg', mimetype='image/svg+xml')
    return abort(404)


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.utcnow().isoformat(),
        'service': 'pdf-watermark-tool'
    })


@app.route('/api/watermark', methods=['POST'])
def process_watermark():
    """
    Main endpoint for receiving PDF and watermark configurations.
    Returns JSON with download URL and metadata.
    """
    try:
        # Periodic cleanup of expired files
        cleanup_old_files()

        # 1. Validate PDF file presence
        if 'pdf' not in request.files:
            return jsonify({'success': False, 'error': 'Please upload a PDF file.'}), 400

        pdf_file = request.files['pdf']
        if not pdf_file or pdf_file.filename == '':
            return jsonify({'success': False, 'error': 'Please select a valid PDF file.'}), 400

        original_filename = secure_filename(pdf_file.filename)
        if not original_filename:
            original_filename = "document.pdf"
        if not original_filename.lower().endswith('.pdf'):
            return jsonify({'success': False, 'error': 'Only PDF files (.pdf) are supported.'}), 400

        # Validate PDF content & structure with PyMuPDF
        doc, error_msg = validate_pdf(pdf_file.stream)
        if error_msg:
            return jsonify({'success': False, 'error': error_msg}), 400

        total_pages = len(doc)

        # 2. Parse and validate page selection
        pages_type = request.form.get('pages', 'all').lower().strip()
        custom_pages = request.form.get('custom_pages', '').strip()

        try:
            target_pages = parse_page_selection(pages_type, custom_pages, total_pages)
        except ValueError as ve:
            doc.close()
            return jsonify({'success': False, 'error': str(ve)}), 400

        # 3. Common watermark parameters
        watermark_type = request.form.get('watermark_type', 'text').lower().strip()
        position = request.form.get('position', 'center').strip()
        custom_x = request.form.get('custom_x', None)
        custom_y = request.form.get('custom_y', None)

        try:
            opacity = float(request.form.get('opacity', 0.3))
        except (ValueError, TypeError):
            opacity = 0.3

        try:
            rotation = float(request.form.get('rotation', -45))
        except (ValueError, TypeError):
            rotation = -45.0

        # 4. Process according to type
        if watermark_type == 'text':
            watermark_text = request.form.get('watermark_text', '').strip()
            if not watermark_text:
                doc.close()
                return jsonify({'success': False, 'error': 'Please enter watermark text.'}), 400

            font_family = request.form.get('font_family', 'helvetica').strip()
            is_bold = request.form.get('is_bold', 'false').lower() == 'true'
            is_italic = request.form.get('is_italic', 'false').lower() == 'true'

            try:
                font_size = float(request.form.get('font_size', 36))
            except (ValueError, TypeError):
                font_size = 36.0

            color_hex = request.form.get('color', '#000000').strip()

            # Map font code with style
            font_code = get_font_code(font_family, is_bold, is_italic)

            for page_idx in target_pages:
                page = doc[page_idx]
                pw = page.rect.width
                ph = page.rect.height
                cx, cy = calculate_watermark_position(position, pw, ph, custom_x, custom_y)

                try:
                    text_len = fitz.get_text_length(watermark_text, fontname=font_code, fontsize=font_size)
                except Exception:
                    text_len = len(watermark_text) * font_size * 0.55

                ascent = font_size * 0.75
                descent = font_size * 0.25
                base_x = cx - (text_len / 2.0)
                base_y = cy + ((ascent - descent) / 2.0)

                page.insert_text(
                    fitz.Point(base_x, base_y),
                    watermark_text,
                    fontname=font_code,
                    fontsize=font_size,
                    color=hex_to_rgb(color_hex),
                    fill_opacity=max(0.05, min(1.0, opacity)),
                    morph=(fitz.Point(cx, cy), fitz.Matrix(rotation))
                )

        elif watermark_type == 'image':
            if 'watermark_image' not in request.files:
                doc.close()
                return jsonify({'success': False, 'error': 'Please upload an image for the watermark.'}), 400

            img_file = request.files['watermark_image']
            if not img_file or img_file.filename == '':
                doc.close()
                return jsonify({'success': False, 'error': 'Please select an image file.'}), 400

            pil_img, img_err = validate_image(img_file.stream)
            if img_err:
                doc.close()
                return jsonify({'success': False, 'error': img_err}), 400

            try:
                img_width = float(request.form.get('img_width', 200))
            except (ValueError, TypeError):
                img_width = 200.0

            apply_image_watermark(
                doc=doc,
                target_pages=target_pages,
                pil_img=pil_img,
                target_width=img_width,
                opacity=opacity,
                rotation=rotation,
                position=position,
                custom_x=custom_x,
                custom_y=custom_y
            )

        else:
            doc.close()
            return jsonify({'success': False, 'error': f"Unknown watermark type: '{watermark_type}'"}), 400

        # 5. Save the watermarked PDF to output directory
        file_id = str(uuid.uuid4())
        output_filename = f"{file_id}.pdf"
        output_path = os.path.join(OUTPUT_DIR, output_filename)

        # Optimize output PDF to bytes
        pdf_bytes = doc.tobytes(garbage=3, deflate=True)
        doc.close()

        with open(output_path, 'wb') as f:
            f.write(pdf_bytes)

        # Base64 encode for instant serverless / client-side download
        pdf_b64 = base64.b64encode(pdf_bytes).decode('utf-8')

        # Prepare clean download name: watermarked_<original-name>.pdf
        base_name, _ = os.path.splitext(original_filename)
        clean_download_name = f"watermarked_{base_name}.pdf"

        # Register metadata for secure retrieval
        FILE_REGISTRY[file_id] = {
            'file_id': file_id,
            'download_name': clean_download_name,
            'original_name': original_filename,
            'created_at': time.time(),
            'pages_watermarked': len(target_pages),
            'total_pages': total_pages,
            'file_size': len(pdf_bytes)
        }

        logger.info(f"Successfully processed PDF {file_id}: {clean_download_name} ({len(target_pages)}/{total_pages} pages)")

        return jsonify({
            'success': True,
            'file_id': file_id,
            'filename': clean_download_name,
            'download_url': f'/download/{file_id}',
            'pdf_base64': pdf_b64,
            'pages_watermarked': len(target_pages),
            'total_pages': total_pages
        })

    except Exception as e:
        logger.exception(f"Unexpected error processing watermark: {e}")
        return jsonify({
            'success': False,
            'error': 'Something went wrong while processing your PDF. Please try again.'
        }), 500


@app.route('/download/<file_id>', methods=['GET'])
def download_watermarked_pdf(file_id):
    """
    Secure download endpoint. Validates file_id format (UUID) and serves the PDF as attachment.
    """
    # Strict UUID validation to prevent path traversal
    uuid_pattern = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    if not uuid_pattern.match(file_id):
        return jsonify({'success': False, 'error': 'Invalid download identifier.'}), 400

    target_path = os.path.join(OUTPUT_DIR, f"{file_id}.pdf")
    if not os.path.exists(target_path):
        return jsonify({'success': False, 'error': 'Requested file not found or has expired. Please process the document again.'}), 404

    meta = FILE_REGISTRY.get(file_id, {})
    download_filename = meta.get('download_name', f"watermarked_{file_id[:8]}.pdf")

    return send_file(
        target_path,
        as_attachment=True,
        download_name=download_filename,
        mimetype='application/pdf'
    )


# ============================================================================
# ERROR HANDLERS
# ============================================================================

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({
        'success': False,
        'error': f'The PDF file is too large. Maximum size is {MAX_MB} MB.'
    }), 413


@app.errorhandler(404)
def not_found_error(error):
    return jsonify({
        'success': False,
        'error': 'Resource not found.'
    }), 404


@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({
        'success': False,
        'error': 'An internal server error occurred. Please try again.'
    }), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    host = os.environ.get('HOST', '127.0.0.1')
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    logger.info(f"Starting PDF Watermark server at http://{host}:{port}")
    app.run(host=host, port=port, debug=debug)
