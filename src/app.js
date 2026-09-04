// Real-time circle detector with statistics
// Uses Pyodide (tifffile) for accurate 16-bit data, UTIF for display, ExcelJS for Excel export

import ExcelJS from 'exceljs';
import UTIF from 'utif';

const TIFF_EXTENSIONS = new Set(['tif', 'tiff']);
const HEIC_EXTENSIONS = new Set(['heic', 'heif']);
const KNOWN_IMAGE_EXTENSIONS = new Set([
    ...TIFF_EXTENSIONS,
    ...HEIC_EXTENSIONS,
    'png', 'apng', 'jpg', 'jpeg', 'jfif', 'bmp', 'dib', 'gif', 'webp', 'avif', 'ico'
]);

// Pyodide globals for accurate pixel value analysis
let pyodide = null;
let pyodideReady = false;
let pythonTiffLoaded = false;  // True when tiff_gray is available in Python
let tiffArrayBuffer = null;

let originalGray = null;  // Original grayscale (normalized 0-255 for processing)
let rawValues = null;     // Original raw values (16-bit for TIFF, null for 8-bit)
let processedGray = null; // After brightness/contrast adjustment
let imageData = null;
let width = 0;
let height = 0;
let bitDepth = 8;         // Actual bit depth of the image
let maxValue = 255;       // Maximum possible value based on bit depth
let allCircles = [];      // All detected circles (before cap)
let circles = [];         // Circles after applying cap
let sortedCircles = [];   // For display ordering
let isProcessing = false;
let frameCount = 0;
let lastFpsTime = performance.now();
let is16Bit = false;
let highlightedCircleId = null;

// DOM elements (initialized after DOM ready)
let startupDropZone, startupStatus, appContainer, fileInput;
let originalCanvas, resultCanvas, downloadBtn, exportExcelBtn;
let statusEl, circleCountEl, processTimeEl, fpsEl, statsBody;
let sortBySelect, maxCirclesInput, statsAreaPctInput, sampleDiameterInput, showRoiToggle;
let hoverPanel, hoverPos, hoverMean, hoverMinMax, hoverStdDev, hoverPixels;
let zoomLevelInput, zoomInBtn, zoomOutBtn, zoomResetBtn;
let originalWrapper, resultWrapper, sampleIndicator;
let sensitivitySlider, brightnessSlider, contrastSlider, minSizeSlider;
let sensitivityVal, brightnessVal, contrastVal, minSizeVal;
let settingsBtn, settingsModal, closeSettingsBtn, saveSettingsBtn, resetDefaultsBtn;
let defaultSensitivity, defaultBrightness, defaultContrast, defaultMinSize;
let defaultMaxCircles, defaultStatsArea, defaultSampleDiameter, defaultSortBy;
let themeBtn, startupThemeBtn;

// Graph elements
let graphCanvas, graphCtx, targetTypeSelect, xAxisValuesInput;
let showTrendlineToggle, showEquationToggle, showR2Toggle, fitResultsEl;
let graphPanel, showGraphToggle, generatePlotBtn, closeGraphBtn, reverseXAxisToggle;
let lastFitResults = null;
let graphPointPositions = []; // Store {x, y, circleId} for hover detection

let currentZoom = 1;
let showRoi = false;
let zoomKeyHeld = false;
let zoomInterval = null;
let cursorX = 0;  // Track cursor position for zoom centering
let cursorY = 0;

// Initialize DOM references
function initDOMReferences() {
    // DOM - Startup
    startupDropZone = document.getElementById('startupDropZone');
    startupStatus = document.getElementById('startupStatus');
    appContainer = document.getElementById('appContainer');
    fileInput = document.getElementById('fileInput');

    // DOM - Main app
    originalCanvas = document.getElementById('originalCanvas');
    resultCanvas = document.getElementById('resultCanvas');
    downloadBtn = document.getElementById('downloadBtn');
    exportExcelBtn = document.getElementById('exportExcelBtn');
    statusEl = document.getElementById('status');
    circleCountEl = document.getElementById('circleCount');
    processTimeEl = document.getElementById('processTime');
    fpsEl = document.getElementById('fps');
    statsBody = document.getElementById('statsBody');
    sortBySelect = document.getElementById('sortBy');
    maxCirclesInput = document.getElementById('maxCircles');
    statsAreaPctInput = document.getElementById('statsAreaPct');
    sampleDiameterInput = document.getElementById('sampleDiameter');
    showRoiToggle = document.getElementById('showRoiToggle');

    // Hover panel elements
    hoverPanel = document.getElementById('hoverPanel');
    hoverPos = document.getElementById('hoverPos');
    hoverMean = document.getElementById('hoverMean');
    hoverMinMax = document.getElementById('hoverMinMax');
    hoverStdDev = document.getElementById('hoverStdDev');
    hoverPixels = document.getElementById('hoverPixels');
    zoomLevelInput = document.getElementById('zoomLevel');
    zoomInBtn = document.getElementById('zoomInBtn');
    zoomOutBtn = document.getElementById('zoomOutBtn');
    zoomResetBtn = document.getElementById('zoomResetBtn');
    originalWrapper = document.getElementById('originalWrapper');
    resultWrapper = document.getElementById('resultWrapper');
    sampleIndicator = document.getElementById('sampleIndicator');

    // Sliders
    sensitivitySlider = document.getElementById('sensitivity');
    brightnessSlider = document.getElementById('brightness');
    contrastSlider = document.getElementById('contrast');
    minSizeSlider = document.getElementById('minSize');
    sensitivityVal = document.getElementById('sensitivityVal');
    brightnessVal = document.getElementById('brightnessVal');
    contrastVal = document.getElementById('contrastVal');
    minSizeVal = document.getElementById('minSizeVal');

    // Settings modal elements
    settingsBtn = document.getElementById('settingsBtn');
    settingsModal = document.getElementById('settingsModal');
    closeSettingsBtn = document.getElementById('closeSettings');
    saveSettingsBtn = document.getElementById('saveSettings');
    resetDefaultsBtn = document.getElementById('resetDefaults');
    defaultSensitivity = document.getElementById('defaultSensitivity');
    defaultBrightness = document.getElementById('defaultBrightness');
    defaultContrast = document.getElementById('defaultContrast');
    defaultMinSize = document.getElementById('defaultMinSize');
    defaultMaxCircles = document.getElementById('defaultMaxCircles');
    defaultStatsArea = document.getElementById('defaultStatsArea');
    defaultSampleDiameter = document.getElementById('defaultSampleDiameter');
    defaultSortBy = document.getElementById('defaultSortBy');
    themeBtn = document.getElementById('themeBtn');
    startupThemeBtn = document.getElementById('startupThemeBtn');

    // Graph elements
    graphCanvas = document.getElementById('graphCanvas');
    graphCtx = graphCanvas ? graphCanvas.getContext('2d') : null;
    targetTypeSelect = document.getElementById('targetType');
    xAxisValuesInput = document.getElementById('xAxisValues');
    showTrendlineToggle = document.getElementById('showTrendline');
    showEquationToggle = document.getElementById('showEquation');
    showR2Toggle = document.getElementById('showR2');
    fitResultsEl = document.getElementById('fitResults');
    graphPanel = document.querySelector('.graph-panel');
    showGraphToggle = document.getElementById('showGraphToggle');
    generatePlotBtn = document.getElementById('generatePlotBtn');
    closeGraphBtn = document.getElementById('closeGraphBtn');
    reverseXAxisToggle = document.getElementById('reverseXAxis');
}

// Theme toggle
function initTheme() {
    const savedTheme = localStorage.getItem('circleDetectorTheme');
    if (savedTheme === 'light') {
        document.documentElement.classList.add('light-mode');
        updateThemeIcon(true);
    }
}

function toggleTheme() {
    const isLight = document.documentElement.classList.toggle('light-mode');
    localStorage.setItem('circleDetectorTheme', isLight ? 'light' : 'dark');
    updateThemeIcon(isLight);
}

function updateThemeIcon(isLight) {
    const icon = isLight ? '&#9790;' : '&#9788;'; // Moon for light mode, sun for dark mode
    const title = isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode';
    if (themeBtn) {
        themeBtn.innerHTML = icon;
        themeBtn.title = title;
    }
    if (startupThemeBtn) {
        startupThemeBtn.innerHTML = icon;
        startupThemeBtn.title = title;
    }
}

// Default settings
const DEFAULT_SETTINGS = {
    sensitivity: 50,
    brightness: 0,
    contrast: 100,
    minSize: 10,
    maxCircles: '',
    statsArea: 50,
    sampleDiameter: 10,
    sortBy: 'brightness-desc',
    showGraph: false,
    targetType: 'none',
    concentrationValues: '1, 3, 10, 30, 60, 100, 300, 1000',
    depthValues: '0.5, 1, 1.5, 2, 3, 4, 5, 6'
};

// Colors for circles
const COLORS = [
    [255, 87, 87], [87, 255, 87], [87, 87, 255], [255, 255, 87],
    [255, 87, 255], [87, 255, 255], [255, 167, 87], [167, 87, 255],
    [87, 255, 167], [255, 87, 167], [167, 255, 87], [87, 167, 255],
    [255, 127, 127], [127, 255, 127], [127, 127, 255], [255, 200, 100]
];

