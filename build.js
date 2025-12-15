// build.js - FIXED Build System for Cloudflare Workers
const fs = require('fs');
const path = require('path');

console.log('🚀 Building MapaBus for Cloudflare Workers...\n');

// Ensure directories exist
if (!fs.existsSync('src')) fs.mkdirSync('src');
if (!fs.existsSync('src/handlers')) fs.mkdirSync('src/handlers');
if (!fs.existsSync('src/utils')) fs.mkdirSync('src/utils');

// =====================================================
// STEP 1: Create utility files FIRST
// =====================================================
console.log('🔧 Creating utilities...\n');

// data-loader.js
const dataLoaderContent = `// src/utils/data-loader.js
// Loads large GTFS files from external source (Vercel deployment)

const DATA_BASE_URL = 'https://mapabus.vercel.app';

const FILE_MAP = {
  'api/shapes.txt': '/data/shapes.txt',
  'api/shapes_gradske.txt': '/data/shapes_gradske.txt',
  'public/data/shapes.txt': '/data/shapes.txt',
  'public/data/shapes_gradske.txt': '/data/shapes_gradske.txt',
  'api/stops.txt': '/data/stops.txt',
  'api/stops_gradske.txt': '/data/stops_gradske.txt',
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

// crypto-utils.js
const cryptoUtilsContent = `// src/utils/crypto-utils.js
export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password, hashedPassword) {
  const hash = await hashPassword(password);
  return hash === hashedPassword;
}`;

fs.writeFileSync('src/utils/crypto-utils.js', cryptoUtilsContent);
console.log('✓ Created src/utils/crypto-utils.js');

// =====================================================
// STEP 2: Create handler files
// =====================================================
console.log('\n📁 Creating handlers...\n');

// stations.js handler
const stationsHandler = `// src/handlers/stations.js
import { fetchDataFile } from '../utils/data-loader.js';

