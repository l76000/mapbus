// build.js - Optimized: Only bundle SMALL files, exclude large GTFS data
const fs = require('fs');
const path = require('path');

console.log('🚀 Building MapaBus for Cloudflare Workers...\n');

// 1. Convert API handlers
console.log('📁 Converting API routes...');

const apiFiles = {
  'api/auth.js': 'src/handlers/auth.js',
  'api/vehicles.js': 'src/handlers/vehicles.js',
  'api/get-sheet-data.js': 'src/handlers/get-sheet-data.js',
  'api/update-sheet.js': 'src/handlers/update-sheet.js',
  'api/update-departures-sheet.js': 'src/handlers/update-departures-sheet.js',
  'api/reset-departures.js': 'src/handlers/reset-departures.js',
  'api/hourly-check.js': 'src/handlers/hourly-check.js',
  'api/stations.js': 'src/handlers/stations.js',
  'api/shapes.js': 'src/handlers/shapes.js',
  'api/config.js': 'src/handlers/config.js',
  'api/sve.js': 'src/handlers/sve.js',
  'api/linije.js': 'src/linije.js',
};

if (dest === 'src/handlers/auth.js') {
    console.log(`⏩ Skipped ${source} (using pre-built version)`);
    return;
  }
  
if (!fs.existsSync('src')) fs.mkdirSync('src');
if (!fs.existsSync('src/handlers')) fs.mkdirSync('src/handlers');