// Initialize
function init() {
    // Initialize DOM references first
    initDOMReferences();

    // Initialize theme
    initTheme();

    // Load saved settings
    loadSettings();

    // Theme toggle buttons
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleTheme);
    }
    if (startupThemeBtn) {
        startupThemeBtn.addEventListener('click', toggleTheme);
    }

    // Settings modal events
    settingsBtn.addEventListener('click', openSettingsModal);
    closeSettingsBtn.addEventListener('click', closeSettingsModal);
    saveSettingsBtn.addEventListener('click', saveSettings);
    resetDefaultsBtn.addEventListener('click', resetToDefaults);
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettingsModal();
    });

    // Startup drop zone - full screen
    startupDropZone.addEventListener('click', () => fileInput.click());
    startupDropZone.addEventListener('dragover', e => {
        e.preventDefault();
        startupDropZone.classList.add('drag-over');
    });
    startupDropZone.addEventListener('dragleave', () => startupDropZone.classList.remove('drag-over'));
    startupDropZone.addEventListener('drop', e => {
        e.preventDefault();
        startupDropZone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });

    // Sliders - real-time updates
    const sliders = [
        [sensitivitySlider, sensitivityVal],
        [brightnessSlider, brightnessVal],
        [contrastSlider, contrastVal],
        [minSizeSlider, minSizeVal]
    ];

    sliders.forEach(([slider, valEl]) => {
        slider.addEventListener('input', () => {
            valEl.textContent = slider.value;
            if (originalGray) scheduleDetection();
        });
    });

    // Sort dropdown
    sortBySelect.addEventListener('change', () => {
        if (circles.length > 0) {
            sortCircles();
            updateStatsTable();
        }
    });

    // Max circles input
    maxCirclesInput.addEventListener('input', () => {
        if (originalGray) {
            applyCircleCap();
            drawResults();
            updateStatsTable();
        }
    });

    // Stats area percentage input
    statsAreaPctInput.addEventListener('input', async () => {
        if (circles.length > 0) {
            await calculateCircleStats();
            updateStatsTable();
            if (showRoi) drawResults();
        }
    });

    downloadBtn.addEventListener('click', download);
    exportExcelBtn.addEventListener('click', exportToExcel);

    // Table row hover events (delegated)
    statsBody.addEventListener('mouseenter', handleRowHover, true);
    statsBody.addEventListener('mouseleave', handleRowLeave, true);

    // Mouse hover for brightness display on original canvas
    originalCanvas.addEventListener('mousemove', handleCanvasHover);
    originalCanvas.addEventListener('mouseleave', handleCanvasLeave);

    // Zoom controls
    zoomLevelInput.addEventListener('input', applyZoom);
    zoomResetBtn.addEventListener('click', resetZoom);
    zoomInBtn.addEventListener('click', () => zoomBy(10));
    zoomOutBtn.addEventListener('click', () => zoomBy(-10));

    // ROI toggle
    showRoiToggle.addEventListener('change', () => {
        showRoi = showRoiToggle.checked;
        if (circles.length > 0) drawResults();
    });

    // Keyboard zoom handlers
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Track cursor position globally for zoom centering
    originalWrapper.addEventListener('mousemove', trackCursorPosition);
    resultWrapper.addEventListener('mousemove', trackCursorPosition);

    // Circle hover detection on result canvas
    resultCanvas.addEventListener('mousemove', handleResultCanvasHover);
    resultCanvas.addEventListener('mouseleave', handleResultCanvasLeave);

    // Header drop zone for new image
    const headerDropZone = document.getElementById('headerDropZone');
    if (headerDropZone) {
        headerDropZone.addEventListener('click', () => fileInput.click());
        headerDropZone.addEventListener('dragover', e => {
            e.preventDefault();
            headerDropZone.classList.add('drag-over');
        });
        headerDropZone.addEventListener('dragleave', () => headerDropZone.classList.remove('drag-over'));
        headerDropZone.addEventListener('drop', e => {
            e.preventDefault();
            headerDropZone.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
        });
    }

    // Graph controls
    if (generatePlotBtn) {
        generatePlotBtn.addEventListener('click', () => {
            if (graphPanel) {
                graphPanel.style.display = 'block';
                // Default to concentration if none selected
                if (targetTypeSelect && targetTypeSelect.value === 'none') {
                    targetTypeSelect.value = 'concentration';
                    updateXAxisValues();
                }
                updateGraph();
            }
        });
    }
    if (closeGraphBtn) {
        closeGraphBtn.addEventListener('click', () => {
            if (graphPanel) {
                graphPanel.style.display = 'none';
            }
        });
    }
    if (targetTypeSelect) {
        targetTypeSelect.addEventListener('change', () => {
            updateXAxisValues();
            updateGraph();
        });
    }
    if (xAxisValuesInput) {
        xAxisValuesInput.addEventListener('input', updateGraph);
    }
    if (showTrendlineToggle) {
        showTrendlineToggle.addEventListener('change', updateGraph);
    }
    if (showEquationToggle) {
        showEquationToggle.addEventListener('change', updateGraph);
    }
    if (showR2Toggle) {
        showR2Toggle.addEventListener('change', updateGraph);
    }
    if (reverseXAxisToggle) {
        reverseXAxisToggle.addEventListener('change', updateGraph);
    }

    // Graph hover for point-to-circle correlation
    if (graphCanvas) {
        graphCanvas.addEventListener('mousemove', handleGraphCanvasHover);
        graphCanvas.addEventListener('mouseleave', handleGraphCanvasLeave);
    }

    // Initialize Pyodide for accurate pixel analysis
    initPyodide();
}

// Settings functions
function loadSettings() {
    const saved = localStorage.getItem('circleDetectorSettings');
    const settings = { ...DEFAULT_SETTINGS, ...(saved ? JSON.parse(saved) : {}) };

    // Apply to main controls
    sensitivitySlider.value = settings.sensitivity;
    sensitivityVal.textContent = settings.sensitivity;
    brightnessSlider.value = settings.brightness;
    brightnessVal.textContent = settings.brightness;
    contrastSlider.value = settings.contrast;
    contrastVal.textContent = settings.contrast;
    minSizeSlider.value = settings.minSize;
    minSizeVal.textContent = settings.minSize;
    maxCirclesInput.value = settings.maxCircles;
    statsAreaPctInput.value = settings.statsArea;
    sampleDiameterInput.value = settings.sampleDiameter;
    sortBySelect.value = settings.sortBy;

    // Graph settings - panel starts hidden, shown via Generate Plot button
    if (targetTypeSelect) {
        targetTypeSelect.value = settings.targetType || 'none';
        updateXAxisValues();
    }

    // Also populate modal inputs
    defaultSensitivity.value = settings.sensitivity;
    defaultBrightness.value = settings.brightness;
    defaultContrast.value = settings.contrast;
    defaultMinSize.value = settings.minSize;
    defaultMaxCircles.value = settings.maxCircles;
    defaultStatsArea.value = settings.statsArea;
    defaultSampleDiameter.value = settings.sampleDiameter;
    defaultSortBy.value = settings.sortBy;
}

function openSettingsModal() {
    // Load current saved settings into modal
    const saved = localStorage.getItem('circleDetectorSettings');
    const settings = saved ? JSON.parse(saved) : DEFAULT_SETTINGS;

    defaultSensitivity.value = settings.sensitivity;
    defaultBrightness.value = settings.brightness;
    defaultContrast.value = settings.contrast;
    defaultMinSize.value = settings.minSize;
    defaultMaxCircles.value = settings.maxCircles;
    defaultStatsArea.value = settings.statsArea;
    defaultSampleDiameter.value = settings.sampleDiameter;
    defaultSortBy.value = settings.sortBy;
    if (showGraphToggle) showGraphToggle.checked = settings.showGraph !== false;

    settingsModal.classList.add('visible');
}

function closeSettingsModal() {
    settingsModal.classList.remove('visible');
}

function saveSettings() {
    const settings = {
        sensitivity: parseInt(defaultSensitivity.value) || DEFAULT_SETTINGS.sensitivity,
        brightness: parseInt(defaultBrightness.value) || DEFAULT_SETTINGS.brightness,
        contrast: parseInt(defaultContrast.value) || DEFAULT_SETTINGS.contrast,
        minSize: parseInt(defaultMinSize.value) || DEFAULT_SETTINGS.minSize,
        maxCircles: defaultMaxCircles.value || '',
        statsArea: parseInt(defaultStatsArea.value) || DEFAULT_SETTINGS.statsArea,
        sampleDiameter: parseInt(defaultSampleDiameter.value) || DEFAULT_SETTINGS.sampleDiameter,
        sortBy: defaultSortBy.value || DEFAULT_SETTINGS.sortBy,
        showGraph: showGraphToggle ? showGraphToggle.checked : DEFAULT_SETTINGS.showGraph,
        targetType: targetTypeSelect ? targetTypeSelect.value : DEFAULT_SETTINGS.targetType,
        concentrationValues: DEFAULT_SETTINGS.concentrationValues,
        depthValues: DEFAULT_SETTINGS.depthValues
    };

    localStorage.setItem('circleDetectorSettings', JSON.stringify(settings));

    // Apply to main controls immediately
    sensitivitySlider.value = settings.sensitivity;
    sensitivityVal.textContent = settings.sensitivity;
    brightnessSlider.value = settings.brightness;
    brightnessVal.textContent = settings.brightness;
    contrastSlider.value = settings.contrast;
    contrastVal.textContent = settings.contrast;
    minSizeSlider.value = settings.minSize;
    minSizeVal.textContent = settings.minSize;
    maxCirclesInput.value = settings.maxCircles;
    statsAreaPctInput.value = settings.statsArea;
    sampleDiameterInput.value = settings.sampleDiameter;
    sortBySelect.value = settings.sortBy;

    // Re-run detection if we have an image
    if (originalGray) {
        scheduleDetection();
    }

    closeSettingsModal();
}

function resetToDefaults() {
    defaultSensitivity.value = DEFAULT_SETTINGS.sensitivity;
    defaultBrightness.value = DEFAULT_SETTINGS.brightness;
    defaultContrast.value = DEFAULT_SETTINGS.contrast;
    defaultMinSize.value = DEFAULT_SETTINGS.minSize;
    defaultMaxCircles.value = DEFAULT_SETTINGS.maxCircles;
    defaultStatsArea.value = DEFAULT_SETTINGS.statsArea;
    defaultSampleDiameter.value = DEFAULT_SETTINGS.sampleDiameter;
    defaultSortBy.value = DEFAULT_SETTINGS.sortBy;
    if (showGraphToggle) showGraphToggle.checked = DEFAULT_SETTINGS.showGraph;
}

function handleRowHover(e) {
    const row = e.target.closest('tr[data-circle-id]');
    if (row) {
        const id = parseInt(row.dataset.circleId);
        highlightCircle(id);
    }
}

function handleRowLeave(e) {
    const row = e.target.closest('tr[data-circle-id]');
    if (row) {
        highlightCircle(null);
    }
}

function highlightCircle(id) {
    highlightedCircleId = id;
    drawResults();

    // Update table row highlighting
    document.querySelectorAll('tr[data-circle-id]').forEach(row => {
        row.classList.toggle('highlight', parseInt(row.dataset.circleId) === id);
    });

    // Update graph highlighting if visible
    if (graphPanel && graphPanel.style.display !== 'none' && lastFitResults) {
        drawGraph(
            lastFitResults.xValues,
            lastFitResults.yValues,
            lastFitResults.fit,
            lastFitResults.type,
            lastFitResults.circles
        );
    }
}

// Debounced hover update
let hoverTimeout = null;
let lastHoverX = -1;
let lastHoverY = -1;

