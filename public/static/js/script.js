/**
 * PDF Watermark Tool — Client Application Logic
 * Vanilla JavaScript (ES6+)
 */

// Configure PDF.js worker
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/vendor/pdf.worker.min.js';
}

(function () {
  'use strict';

  // ============================================================================
  // APPLICATION STATE
  // ============================================================================
  const state = {
    // Current uploaded PDF
    pdfFile: null,
    pdfArrayBuffer: null,
    pdfDoc: null,
    currentPage: 1,
    totalPages: 1,
    zoomScale: 1.0,
    renderTask: null,

    // Active watermark settings
    mode: 'text', // 'text' | 'image'
    
    // Text watermark settings
    text: '© Disha Online Classes',
    fontFamily: 'helvetica',
    fontSize: 36,
    isBold: false,
    isItalic: false,
    color: '#000000',
    
    // Image watermark settings
    imageFile: null,
    imageObj: null,
    imageWidth: 200,
    
    // Common settings
    opacity: 0.3,
    rotation: -45,
    position: 'center', // 'topleft', 'topcenter', 'topright', 'bottomleft', 'center', 'bottomright', 'bottomcenter', 'custom'
    customX: 50, // Percentage 0 - 100
    customY: 50, // Percentage 0 - 100
    
    // Page selection
    pageSelectionMode: 'all', // 'all', 'first', 'last', 'custom'
    customPages: '',

    // UI state
    isProcessing: false,
    isDraggingCustomPos: false
  };

  // ============================================================================
  // DOM ELEMENT SELECTORS
  // ============================================================================
  const el = {
    // Alert banner
    alertBanner: document.getElementById('alertBanner'),
    alertTitle: document.getElementById('alertTitle'),
    alertMessage: document.getElementById('alertMessage'),
    alertIcon: document.getElementById('alertIcon'),
    alertCloseBtn: document.getElementById('alertCloseBtn'),

    // Upload section
    uploadSection: document.getElementById('uploadSection'),
    dropZone: document.getElementById('dropZone'),
    pdfFileInput: document.getElementById('pdfFileInput'),
    uploadPlaceholder: document.getElementById('uploadPlaceholder'),
    browsePdfBtn: document.getElementById('browsePdfBtn'),
    fileInfoBar: document.getElementById('fileInfoBar'),
    fileNameDisplay: document.getElementById('fileNameDisplay'),
    fileSizeDisplay: document.getElementById('fileSizeDisplay'),
    replacePdfBtn: document.getElementById('replacePdfBtn'),
    clearPdfBtn: document.getElementById('clearPdfBtn'),

    // Workspace & Preview
    workspaceArea: document.getElementById('workspaceArea'),
    previewViewportWrapper: document.getElementById('previewViewportWrapper'),
    pdfRenderCanvas: document.getElementById('pdfRenderCanvas'),
    watermarkOverlayCanvas: document.getElementById('watermarkOverlayCanvas'),
    canvasContainer: document.getElementById('canvasContainer'),
    pdfLoadingSpinner: document.getElementById('pdfLoadingSpinner'),
    currentPageNum: document.getElementById('currentPageNum'),
    totalPagesNum: document.getElementById('totalPagesNum'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    zoomLabel: document.getElementById('zoomLabel'),

    // Mode Tabs
    tabTextMode: document.getElementById('tabTextMode'),
    tabImageMode: document.getElementById('tabImageMode'),
    textControlsSection: document.getElementById('textControlsSection'),
    imageControlsSection: document.getElementById('imageControlsSection'),

    // Text controls
    watermarkTextInput: document.getElementById('watermarkTextInput'),
    textCharCounter: document.getElementById('textCharCounter'),
    fontFamilySelect: document.getElementById('fontFamilySelect'),
    btnBoldToggle: document.getElementById('btnBoldToggle'),
    btnItalicToggle: document.getElementById('btnItalicToggle'),
    fontSizeRange: document.getElementById('fontSizeRange'),
    fontSizeDisplay: document.getElementById('fontSizeDisplay'),
    textColorPicker: document.getElementById('textColorPicker'),
    textColorHexInput: document.getElementById('textColorHexInput'),
    colorDots: document.querySelectorAll('.color-dot'),

    // Image controls
    imageFileInput: document.getElementById('imageFileInput'),
    imageDropZone: document.getElementById('imageDropZone'),
    imageUploadPrompt: document.getElementById('imageUploadPrompt'),
    imagePreviewContainer: document.getElementById('imagePreviewContainer'),
    imageThumbnail: document.getElementById('imageThumbnail'),
    imageMetaName: document.getElementById('imageMetaName'),
    imageMetaDim: document.getElementById('imageMetaDim'),
    removeImageBtn: document.getElementById('removeImageBtn'),
    imageWidthRange: document.getElementById('imageWidthRange'),
    imageWidthDisplay: document.getElementById('imageWidthDisplay'),
    sizePresets: document.querySelectorAll('.btn-preset'),

    // Common controls
    opacityRange: document.getElementById('opacityRange'),
    opacityDisplay: document.getElementById('opacityDisplay'),
    rotationRange: document.getElementById('rotationRange'),
    rotationDisplay: document.getElementById('rotationDisplay'),
    anglePresets: document.querySelectorAll('.btn-angle-preset'),
    currentPosLabel: document.getElementById('currentPosLabel'),
    posCells: document.querySelectorAll('.pos-cell'),
    customPosInputs: document.getElementById('customPosInputs'),
    customXRange: document.getElementById('customXRange'),
    customYRange: document.getElementById('customYRange'),
    customXVal: document.getElementById('customXVal'),
    customYVal: document.getElementById('customYVal'),

    // Page selection
    pageRadioInputs: document.querySelectorAll('input[name="pageSelectionMode"]'),
    customPagesBox: document.getElementById('customPagesBox'),
    customPagesInput: document.getElementById('customPagesInput'),

    // Submit & Modals
    addWatermarkBtn: document.getElementById('addWatermarkBtn'),
    actionBtnIcon: document.getElementById('actionBtnIcon'),
    actionBtnSpinner: document.getElementById('actionBtnSpinner'),
    actionBtnText: document.getElementById('actionBtnText'),
    processingModal: document.getElementById('processingModal'),
    resultCard: document.getElementById('resultCard'),
    resultDetails: document.getElementById('resultDetails'),
    downloadResultBtn: document.getElementById('downloadResultBtn'),
    watermarkAnotherBtn: document.getElementById('watermarkAnotherBtn')
  };

  // ============================================================================
  // NOTIFICATION & ERROR HELPERS
  // ============================================================================
  function showAlert(message, type = 'error') {
    el.alertBanner.className = `alert-banner ${type}`;
    el.alertTitle.textContent = type === 'error' ? 'Error' : type === 'success' ? 'Success' : 'Notice';
    el.alertMessage.textContent = message;
    el.alertBanner.classList.remove('hidden');
    el.alertBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideAlert() {
    el.alertBanner.classList.add('hidden');
  }

  function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // ============================================================================
  // FILE UPLOAD & VALIDATION
  // ============================================================================
  function handlePdfSelection(file) {
    if (!file) return;

    hideAlert();
    const maxSizeBytes = 50 * 1024 * 1024; // 50MB

    // Validation 1: extension / mime
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      showAlert('Please upload a valid PDF file (.pdf).', 'error');
      return;
    }

    // Validation 2: size
    if (file.size > maxSizeBytes) {
      showAlert('The PDF file is too large. Maximum size allowed is 50 MB.', 'error');
      return;
    }

    if (file.size === 0) {
      showAlert('The selected PDF file is empty.', 'error');
      return;
    }

    state.pdfFile = file;

    // Update UI info bar
    el.fileNameDisplay.textContent = file.name;
    el.fileSizeDisplay.textContent = formatBytes(file.size);
    el.uploadPlaceholder.classList.add('hidden');
    el.fileInfoBar.classList.remove('hidden');
    el.resultCard.classList.add('hidden');

    // Read and render with PDF.js
    const reader = new FileReader();
    reader.onload = async function (e) {
      state.pdfArrayBuffer = e.target.result;
      try {
        // Ensure workspace is visible so dimensions can be measured accurately
        el.workspaceArea.classList.remove('hidden');
        await loadPdfDocument(state.pdfArrayBuffer);
      } catch (err) {
        console.error('Error loading PDF document:', err);
        el.workspaceArea.classList.add('hidden');
        showAlert('Could not read PDF document: ' + (err.message || 'It may be corrupted or password-protected.'), 'error');
      }
    };
    reader.onerror = function () {
      showAlert('Failed to read the selected file. Please try again.', 'error');
    };
    reader.readAsArrayBuffer(file);
  }

  function resetPdfSelection() {
    state.pdfFile = null;
    state.pdfArrayBuffer = null;
    state.pdfDoc = null;
    state.currentPage = 1;
    state.totalPages = 1;

    el.pdfFileInput.value = '';
    el.fileInfoBar.classList.add('hidden');
    el.uploadPlaceholder.classList.remove('hidden');
    el.workspaceArea.classList.add('hidden');
    el.resultCard.classList.add('hidden');
    hideAlert();
  }

  // ============================================================================
  // PDF.JS RENDERING & CANVAS OVERLAY
  // ============================================================================
  async function loadPdfDocument(arrayBuffer) {
    el.pdfLoadingSpinner.classList.remove('hidden');
    try {
      // Pass a clone as Uint8Array so worker transfer doesn't detach or fail
      const typedData = new Uint8Array(arrayBuffer.slice(0));
      const loadingTask = window.pdfjsLib.getDocument({ data: typedData });
      state.pdfDoc = await loadingTask.promise;
      state.totalPages = state.pdfDoc.numPages;
      state.currentPage = 1;

      el.totalPagesNum.textContent = state.totalPages;
      updatePageNavControls();
      await renderCurrentPage();
    } finally {
      el.pdfLoadingSpinner.classList.add('hidden');
    }
  }

  async function renderCurrentPage() {
    if (!state.pdfDoc) return;

    if (state.renderTask) {
      try {
        state.renderTask.cancel();
      } catch (e) {
        // ignore cancel exception
      }
    }

    el.currentPageNum.textContent = state.currentPage;
    updatePageNavControls();

    const page = await state.pdfDoc.getPage(state.currentPage);
    
    // Fit canvas scale to container safely
    const viewportWrapper = el.previewViewportWrapper || document.getElementById('previewViewportWrapper');
    const clientW = viewportWrapper ? viewportWrapper.clientWidth : 0;
    const containerWidth = clientW > 100 ? (clientW - 48) : 600;
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    
    // Calculate base scale to fit container width nicely
    let baseScale = (containerWidth / unscaledViewport.width) * 0.95;
    baseScale = Math.min(Math.max(baseScale, 0.4), 1.8);
    const effectiveScale = baseScale * state.zoomScale;

    // Use devicePixelRatio for crisp high-DPI rendering
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: effectiveScale * dpr });

    const canvas = el.pdfRenderCanvas;
    const ctx = canvas.getContext('2d');

    // High DPI sizing
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;

    // Overlay canvas matches visual layout
    const overlay = el.watermarkOverlayCanvas;
    overlay.width = viewport.width;
    overlay.height = viewport.height;
    overlay.style.width = `${viewport.width / dpr}px`;
    overlay.style.height = `${viewport.height / dpr}px`;

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };

    try {
      state.renderTask = page.render(renderContext);
      await state.renderTask.promise;
      state.renderTask = null;
      // Draw watermark over rendered PDF
      drawWatermarkOverlay(viewport.width / dpr, viewport.height / dpr, dpr, effectiveScale);
    } catch (err) {
      if (err.name !== 'RenderingCancelledException') {
        console.error('Render error:', err);
      }
    }
  }

  function updatePageNavControls() {
    el.prevPageBtn.disabled = state.currentPage <= 1;
    el.nextPageBtn.disabled = state.currentPage >= state.totalPages;
  }

  // ============================================================================
  // LIVE WATERMARK OVERLAY DRAWING
  // ============================================================================
  function drawWatermarkOverlay(displayWidth, displayHeight, dpr, scale) {
    const canvas = el.watermarkOverlayCanvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(dpr, dpr);

    // Compute center anchor coordinates (cx, cy)
    let cx = displayWidth / 2;
    let cy = displayHeight / 2;
    const margin = 50 * scale;

    const pos = state.position.toLowerCase();
    if (pos === 'topleft') {
      cx = margin;
      cy = margin;
    } else if (pos === 'topcenter') {
      cx = displayWidth / 2;
      cy = margin;
    } else if (pos === 'topright') {
      cx = displayWidth - margin;
      cy = margin;
    } else if (pos === 'bottomleft') {
      cx = margin;
      cy = displayHeight - margin;
    } else if (pos === 'bottomcenter') {
      cx = displayWidth / 2;
      cy = displayHeight - margin;
    } else if (pos === 'bottomright') {
      cx = displayWidth - margin;
      cy = displayHeight - margin;
    } else if (pos === 'custom') {
      cx = (state.customX / 100) * displayWidth;
      cy = (state.customY / 100) * displayHeight;
    }

    // Set transparency
    ctx.globalAlpha = Math.max(0.02, Math.min(1.0, state.opacity));

    // Rotate canvas around anchor point (cx, cy)
    // Positive CSS degree rotation is clockwise; state.rotation is in degrees (-45° default)
    const rad = (state.rotation * Math.PI) / 180;
    ctx.translate(cx, cy);
    ctx.rotate(rad);

    if (state.mode === 'text') {
      // Draw Text Watermark
      const scaledFontSize = state.fontSize * scale;
      const fontStyle = `${state.isItalic ? 'italic ' : ''}${state.isBold ? 'bold ' : ''}`;
      
      let fontStack = 'Helvetica, Arial, sans-serif';
      if (state.fontFamily === 'times') {
        fontStack = '"Times New Roman", Times, serif';
      } else if (state.fontFamily === 'courier') {
        fontStack = '"Courier New", Courier, monospace';
      }

      ctx.font = `${fontStyle}${scaledFontSize}px ${fontStack}`;
      ctx.fillStyle = state.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillText(state.text, 0, 0);

    } else if (state.mode === 'image' && state.imageObj) {
      // Draw Image Watermark
      const img = state.imageObj;
      const targetW = state.imageWidth * scale;
      const aspect = img.naturalHeight / img.naturalWidth;
      const targetH = targetW * aspect;

      ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
    }

    ctx.restore();
  }

  function updateWatermarkPreview() {
    if (!state.pdfDoc) return;
    const canvas = el.watermarkOverlayCanvas;
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = canvas.width / dpr;
    const displayHeight = canvas.height / dpr;

    // Approximate scale relative to standard 595pt A4
    const scale = (displayWidth / 595.0) || 1.0;
    drawWatermarkOverlay(displayWidth, displayHeight, dpr, scale);
  }

  // ============================================================================
  // POSITION & CUSTOM DRAG HANDLERS
  // ============================================================================
  function setPosition(posName) {
    state.position = posName;
    el.currentPosLabel.textContent = posName === 'custom' ? 'Custom' :
      posName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, str => str.toUpperCase());

    el.posCells.forEach(cell => {
      cell.classList.toggle('active', cell.dataset.pos === posName);
    });

    if (posName === 'custom') {
      el.customPosInputs.classList.remove('hidden');
    } else {
      el.customPosInputs.classList.add('hidden');
    }

    updateWatermarkPreview();
  }

  function handleOverlayCanvasClickOrDrag(event) {
    const rect = el.watermarkOverlayCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const pctX = Math.round(Math.max(5, Math.min(95, (x / rect.width) * 100)));
    const pctY = Math.round(Math.max(5, Math.min(95, (y / rect.height) * 100)));

    state.customX = pctX;
    state.customY = pctY;

    el.customXRange.value = pctX;
    el.customYRange.value = pctY;
    el.customXVal.textContent = `${pctX}%`;
    el.customYVal.textContent = `${pctY}%`;

    setPosition('custom');
  }

  // ============================================================================
  // IMAGE WATERMARK UPLOAD & PREVIEW
  // ============================================================================
  function handleImageSelection(file) {
    if (!file) return;

    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      showAlert('Unsupported image format. Please upload PNG, JPG, JPEG, or WEBP.', 'error');
      return;
    }

    state.imageFile = file;

    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = function () {
        state.imageObj = img;
        el.imageThumbnail.src = e.target.result;
        el.imageMetaName.textContent = file.name;
        el.imageMetaDim.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
        
        el.imageUploadPrompt.classList.add('hidden');
        el.imagePreviewContainer.classList.remove('hidden');
        updateWatermarkPreview();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function removeImage() {
    state.imageFile = null;
    state.imageObj = null;
    el.imageFileInput.value = '';
    el.imagePreviewContainer.classList.add('hidden');
    el.imageUploadPrompt.classList.remove('hidden');
    updateWatermarkPreview();
  }

  // ============================================================================
  // FORM & SETTINGS COLLECTION
  // ============================================================================
  function collectWatermarkSettings() {
    const formData = new FormData();

    // 1. PDF file
    if (!state.pdfFile) {
      throw new Error('Please upload a PDF file first.');
    }
    formData.append('pdf', state.pdfFile);

    // 2. Watermark mode
    formData.append('watermark_type', state.mode);

    // 3. Common settings
    formData.append('position', state.position);
    formData.append('custom_x', state.customX);
    formData.append('custom_y', state.customY);
    formData.append('opacity', state.opacity);
    formData.append('rotation', state.rotation);

    // 4. Page selection
    formData.append('pages', state.pageSelectionMode);
    if (state.pageSelectionMode === 'custom') {
      if (!state.customPages.trim()) {
        throw new Error('Please enter custom page numbers (e.g. 1, 3, 5-8).');
      }
      formData.append('custom_pages', state.customPages.trim());
    }

    // 5. Type-specific settings
    if (state.mode === 'text') {
      if (!state.text.trim()) {
        throw new Error('Please enter watermark text.');
      }
      formData.append('watermark_text', state.text.trim());
      formData.append('font_family', state.fontFamily);
      formData.append('font_size', state.fontSize);
      formData.append('is_bold', state.isBold ? 'true' : 'false');
      formData.append('is_italic', state.isItalic ? 'true' : 'false');
      formData.append('color', state.color);
    } else if (state.mode === 'image') {
      if (!state.imageFile) {
        throw new Error('Please upload a watermark image.');
      }
      formData.append('watermark_image', state.imageFile);
      formData.append('img_width', state.imageWidth);
    }

    return formData;
  }

  // ============================================================================
  // PROCESS WATERMARK (API CALL)
  // ============================================================================
  async function processPDF() {
    hideAlert();

    let formData;
    try {
      formData = collectWatermarkSettings();
    } catch (err) {
      showAlert(err.message, 'error');
      return;
    }

    // Update UI to Processing State
    setButtonProcessingState(true);
    el.processingModal.classList.remove('hidden');

    try {
      const response = await fetch('/api/watermark', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Server returned an error processing the PDF.');
      }

      // Success!
      showSuccess(data);

    } catch (err) {
      console.error('Watermark processing error:', err);
      showAlert(err.message || 'Something went wrong while processing your PDF. Please try again.', 'error');
    } finally {
      setButtonProcessingState(false);
      el.processingModal.classList.add('hidden');
    }
  }

  function setButtonProcessingState(isProcessing) {
    state.isProcessing = isProcessing;
    el.addWatermarkBtn.disabled = isProcessing;

    if (isProcessing) {
      el.actionBtnSpinner.classList.remove('hidden');
      el.actionBtnIcon.classList.add('hidden');
      el.actionBtnText.textContent = 'Processing...';
    } else {
      el.actionBtnSpinner.classList.add('hidden');
      el.actionBtnIcon.classList.remove('hidden');
      el.actionBtnText.textContent = 'Add Watermark';
    }
  }

  function showSuccess(data) {
    el.actionBtnText.textContent = 'Watermark Added ✓';
    setTimeout(() => {
      el.actionBtnText.textContent = 'Add Watermark';
    }, 4000);

    el.resultDetails.textContent = `Watermarked ${data.pages_watermarked} of ${data.total_pages} page(s). Download file ready: ${data.filename}`;

    if (data.pdf_base64) {
      try {
        const byteCharacters = atob(data.pdf_base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);
        el.downloadResultBtn.href = blobUrl;
      } catch (e) {
        el.downloadResultBtn.href = data.download_url;
      }
    } else {
      el.downloadResultBtn.href = data.download_url;
    }

    el.downloadResultBtn.setAttribute('download', data.filename);

    el.resultCard.classList.remove('hidden');
    el.resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ============================================================================
  // EVENT LISTENERS INITIALIZATION
  // ============================================================================
  function initEventListeners() {
    // Alert close
    el.alertCloseBtn.addEventListener('click', hideAlert);

    // Browse PDF button
    el.browsePdfBtn.addEventListener('click', () => el.pdfFileInput.click());
    el.dropZone.addEventListener('click', (e) => {
      if (e.target.closest('#fileInfoBar') || e.target.closest('button')) return;
      el.pdfFileInput.click();
    });

    el.pdfFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handlePdfSelection(e.target.files[0]);
      }
    });

    // Replace and Clear PDF buttons
    el.replacePdfBtn.addEventListener('click', () => el.pdfFileInput.click());
    el.clearPdfBtn.addEventListener('click', resetPdfSelection);

    // PDF Drag & Drop handling
    ['dragenter', 'dragover'].forEach(eventName => {
      el.dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      el.dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.dropZone.classList.remove('drag-over');
      });
    });

    el.dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt.files && dt.files[0]) {
        handlePdfSelection(dt.files[0]);
      }
    });

    // Pagination controls
    el.prevPageBtn.addEventListener('click', () => {
      if (state.currentPage > 1) {
        state.currentPage--;
        renderCurrentPage();
      }
    });

    el.nextPageBtn.addEventListener('click', () => {
      if (state.currentPage < state.totalPages) {
        state.currentPage++;
        renderCurrentPage();
      }
    });

    // Zoom controls
    el.zoomInBtn.addEventListener('click', () => {
      if (state.zoomScale < 2.0) {
        state.zoomScale += 0.2;
        el.zoomLabel.textContent = `${Math.round(state.zoomScale * 100)}%`;
        renderCurrentPage();
      }
    });

    el.zoomOutBtn.addEventListener('click', () => {
      if (state.zoomScale > 0.6) {
        state.zoomScale -= 0.2;
        el.zoomLabel.textContent = `${Math.round(state.zoomScale * 100)}%`;
        renderCurrentPage();
      }
    });

    // Mode Tabs Switch (Text vs Image)
    el.tabTextMode.addEventListener('click', () => {
      state.mode = 'text';
      el.tabTextMode.classList.add('active');
      el.tabImageMode.classList.remove('active');
      el.textControlsSection.classList.remove('hidden');
      el.imageControlsSection.classList.add('hidden');
      updateWatermarkPreview();
    });

    el.tabImageMode.addEventListener('click', () => {
      state.mode = 'image';
      el.tabImageMode.classList.add('active');
      el.tabTextMode.classList.remove('active');
      el.imageControlsSection.classList.remove('hidden');
      el.textControlsSection.classList.add('hidden');
      updateWatermarkPreview();
    });

    // Text Watermark Inputs
    el.watermarkTextInput.addEventListener('input', (e) => {
      state.text = e.target.value;
      el.textCharCounter.textContent = e.target.value.length;
      updateWatermarkPreview();
    });

    el.fontFamilySelect.addEventListener('change', (e) => {
      state.fontFamily = e.target.value;
      updateWatermarkPreview();
    });

    el.btnBoldToggle.addEventListener('click', () => {
      state.isBold = !state.isBold;
      el.btnBoldToggle.classList.toggle('active', state.isBold);
      updateWatermarkPreview();
    });

    el.btnItalicToggle.addEventListener('click', () => {
      state.isItalic = !state.isItalic;
      el.btnItalicToggle.classList.toggle('active', state.isItalic);
      updateWatermarkPreview();
    });

    el.fontSizeRange.addEventListener('input', (e) => {
      state.fontSize = parseInt(e.target.value, 10);
      el.fontSizeDisplay.textContent = state.fontSize;
      updateWatermarkPreview();
    });

    // Color Pickers
    el.textColorPicker.addEventListener('input', (e) => {
      state.color = e.target.value;
      el.textColorHexInput.value = e.target.value.toUpperCase();
      updateWatermarkPreview();
    });

    el.textColorHexInput.addEventListener('input', (e) => {
      let val = e.target.value;
      if (!val.startsWith('#')) val = '#' + val;
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        state.color = val;
        el.textColorPicker.value = val;
        updateWatermarkPreview();
      }
    });

    el.colorDots.forEach(dot => {
      dot.addEventListener('click', () => {
        const color = dot.dataset.color;
        state.color = color;
        el.textColorPicker.value = color;
        el.textColorHexInput.value = color.toUpperCase();
        updateWatermarkPreview();
      });
    });

    // Image Watermark Inputs
    el.imageDropZone.addEventListener('click', (e) => {
      if (e.target.closest('#removeImageBtn')) return;
      el.imageFileInput.click();
    });

    el.imageFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleImageSelection(e.target.files[0]);
      }
    });

    el.removeImageBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeImage();
    });

    // Image drag & drop inside image box
    ['dragenter', 'dragover'].forEach(eventName => {
      el.imageDropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.imageDropZone.style.borderColor = 'var(--accent-primary)';
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      el.imageDropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.imageDropZone.style.borderColor = '';
      });
    });

    el.imageDropZone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleImageSelection(e.dataTransfer.files[0]);
      }
    });

    el.imageWidthRange.addEventListener('input', (e) => {
      state.imageWidth = parseInt(e.target.value, 10);
      el.imageWidthDisplay.textContent = state.imageWidth;
      
      // Update preset buttons active state
      el.sizePresets.forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.preset, 10) === state.imageWidth);
      });
      updateWatermarkPreview();
    });

    el.sizePresets.forEach(btn => {
      btn.addEventListener('click', () => {
        const w = parseInt(btn.dataset.preset, 10);
        state.imageWidth = w;
        el.imageWidthRange.value = w;
        el.imageWidthDisplay.textContent = w;
        el.sizePresets.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateWatermarkPreview();
      });
    });

    // Common controls: Opacity
    el.opacityRange.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      state.opacity = val / 100;
      el.opacityDisplay.textContent = val;
      updateWatermarkPreview();
    });

    // Common controls: Rotation
    el.rotationRange.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      state.rotation = val;
      el.rotationDisplay.textContent = val;

      el.anglePresets.forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.angle, 10) === val);
      });
      updateWatermarkPreview();
    });

    el.anglePresets.forEach(btn => {
      btn.addEventListener('click', () => {
        const angle = parseInt(btn.dataset.angle, 10);
        state.rotation = angle;
        el.rotationRange.value = angle;
        el.rotationDisplay.textContent = angle;
        el.anglePresets.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateWatermarkPreview();
      });
    });

    // Position 9-Grid
    el.posCells.forEach(cell => {
      cell.addEventListener('click', () => {
        setPosition(cell.dataset.pos);
      });
    });

    // Custom coordinates sliders
    el.customXRange.addEventListener('input', (e) => {
      state.customX = parseInt(e.target.value, 10);
      el.customXVal.textContent = `${state.customX}%`;
      updateWatermarkPreview();
    });

    el.customYRange.addEventListener('input', (e) => {
      state.customY = parseInt(e.target.value, 10);
      el.customYVal.textContent = `${state.customY}%`;
      updateWatermarkPreview();
    });

    // Interactive Drag & Click directly on PDF overlay canvas
    el.watermarkOverlayCanvas.addEventListener('mousedown', (e) => {
      state.isDraggingCustomPos = true;
      handleOverlayCanvasClickOrDrag(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (state.isDraggingCustomPos) {
        handleOverlayCanvasClickOrDrag(e);
      }
    });

    window.addEventListener('mouseup', () => {
      state.isDraggingCustomPos = false;
    });

    // Page selection mode
    el.pageRadioInputs.forEach(radio => {
      radio.addEventListener('change', (e) => {
        state.pageSelectionMode = e.target.value;
        if (state.pageSelectionMode === 'custom') {
          el.customPagesBox.classList.remove('hidden');
        } else {
          el.customPagesBox.classList.add('hidden');
        }
      });
    });

    el.customPagesInput.addEventListener('input', (e) => {
      state.customPages = e.target.value;
    });

    // Submit Watermark Button
    el.addWatermarkBtn.addEventListener('click', processPDF);

    // Process another file
    el.watermarkAnotherBtn.addEventListener('click', () => {
      resetPdfSelection();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Resize handling for responsive preview
    let resizeDebounce;
    window.addEventListener('resize', () => {
      clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(() => {
        if (state.pdfDoc) {
          renderCurrentPage();
        }
      }, 150);
    });
  }

  // Initialize on DOM load
  document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    // Initialize character counter
    if (el.watermarkTextInput) {
      el.textCharCounter.textContent = el.watermarkTextInput.value.length;
    }
  });

})();
