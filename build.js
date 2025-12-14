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
  'api/auth.js': 'src/handlers/auth.js',
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
  
  // Replace export default function handler
  content = content.replace(
    /export default async function handler\s*\(/g,
    `export async function ${handlerName}(`
  );
  
  // Also handle non-async handlers
  content = content.replace(
    /export default function handler\s*\(/g,
    `export function ${handlerName}(`
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
  
  // Parse query params properly - inject inside function body only
  if (content.includes('request.query')) {
    // Find the function body and inject query parsing there
    content = content.replace(
      /(export (?:async )?function handle[A-Za-z]+\([^)]*\)\s*{)/,
      '$1\n  const url = new URL(request.url);\n  const query = Object.fromEntries(url.searchParams);'
    );
    content = content.replace(/request\.query/g, 'query');
  }
  
  // Replace res.status().json() - FIXED ORDER
  content = content.replace(
    /return\s+res\.status\s*\(\s*(\d+)\s*\)\.json\s*\(\s*({[^}]+})\s*\)/g,
    'return new Response(JSON.stringify($2), { status: $1, headers: { "Content-Type": "application/json" } })'
  );
  
  content = content.replace(
    /(?<!return\s+)res\.status\s*\(\s*(\d+)\s*\)\.json\s*\(\s*({[^}]+})\s*\)/g,
    'return new Response(JSON.stringify($2), { status: $1, headers: { "Content-Type": "application/json" } })'
  );
  
  // Replace res.setHeader
  content = content.replace(/res\.setHeader\s*\([^)]+\)\s*;?\s*/g, '');
  
  // Replace res.status().send() - FIXED: Handle with and without return
  content = content.replace(
    /return\s+res\.status\s*\(\s*(\d+)\s*\)\.send\s*\(\s*([^)]+)\s*\)/g,
    'return new Response($2, { status: $1, headers: { "Content-Type": "text/plain; charset=utf-8" } })'
  );
  
  content = content.replace(
    /(?<!return\s+)res\.status\s*\(\s*(\d+)\s*\)\.send\s*\(\s*([^)]+)\s*\)/g,
    'return new Response($2, { status: $1, headers: { "Content-Type": "text/plain; charset=utf-8" } })'
  );
  
  // Replace res.send
  content = content.replace(
    /res\.send\s*\(\s*([^)]+)\s*\)/g,
    'return new Response($1, { headers: { "Content-Type": "text/html; charset=utf-8" } })'
  );
  
  // Replace process.env with env
  content = content.replace(/process\.env\./g, 'env.');
  
  // Add Google Sheets client import
  if (content.includes('google.sheets') || content.includes('sheets.spreadsheets')) {
    content = `import { getSheetsClient } from '../utils/sheets-client.js';\n\n` + content;
    content = content.replace(/const sheets = google\.sheets\([^)]+\);?/g, 'const sheets = await getSheetsClient(env);');
  }
  
  // Add crypto utilities for auth handler
  if (source.includes('auth.js') && content.includes('crypto.createHash')) {
    content = `import { hashPassword, verifyPassword } from '../utils/crypto-utils.js';\n\n` + content;
    // Remove the local hash/verify functions since we'll import them
    content = content.replace(/function hashPassword\(password\) {[^}]+}/g, '');
    content = content.replace(/function verifyPassword\(password, hashedPassword\) {[^}]+}/g, '');
    // Remove calls to crypto.createHash
    content = content.replace(/crypto\.createHash\([^)]+\)[^;]+;/g, '');
  }
  
  // Replace Google Auth setup in auth.js
  if (source.includes('auth.js')) {
    content = content.replace(/const auth = new google\.auth\.GoogleAuth\([^;]+\);/g, '');
    content = content.replace(/const sheets = google\.sheets\([^)]+\);?/g, '');
    content = content.replace(/const SPREADSHEET_ID = process\.env\.GOOGLE_SPREADSHEET_ID;?/g, '');
    content = content.replace(/const USERS_SHEET = ['"]Users['"];?/g, '');
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

// Create fallback handlers for stations and config
console.log('✓ Creating fallback handlers...');

// stations.js fallback
const stationsHandler = `// src/handlers/stations.js
import { fetchDataFile } from '../utils/data-loader.js';

export async function handleStations(request, env) {
  try {
    // Fetch stops files
    const [stopsText, stopsGradskeText] = await Promise.all([
      fetchDataFile('api/stops.txt', env),
      fetchDataFile('api/stops_gradske.txt', env)
    ]);

    const stationsMap = {};

    // Parse stops.txt
    parseStopsCSV(stopsText, stationsMap);
    parseStopsCSV(stopsGradskeText, stationsMap);

    return new Response(JSON.stringify(stationsMap), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Stations error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function parseStopsCSV(csvText, stationsMap) {
  const lines = csvText.split('\\n');
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(',');
    if (parts.length < 5) continue;
    
    const stopId = parts[0];
    const stopName = parts[2] || parts[1];
    const lat = parseFloat(parts[4]);
    const lon = parseFloat(parts[5]);
    
    if (!isNaN(lat) && !isNaN(lon)) {
      stationsMap[stopId] = {
        name: stopName,
        coords: [lat, lon]
      };
    }
  }
}`;

fs.writeFileSync('src/handlers/stations.js', stationsHandler);
console.log('✓ Created src/handlers/stations.js');

// config.js fallback
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

// crypto-utils.js for auth
const cryptoUtilsContent = `// src/utils/crypto-utils.js
// Crypto utilities for Cloudflare Workers

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
      if (path === '/api/vehicles') {
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