function handleCanvasHover(e) {
    if (!originalGray) return;

    const rect = originalCanvas.getBoundingClientRect();
    const scaleX = originalCanvas.width / rect.width;
    const scaleY = originalCanvas.height / rect.height;

    const canvasX = Math.floor((e.clientX - rect.left) * scaleX);
    const canvasY = Math.floor((e.clientY - rect.top) * scaleY);

    if (canvasX < 0 || canvasX >= width || canvasY < 0 || canvasY >= height) {
        resetHoverPanel();
        sampleIndicator.classList.remove('visible');
        return;
    }

    const sampleDiameter = parseInt(sampleDiameterInput.value) || 10;
    const sampleRadius = sampleDiameter / 2;

    // Update sample indicator (circle) position immediately
    const indicatorX = (canvasX / scaleX) - sampleRadius / scaleX;
    const indicatorY = (canvasY / scaleY) - sampleRadius / scaleY;
    const indicatorSize = sampleDiameter / scaleX;

    sampleIndicator.style.left = `${indicatorX + originalCanvas.offsetLeft}px`;
    sampleIndicator.style.top = `${indicatorY + originalCanvas.offsetTop}px`;
    sampleIndicator.style.width = `${indicatorSize}px`;
    sampleIndicator.style.height = `${indicatorSize}px`;
    sampleIndicator.classList.add('visible');

    // Update position immediately
    hoverPanel.classList.add('active');
    hoverPos.textContent = `${canvasX}, ${canvasY}`;

    // Debounce the expensive Python stats call
    if (canvasX === lastHoverX && canvasY === lastHoverY) return;
    lastHoverX = canvasX;
    lastHoverY = canvasY;

    if (hoverTimeout) clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
        updateHoverStats(canvasX, canvasY, sampleRadius);
    }, 50);
}

async function updateHoverStats(x, y, radius) {
    // Try Python first for accurate raw TIFF values
    if (pyodideReady && pythonTiffLoaded) {
        const stats = await getPythonPixelStats(x, y, radius);
        if (stats) {
            hoverMean.textContent = Math.round(stats.mean).toLocaleString();
            hoverMinMax.textContent = `${stats.min.toLocaleString()} / ${stats.max.toLocaleString()}`;
            hoverStdDev.textContent = stats.std.toFixed(1);
            hoverPixels.textContent = stats.count;
            return;
        }
    }

    // Fallback to JavaScript (8-bit or if Python unavailable)
    const sampleRadiusSq = radius * radius;
    let sum = 0, count = 0, min = 255, max = 0;
    const values = [];

    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(width - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(height - 1, Math.ceil(y + radius));

    for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
            const dx = px - x;
            const dy = py - y;
            if (dx * dx + dy * dy <= sampleRadiusSq) {
                const idx = py * width + px;
                const v = originalGray[idx];
                sum += v;
                if (v < min) min = v;
                if (v > max) max = v;
                values.push(v);
                count++;
            }
        }
    }

    if (count > 0) {
        const mean = sum / count;
        let variance = 0;
        for (const v of values) {
            variance += (v - mean) ** 2;
        }
        const stdDev = Math.sqrt(variance / count);

        hoverMean.textContent = Math.round(mean);
        hoverMinMax.textContent = `${min} / ${max}`;
        hoverStdDev.textContent = stdDev.toFixed(1);
        hoverPixels.textContent = count;
    }
}

function handleCanvasLeave() {
    resetHoverPanel();
    sampleIndicator.classList.remove('visible');
}

function resetHoverPanel() {
    hoverPanel.classList.remove('active');
    hoverPos.textContent = '-';
    hoverMean.textContent = '-';
    hoverMinMax.textContent = '-';
    hoverStdDev.textContent = '-';
    hoverPixels.textContent = '-';
}

function applyZoom() {
    currentZoom = parseInt(zoomLevelInput.value) / 100;
    updateCanvasTransform();
}

function updateCanvasTransform() {
    const isZoomed = currentZoom > 1;

    // Toggle zoomed class on wrapper for proper overflow handling
    originalWrapper.classList.toggle('zoomed-in', isZoomed);
    resultWrapper.classList.toggle('zoomed-in', isZoomed);

    if (!isZoomed) {
        // Reset everything at 100%
        originalCanvas.style.transform = '';
        originalCanvas.style.transformOrigin = '';
        resultCanvas.style.transform = '';
        resultCanvas.style.transformOrigin = '';
        originalWrapper.scrollLeft = 0;
        originalWrapper.scrollTop = 0;
        resultWrapper.scrollLeft = 0;
        resultWrapper.scrollTop = 0;
        return;
    }

    // Apply scale transform
    const transform = `scale(${currentZoom})`;
    originalCanvas.style.transform = transform;
    originalCanvas.style.transformOrigin = 'top left';
    resultCanvas.style.transform = transform;
    resultCanvas.style.transformOrigin = 'top left';
}

function resetZoom() {
    zoomLevelInput.value = 100;
    currentZoom = 1;
    updateCanvasTransform();
}

function zoomBy(amount) {
    const oldZoom = currentZoom;
    let newZoomVal = parseInt(zoomLevelInput.value) + amount;
    newZoomVal = Math.max(100, Math.min(800, newZoomVal));
    zoomLevelInput.value = newZoomVal;
    currentZoom = newZoomVal / 100;

    // Center zoom on cursor position
    if (cursorX > 0 && cursorY > 0 && oldZoom !== currentZoom) {
        const scrollLeftBefore = originalWrapper.scrollLeft;
        const scrollTopBefore = originalWrapper.scrollTop;

        // Calculate cursor position relative to content
        const contentX = scrollLeftBefore + cursorX;
        const contentY = scrollTopBefore + cursorY;

        updateCanvasTransform();

        // Adjust scroll to keep cursor position fixed
        if (currentZoom > 1) {
            const scale = currentZoom / oldZoom;
            const newContentX = contentX * scale;
            const newContentY = contentY * scale;

            originalWrapper.scrollLeft = newContentX - cursorX;
            originalWrapper.scrollTop = newContentY - cursorY;

            // Sync result wrapper
            resultWrapper.scrollLeft = originalWrapper.scrollLeft;
            resultWrapper.scrollTop = originalWrapper.scrollTop;
        }
    } else {
        updateCanvasTransform();
    }
}

function trackCursorPosition(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    cursorX = e.clientX - rect.left;
    cursorY = e.clientY - rect.top;
}

function handleKeyDown(e) {
    if (!originalGray) return;

    // Ignore if typing in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        if (!zoomKeyHeld) {
            zoomKeyHeld = true;
            zoomBy(10);
            // Start continuous zoom after initial press
            zoomInterval = setInterval(() => zoomBy(10), 100);
        }
    } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        if (!zoomKeyHeld) {
            zoomKeyHeld = true;
            zoomBy(-10);
            // Start continuous zoom after initial press
            zoomInterval = setInterval(() => zoomBy(-10), 100);
        }
    } else if (e.key === '0') {
        e.preventDefault();
        resetZoom();
    }
}

function handleKeyUp(e) {
    if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
        zoomKeyHeld = false;
        if (zoomInterval) {
            clearInterval(zoomInterval);
            zoomInterval = null;
        }
    }
}

// Hover detection for circles on result canvas
function handleResultCanvasHover(e) {
    if (!circles.length) return;

    const rect = resultCanvas.getBoundingClientRect();
    const scaleX = resultCanvas.width / rect.width;
    const scaleY = resultCanvas.height / rect.height;

    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    // Find which circle the cursor is over
    let hoveredCircle = null;
    for (const circle of circles) {
        const dx = canvasX - circle.cx;
        const dy = canvasY - circle.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= circle.r) {
            hoveredCircle = circle;
            break;
        }
    }

    if (hoveredCircle) {
        if (highlightedCircleId !== hoveredCircle.id) {
            highlightCircle(hoveredCircle.id);
        }
    } else {
        if (highlightedCircleId !== null) {
            highlightCircle(null);
        }
    }
}

function handleResultCanvasLeave() {
    if (highlightedCircleId !== null) {
        highlightCircle(null);
    }
}

// Debounced detection
let detectTimeout = null;
function scheduleDetection() {
    if (detectTimeout) clearTimeout(detectTimeout);
    detectTimeout = setTimeout(() => detect(), 16);
}

// Store pending TIFF data for when Pyodide becomes ready
let pendingTiffData = null;

// Initialize Pyodide for accurate pixel value analysis
async function initPyodide() {
    try {
        startupStatus.textContent = 'Loading Python runtime...';

        // Load Pyodide from CDN
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js';
        document.head.appendChild(script);

        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = reject;
        });

        // Initialize Pyodide
        pyodide = await loadPyodide();

        // Load Pyodide's compiled NumPy build, then install a pure-Python
        // tifffile release compatible with this pinned Pyodide runtime.
        startupStatus.textContent = 'Installing Python packages...';
        await pyodide.loadPackage(['numpy', 'micropip']);
        const micropip = pyodide.pyimport('micropip');
        await micropip.install('tifffile==2024.8.30');

        pyodideReady = true;
        console.log('Pyodide initialized with tifffile and numpy');

        // If there's pending TIFF data, load it now
        if (pendingTiffData) {
            console.log('Loading pending TIFF into Python...');
            await loadTiffIntoPython(pendingTiffData);
            pendingTiffData = null;
            // Update status to show Python is now available
            if (width > 0) {
                statusEl.textContent = `Loaded ${width}x${height} (${bitDepth}-bit) - Python ready`;
                // Recalculate circle stats with accurate 16-bit values
                if (circles.length > 0) {
                    await calculateCircleStats();
                    updateStatsTable();
                }
            }
        } else {
            startupStatus.textContent = 'Ready - Drop an image to begin';
        }
    } catch (err) {
        console.error('Failed to initialize Pyodide:', err);
        startupStatus.textContent = 'Ready (Python unavailable)';
    }
}

// Get pixel stats from Python for accurate 16-bit values
async function getPythonPixelStats(x, y, radius) {
    if (!pyodideReady || !pythonTiffLoaded) return null;

    try {
        pyodide.globals.set('query_x', x);
        pyodide.globals.set('query_y', y);
        pyodide.globals.set('query_radius', radius);

        const result = await pyodide.runPythonAsync(`
import numpy as np

# Use the precomputed grayscale array (tiff_gray) for accurate 16-bit values
x, y, r = int(query_x), int(query_y), float(query_radius)
h, w = tiff_gray.shape

# Sample circular region
values = []
r_sq = r * r
min_x = max(0, int(x - r))
max_x = min(w - 1, int(x + r))
min_y = max(0, int(y - r))
max_y = min(h - 1, int(y + r))

for py in range(min_y, max_y + 1):
    for px in range(min_x, max_x + 1):
        dx = px - x
        dy = py - y
        if dx*dx + dy*dy <= r_sq:
            values.append(int(tiff_gray[py, px]))

if len(values) > 0:
    arr = np.array(values, dtype=np.float64)
    result = {
        'mean': float(arr.mean()),
        'min': int(arr.min()),
        'max': int(arr.max()),
        'std': float(arr.std()),
        'count': len(values)
    }
else:
    result = None
result
        `);

        if (result) {
            const stats = result.toJs();
            return {
                mean: stats.get('mean'),
                min: stats.get('min'),
                max: stats.get('max'),
                std: stats.get('std'),
                count: stats.get('count')
            };
        }
    } catch (err) {
        console.warn('Python stats failed:', err);
    }
    return null;
}

