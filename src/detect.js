#!/usr/bin/env bun
import UTIF from 'utif';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// CLI usage
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('Circle Detector CLI');
    console.log('-------------------');
    console.log('Usage: bun run src/detect.js <input> [minRadius] [maxRadius] [threshold] [blurSize]');
    console.log('');
    console.log('Arguments:');
    console.log('  input      - Path to image file (.tif, .tiff, .png, .jpg, .jpeg)');
    console.log('  minRadius  - Minimum circle radius (default: 10)');
    console.log('  maxRadius  - Maximum circle radius (default: 50)');
    console.log('  threshold  - Edge detection threshold (default: 100)');
    console.log('  blurSize   - Gaussian blur kernel size, odd number (default: 5)');
    console.log('');
    console.log('Example:');
    console.log('  bun run src/detect.js sample.tif 10 50 100 5');
    process.exit(1);
}

const inputPath = args[0];
const minRadius = parseInt(args[1]) || 10;
const maxRadius = parseInt(args[2]) || 50;
const threshold = parseInt(args[3]) || 100;
let blurSize = parseInt(args[4]) || 5;

// Ensure blur size is odd
if (blurSize % 2 === 0) blurSize++;

// Check if file exists
if (!existsSync(inputPath)) {
    console.error(`Error: File not found: ${inputPath}`);
    process.exit(1);
}

const ext = inputPath.toLowerCase().split('.').pop();
const validExts = ['tif', 'tiff', 'png', 'jpg', 'jpeg'];

if (!validExts.includes(ext)) {
    console.error(`Error: Unsupported file format: .${ext}`);
    console.error('Supported formats: TIFF, PNG, JPEG');
    process.exit(1);
}

console.log(`Loading ${inputPath}...`);

let width, height, bitsPerSample, is16Bit;
let rawValues = null;
let grayscaleData;
let valueRange = { min: 0, max: 255 };

try {
    const buffer = readFileSync(inputPath);

    if (ext === 'tif' || ext === 'tiff') {
        // Load TIFF
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const ifds = UTIF.decode(arrayBuffer);
        UTIF.decodeImage(arrayBuffer, ifds[0]);
        const ifd = ifds[0];

        width = ifd.width;
        height = ifd.height;
        bitsPerSample = ifd.t258 ? ifd.t258[0] : 8;
        is16Bit = bitsPerSample === 16;

        console.log(`Image: ${width}x${height}, ${bitsPerSample}-bit`);

        if (is16Bit) {
            // Store raw 16-bit values
            rawValues = new Uint16Array(ifd.data.buffer, ifd.data.byteOffset, width * height);

            // Find min/max for normalization
            let min = Infinity, max = -Infinity;
            for (let i = 0; i < rawValues.length; i++) {
                if (rawValues[i] < min) min = rawValues[i];
                if (rawValues[i] > max) max = rawValues[i];
            }
            valueRange = { min, max };
            console.log(`16-bit value range: ${min} - ${max}`);

            // Normalize to 8-bit for processing
            grayscaleData = new Uint8Array(width * height);
            const range = max - min || 1;
            for (let i = 0; i < rawValues.length; i++) {
                grayscaleData[i] = Math.round(((rawValues[i] - min) / range) * 255);
            }
        } else {
            // 8-bit TIFF
            const rgba = UTIF.toRGBA8(ifd);
            grayscaleData = new Uint8Array(width * height);
            for (let i = 0; i < grayscaleData.length; i++) {
                const r = rgba[i * 4];
                const g = rgba[i * 4 + 1];
                const b = rgba[i * 4 + 2];
                grayscaleData[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            }
        }
    } else {
        // PNG/JPEG - use Bun's native image handling
        console.error('Note: PNG/JPEG support requires browser environment.');
        console.error('For CLI usage, please convert to TIFF format.');
        process.exit(1);
    }
} catch (error) {
    console.error(`Error loading image: ${error.message}`);
    process.exit(1);
}

// Check for large images
if (width > 2000 || height > 2000) {
    console.log('Warning: Large image detected. Processing may be slow.');
}

console.log(`Detecting circles...`);
console.log(`Parameters: minR=${minRadius}, maxR=${maxRadius}, threshold=${threshold}, blur=${blurSize}`);

// Gaussian blur implementation
function gaussianBlur(data, width, height, kernelSize) {
    const sigma = kernelSize / 3;
    const halfSize = Math.floor(kernelSize / 2);

    // Create Gaussian kernel
    const kernel = [];
    let sum = 0;
    for (let y = -halfSize; y <= halfSize; y++) {
        for (let x = -halfSize; x <= halfSize; x++) {
            const value = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
            kernel.push(value);
            sum += value;
        }
    }
    // Normalize kernel
    for (let i = 0; i < kernel.length; i++) {
        kernel[i] /= sum;
    }

    const result = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let value = 0;
            let ki = 0;

            for (let ky = -halfSize; ky <= halfSize; ky++) {
                for (let kx = -halfSize; kx <= halfSize; kx++) {
                    const px = Math.max(0, Math.min(width - 1, x + kx));
                    const py = Math.max(0, Math.min(height - 1, y + ky));
                    value += data[py * width + px] * kernel[ki];
                    ki++;
                }
            }

            result[y * width + x] = Math.round(value);
        }
    }

    return result;
}