Object.entries(apiFiles).forEach(([source, dest]) => {
  if (fs.existsSync(source)) {
    let content = fs.readFileSync(source, 'utf8');
    
    // Remove Node.js imports
    content = content.replace(/import\s+crypto\s+from\s+['"]crypto['"]\s*;?\s*/g, '');
    content = content.replace(/import\s+fs\s+from\s+['"]fs['"]\s*;?\s*/g, '');
    content = content.replace(/import\s+path\s+from\s+['"]path['"]\s*;?\s*/g, '');
    
    // Generate handler name
    const handlerName = path.basename(dest, '.js')
      .split('-')
      .map((word, i) => i === 0 ? 'handle' + word.charAt(0).toUpperCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
    
    content = content.replace(
      /export default async function handler/g,
      `export async function ${handlerName}`
    );
    
    // Replace req/res with request/Response
    content = content.replace(/\breq\.method\b/g, 'request.method');
    content = content.replace(/\breq\.body\b/g, 'request.body');
    content = content.replace(/\breq\.query\b/g, 'request.query');
    content = content.replace(/\breq\.headers\b/g, 'request.headers');
    
    content = content.replace(
      /return\s+res\.status\s*\(\s*(\d+)\s*\)\.json\s*\(\s*({[^}]+})\s*\)/g,
      'return new Response(JSON.stringify($2), { status: $1, headers: { "Content-Type": "application/json" } })'
    );
    
    content = content.replace(
      /res\.status\s*\(\s*(\d+)\s*\)\.json\s*\(\s*({[^}]+})\s*\)/g,
      'return new Response(JSON.stringify($2), { status: $1, headers: { "Content-Type": "application/json" } })'
    );
    
    content = content.replace(/process\.env\./g, 'env.');
    
    // Replace fs.readFileSync with KV fetch
    if (content.includes('fs.readFileSync')) {
      content = `import { fetchDataFile } from '../utils/data-loader.js';\n` + content;
      content = content.replace(
        /fs\.readFileSync\(['"]([^'"]+)['"]\)\.toString\(\)/g,
        'await fetchDataFile("$1", env)'
      );
    }
    
    // Add Google Sheets client import
    if (content.includes('google.sheets')) {
      content = `import { getSheetsClient } from '../utils/sheets-client.js';\n` + content;
      content = content.replace(/const sheets = google\.sheets\([^)]+\);/g, 'const sheets = await getSheetsClient(env);');
      content = content.replace(/import { google } from 'googleapis';/g, '');
    }
    
    fs.writeFileSync(dest, content);
    console.log(`✓ Converted ${source} → ${dest}`);
  } else {
    console.log(`⚠️  Skipped ${source} (not found)`);
  }
});

// 2. Bundle ONLY small static assets (HTML, JS, small JSON)
console.log('\n📦 Bundling small static assets...');

const staticFiles = [
  'public/index.html',
  'public/login.html',
  'public/admin.html',
  'public/baza.html',
  'public/polasci.html',
  'public/juce.html',
  'public/panel.html',
  'public/rv.html',
  'public/493.html',
  'public/bbr.html',
  'public/lazarevac.html',
  'public/300sumice.html',
  'public/trosarina.html',
  'public/auth-check.js',
  'public/app.min.js',
  'public/route-mapping.json',
  'api/trasa.html'
  // NOTE: Large files (shapes.txt, stops.txt, etc.) will be fetched from external URL
];

const assets = {};

staticFiles.forEach(file => {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    const filename = path.basename(file);
    assets[filename] = content;
    console.log(`✓ Added ${filename}`);
  } else {
    console.log(`⚠️  Skipped ${file} (not found)`);
  }
});

// 3. Generate assets.js
console.log('\n📝 Generating assets...');

const assetsContent = `// Auto-generated static assets
export const STATIC_ASSETS = ${JSON.stringify(assets, null, 2)};`;

fs.writeFileSync('src/assets.js', assetsContent);
console.log('✓ Generated src/assets.js');

// 4. Create data-loader utility
console.log('\n🔧 Creating utilities...');

// Ensure utils directory exists
if (!fs.existsSync('src/utils')) fs.mkdirSync('src/utils', { recursive: true });

const dataLoaderContent = `// src/utils/data-loader.js
// Loads large data files from external source (Vercel deployment or R2)

const DATA_BASE_URL = 'https://mapabus.vercel.app';

// Map local paths to remote URLs
const FILE_MAP = {
  'api/shapes.txt': '/api/shapes.txt',
  'api/shapes_gradske.txt': '/api/shapes_gradske.txt',
  'api/stop_times.txt': '/api/stop_times.txt',
  'api/stops.txt': '/api/stops.txt',
  'api/stops_gradske.txt': '/api/stops_gradske.txt',
  'api/trips.txt': '/api/trips.txt',
  'api/trips_gradske.txt': '/api/trips_gradske.txt',
  'api/lista/lista.txt': '/api/lista/lista.txt',
  'api/all.json': '/api/all.json',
  'public/alll.json': '/alll.json',
  'public/all.json': '/all.json',
  'public/data/shapes.txt': '/data/shapes.txt',
  'public/data/shapes_gradske.txt': '/data/shapes_gradske.txt'
};

export async function fetchDataFile(filePath, env) {
  // Check if we should use KV cache
  if (env.DATA_CACHE) {
    try {
      const cached = await env.DATA_CACHE.get(filePath);
      if (cached) {
        console.log(\`✓ Cache hit: \${filePath}\`);
        return cached;
      }
    } catch (e) {
      console.warn('KV cache error:', e);
    }
  }

  // Fetch from remote
  const remotePath = FILE_MAP[filePath] || '/' + filePath;
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

// 5. Create sheets-client.js (same as before)
const sheetsClientContent = `// src/utils/sheets-client.js
export async function getSheetsClient(env) {
  const accessToken = await getAccessToken(env);
  
  return {
    spreadsheets: {
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

// Write both files
fs.writeFileSync('src/utils/data-loader.js', dataLoaderContent);
console.log('✓ Created src/utils/data-loader.js');

fs.writeFileSync('src/utils/sheets-client.js', sheetsClientContent);
console.log('✓ Created src/utils/sheets-client.js');

// 6. Update index.js
console.log('\n🔗 Updating index.js...');

let indexContent = fs.readFileSync('src/index.js', 'utf8');
indexContent = indexContent.replace(
  'const STATIC_ASSETS = {}; // Biće popunjeno tokom build-a',
  "import { STATIC_ASSETS } from './assets.js';"
);
fs.writeFileSync('src/index.js', indexContent);
console.log('✓ Updated src/index.js');

console.log('\n✅ Build complete!');
console.log('\n📝 Strategy:');
console.log('  - Small files: bundled in Worker');
console.log('  - Large GTFS data: fetched from Vercel (cached in KV)');
console.log('\n🔑 Set secrets:');
console.log('  wrangler secret put GOOGLE_SHEETS_CLIENT_EMAIL');
console.log('  wrangler secret put GOOGLE_SHEETS_PRIVATE_KEY');
console.log('  wrangler secret put GOOGLE_SPREADSHEET_ID');
console.log('\n🚀 Deploy: wrangler deploy');
