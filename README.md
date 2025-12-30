# Circle Detector

A circle detection application that processes 16-bit TIFF images, preserves raw pixel values, and detects circular features using computer vision techniques. Supports both browser-based UI and CLI operation.

## Features

- Load 8-bit and 16-bit TIFF images
- Support for PNG and JPEG formats
- Hough Circle Transform implementation (no OpenCV dependency)
- Preserve and display raw 16-bit pixel values
- Adjustable detection parameters
- Export results as PNG (browser) or JSON (CLI)

## Setup

1. Install Bun (if not already installed):
```bash
curl -fsSL https://bun.sh/install | bash
```

2. Install dependencies:
```bash
bun install
```

## Browser Interface

Start the development server:
```bash
bun run dev
```

Open your browser to the URL shown (typically http://localhost:3000).

### Usage

1. Drag and drop an image or click to browse
2. Adjust detection parameters:
   - **Min Radius**: Minimum circle radius to detect (5-100px)
   - **Max Radius**: Maximum circle radius to detect (10-200px)
   - **Edge Threshold**: Sensitivity of edge detection (10-255)
   - **Blur Size**: Gaussian blur kernel size (1-21, odd numbers)
3. Click "Detect Circles"
4. View results and download annotated image

## CLI Interface

```bash
bun run detect <input.tif> [minRadius] [maxRadius] [threshold] [blurSize]
```

### Example

```bash
bun run detect sample.tif 10 50 100 5
```

### Output

- Console output showing detected circles with coordinates
- JSON file with full results: `<input>_circles.json`

## Algorithm

The circle detection uses a custom implementation of:

1. **Gaussian Blur** - Reduces noise in the image
2. **Sobel Edge Detection** - Finds edges using gradient magnitude
3. **Hough Circle Transform** - Votes for circle centers and radii
4. **Non-Maximum Suppression** - Removes overlapping detections

## Parameter Tuning

- **High contrast images**: Lower threshold
- **Noisy images**: Increase blur size
- **Small circles**: Reduce min radius
- **Large circles**: Increase max radius
- **Too many false positives**: Increase threshold or use smaller radius range

## Project Structure

```
circle-detector/
├── package.json
├── index.html          # Browser UI
├── src/
│   ├── app.js          # Browser application logic
│   └── detect.js       # CLI detection script
└── README.md
```

## Supported Formats

- TIFF (.tif, .tiff) - 8-bit and 16-bit
- PNG (.png)
- JPEG (.jpg, .jpeg)