// Sobel edge detection
function sobelEdgeDetection(data, width, height) {
    const result = new Uint8Array(width * height);

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const gx =
                -data[(y - 1) * width + (x - 1)] + data[(y - 1) * width + (x + 1)] +
                -2 * data[y * width + (x - 1)] + 2 * data[y * width + (x + 1)] +
                -data[(y + 1) * width + (x - 1)] + data[(y + 1) * width + (x + 1)];

            const gy =
                -data[(y - 1) * width + (x - 1)] - 2 * data[(y - 1) * width + x] - data[(y - 1) * width + (x + 1)] +
                data[(y + 1) * width + (x - 1)] + 2 * data[(y + 1) * width + x] + data[(y + 1) * width + (x + 1)];

            const magnitude = Math.sqrt(gx * gx + gy * gy);
            result[y * width + x] = Math.min(255, Math.round(magnitude));
        }
    }

    return result;
}

// Hough Circle Transform
function houghCircles(edgeData, width, height, minR, maxR, edgeThreshold) {
    const accumulator = new Map();
    const angleStep = 15; // degrees
    const angleStepRad = angleStep * Math.PI / 180;

    // Collect edge points
    let edgeCount = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (edgeData[y * width + x] > edgeThreshold) {
                edgeCount++;
            }
        }
    }
    console.log(`Found ${edgeCount} edge points`);

    // Vote for circles with progress
    let processed = 0;
    const totalPixels = width * height;
    let lastProgress = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            processed++;
            const progress = Math.floor((processed / totalPixels) * 100);
            if (progress >= lastProgress + 10) {
                process.stdout.write(`\rProcessing... ${progress}%`);
                lastProgress = progress;
            }

            if (edgeData[y * width + x] > edgeThreshold) {
                for (let r = minR; r <= maxR; r++) {
                    for (let angle = 0; angle < 2 * Math.PI; angle += angleStepRad) {
                        const cx = Math.round(x - r * Math.cos(angle));
                        const cy = Math.round(y - r * Math.sin(angle));

                        if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
                            const key = `${cx},${cy},${r}`;
                            accumulator.set(key, (accumulator.get(key) || 0) + 1);
                        }
                    }
                }
            }
        }
    }
    console.log('\rProcessing... 100%');

    // Find peaks (minimum votes threshold)
    const minVotes = 25;
    const candidates = [];

    for (const [key, votes] of accumulator) {
        if (votes >= minVotes) {
            const [cx, cy, r] = key.split(',').map(Number);
            candidates.push({ x: cx, y: cy, r, votes });
        }
    }

    // Sort by votes (descending)
    candidates.sort((a, b) => b.votes - a.votes);

    // Non-maximum suppression
    const circles = [];
    for (const candidate of candidates) {
        let isOverlapping = false;
        for (const existing of circles) {
            const dx = candidate.x - existing.x;
            const dy = candidate.y - existing.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const suppressThreshold = (candidate.r + existing.r) * 0.5;

            if (dist < suppressThreshold) {
                isOverlapping = true;
                break;
            }
        }

        if (!isOverlapping) {
            circles.push(candidate);
        }
    }

    return circles;
}

// Run detection
console.log('Applying Gaussian blur...');
const blurred = gaussianBlur(grayscaleData, width, height, blurSize);

console.log('Detecting edges...');
const edges = sobelEdgeDetection(blurred, width, height);

console.log('Finding circles...');
const circles = houghCircles(edges, width, height, minRadius, maxRadius, threshold);

// Output results
console.log('');
console.log(`Found ${circles.length} circles:`);
console.log('');

if (circles.length === 0) {
    console.log('No circles detected. Try adjusting parameters:');
    console.log('  - Lower the threshold for low-contrast images');
    console.log('  - Adjust min/max radius to match expected circle sizes');
    console.log('  - Increase blur for noisy images');
} else {
    circles.forEach((circle, i) => {
        console.log(`Circle ${i + 1}:`);
        console.log(`  Center: (${circle.x}, ${circle.y})`);
        console.log(`  Radius: ${circle.r}`);
        console.log(`  Votes: ${circle.votes}`);

        if (is16Bit && rawValues) {
            const idx = circle.y * width + circle.x;
            if (idx >= 0 && idx < rawValues.length) {
                console.log(`  Raw 16-bit value at center: ${rawValues[idx]}`);
            }
        }
        console.log('');
    });
}

// Save results as JSON
const baseName = inputPath.replace(/\.[^.]+$/, '');
const outputPath = `${baseName}_circles.json`;

const results = {
    image: {
        width,
        height,
        bitsPerSample: bitsPerSample || 8,
        is16Bit: is16Bit || false,
        valueRange: is16Bit ? valueRange : null
    },
    parameters: {
        minRadius,
        maxRadius,
        threshold,
        blurSize
    },
    circles: circles.map(c => ({
        center: { x: c.x, y: c.y },
        radius: c.r,
        votes: c.votes,
        raw16BitValue: (is16Bit && rawValues) ? rawValues[c.y * width + c.x] : null
    }))
};

writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`Results saved to ${outputPath}`);

process.exit(0);