export async function handleStations(request, env) {
  try {
    const allJsonText = await fetchDataFile('public/all.json', env);
    const stations = JSON.parse(allJsonText);
    
    const stationsMap = {};
    
    stations.forEach(station => {
      if (station.id && station.name && station.coords) {
        stationsMap[station.id] = {
          name: station.name,
          coords: [parseFloat(station.coords[0]), parseFloat(station.coords[1])]
        };
      }
    });

    return new Response(JSON.stringify(stationsMap), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Stations error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to load stations',
      message: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}`;

fs.writeFileSync('src/handlers/stations.js', stationsHandler);
console.log('✓ Created src/handlers/stations.js');

// config.js handler
const configHandler = `// src/handlers/config.js
export async function handleConfig(request, env) {
  const config = {
    refreshInterval: 60000,
    mapCenter: [44.8125, 20.4612],
    mapZoom: 13,
    colors: [
      '#e74c3c', '#3498db', '#9b59b6', '#2ecc71', '#f1c40f',
      '#e67e22', '#1abc9c', '#34495e', '#d35400', '#c0392b',
      '#2980b9', '#8e44ad', '#27ae60', '#f39c12', '#16a085'
    ]
  };

  return new Response(JSON.stringify(config), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}`;

fs.writeFileSync('src/handlers/config.js', configHandler);
console.log('✓ Created src/handlers/config.js');

// vehicles.js handler
const vehiclesHandler = `// src/handlers/vehicles.js
export async function handleVehicles(request, env) {
  const url = new URL(request.url);
  const linesParam = url.searchParams.get('lines');
  let selectedLines = null;
  
  if (linesParam) {
    selectedLines = linesParam.split(',').map(l => l.trim());
  }

  try {
    const timestamp = Date.now();
    const randomSalt = Math.random().toString(36).substring(2, 15);
    const BASE_URL = 'https://rt.buslogic.baguette.pirnet.si/beograd/rt.json';
    const targetUrl = \`\${BASE_URL}?_=\${timestamp}&salt=\${randomSalt}\`;

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(\`API error: \${response.status}\`);
    }

    const data = await response.json();

    if (!data || !data.entity) {
      return new Response(JSON.stringify({ vehicles: [], tripUpdates: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const vehicles = [];
    const tripUpdates = [];

    data.entity.forEach(entitet => {
      if (entitet.vehicle && entitet.vehicle.position) {
        const info = entitet.vehicle;
        const vehicleLabel = info.vehicle.label;
        const routeId = normalizeRouteId(info.trip.routeId);

        if (!isValidGarageNumber(vehicleLabel)) {
          return;
        }

        if (selectedLines && !selectedLines.includes(routeId)) {
          return;
        }

        vehicles.push({
          id: info.vehicle.id,
          label: vehicleLabel,
          routeId: info.trip.routeId,
          startTime: info.trip.startTime,
          lat: parseFloat(info.position.latitude),
          lon: parseFloat(info.position.longitude)
        });
      }

      if (entitet.tripUpdate && entitet.tripUpdate.trip && 
          entitet.tripUpdate.stopTimeUpdate && entitet.tripUpdate.vehicle) {
        const updates = entitet.tripUpdate.stopTimeUpdate;
        const vehicleId = entitet.tripUpdate.vehicle.id;

        if (updates.length > 0 && vehicleId) {
          const lastStopId = updates[updates.length - 1].stopId;
          tripUpdates.push({
            vehicleId: vehicleId,
            destination: lastStopId
          });
        }
      }
    });

    return new Response(JSON.stringify({
      vehicles: vehicles,
      tripUpdates: tripUpdates,
      timestamp: Date.now()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error fetching vehicles:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to fetch vehicle data',
      message: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function normalizeRouteId(routeId) {
  if (typeof routeId === 'string') {
    return parseInt(routeId, 10).toString();
  }
  return routeId;
}

function isValidGarageNumber(label) {
  if (!label || typeof label !== 'string') return false;
  
  if (label.startsWith('P')) {
    return label.length >= 6;
  }
  
  return true;
}`;

fs.writeFileSync('src/handlers/vehicles.js', vehiclesHandler);
console.log('✓ Created src/handlers/vehicles.js');

// Convert update-sheet.js and update-departures-sheet.js with proper transformation
console.log('\n📝 Converting Sheets handlers...\n');

// Helper function to convert handlers
function convertHandler(sourceFile, destFile, handlerName) {
  if (!fs.existsSync(sourceFile)) {
    console.log(`⚠️  Skipped ${sourceFile} (not found)`);
    return;
  }
  
  let content = fs.readFileSync(sourceFile, 'utf8');
  
  // Remove Node.js imports
  content = content.replace(/import\s+.*from\s+['"]googleapis['"]\s*;?\s*/g, '');
  content = content.replace(/import\s+.*from\s+['"]crypto['"]\s*;?\s*/g, '');
  content = content.replace(/import\s+.*from\s+['"]fs['"]\s*;?\s*/g, '');
  content = content.replace(/import\s+.*from\s+['"]path['"]\s*;?\s*/g, '');
  
  // Add imports
  content = `import { getSheetsClient } from '../utils/sheets-client.js';\n\n` + content;
  
  // Replace export default function handler
  content = content.replace(
    /export default async function handler\s*\(/g,
    `export async function ${handlerName}(`
  );
  
  // Replace req/res with request
  content = content.replace(/\breq\.method\b/g, 'request.method');
  content = content.replace(/\breq\.query\b/g, 'query');
  content = content.replace(/\breq\.body\b/g, 'body');
  
  // Parse query params
  if (content.includes('query')) {
    content = content.replace(
      /(export (?:async )?function handle[A-Za-z]+\([^)]*\)\s*{)/,
      '$1\n  const url = new URL(request.url);\n  const query = Object.fromEntries(url.searchParams);'
    );
  }
  
  // Parse request body
  if (content.includes('body')) {
    content = content.replace(
      /(export (?:async )?function handle[A-Za-z]+\([^)]*\)\s*{(?:\s*const url[^;]+;\s*const query[^;]+;)?)/,
      '$1\n  const body = request.method === "POST" ? await request.json() : {};'
    );
  }
  
  // Replace res.status().end()
  content = content.replace(
    /return\s+res\.status\s*\(\s*(\d+)\s*\)\.end\s*\(\s*\)/g,
    'return new Response(null, { status: $1 })'
  );
  
  // Replace res.status().json()
  content = content.replace(
    /return\s+res\.status\s*\(\s*(\d+)\s*\)\.json\s*\(\s*([^)]+)\s*\)/g,
    'return new Response(JSON.stringify($2), { status: $1, headers: { "Content-Type": "application/json" } })'
  );
  
  content = content.replace(
    /(?<!return\s+)res\.status\s*\(\s*(\d+)\s*\)\.json\s*\(\s*([^)]+)\s*\)/g,
    'return new Response(JSON.stringify($2), { status: $1, headers: { "Content-Type": "application/json" } })'
  );
  
  // Remove res.setHeader
  content = content.replace(/res\.setHeader\s*\([^)]+\)\s*;?\s*/g, '');
  
  // Replace process.env with env
  content = content.replace(/process\.env\./g, 'env.');
  
  // Replace Google Sheets setup
  content = content.replace(/const sheets = google\.sheets\([^)]+\);?/g, 'const sheets = await getSheetsClient(env);');
  
  fs.writeFileSync(destFile, content);
  console.log(`✓ Converted ${sourceFile} → ${destFile}`);
}

convertHandler('api/update-sheet.js', 'src/handlers/update-sheet.js', 'handleUpdateSheet');
convertHandler('api/update-departures-sheet.js', 'src/handlers/update-departures-sheet.js', 'handleUpdateDeparturesSheet');

// Create simplified HTML handlers
console.log('\n📄 Creating HTML handlers...\n');

const sveHandler = `// src/handlers/sve.js
export async function handleSve(request, env) {
  const html = \`<!DOCTYPE html>
<html lang="sr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sva Vozila</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; overflow: hidden; }
        #map { height: 100vh; width: 100%; }
        .loading-card {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: white; padding: 30px 50px; border-radius: 15px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3); z-index: 2000; text-align: center;
        }
        .loading-card.hidden { display: none; }
        .spinner {
            border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%;
            width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 15px;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .search-box {
            position: absolute; top: 20px; left: 20px; z-index: 1000;
            background: white; padding: 15px; border-radius: 10px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2); width: 300px;
        }
        .search-box input {
            width: 100%; padding: 10px; border: 2px solid #ddd;
            border-radius: 6px; font-size: 14px; outline: none; transition: border-color 0.3s;
        }
        .search-box input:focus { border-color: #3498db; }
        #searchResults { margin-top: 10px; max-height: 200px; overflow-y: auto; }
        .search-result-item {
            padding: 10px; cursor: pointer; border-radius: 5px;
            margin-bottom: 5px; background: #f8f9fa; transition: background 0.2s;
        }
        .search-result-item:hover { background: #e9ecef; }
        .bus-icon-container { background: none; border: none; }
        .bus-wrapper { position: relative; width: 50px; height: 56px; transition: all 0.3s ease; }
        .bus-circle {
            width: 32px; height: 32px; border-radius: 50%; color: white;
            display: flex; justify-content: center; align-items: center;
            font-weight: bold; font-size: 13px; border: 2px solid white;
            box-shadow: 0 3px 6px rgba(0,0,0,0.4);
            position: absolute; top: 0; left: 50%; transform: translateX(-50%); z-index: 20;
        }
        .bus-garage-label {
            position: absolute; top: 36px; left: 50%; transform: translateX(-50%);
            font-size: 9px; font-weight: bold; color: white;
            background: rgba(0, 0, 0, 0.7); padding: 2px 5px;
            border-radius: 3px; white-space: nowrap; z-index: 19;
        }
        .bus-arrow {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            z-index: 10; transition: transform 0.5s linear;
        }
        .arrow-head {
            width: 0; height: 0; border-left: 7px solid transparent;
            border-right: 7px solid transparent; border-bottom: 12px solid #333;
            position: absolute; top: 0px; left: 50%; transform: translateX(-50%);
        }
        .popup-content { font-size: 13px; line-height: 1.6; }
        .popup-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .popup-label { font-weight: bold; color: #555; margin-right: 10px; }
    </style>
</head>
<body>
    <div id="loadingCard" class="loading-card">
        <div class="spinner"></div>
        <p>Učitavanje vozila...</p>
    </div>
    <div class="search-box">
        <input type="text" id="searchInput" placeholder="Pretraži vozilo (garažni broj)..." />
        <div id="searchResults"></div>
    </div>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="/app.min.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            initApp();
        });
    </script>
</body>
</html>\`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}`;

fs.writeFileSync('src/handlers/sve.js', sveHandler);
console.log('✓ Created src/handlers/sve.js');

// linije.js would be similar - create if needed

// =====================================================
// STEP 3: Bundle static assets
// =====================================================
console.log('\n📦 Bundling static assets...\n');

const staticFiles = [
  'public/index.html',
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
import { handleVehicles } from './handlers/vehicles.js';
import { handleUpdateSheet } from './handlers/update-sheet.js';
import { handleUpdateDeparturesSheet } from './handlers/update-departures-sheet.js';
import { handleStations } from './handlers/stations.js';
import { handleConfig } from './handlers/config.js';
import { handleSve } from './handlers/sve.js';

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

      // API routes
      if (path === '/api/vehicles') {
        response = await handleVehicles(request, env);
      }
      else if (path === '/api/update-sheet') {
        response = await handleUpdateSheet(request, env);
      }
      else if (path === '/api/update-departures-sheet') {
        response = await handleUpdateDeparturesSheet(request, env);
      }
      else if (path === '/api/stations') {
        response = await handleStations(request, env);
      }
      else if (path === '/api/config') {
        response = await handleConfig(request, env);
      }
      else if (path === '/api/sve') {
        response = await handleSve(request, env);
      }
      // Shapes data files (proxy from Vercel)
      else if (path === '/data/shapes.txt' || path === '/data/shapes_gradske.txt') {
        const filename = path.split('/').pop();
        const vercelUrl = \`https://mapabus.vercel.app/data/\${filename}\`;
        
        try {
          const dataResponse = await fetch(vercelUrl);
          if (dataResponse.ok) {
            const text = await dataResponse.text();
            response = new Response(text, {
              headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'public, max-age=3600'
              }
            });
          } else {
            response = new Response('Shapes file not found', { status: 404 });
          }
        } catch (error) {
          response = new Response('Error fetching shapes: ' + error.message, { status: 500 });
        }
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
  }
};

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
}\`;

fs.writeFileSync('src/index.js', indexContent);
console.log('✓ Created src/index.js');

// =====================================================
// DONE
// =====================================================
console.log('\\n✅ Build complete!\\n');
console.log('📝 Next steps:');
console.log('  1. Set secrets:');
console.log('     wrangler secret put GOOGLE_SHEETS_CLIENT_EMAIL');
console.log('     wrangler secret put GOOGLE_SHEETS_PRIVATE_KEY');
console.log('     wrangler secret put GOOGLE_SPREADSHEET_ID');
console.log('  2. Deploy:');
console.log('     wrangler deploy');