// Load file
async function loadFile(file) {
    const ext = file.name.toLowerCase().split('.').pop();
    const isTiff = TIFF_EXTENSIONS.has(ext) || ['image/tiff', 'image/x-tiff'].includes(file.type);
    const isRecognizedImage = file.type.startsWith('image/') || KNOWN_IMAGE_EXTENSIONS.has(ext);

    if (!isRecognizedImage) {
        statusEl.textContent = 'Unsupported format. Please choose an image file.';
        return;
    }

    // Hide startup zone and show app
    startupDropZone.classList.add('hidden');
    appContainer.style.display = 'block';

    statusEl.textContent = 'Loading...';

    try {
        if (isTiff) {
            await loadTiff(file);
        } else {
            await loadImage(file, ext);
        }

        drawOriginal();

        // Update status based on Python availability
        if (!isTiff) {
            statusEl.textContent = `Loaded ${width}x${height} (${bitDepth}-bit)`;
        } else if (pythonTiffLoaded) {
            statusEl.textContent = `Loaded ${width}x${height} (${bitDepth}-bit) - Python ready`;
        } else if (pyodideReady) {
            statusEl.textContent = `Loaded ${width}x${height} (${bitDepth}-bit) - Python loading...`;
        } else {
            statusEl.textContent = `Loaded ${width}x${height} (${bitDepth}-bit) - Waiting for Python...`;
        }

        detect();
    } catch (err) {
        statusEl.textContent = 'Error: ' + err.message;
        console.error(err);
    }
}

async function loadTiff(file) {
    const buf = await file.arrayBuffer();
    const uint8 = new Uint8Array(buf);

    // Store buffer for Pyodide
    tiffArrayBuffer = buf;

    // Load into Python for accurate pixel analysis (in parallel with display loading)
    let pythonLoadPromise;
    if (pyodideReady) {
        pythonLoadPromise = loadTiffIntoPython(uint8);
    } else {
        // Store for later when Pyodide becomes ready
        console.log('Pyodide not ready yet, storing TIFF data for later...');
        pendingTiffData = uint8;
        pythonLoadPromise = Promise.resolve();
    }

    // Decode TIFF using UTIF for display
    const ifds = UTIF.decode(uint8);
    if (!ifds || ifds.length === 0) {
        throw new Error('Invalid TIFF file');
    }

    const ifd = ifds[0];
    UTIF.decodeImage(uint8, ifd);

    width = ifd.width;
    height = ifd.height;

    // Get bit depth
    const bps = ifd.t258 ? ifd.t258[0] : 8;
    bitDepth = bps;
    is16Bit = bps > 8;
    maxValue = (1 << bps) - 1;

    console.log(`TIFF (UTIF): ${width}x${height}, ${bitDepth}-bit`);

    // Use UTIF.toRGBA8 for proper display conversion
    const rgba = UTIF.toRGBA8(ifd);
    const totalPixels = width * height;

    // Create display arrays
    originalGray = new Uint8Array(totalPixels);
    imageData = new Uint8ClampedArray(rgba);

    // Extract grayscale for circle detection
    for (let i = 0; i < totalPixels; i++) {
        const r = rgba[i * 4];
        const g = rgba[i * 4 + 1];
        const b = rgba[i * 4 + 2];
        originalGray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }

    processedGray = new Uint8Array(originalGray);
    rawValues = null; // Raw values come from Python

    // Wait for Python to finish loading
    await pythonLoadPromise;
    console.log('After Python load:', { pyodideReady, pythonTiffLoaded });
}

async function loadTiffIntoPython(uint8) {
    pythonTiffLoaded = false;
    try {
        pyodide.globals.set('tiff_bytes', uint8);
        await pyodide.runPythonAsync(`
import numpy as np
import tifffile
import io

tiff_data = bytes(tiff_bytes.to_py())
with io.BytesIO(tiff_data) as f:
    # Use maxworkers=1 to disable threading (not supported in Pyodide/WebAssembly)
    tiff_image = tifffile.imread(f, maxworkers=1)

# Precompute grayscale if needed
if len(tiff_image.shape) == 3:
    tiff_gray = (0.299 * tiff_image[:,:,0] + 0.587 * tiff_image[:,:,1] + 0.114 * tiff_image[:,:,2]).astype(tiff_image.dtype)
else:
    tiff_gray = tiff_image

tiff_height, tiff_width = tiff_gray.shape
print(f"Python loaded TIFF: {tiff_width}x{tiff_height}, dtype={tiff_gray.dtype}, range={tiff_gray.min()}-{tiff_gray.max()}")
        `);
        pythonTiffLoaded = true;
        console.log('TIFF loaded into Python for accurate analysis');
    } catch (err) {
        pythonTiffLoaded = false;
        console.warn('Failed to load TIFF into Python:', err);
    }
}

async function loadImage(file, ext) {
    pythonTiffLoaded = false;  // Non-TIFF images don't use Python
    tiffArrayBuffer = null;

    try {
        await decodeBrowserImage(file);
    } catch (nativeError) {
        const isHeic = HEIC_EXTENSIONS.has(ext) || ['image/heic', 'image/heif'].includes(file.type);
        if (!isHeic) throw nativeError;

        statusEl.textContent = 'Converting HEIC/HEIF image...';
        try {
            const { default: heic2any } = await import('heic2any');
            const converted = await heic2any({ blob: file, toType: 'image/png' });
            const convertedBlob = Array.isArray(converted) ? converted[0] : converted;
            await decodeBrowserImage(convertedBlob);
        } catch (conversionError) {
            console.error('HEIC/HEIF conversion failed:', conversionError);
            throw new Error('Could not decode this HEIC/HEIF image');
        }
    }
}

function decodeBrowserImage(blob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(blob);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            width = img.width;
            height = img.height;
            is16Bit = false;
            rawValues = null;
            bitDepth = 8;
            maxValue = 255;

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const data = ctx.getImageData(0, 0, width, height);
            imageData = new Uint8ClampedArray(data.data);
            originalGray = new Uint8Array(width * height);

            for (let i = 0; i < originalGray.length; i++) {
                originalGray[i] = Math.round(
                    0.299 * imageData[i * 4] + 0.587 * imageData[i * 4 + 1] + 0.114 * imageData[i * 4 + 2]
                );
            }

            processedGray = new Uint8Array(originalGray);
            resolve();
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('The browser could not decode this image'));
        };
        img.src = objectUrl;
    });
}

function drawOriginal() {
    originalCanvas.width = width;
    originalCanvas.height = height;
    const ctx = originalCanvas.getContext('2d');
    ctx.putImageData(new ImageData(imageData, width, height), 0, 0);
}

async function detect() {
    if (!originalGray || isProcessing) return;
    isProcessing = true;

    const startTime = performance.now();

    const brightness = parseInt(brightnessSlider.value);
    const contrast = parseInt(contrastSlider.value) / 100;
    const sensitivity = parseInt(sensitivitySlider.value) / 100;
    const minArea = parseInt(minSizeSlider.value);

    applyBrightnessContrast(brightness, contrast);
    allCircles = findCircles(sensitivity, minArea);

    // Assign permanent IDs
    allCircles.forEach((c, i) => c.id = i);

    // Apply circle count cap
    applyCircleCap();

    await calculateCircleStats();
    sortCircles();
    drawResults();

    const elapsed = Math.round(performance.now() - startTime);
    processTimeEl.textContent = elapsed;
    updateCircleCount();

    updateStatsTable();
    // Only update graph if panel is visible
    if (graphPanel && graphPanel.style.display !== 'none') {
        updateGraph();
    }

    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 500) {
        const fps = Math.round(frameCount / ((now - lastFpsTime) / 1000));
        fpsEl.textContent = fps;
        frameCount = 0;
        lastFpsTime = now;
    }

    isProcessing = false;
}

function applyCircleCap() {
    const maxCircles = parseInt(maxCirclesInput.value) || Infinity;

    // Sort all circles by area (largest first) before applying cap
    const sorted = [...allCircles].sort((a, b) => b.area - a.area);
    circles = sorted.slice(0, maxCircles);

    // Re-assign display IDs based on capped list
    circles.forEach((c, i) => c.displayId = i);
}

function updateCircleCount() {
    const maxCirclesVal = parseInt(maxCirclesInput.value) || Infinity;
    if (maxCirclesVal < Infinity && allCircles.length > maxCirclesVal) {
        circleCountEl.textContent = `${circles.length} / ${allCircles.length}`;
    } else {
        circleCountEl.textContent = circles.length;
    }
    downloadBtn.disabled = circles.length === 0;
    exportExcelBtn.disabled = circles.length === 0;
    if (generatePlotBtn) generatePlotBtn.disabled = circles.length === 0;
}

function applyBrightnessContrast(brightness, contrast) {
    const factor = contrast;
    const offset = brightness + 128 * (1 - contrast);

    for (let i = 0; i < originalGray.length; i++) {
        let v = originalGray[i] * factor + offset;
        processedGray[i] = Math.max(0, Math.min(255, Math.round(v)));
    }
}

function findCircles(sensitivity, minAreaParam) {
    const thresholds = calculateMultiThresholds(processedGray, 3);
    const foundCircles = [];
    const visited = new Uint8Array(width * height);

    const minCircularity = 0.4 - sensitivity * 0.25;
    const minArea = Math.max(minAreaParam, 4);
    const maxArea = width * height * 0.4;

    for (const thresh of thresholds) {
        visited.fill(0);
        for (const c of foundCircles) {
            for (const idx of c.pixels) visited[idx] = 1;
        }

        const found = findCirclesAtThreshold(processedGray, visited, thresh, true, minCircularity, minArea, maxArea);
        foundCircles.push(...found);

        visited.fill(0);
        for (const c of foundCircles) {
            for (const idx of c.pixels) visited[idx] = 1;
        }
        const foundDark = findCirclesAtThreshold(processedGray, visited, 255 - thresh, false, minCircularity, minArea, maxArea);
        foundCircles.push(...foundDark);
    }

    return removeDuplicates(foundCircles);
}

