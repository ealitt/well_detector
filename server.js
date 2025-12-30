import { networkInterfaces } from "os";
import { watch } from "fs";

const PORT = 3000;
const SRC_DIR = "./src";

// Get local IP address for display
function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

// Bundle the app
async function bundle() {
  const result = await Bun.build({
    entrypoints: ["./src/app.js"],
    outdir: "./dist",
    minify: false,
    sourcemap: "inline",
    target: "browser",
  });

  if (!result.success) {
    console.error("Bundle failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    return false;
  }
  return true;
}

// Initial bundle
console.log("Bundling...");
if (!(await bundle())) {
  process.exit(1);
}

// Watch for changes and rebundle
let rebundleTimeout = null;
watch(SRC_DIR, { recursive: true }, (event, filename) => {
  if (rebundleTimeout) clearTimeout(rebundleTimeout);
  rebundleTimeout = setTimeout(async () => {
    console.log(`\nFile changed: ${filename}, rebundling...`);
    await bundle();
    console.log("Done. Reload browser to see changes.");
  }, 100);
});

// MIME types
const mimeTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    // Serve index.html for root
    if (path === "/") {
      path = "/index.html";
    }

    const filePath = "." + path;
    const file = Bun.file(filePath);

    if (await file.exists()) {
      const ext = path.substring(path.lastIndexOf("."));
      const contentType = mimeTypes[ext] || "application/octet-stream";

      return new Response(file, {
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

const localIP = getLocalIP();
console.log(`\nServer running at:`);
console.log(`  Local:   http://localhost:${PORT}`);
console.log(`  Network: http://${localIP}:${PORT}`);
console.log(`\nWatching for file changes...`);
