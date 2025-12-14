// build.js - Automatski konvertuje Vercel projekat u Cloudflare Worker
const fs = require('fs');
const path = require('path');

console.log('🚀 Building MapaBus for Cloudflare Workers...\n');

// 1. Kopiraj sve handlere iz api/ u src/handlers/
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
  'parse-routes.js': 'src/handlers/config.js'
};

// Kreiraj src/handlers direktorijum
if (!fs.existsSync('src')) fs.mkdirSync('src');
if (!fs.existsSync('src/handlers')) fs.mkdirSync('src/handlers');

Object.entries(apiFiles).forEach(([source, dest]) => {
  if (fs.existsSync(source)) {
    let content = fs.readFileSync(source, 'utf8');
    
    // Transformacije:
    // 1. Zameni "export default async function handler" sa "export async function handleX"
    const handlerName = path.basename(dest, '.js')
      .split('-')
      .map((word, i) => i === 0 ? 'handle' + word.charAt(0).toUpperCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
    
    content = content.replace(
      /export default async function handler/g,
      `export async function ${handlerName}`
    );
    
    // 2. Zameni req.method sa request.method
    content = content.replace(/\breq\.method\b/g, 'request.method');
    content = content.replace(/\breq\.body\b/g, 'request.body');
    content = content.replace(/\breq\.query\b/g, 'request.query');
    content = content.replace(/\breq\.headers\b/g, 'request.headers');
    
    // 3. Zameni res.status().json() sa return new Response(JSON.stringify())
    content = content.replace(
      /res\.status\((\d+)\)\.json\(([^)]+)\)/g,
      'return new Response(JSON.stringify($2), { status: $1, headers: { "Content-Type": "application/json" } })'
    );
    
    // 4. Zameni process.env sa env
    content = content.replace(/process\.env\./g, 'env.');
    
    // 5. Dodaj import za Google Sheets client ako koristi
    if (content.includes('google.sheets')) {
      content = `import { getSheetsClient } from '../utils/sheets-client';\n\n` + content;
      content = content.replace(/const sheets = google\.sheets\([^)]+\);/g, 'const sheets = await getSheetsClient(env);');
      content = content.replace(/import { google } from 'googleapis';/g, '');
    }
    
    fs.writeFileSync(dest, content);
    console.log(`✓ Converted ${source} → ${dest}`);
  }
});

// 2. Bundle static assets
console.log('\n📦 Bundling static assets...');

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
  'public/all.json',
  'public/data/shapes.txt',
  'public/data/shapes_gradske.txt',
  'api/stop_times.txt',
  'api/stops.txt',
  'api/stops_gradske.txt',
  'api/trips.txt',
  'api/trips_gradske.txt',
  'api/lista/lista.txt',
  'api/all.json',
  'public/all.json.txt',
  'api/trasa.html'
];

const assets = {};

staticFiles.forEach(file => {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    const filename = path.basename(file);
    assets[filename] = content;
    console.log(`✓ Added ${filename}`);
  } else {
    console.log(`⚠ Missing ${file}`);
  }
});

// 3. Generiši assets.js
console.log('\n📝 Generating assets...');

const assetsContent = `// Auto-generated static assets
export const STATIC_ASSETS = ${JSON.stringify(assets, null, 2)};`;

fs.writeFileSync('src/assets.js', assetsContent);
console.log('✓ Generated src/assets.js');

// 4. Kreiraj utils/sheets-client.js
console.log('\n🔧 Creating utilities...');

const sheetsClientContent = `// src/utils/sheets-client.js
// Google Sheets API client za Cloudflare Workers

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

if (!fs.existsSync('src/utils')) fs.mkdirSync('src/utils');
fs.writeFileSync('src/utils/sheets-client.js', sheetsClientContent);
console.log('✓ Created src/utils/sheets-client.js');

// 5. Ažuriraj index.js da koristi assets
console.log('\n🔗 Updating index.js...');

let indexContent = fs.readFileSync('src/index.js', 'utf8');
indexContent = indexContent.replace(
  'const STATIC_ASSETS = {}; // Biće popunjeno tokom build-a',
  "import { STATIC_ASSETS } from './assets';"
);
fs.writeFileSync('src/index.js', indexContent);
console.log('✓ Updated src/index.js');

console.log('\n✅ Build complete! Run "npm run deploy" to deploy to Cloudflare Workers.');
console.log('\n📝 Next steps:');
console.log('1. wrangler secret put GOOGLE_SHEETS_CLIENT_EMAIL');
console.log('2. wrangler secret put GOOGLE_SHEETS_PRIVATE_KEY');
console.log('3. wrangler secret put GOOGLE_SPREADSHEET_ID');
console.log('4. npm run deploy');