function calculateMultiThresholds(data, levels) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < data.length; i++) hist[data[i]]++;

    const otsu = otsuThreshold(hist, data.length);
    const thresholds = [
        otsu,
        Math.round(otsu * 0.5),
        Math.round(otsu * 1.5),
        Math.round(otsu * 0.75),
        Math.round(otsu * 1.25)
    ];

    const unique = [...new Set(thresholds.map(t => Math.max(10, Math.min(245, t))))];
    return unique.sort((a, b) => a - b);
}

function otsuThreshold(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];

    let sumB = 0, wB = 0;
    let maxVariance = 0, threshold = 128;

    for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        const wF = total - wB;
        if (wF === 0) break;

        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const variance = wB * wF * (mB - mF) * (mB - mF);

        if (variance > maxVariance) {
            maxVariance = variance;
            threshold = t;
        }
    }

    return threshold;
}

function findCirclesAtThreshold(gray, visited, threshold, bright, minCircularity, minArea, maxArea) {
    const foundCircles = [];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (visited[idx]) continue;

            const val = gray[idx];
            const isForeground = bright ? (val > threshold) : (val < threshold);
            if (!isForeground) continue;

            const component = floodFill(gray, visited, x, y, threshold, bright);

            if (component.area >= minArea && component.area <= maxArea) {
                const circularity = calculateCircularity(component);

                if (circularity >= minCircularity) {
                    const r = Math.sqrt(component.area / Math.PI);
                    foundCircles.push({
                        cx: Math.round(component.sumX / component.area),
                        cy: Math.round(component.sumY / component.area),
                        r: Math.round(r),
                        area: component.area,
                        circularity,
                        pixels: component.pixels,
                        bright
                    });
                }
            }
        }
    }

    return foundCircles;
}

function floodFill(gray, visited, startX, startY, threshold, bright) {
    const pixels = [];
    let area = 0, sumX = 0, sumY = 0;
    let minX = startX, maxX = startX, minY = startY, maxY = startY;
    let perimeter = 0;

    const stack = [[startX, startY]];

    while (stack.length > 0) {
        const [x, y] = stack.pop();
        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        const idx = y * width + x;
        if (visited[idx]) continue;

        const val = gray[idx];
        const isForeground = bright ? (val > threshold) : (val < threshold);
        if (!isForeground) continue;

        visited[idx] = 1;
        pixels.push(idx);
        area++;
        sumX += x;
        sumY += y;

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        let isEdge = false;
        const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of neighbors) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                isEdge = true;
            } else {
                const nidx = ny * width + nx;
                const nval = gray[nidx];
                const nFg = bright ? (nval > threshold) : (nval < threshold);
                if (!nFg) {
                    isEdge = true;
                } else if (!visited[nidx]) {
                    stack.push([nx, ny]);
                }
            }
        }
        if (isEdge) perimeter++;
    }

    return { pixels, area, sumX, sumY, minX, maxX, minY, maxY, perimeter };
}

function calculateCircularity(component) {
    if (component.perimeter === 0) return 0;

    const circularity = (4 * Math.PI * component.area) / (component.perimeter * component.perimeter);
    const boxW = component.maxX - component.minX + 1;
    const boxH = component.maxY - component.minY + 1;
    const aspectRatio = Math.min(boxW, boxH) / Math.max(boxW, boxH);

    return circularity * 0.6 + aspectRatio * 0.4;
}

function removeDuplicates(circleList) {
    circleList.sort((a, b) => b.area - a.area);
    const keep = [];

    for (const c of circleList) {
        let isDupe = false;
        for (const k of keep) {
            const dist = Math.sqrt((c.cx - k.cx) ** 2 + (c.cy - k.cy) ** 2);
            if (dist < Math.max(c.r, k.r) * 0.8) {
                isDupe = true;
                break;
            }
        }
        if (!isDupe) keep.push(c);
    }

    return keep;
}

async function calculateCircleStats() {
    const statsAreaPct = parseInt(statsAreaPctInput.value) || 50;
    const pctFactor = statsAreaPct / 100;

    // Try Python for accurate 16-bit stats (use precomputed tiff_gray)
    if (pyodideReady && pythonTiffLoaded && circles.length > 0) {
        try {
            // Send circle data to Python
            const circleData = circles.map(c => ({
                cx: c.cx,
                cy: c.cy,
                r: c.r * pctFactor
            }));
            pyodide.globals.set('circles_data', JSON.stringify(circleData));

            const result = await pyodide.runPythonAsync(`
import numpy as np
import json

circles_list = json.loads(circles_data)

# Use precomputed tiff_gray for accurate 16-bit values
h, w = tiff_gray.shape
results = []

for c in circles_list:
    cx, cy, r = c['cx'], c['cy'], c['r']
    r_sq = r * r

    min_x = max(0, int(cx - r))
    max_x = min(w - 1, int(cx + r))
    min_y = max(0, int(cy - r))
    max_y = min(h - 1, int(cy + r))

    values = []
    for py in range(min_y, max_y + 1):
        for px in range(min_x, max_x + 1):
            dx = px - cx
            dy = py - cy
            if dx*dx + dy*dy <= r_sq:
                values.append(int(tiff_gray[py, px]))

    if len(values) > 0:
        arr = np.array(values, dtype=np.float64)
        results.append({
            'mean': float(arr.mean()),
            'min': int(arr.min()),
            'max': int(arr.max()),
            'std': float(arr.std()),
            'count': len(values)
        })
    else:
        results.append({'mean': 0, 'min': 0, 'max': 0, 'std': 0, 'count': 0})

json.dumps(results)
            `);

            const statsResults = JSON.parse(result);
            for (let i = 0; i < circles.length; i++) {
                const stats = statsResults[i];
                circles[i].meanValue = stats.mean;
                circles[i].minValue = stats.min;
                circles[i].maxValue = stats.max;
                circles[i].stdDev = stats.std;
                circles[i].diameter = circles[i].r * 2;
                circles[i].statsRadius = circles[i].r * pctFactor;
                circles[i].statsSampledCount = stats.count;
            }
            return;
        } catch (err) {
            console.warn('Python circle stats failed, using JS fallback:', err);
        }
    }

    // JavaScript fallback
    for (const circle of circles) {
        const statsRadius = circle.r * pctFactor;
        const statsRadiusSq = statsRadius * statsRadius;

        let sum = 0, min = 65535, max = 0;
        const values = [];

        const minX = Math.max(0, Math.floor(circle.cx - statsRadius));
        const maxX = Math.min(width - 1, Math.ceil(circle.cx + statsRadius));
        const minY = Math.max(0, Math.floor(circle.cy - statsRadius));
        const maxY = Math.min(height - 1, Math.ceil(circle.cy + statsRadius));

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dx = x - circle.cx;
                const dy = y - circle.cy;
                if (dx * dx + dy * dy <= statsRadiusSq) {
                    const idx = y * width + x;
                    const v = originalGray[idx];
                    sum += v;
                    if (v < min) min = v;
                    if (v > max) max = v;
                    values.push(v);
                }
            }
        }

        const count = values.length || 1;
        const mean = sum / count;
        let variance = 0;
        for (const v of values) {
            variance += (v - mean) ** 2;
        }
        const stdDev = Math.sqrt(variance / count);

        circle.meanValue = mean;
        circle.minValue = min;
        circle.maxValue = max;
        circle.stdDev = stdDev;
        circle.diameter = circle.r * 2;
        circle.statsRadius = statsRadius;
        circle.statsSampledCount = count;
    }
}

function sortCircles() {
    const sortKey = sortBySelect.value;
    const [field, direction] = sortKey.split('-');
    const asc = direction === 'asc';

    sortedCircles = [...circles].sort((a, b) => {
        let valA, valB;

        switch (field) {
            case 'area':
                valA = a.area;
                valB = b.area;
                break;
            case 'brightness':
                valA = a.meanValue;
                valB = b.meanValue;
                break;
            case 'diameter':
                valA = a.diameter;
                valB = b.diameter;
                break;
            case 'circularity':
                valA = a.circularity;
                valB = b.circularity;
                break;
            case 'x':
                valA = a.cx;
                valB = b.cx;
                break;
            case 'y':
                valA = a.cy;
                valB = b.cy;
                break;
            default:
                valA = a.area;
                valB = b.area;
        }

        return asc ? valA - valB : valB - valA;
    });
}

function formatValue(val) {
    if (is16Bit) {
        return Math.round(val).toLocaleString();
    }
    return Math.round(val);
}

