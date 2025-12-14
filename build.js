// build.js - FIXED Build System for Cloudflare Workers
const fs = require('fs');
const path = require('path');

console.log('🚀 Building MapaBus for Cloudflare Workers...\n');

// Ensure directories exist
if (!fs.existsSync('src')) fs.mkdirSync('src');
if (!fs.existsSync('src/handlers')) fs.mkdirSync('src/handlers');
if (!fs.existsSync('src/utils')) fs.mkdirSync('src/utils');

// =====================================================
// STEP 1: Convert API handlers to Workers format
// =====================================================
console.log('📁 Converting API routes...\n');

const apiFiles = {
  'api/vehicles.js': 'src/handlers/vehicles.js',
  'api/get-sheet-data.js': 'src/handlers/get-sheet-data.js',
  'api/update-sheet.js': 'src/handlers/update-sheet.js',
  'api/update-departures-sheet.js': 'src/handlers/update-departures-sheet.js',
  'api/reset-departures.js': 'src/handlers/reset-departures.js',
  'api/hourly-check.js': 'src/handlers/hourly-check.js',
  'api/stations.js': 'src/handlers/stations.js',
  'api/config.js': 'src/handlers/config.js',
};

Object.entries(apiFiles).forEach(([source, dest]) => {
  if (!fs.existsSync(source)) {
    console.log(`⚠️  Skipped ${source} (not found)`);
    return;
  }
  
  let content = fs.readFileSync(source, 'utf8');
  
  // Remove Node.js imports
  content = content.replace(/import\s+.*from\s+['"]googleapis['"]\s*;?\s*/g, '');
  content = content.replace(/import\s+.*from\s+['"]crypto['"]\s*;?\s*/g, '');
  content = content.replace(/import\s+.*from\s+['"]fs['"]\s*;?\s*/g, '');
  content = content.replace(/import\s+.*from\s+['"]path['"]\s*;?\s*/g, '');
  
  // Generate handler name from filename
  const handlerName = 'handle' + path.basename(dest, '.js')
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  
  // Replace export default
  content = content.replace(
    /export default async function handler\s*\(/g,
    `export async function ${handlerName}(`
  );
  
  // Replace req/res with request
  content = content.replace(/\breq\.method\b/g, 'request.method');
  content = content.replace(/\breq\.query\b/g, 'request.query');
  content = content.replace(/\breq\.headers\b/g, 'request.headers');
  
  // Parse request body properly
  if (content.includes('req.body')) {
    content = content.replace(
      /const\s+{\s*([^}]+)\s*}\s*=\s*req\.body\s*;?/g,
      'const body = await request.json();\n  const { $1 } = body;'
    );
    content = content.replace(/\breq\.body\b/g, 'body');
  }
  
  // Parse query params properly
  if (content.includes('request.query')) {
    content = `const url = new URL(request.url);\n  const query = Object.fromEntries(url.searchParams);\n  ${content}`;
    content = content.replace(/request\.query/g, 'query');
  }
  
  // Replace res.status().json()
  content = content.replace(
    /return\s+res\.status\s*\(\s*(\d+)\s*\)\.json\s*\(\s*({[^}]+})\s*\)/g,
    'return new Response(JSON.stringify($2), { status: $1, headers: { "Content-Type": "application/json" } })'
  );
  
  content = content.replace(
    /res\.status\s*\(\s*(\d+)\s*\)\.json\s*\(\s*({[^}]+})\s*\)/g,
    'return new Response(JSON.stringify($2), { status: $1, headers: { "Content-Type": "application/json" } })'
  );
  
  // Replace process.env with env
  content = content.replace(/process\.env\./g, 'env.');
  
  // Add Google Sheets client import
  if (content.includes('google.sheets') || content.includes('sheets.spreadsheets')) {
    content = `import { getSheetsClient } from '../utils/sheets-client.js';\n\n` + content;
    content = content.replace(/const sheets = google\.sheets\([^)]+\);?/g, 'const sheets = await getSheetsClient(env);');
  }
  
  // Add data loader for file reading
  if (content.includes('fs.readFileSync')) {
    content = `import { fetchDataFile } from '../utils/data-loader.js';\n` + content;
    content = content.replace(
      /fs\.readFileSync\s*\(\s*['"]([^'"]+)['"]\s*\)\.toString\(\)/g,
      'await fetchDataFile("$1", env)'
    );
    content = content.replace(
      /fs\.readFileSync\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]utf-?8['"]\s*\)/g,
      'await fetchDataFile("$1", env)'
    );
  }
  
  fs.writeFileSync(dest, content);
  console.log(`✓ Converted ${source} → ${dest}`);
});

// =====================================================
// STEP 2: Create utility files
// =====================================================
console.log('\n🔧 Creating utilities...\n');

// data-loader.js
const dataLoaderContent = `// src/utils/data-loader.js
// Loads large GTFS files from external source (Vercel deployment)

const DATA_BASE_URL = 'https://mapabus.vercel.app';

const FILE_MAP = {
  'api/shapes.txt': '/data/shapes.txt',
  'api/shapes_gradske.txt': '/data/shapes_gradske.txt',
  'public/data/shapes.txt': '/data/shapes.txt',
  'public/data/shapes_gradske.txt': '/data/shapes_gradske.txt',
  'api/stops.txt': '/api/stops.txt',
  'api/stops_gradske.txt': '/api/stops_gradske.txt',
  'api/trips.txt': '/api/trips.txt',
  'api/stop_times.txt': '/api/stop_times.txt',
  'public/all.json': '/all.json',
  'public/alll.json': '/alll.json'
};

export async function fetchDataFile(filePath, env) {
  // Check KV cache first (if available)
  if (env.DATA_CACHE) {
    try {
      const cached = await env.DATA_CACHE.get(filePath);
      if (cached) {
        console.log(\`✓ Cache hit: \${filePath}\`);
        return cached;
      }
    } catch (e) {
      console.warn('KV cache read error:', e);
    }
  }

  // Fetch from remote
  const remotePath = FILE_MAP[filePath] || '/' + filePath.replace(/^(api|public)\\//, '');
  const url = DATA_BASE_URL + remotePath;
  
  console.log(\`⬇️  Fetching: \${url}\`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(\`HTTP \${response.status}\`);
    }
    
    const data = await response.text();
    
    // Cache for 1 hour
    if (env.DATA_CACHE) {
      try {
        await env.DATA_CACHE.put(filePath, data, { expirationTtl: 3600 });
      } catch (e) {
        console.warn('KV cache write error:', e);
      }
    }
    
    return data;
  } catch (error) {
    console.error(\`Failed to fetch \${filePath}:\`, error);
    throw new Error(\`Could not load data file: \${filePath}\`);
  }
}`;

fs.writeFileSync('src/utils/data-loader.js', dataLoaderContent);
console.log('✓ Created src/utils/data-loader.js');

// sheets-client.js
const sheetsClientContent = `// src/utils/sheets-client.js
export async function getSheetsClient(env) {
  const accessToken = await getAccessToken(env);
  
  return {
    spreadsheets: {
      get: async (params) => {
        const url = \`https://sheets.googleapis.com/v4/spreadsheets/\${params.spreadsheetId}\`;
        const response = await fetch(url, {
          headers: { 'Authorization': \`Bearer \${accessToken}\` }
        });
        return { data: await response.json() };
      },
      values: {
        get: async (params) => {
          const url = \`https://sheets.googleapis.com/v4/spreadsheets/\${params.spreadsheetId}/values/\${params.range}\`;
          const response = await fetch(url, {
            headers: { 'Authorization': \`Bearer \${accessToken}\` }
          });
          return { data: await response.json() };
        },
        update: async (params) => {
          const url = \`https://sheets.googleapis.com/v4/spreadsheets/\${params.spreadsheetId}/values/\${params.range}?valueInputOption=\${params.valueInputOption || 'RAW'}\`;
          const response = await fetch(url, {
            method: 'PUT',
            headers: {
              'Authorization': \`Bearer \${accessToken}\`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(params.resource)
          });
          return { data: await response.json() };
        },
        append: async (params) => {
          const url = \`https://sheets.googleapis.com/v4/spreadsheets/\${params.spreadsheetId}/values/\${params.range}:append?valueInputOption=\${params.valueInputOption || 'RAW'}\`;
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': \`Bearer \${accessToken}\`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(params.resource)
          });
          return { data: await response.json() };
        },
        clear: async (params) => {
          const url = \`https://sheets.googleapis.com/v4/spreadsheets/\${params.spreadsheetId}/values/\${params.range}:clear\`;
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': \`Bearer \${accessToken}\`,
              'Content-Type': 'application/json'
            }
          });
          return { data: await response.json() };
        }
      },
      batchUpdate: async (params) => {
        const url = \`https://sheets.googleapis.com/v4/spreadsheets/\${params.spreadsheetId}:batchUpdate\`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${accessToken}\`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(params.resource)
        });
        return { data: await response.json() };
      }
    }
  };
}

async function getAccessToken(env) {
  const jwtHeader = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const jwtClaimSet = {
    iss: env.GOOGLE_SHEETS_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const jwt = await signJWT(jwtHeader, jwtClaimSet, env.GOOGLE_SHEETS_PRIVATE_KEY);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

async function signJWT(header, payload, privateKeyPem) {
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const data = \`\${headerB64}.\${payloadB64}\`;

  const privateKey = await importPrivateKey(privateKeyPem);
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    encoder.encode(data)
  );

  const signatureB64 = base64UrlEncode(signature);
  return \`\${data}.\${signatureB64}\`;
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\\\n/g, '')
    .replace(/\\s/g, '');
  
  const binaryDer = base64Decode(pemContents);
  
  return await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function base64UrlEncode(data) {
  if (typeof data === 'string') {
    data = new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer) {
    data = new Uint8Array(data);
  }
  
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
}

function base64Decode(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}`;

fs.writeFileSync('src/utils/sheets-client.js', sheetsClientContent);
console.log('✓ Created src/utils/sheets-client.js');

// =====================================================
// STEP 3: Bundle static assets
// =====================================================
console.log('\n📦 Bundling static assets...\n');

const staticFiles = [
  'public/index.html',
  'public/login.html',
  'public/admin.html',
  'public/baza.html',
  'public/polasci.html',
  'public/juce.html',
  'public/panel.html',
  'public/auth-check.js',
  'public/app.min.js',
  'public/route-mapping.json'
];

const assets = {};

staticFiles.forEach(file => {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    const filename = path.basename(file);
    assets[filename] = content;
    console.log(`✓ Bundled ${filename}`);
  } else {
    console.log(`⚠️  Skipped ${file} (not found)`);
  }
});

// Generate assets.js
const assetsContent = `// Auto-generated static assets
export const STATIC_ASSETS = ${JSON.stringify(assets, null, 2)};`;

fs.writeFileSync('src/assets.js', assetsContent);
console.log('\n✓ Generated src/assets.js');

// =====================================================
// STEP 4: Create main index.js
// =====================================================
console.log('\n🔗 Creating main index.js...\n');

const indexContent = `// src/index.js - Main Cloudflare Worker
import { STATIC_ASSETS } from './assets.js';
import { handleAuth } from './handlers/auth.js';
import { handleVehicles } from './handlers/vehicles.js';
import { handleGetSheetData } from './handlers/get-sheet-data.js';
import { handleUpdateSheet } from './handlers/update-sheet.js';
import { handleUpdateDeparturesSheet } from './handlers/update-departures-sheet.js';
import { handleResetDepartures } from './handlers/reset-departures.js';
import { handleHourlyCheck } from './handlers/hourly-check.js';
import { handleStations } from './handlers/stations.js';
import { handleConfig } from './handlers/config.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle OPTIONS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      let response;

      // ==================== API ROUTES ====================
      if (path === '/api/auth') {
        response = await handleAuth(request, env);
      }
      else if (path === '/api/vehicles') {
        response = await handleVehicles(request, env);
      }
      else if (path === '/api/get-sheet-data') {
        response = await handleGetSheetData(request, env);
      }
      else if (path === '/api/update-sheet') {
        response = await handleUpdateSheet(request, env);
      }
      else if (path === '/api/update-departures-sheet') {
        response = await handleUpdateDeparturesSheet(request, env);
      }
      else if (path === '/api/reset-departures') {
        response = await handleResetDepartures(request, env);
      }
      else if (path === '/api/hourly-check') {
        response = await handleHourlyCheck(request, env);
      }
      else if (path === '/api/stations') {
        response = await handleStations(request, env);
      }
      else if (path === '/api/config') {
        response = await handleConfig(request, env);
      }
      
      // HTML Pages served as API endpoints
      else if (path === '/api/sve') {
        response = serveHTML(STATIC_ASSETS['sve.html'] || '<h1>Page not found</h1>');
      }
      else if (path === '/api/linije') {
        const linijeHTML = \`<!DOCTYPE html>
<html lang="sr">
<head>
<script src="/auth-check.js"></script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Linije</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
body { margin: 0; padding: 0; font-family: sans-serif; overflow: hidden; background: #eee; }
#map { height: 100vh; width: 100%; z-index: 1; }
.controls {
  position: absolute; top: 10px; right: 10px; z-index: 1000;
  background: rgba(255, 255, 255, 0.98); padding: 15px;
  border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);
  width: 260px; max-height: 70vh; overflow-y: auto;
}
h3 { margin: 0 0 10px 0; color: #333; font-size: 16px; }
.input-group { display: flex; gap: 5px; margin-bottom: 10px; }
input { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px; }
button#addBtn { padding: 0 15px; background: #2980b9; color: white; border: none; border-radius: 6px; font-weight: bold; }
#activeLines { list-style: none; padding: 0; margin: 0; }
.line-item { background: #f8f9fa; margin-bottom: 6px; padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; }
.remove-btn { color: #e74c3c; cursor: pointer; }
</style>
</head>
<body>
<div class="controls">
  <h3>Linije</h3>
  <div class="input-group">
    <input type="text" id="lineInput" placeholder="Linija (npr. 31)">
    <button id="addBtn" onclick="alert('Funkcionalnost u izradi')">+</button>
  </div>
  <ul id="activeLines"></ul>
</div>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const map = L.map('map').setView([44.8125, 20.4612], 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; CARTO'
}).addTo(map);
</script>
</body>
</html>\`;
        response = serveHTML(linijeHTML);
      }
      
      // Static files
      else {
        response = serveStaticFile(path);
      }

      // Add CORS to all responses
      if (response) {
        const newHeaders = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          newHeaders.set(key, value);
        });
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal Server Error',
        message: error.message,
        stack: error.stack
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },

  async scheduled(event, env, ctx) {
    console.log('Cron triggered:', new Date().toISOString());
    try {
      const request = new Request('https://worker/cron', {
        method: 'GET',
        headers: { 'X-Cron': 'true' }
      });
      await handleHourlyCheck(request, env);
    } catch (error) {
      console.error('Cron error:', error);
    }
  }
};

function serveHTML(html) {
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function serveStaticFile(path) {
  if (path === '/' || path === '') path = '/index.html';
  
  const filename = path.substring(1);
  const content = STATIC_ASSETS[filename];
  
  if (!content) {
    return new Response('Not Found', { status: 404 });
  }

  const contentType = getContentType(filename);
  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

function getContentType(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  const types = {
    'html': 'text/html; charset=utf-8',
    'js': 'application/javascript; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'svg': 'image/svg+xml',
    'txt': 'text/plain; charset=utf-8'
  };
  return types[ext] || 'application/octet-stream';
}`;

fs.writeFileSync('src/index.js', indexContent);
console.log('✓ Created src/index.js');

// =====================================================
// DONE
// =====================================================
console.log('\n✅ Build complete!\n');
console.log('📝 Next steps:');
console.log('  1. Set secrets:');
console.log('     wrangler secret put GOOGLE_SHEETS_CLIENT_EMAIL');
console.log('     wrangler secret put GOOGLE_SHEETS_PRIVATE_KEY');
console.log('     wrangler secret put GOOGLE_SPREADSHEET_ID');
console.log('  2. Deploy:');
console.log('     wrangler deploy');