function drawResults() {
    resultCanvas.width = width;
    resultCanvas.height = height;
    const ctx = resultCanvas.getContext('2d');

    const output = new Uint8ClampedArray(imageData);

    // Draw colored masks
    circles.forEach((circle) => {
        const color = COLORS[circle.id % COLORS.length];
        const isHighlighted = circle.id === highlightedCircleId;
        const alpha = isHighlighted ? 0.8 : 0.6;

        for (const idx of circle.pixels) {
            output[idx * 4] = Math.round(output[idx * 4] * (1 - alpha) + color[0] * alpha);
            output[idx * 4 + 1] = Math.round(output[idx * 4 + 1] * (1 - alpha) + color[1] * alpha);
            output[idx * 4 + 2] = Math.round(output[idx * 4 + 2] * (1 - alpha) + color[2] * alpha);
        }
    });

    ctx.putImageData(new ImageData(output, width, height), 0, 0);

    // Draw outlines, centroids, and labels
    circles.forEach((circle) => {
        const color = COLORS[circle.id % COLORS.length];
        const colorStr = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
        const isHighlighted = circle.id === highlightedCircleId;

        // Circle outline
        ctx.strokeStyle = isHighlighted ? '#fff' : colorStr;
        ctx.lineWidth = isHighlighted ? 4 : 2;
        ctx.beginPath();
        ctx.arc(circle.cx, circle.cy, circle.r, 0, Math.PI * 2);
        ctx.stroke();

        // If highlighted, draw additional glow
        if (isHighlighted) {
            ctx.strokeStyle = colorStr;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(circle.cx, circle.cy, circle.r + 3, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Draw ROI circle (stats area) if toggle enabled
        if (showRoi && circle.statsRadius) {
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(circle.cx, circle.cy, circle.statsRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Centroid circle indicator
        ctx.fillStyle = isHighlighted ? '#fff' : colorStr;
        ctx.beginPath();
        ctx.arc(circle.cx, circle.cy, isHighlighted ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();

        // White border on centroid
        ctx.strokeStyle = isHighlighted ? colorStr : '#fff';
        ctx.lineWidth = isHighlighted ? 2 : 1;
        ctx.beginPath();
        ctx.arc(circle.cx, circle.cy, isHighlighted ? 6 : 4, 0, Math.PI * 2);
        ctx.stroke();

        // Label
        ctx.fillStyle = '#fff';
        ctx.font = isHighlighted ? 'bold 14px sans-serif' : 'bold 12px sans-serif';
        ctx.fillText(`${circle.id + 1}`, circle.cx + circle.r + 6, circle.cy + 4);
    });
}

function updateStatsTable() {
    if (sortedCircles.length === 0) {
        statsBody.innerHTML = '<tr><td colspan="8" class="no-data">No circles detected</td></tr>';
        return;
    }

    statsBody.innerHTML = sortedCircles.map((c) => {
        const color = COLORS[c.id % COLORS.length];
        const isHighlighted = c.id === highlightedCircleId;

        return `
            <tr data-circle-id="${c.id}" class="${isHighlighted ? 'highlight' : ''}">
                <td>
                    <span class="color-dot" style="background: rgb(${color.join(',')})"></span>
                    ${c.id + 1}
                </td>
                <td>(${c.cx}, ${c.cy})</td>
                <td>${formatValue(c.meanValue)}</td>
                <td>${c.diameter} px</td>
                <td>${c.area.toLocaleString()}</td>
                <td>${(c.circularity * 100).toFixed(1)}%</td>
                <td>${formatValue(c.minValue)} / ${formatValue(c.maxValue)}</td>
                <td>${c.stdDev.toFixed(1)}</td>
            </tr>
        `;
    }).join('');
}

function download() {
    const link = document.createElement('a');
    link.download = 'circles_detected.png';
    link.href = resultCanvas.toDataURL('image/png');
    link.click();
}

async function exportToExcel() {
    const statsAreaPct = parseInt(statsAreaPctInput.value) || 50;

    // Create workbook with ExcelJS
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Circle Detector';
    workbook.created = new Date();

    // Create single worksheet with all data
    const worksheet = workbook.addWorksheet('Circle Detection Results');

    // Set column widths
    worksheet.columns = [
        { width: 6 },   // #
        { width: 10 },  // Center X
        { width: 10 },  // Center Y
        { width: 14 },  // Mean Value
        { width: 12 },  // Diameter
        { width: 12 },  // Area
        { width: 12 },  // Circularity
        { width: 12 },  // Min Value
        { width: 12 },  // Max Value
        { width: 10 },  // Std Dev
        { width: 16 },  // Stats Area
    ];

    // Add title
    worksheet.mergeCells('A1:K1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'Circle Detection Results';
    titleCell.font = { bold: true, size: 16 };
    titleCell.alignment = { horizontal: 'center' };

    // Add metadata
    let row = 3;
    worksheet.getCell(`A${row}`).value = 'Image Information:';
    worksheet.getCell(`A${row}`).font = { bold: true };
    row++;
    worksheet.getCell(`A${row}`).value = `Image Size: ${width} x ${height}`;
    row++;
    worksheet.getCell(`A${row}`).value = `Bit Depth: ${bitDepth}-bit`;
    row++;
    worksheet.getCell(`A${row}`).value = `Max Value: ${maxValue}`;
    row++;

    row++;
    worksheet.getCell(`A${row}`).value = 'Detection Parameters:';
    worksheet.getCell(`A${row}`).font = { bold: true };
    row++;
    worksheet.getCell(`A${row}`).value = `Sensitivity: ${sensitivitySlider.value}`;
    row++;
    worksheet.getCell(`A${row}`).value = `Brightness: ${brightnessSlider.value}`;
    row++;
    worksheet.getCell(`A${row}`).value = `Contrast: ${contrastSlider.value}`;
    row++;
    worksheet.getCell(`A${row}`).value = `Min Size: ${minSizeSlider.value}`;
    row++;
    worksheet.getCell(`A${row}`).value = `Max Circles: ${maxCirclesInput.value || 'All'}`;
    row++;
    worksheet.getCell(`A${row}`).value = `Stats Area: ${statsAreaPct}%`;
    row++;

    row++;
    worksheet.getCell(`A${row}`).value = `Total Detected: ${allCircles.length}`;
    row++;
    worksheet.getCell(`A${row}`).value = `Displayed: ${circles.length}`;
    row++;

    // Add statistics table
    row += 2;
    const tableStartRow = row;

    // Header row
    const headers = ['#', 'Center X', 'Center Y', 'Mean Value', 'Diameter (px)', 'Area (px)',
        'Circularity (%)', 'Min Value', 'Max Value', 'Std Dev', `Stats Area (${statsAreaPct}%)`];

    const headerRow = worksheet.getRow(row);
    headers.forEach((header, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF16213E' }
        };
        cell.font = { bold: true, color: { argb: 'FF00D9FF' } };
        cell.alignment = { horizontal: 'center' };
    });
    row++;

    // Data rows
    for (const c of sortedCircles) {
        const dataRow = worksheet.getRow(row);
        dataRow.values = [
            c.displayId + 1,
            c.cx,
            c.cy,
            is16Bit ? Math.round(c.meanValue) : parseFloat(c.meanValue.toFixed(1)),
            c.diameter,
            c.area,
            parseFloat((c.circularity * 100).toFixed(1)),
            c.minValue,
            c.maxValue,
            parseFloat(c.stdDev.toFixed(2)),
            Math.round(c.statsRadius * 2)
        ];
        row++;
    }

    // Add border to table
    const tableEndRow = row - 1;
    for (let r = tableStartRow; r <= tableEndRow; r++) {
        for (let c = 1; c <= 11; c++) {
            const cell = worksheet.getCell(r, c);
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        }
    }

    // Add images
    row += 2;
    worksheet.getCell(`A${row}`).value = 'Original Image:';
    worksheet.getCell(`A${row}`).font = { bold: true };
    row++;

    // Get image data as base64
    const originalImgBase64 = originalCanvas.toDataURL('image/png').split(',')[1];
    const detectedImgBase64 = resultCanvas.toDataURL('image/png').split(',')[1];

    // Add original image
    const originalImageId = workbook.addImage({
        base64: originalImgBase64,
        extension: 'png',
    });

    // Calculate image dimensions for Excel (max 400px wide, maintain aspect ratio)
    const maxImgWidth = 400;
    const imgScale = Math.min(1, maxImgWidth / width);
    const imgWidthPx = Math.round(width * imgScale);
    const imgHeightPx = Math.round(height * imgScale);

    worksheet.addImage(originalImageId, {
        tl: { col: 0, row: row - 1 },
        ext: { width: imgWidthPx, height: imgHeightPx }
    });

    // Skip rows for image
    const rowsForImage = Math.ceil(imgHeightPx / 20) + 2;
    row += rowsForImage;

    worksheet.getCell(`A${row}`).value = 'Detected Circles:';
    worksheet.getCell(`A${row}`).font = { bold: true };
    row++;

    // Add detected image
    const detectedImageId = workbook.addImage({
        base64: detectedImgBase64,
        extension: 'png',
    });

    worksheet.addImage(detectedImageId, {
        tl: { col: 0, row: row - 1 },
        ext: { width: imgWidthPx, height: imgHeightPx }
    });

    // Add graph data if available
    if (lastFitResults && graphCanvas) {
        row += rowsForImage;
        row += 2;

        worksheet.getCell(`A${row}`).value = 'Analysis Graph:';
        worksheet.getCell(`A${row}`).font = { bold: true };
        row++;

        // Add graph image
        const graphImgBase64 = graphCanvas.toDataURL('image/png').split(',')[1];
        const graphImageId = workbook.addImage({
            base64: graphImgBase64,
            extension: 'png',
        });

        worksheet.addImage(graphImageId, {
            tl: { col: 0, row: row - 1 },
            ext: { width: 400, height: 350 }
        });

        row += Math.ceil(350 / 20) + 2;

        // Add fit data
        worksheet.getCell(`A${row}`).value = 'Curve Fit Results:';
        worksheet.getCell(`A${row}`).font = { bold: true };
        row++;

        const fitType = lastFitResults.type === 'concentration' ? 'Power Law (y = ax^b)' : 'Exponential Decay (y = ae^(-bx))';
        worksheet.getCell(`A${row}`).value = `Fit Type: ${fitType}`;
        row++;

        if (lastFitResults.fit) {
            worksheet.getCell(`A${row}`).value = `Equation: ${lastFitResults.fit.equation}`;
            row++;
            worksheet.getCell(`A${row}`).value = `R² = ${lastFitResults.fit.r2.toFixed(4)}`;
            row++;

            if (lastFitResults.fit.type === 'power') {
                worksheet.getCell(`A${row}`).value = `a = ${lastFitResults.fit.a.toFixed(6)}, b = ${lastFitResults.fit.b.toFixed(6)}`;
            } else {
                worksheet.getCell(`A${row}`).value = `a = ${lastFitResults.fit.a.toFixed(6)}, b = ${lastFitResults.fit.b.toFixed(6)}`;
            }
            row++;
        }

        row++;
        worksheet.getCell(`A${row}`).value = 'Graph Data Points:';
        worksheet.getCell(`A${row}`).font = { bold: true };
        row++;

        // Headers
        const xLabel = lastFitResults.type === 'concentration' ? 'Concentration (nM)' : 'Depth (mm)';
        worksheet.getCell(`A${row}`).value = xLabel;
        worksheet.getCell(`A${row}`).font = { bold: true };
        worksheet.getCell(`B${row}`).value = 'Normalized Intensity';
        worksheet.getCell(`B${row}`).font = { bold: true };
        row++;

        // Data
        lastFitResults.xValues.forEach((x, i) => {
            worksheet.getCell(`A${row}`).value = x;
            worksheet.getCell(`B${row}`).value = lastFitResults.yValues[i];
            row++;
        });
    }

    // Generate and download the file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'circle_detection_results.xlsx';
    link.click();

    URL.revokeObjectURL(url);
}

// ===== GRAPH FUNCTIONS =====

function updateXAxisValues() {
    if (!targetTypeSelect || !xAxisValuesInput) return;

    const type = targetTypeSelect.value;
    const saved = localStorage.getItem('circleDetectorSettings');
    const settings = { ...DEFAULT_SETTINGS, ...(saved ? JSON.parse(saved) : {}) };

    if (type === 'concentration') {
        xAxisValuesInput.value = settings.concentrationValues || DEFAULT_SETTINGS.concentrationValues;
    } else if (type === 'depth') {
        xAxisValuesInput.value = settings.depthValues || DEFAULT_SETTINGS.depthValues;
    } else {
        xAxisValuesInput.value = '';
    }
}

function getXAxisValues() {
    if (!xAxisValuesInput) return [];
    const text = xAxisValuesInput.value.trim();
    if (!text) return [];
    return text.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
}

function updateGraph() {
    if (!graphCanvas || !graphCtx || !targetTypeSelect) return;

    const type = targetTypeSelect.value;
    if (type === 'none' || circles.length === 0) {
        clearGraph();
        return;
    }

    const xValues = getXAxisValues();
    if (xValues.length === 0) {
        clearGraph();
        return;
    }

    // Need circles.length >= xValues.length + 1 (for control)
    if (circles.length < xValues.length + 1) {
        clearGraph('Need ' + (xValues.length + 1) + ' circles\n(control + ' + xValues.length + ' samples)');
        return;
    }

    // Sort circles by brightness to find control (darkest)
    const sortedByBrightness = [...circles].sort((a, b) => a.meanValue - b.meanValue);
    const controlCircle = sortedByBrightness[0];
    const controlValue = controlCircle.meanValue;

    // Get the remaining circles sorted by brightness (brightest first for data)
    const dataCircles = sortedByBrightness.slice(1, xValues.length + 1);
    dataCircles.sort((a, b) => b.meanValue - a.meanValue); // Brightest first

    // Calculate normalized values (subtract control, normalize to max)
    const rawValues = dataCircles.map(c => Math.max(0, c.meanValue - controlValue));
    const maxVal = Math.max(...rawValues);
    const yValues = rawValues.map(v => maxVal > 0 ? v / maxVal : 0);

    // xValues go low to high (1, 3, 10, 30...)
    // By default: brightest circle = LAST x value (highest, e.g. 1000)
    // With reverse: brightest circle = FIRST x value (lowest, e.g. 1)
    const isReversed = reverseXAxisToggle && reverseXAxisToggle.checked;

    let plotX = [...xValues];
    let plotY;
    let plotCircles; // Track which circle each point corresponds to

    if (isReversed) {
        // Brightest to first x value (reverse the yValues to match ascending x)
        plotY = [...yValues];
        plotCircles = [...dataCircles];
    } else {
        // Brightest to last x value (default - yValues need to be reversed)
        plotY = [...yValues].reverse();
        plotCircles = [...dataCircles].reverse();
    }

    if (type === 'depth') {
        // Sort by x value (depth) ascending, y should decrease
        const pairs = plotX.map((x, i) => ({ x, y: plotY[i], circle: plotCircles[i] }));
        pairs.sort((a, b) => a.x - b.x);
        plotX = pairs.map(p => p.x);
        plotY = pairs.map(p => p.y);
        plotCircles = pairs.map(p => p.circle);
    }

    // Fit curve
    let fitResult;
    if (type === 'concentration') {
        fitResult = fitPowerLaw(plotX, plotY);
    } else {
        fitResult = fitExponentialDecay(plotX, plotY);
    }
    lastFitResults = { type, xValues: plotX, yValues: plotY, fit: fitResult, controlValue, circles: plotCircles };

    // Draw graph
    drawGraph(plotX, plotY, fitResult, type, plotCircles);

    // Update fit results display
    updateFitResultsDisplay(fitResult, type);
}

function clearGraph(message = '') {
    if (!graphCtx) return;
    const w = graphCanvas.width;
    const h = graphCanvas.height;

    graphCtx.fillStyle = '#fff';
    graphCtx.fillRect(0, 0, w, h);

    if (message) {
        graphCtx.fillStyle = '#888';
        graphCtx.font = '14px sans-serif';
        graphCtx.textAlign = 'center';
        const lines = message.split('\n');
        lines.forEach((line, i) => {
            graphCtx.fillText(line, w / 2, h / 2 + i * 20);
        });
    }

    lastFitResults = null;
    if (fitResultsEl) fitResultsEl.innerHTML = '<span class="panel-value">-</span>';
}

function fitPowerLaw(x, y) {
    // Power law: y = a * x^b
    // Log transform: ln(y) = ln(a) + b * ln(x)
    // Linear regression on log-log scale

    const validPairs = x.map((xi, i) => ({ x: xi, y: y[i] }))
        .filter(p => p.x > 0 && p.y > 0);

    if (validPairs.length < 2) return null;

    const logX = validPairs.map(p => Math.log(p.x));
    const logY = validPairs.map(p => Math.log(p.y));

    const n = logX.length;
    const sumLogX = logX.reduce((a, b) => a + b, 0);
    const sumLogY = logY.reduce((a, b) => a + b, 0);
    const sumLogXY = logX.reduce((a, xi, i) => a + xi * logY[i], 0);
    const sumLogX2 = logX.reduce((a, xi) => a + xi * xi, 0);

    const b = (n * sumLogXY - sumLogX * sumLogY) / (n * sumLogX2 - sumLogX * sumLogX);
    const lnA = (sumLogY - b * sumLogX) / n;
    const a = Math.exp(lnA);

    // Calculate R²
    const yMean = validPairs.reduce((sum, p) => sum + p.y, 0) / n;
    const ssTot = validPairs.reduce((sum, p) => sum + Math.pow(p.y - yMean, 2), 0);
    const ssRes = validPairs.reduce((sum, p) => {
        const yPred = a * Math.pow(p.x, b);
        return sum + Math.pow(p.y - yPred, 2);
    }, 0);
    const r2 = 1 - ssRes / ssTot;

    return { type: 'power', a, b, r2, equation: `y = ${a.toFixed(3)}x^${b.toFixed(3)}` };
}

function fitExponentialDecay(x, y) {
    // Exponential: y = a * e^(-b*x)
    // Log transform: ln(y) = ln(a) - b*x
    // Linear regression on semi-log scale

    const validPairs = x.map((xi, i) => ({ x: xi, y: y[i] }))
        .filter(p => p.y > 0);

    if (validPairs.length < 2) return null;

    const logY = validPairs.map(p => Math.log(p.y));
    const xVals = validPairs.map(p => p.x);

    const n = xVals.length;
    const sumX = xVals.reduce((a, b) => a + b, 0);
    const sumLogY = logY.reduce((a, b) => a + b, 0);
    const sumXLogY = xVals.reduce((a, xi, i) => a + xi * logY[i], 0);
    const sumX2 = xVals.reduce((a, xi) => a + xi * xi, 0);

    const negB = (n * sumXLogY - sumX * sumLogY) / (n * sumX2 - sumX * sumX);
    const b = -negB;
    const lnA = (sumLogY - negB * sumX) / n;
    const a = Math.exp(lnA);

    // Calculate R²
    const yMean = validPairs.reduce((sum, p) => sum + p.y, 0) / n;
    const ssTot = validPairs.reduce((sum, p) => sum + Math.pow(p.y - yMean, 2), 0);
    const ssRes = validPairs.reduce((sum, p) => {
        const yPred = a * Math.exp(-b * p.x);
        return sum + Math.pow(p.y - yPred, 2);
    }, 0);
    const r2 = 1 - ssRes / ssTot;

    return { type: 'exponential', a, b, r2, equation: `y = ${a.toFixed(3)}e^(-${b.toFixed(3)}x)` };
}

function drawGraph(xValues, yValues, fitResult, targetType, plotCircles = []) {
    if (!graphCtx) return;

    // Clear stored point positions
    graphPointPositions = [];

    const w = graphCanvas.width;
    const h = graphCanvas.height;
    const padding = { left: 60, right: 30, top: 20, bottom: 50 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    // Clear canvas
    graphCtx.fillStyle = '#fff';
    graphCtx.fillRect(0, 0, w, h);

    // Determine axis ranges
    const isLogLog = targetType === 'concentration';
    let xMin, xMax, yMin, yMax;

    if (isLogLog) {
        xMin = Math.min(...xValues.filter(v => v > 0)) * 0.5;
        xMax = Math.max(...xValues) * 2;
        yMin = 0.001;
        yMax = 1.5;
    } else {
        xMin = 0;
        xMax = Math.max(...xValues) * 1.1;
        yMin = 0;
        yMax = 1.1;
    }

    // Scale functions
    const scaleX = (val) => {
        if (isLogLog) {
            return padding.left + (Math.log10(val) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin)) * plotW;
        }
        return padding.left + (val - xMin) / (xMax - xMin) * plotW;
    };

    const scaleY = (val) => {
        if (isLogLog) {
            const logVal = Math.max(Math.log10(yMin), Math.log10(Math.max(val, yMin)));
            return padding.top + plotH - (logVal - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin)) * plotH;
        }
        return padding.top + plotH - (val - yMin) / (yMax - yMin) * plotH;
    };

    // Draw grid
    graphCtx.strokeStyle = '#ddd';
    graphCtx.lineWidth = 1;

    // X grid lines
    const xTicks = isLogLog ? [1, 10, 100, 1000] : generateTicks(xMin, xMax, 5);
    xTicks.forEach(tick => {
        if (tick >= xMin && tick <= xMax) {
            const x = scaleX(tick);
            graphCtx.beginPath();
            graphCtx.moveTo(x, padding.top);
            graphCtx.lineTo(x, padding.top + plotH);
            graphCtx.stroke();
        }
    });

    // Y grid lines
    const yTicks = isLogLog ? [0.001, 0.01, 0.1, 1.0] : generateTicks(yMin, yMax, 5);
    yTicks.forEach(tick => {
        if (tick >= yMin && tick <= yMax) {
            const y = scaleY(tick);
            graphCtx.beginPath();
            graphCtx.moveTo(padding.left, y);
            graphCtx.lineTo(padding.left + plotW, y);
            graphCtx.stroke();
        }
    });

    // Draw axes
    graphCtx.strokeStyle = '#000';
    graphCtx.lineWidth = 2;
    graphCtx.beginPath();
    graphCtx.moveTo(padding.left, padding.top);
    graphCtx.lineTo(padding.left, padding.top + plotH);
    graphCtx.lineTo(padding.left + plotW, padding.top + plotH);
    graphCtx.stroke();

    // Axis labels
    graphCtx.fillStyle = '#000';
    graphCtx.font = 'bold 12px sans-serif';
    graphCtx.textAlign = 'center';

    // X axis label
    const xLabel = targetType === 'concentration' ? 'Concentration (nM)' : 'Depth (mm)';
    graphCtx.fillText(xLabel, padding.left + plotW / 2, h - 10);

    // Y axis label
    graphCtx.save();
    graphCtx.translate(15, padding.top + plotH / 2);
    graphCtx.rotate(-Math.PI / 2);
    graphCtx.fillText('Normalized Intensity (a.u.)', 0, 0);
    graphCtx.restore();

    // Tick labels
    graphCtx.font = '10px sans-serif';
    xTicks.forEach(tick => {
        if (tick >= xMin && tick <= xMax) {
            graphCtx.fillText(tick.toString(), scaleX(tick), padding.top + plotH + 15);
        }
    });

    graphCtx.textAlign = 'right';
    yTicks.forEach(tick => {
        if (tick >= yMin && tick <= yMax) {
            graphCtx.fillText(tick.toFixed(isLogLog ? 3 : 2), padding.left - 5, scaleY(tick) + 4);
        }
    });

    // Draw trendline if enabled
    if (showTrendlineToggle && showTrendlineToggle.checked && fitResult) {
        graphCtx.strokeStyle = '#00aa00';
        graphCtx.lineWidth = 2;
        graphCtx.setLineDash([6, 4]);
        graphCtx.beginPath();

        const trendX = generateLogRange(xMin, xMax, 50);
        let first = true;
        trendX.forEach(x => {
            let y;
            if (fitResult.type === 'power') {
                y = fitResult.a * Math.pow(x, fitResult.b);
            } else {
                y = fitResult.a * Math.exp(-fitResult.b * x);
            }

            if (y >= yMin && y <= yMax) {
                const px = scaleX(x);
                const py = scaleY(y);
                if (first) {
                    graphCtx.moveTo(px, py);
                    first = false;
                } else {
                    graphCtx.lineTo(px, py);
                }
            }
        });
        graphCtx.stroke();
        graphCtx.setLineDash([]);
    }

    // Draw data points and store positions for hover detection
    graphCtx.fillStyle = '#1a3a6e';
    graphCtx.strokeStyle = '#1a3a6e';
    graphCtx.lineWidth = 1;

    xValues.forEach((x, i) => {
        const y = yValues[i];
        if (y > 0) {
            const px = scaleX(x);
            const py = scaleY(y);

            // Store position for hover detection
            const circle = plotCircles[i];
            if (circle) {
                graphPointPositions.push({
                    px, py,
                    circleId: circle.id,
                    xValue: x,
                    yValue: y
                });
            }

            // Check if this point is highlighted
            const isHighlighted = circle && circle.id === highlightedCircleId;
            const pointSize = isHighlighted ? 10 : 8;

            if (isHighlighted) {
                // Draw highlight glow
                graphCtx.fillStyle = '#ff6600';
                graphCtx.strokeStyle = '#ff6600';
                graphCtx.lineWidth = 2;
            } else {
                graphCtx.fillStyle = '#1a3a6e';
                graphCtx.strokeStyle = '#1a3a6e';
                graphCtx.lineWidth = 1;
            }

            // Diamond shape
            graphCtx.beginPath();
            graphCtx.moveTo(px, py - pointSize);
            graphCtx.lineTo(px + pointSize, py);
            graphCtx.lineTo(px, py + pointSize);
            graphCtx.lineTo(px - pointSize, py);
            graphCtx.closePath();
            graphCtx.fill();
            graphCtx.stroke();
        }
    });

    // Draw equation and R² if enabled
    // Position: top-left for concentration (log-log), top-right for depth (exponential)
    const isDepth = targetType === 'depth';
    const textX = isDepth ? w - padding.right - 10 : padding.left + 10;
    const textAlignment = isDepth ? 'right' : 'left';
    let textY = padding.top + 20;

    graphCtx.textAlign = textAlignment;
    graphCtx.fillStyle = '#000';

    if (showEquationToggle && showEquationToggle.checked && fitResult) {
        graphCtx.font = 'italic bold 14px sans-serif';

        if (fitResult.type === 'power') {
            // Draw power law equation with superscript: y = ax^b
            const aStr = fitResult.a.toFixed(3);
            const bStr = fitResult.b.toFixed(3);
            drawEquationWithExponent(graphCtx, textX, textY, `y = ${aStr}x`, bStr, textAlignment);
        } else {
            // Draw exponential equation with superscript: y = ae^(-bx)
            const aStr = fitResult.a.toFixed(3);
            const bStr = fitResult.b.toFixed(3);
            drawExponentialEquation(graphCtx, textX, textY, aStr, bStr, textAlignment);
        }
        textY += 22;
    }

    if (showR2Toggle && showR2Toggle.checked && fitResult) {
        graphCtx.font = 'bold 14px sans-serif';
        graphCtx.textAlign = textAlignment;
        // Draw R² with proper superscript
        drawR2(graphCtx, textX, textY, fitResult.r2, textAlignment);
    }
}

// Helper function to draw equation with exponent (for power law)
function drawEquationWithExponent(ctx, x, y, baseText, exponent, align) {
    ctx.font = 'italic bold 14px sans-serif';
    const baseWidth = ctx.measureText(baseText).width;

    if (align === 'right') {
        // Draw exponent first (at right), then base text
        ctx.font = 'italic bold 10px sans-serif';
        const expWidth = ctx.measureText(exponent).width;
        ctx.fillText(exponent, x, y - 4);

        ctx.font = 'italic bold 14px sans-serif';
        ctx.fillText(baseText, x - expWidth, y);
    } else {
        // Draw base text first, then exponent
        ctx.fillText(baseText, x, y);
        ctx.font = 'italic bold 10px sans-serif';
        ctx.fillText(exponent, x + baseWidth, y - 4);
    }
}

// Helper function to draw exponential equation: y = ae^(-bx)
function drawExponentialEquation(ctx, x, y, a, b, align) {
    ctx.font = 'italic bold 14px sans-serif';
    const prefix = `y = ${a}e`;
    const exponent = `−${b}x`;

    const prefixWidth = ctx.measureText(prefix).width;
    ctx.font = 'italic bold 10px sans-serif';
    const expWidth = ctx.measureText(exponent).width;

    ctx.font = 'italic bold 14px sans-serif';

    if (align === 'right') {
        // Draw from right: exponent, then prefix
        ctx.font = 'italic bold 10px sans-serif';
        ctx.fillText(exponent, x, y - 4);

        ctx.font = 'italic bold 14px sans-serif';
        ctx.fillText(prefix, x - expWidth, y);
    } else {
        // Draw prefix, then exponent
        ctx.fillText(prefix, x, y);
        ctx.font = 'italic bold 10px sans-serif';
        ctx.fillText(exponent, x + prefixWidth, y - 4);
    }
}

// Helper function to draw R² with proper superscript
function drawR2(ctx, x, y, r2Value, align) {
    ctx.font = 'bold 14px sans-serif';
    const prefix = 'R';
    const superscript = '2';
    const valueText = ` = ${r2Value.toFixed(4)}`;

    const prefixWidth = ctx.measureText(prefix).width;
    ctx.font = 'bold 10px sans-serif';
    const supWidth = ctx.measureText(superscript).width;
    ctx.font = 'bold 14px sans-serif';
    const valueWidth = ctx.measureText(valueText).width;

    if (align === 'right') {
        // Draw from right: value, superscript, R
        ctx.fillText(valueText, x, y);
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(superscript, x - valueWidth, y - 4);
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(prefix, x - valueWidth - supWidth, y);
    } else {
        // Draw R, superscript, value
        ctx.fillText(prefix, x, y);
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(superscript, x + prefixWidth, y - 4);
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(valueText, x + prefixWidth + supWidth, y);
    }
}

function generateTicks(min, max, count) {
    const range = max - min;
    const step = range / count;
    const ticks = [];
    for (let i = 0; i <= count; i++) {
        ticks.push(min + i * step);
    }
    return ticks;
}

function generateLogRange(min, max, count) {
    const logMin = Math.log10(min);
    const logMax = Math.log10(max);
    const step = (logMax - logMin) / count;
    const values = [];
    for (let i = 0; i <= count; i++) {
        values.push(Math.pow(10, logMin + i * step));
    }
    return values;
}

function updateFitResultsDisplay(fitResult, type) {
    if (!fitResultsEl) return;

    if (!fitResult) {
        fitResultsEl.innerHTML = '<span class="panel-value">-</span>';
        return;
    }

    const fitType = type === 'concentration' ? 'Power Law' : 'Exponential Decay';
    fitResultsEl.innerHTML = `
        <div><strong>${fitType}</strong></div>
        <div class="equation">${fitResult.equation}</div>
        <div class="r2">R² = ${fitResult.r2.toFixed(4)}</div>
    `;
}

// Graph hover handlers for point-to-circle correlation
function handleGraphCanvasHover(e) {
    if (!graphCanvas || graphPointPositions.length === 0) return;

    const rect = graphCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Find the closest point within hover distance
    const hoverRadius = 15; // pixels
    let closestPoint = null;
    let closestDist = Infinity;

    for (const point of graphPointPositions) {
        const dx = mouseX - point.px;
        const dy = mouseY - point.py;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < hoverRadius && dist < closestDist) {
            closestDist = dist;
            closestPoint = point;
        }
    }

    if (closestPoint) {
        if (highlightedCircleId !== closestPoint.circleId) {
            highlightCircle(closestPoint.circleId);
            // Redraw graph to show highlighted point
            if (lastFitResults) {
                drawGraph(
                    lastFitResults.xValues,
                    lastFitResults.yValues,
                    lastFitResults.fit,
                    lastFitResults.type,
                    lastFitResults.circles
                );
            }
        }
        graphCanvas.style.cursor = 'pointer';
    } else {
        if (highlightedCircleId !== null) {
            highlightCircle(null);
            // Redraw graph to clear highlight
            if (lastFitResults) {
                drawGraph(
                    lastFitResults.xValues,
                    lastFitResults.yValues,
                    lastFitResults.fit,
                    lastFitResults.type,
                    lastFitResults.circles
                );
            }
        }
        graphCanvas.style.cursor = 'default';
    }
}

function handleGraphCanvasLeave() {
    if (highlightedCircleId !== null) {
        highlightCircle(null);
        // Redraw graph to clear highlight
        if (lastFitResults) {
            drawGraph(
                lastFitResults.xValues,
                lastFitResults.yValues,
                lastFitResults.fit,
                lastFitResults.type,
                lastFitResults.circles
            );
        }
    }
    if (graphCanvas) {
        graphCanvas.style.cursor = 'default';
    }
}

// Start when DOM is ready
function onReady(fn) {
    if (document.readyState !== 'loading') {
        // DOM already ready, but use setTimeout to ensure all elements exist
        setTimeout(fn, 0);
    } else {
        document.addEventListener('DOMContentLoaded', fn);
    }
}
onReady(init);
