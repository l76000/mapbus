// build-cloudflare.js - Complete Cloudflare Workers Build
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Building MapaBus for Cloudflare Workers...\n');

// Ensure directories exist
['cf-src', 'cf-src/handlers', 'cf-src/utils'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ==================== UTILITIES ====================
console.log('🔧 Creating utilities...\n');

fs.writeFileSync('cf-src/utils/sheets-client.js', `// Sheets client for Workers
export async function getSheetsClient(env) {
  const accessToken = await getAccessToken(env);
  return {
    spreadsheets: {
      get: async (params) => {
        const res = await fetch(\`https://sheets.googleapis.com/v4/spreadsheets/\${params.spreadsheetId}\`, {
          headers: { 'Authorization': \`Bearer \${accessToken}\` }
        });
        return { data: await res.json() };
      },
      values: {
        get: async (params) => {
          const res = await fetch(\`https://sheets.googleapis.com/v4/spreadsheets/\${params.spreadsheetId}/values/\${params.range}\`, {
            headers: { 'Authorization': \`Bearer \${accessToken}\` }
          });
          return { data: await res.json() };
        },
        update: async (params) => {
          const res = await fetch(\`https://sheets.googleapis.com/v4/spreadsheets/\${params.spreadsheetId}/values/\${params.range}?valueInputOption=\${params.valueInputOption || 'RAW'}\`, {
            method: 'PUT',
            headers: { 'Authorization': \`Bearer \${accessToken}\`, 'Content-Type': 'application/json' },
            body: JSON.stringify(params.resource)
          });
          return { data: await res.json() };
        },
        append: async (params) => {
          const res = await fetch(\`https://sheets.googleapis.com/v4/spreadsheets/\${params.spreadsheetId}/values/\${params.range}:append?valueInputOption=\${params.valueInputOption || 'RAW'}\`, {
            method: 'POST',
            headers: { 'Authorization': \`Bearer \${accessToken}\`, 'Content-Type': 'application/json' },
            body: JSON.stringify(params.resource)
          });
          return { data: await res.json() };
        },
        clear: async (params) => {
          const res = await fetch(\`https://sheets.googleapis.com/v4/spreadsheets/\${params.spreadsheetId}/values/\${params.range}:clear\`, {
            method: 'POST',
            headers: { 'Authorization': \`Bearer \${accessToken}\`, 'Content-Type': 'application/json' }
          });
          return { data: await res.json() };
        }
      },
      batchUpdate: async (params) => {
        const res = await fetch(\`https://sheets.googleapis.com/v4/spreadsheets/\${params.spreadsheetId}:batchUpdate\`, {
          method: 'POST',
          headers: { 'Authorization': \`Bearer \${accessToken}\`, 'Content-Type': 'application/json' },
          body: JSON.stringify(params.resource)
        });
        return { data: await res.json() };
      }
    }
  };
}

async function getAccessToken(env) {
  const jwt = await signJWT(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: env.GOOGLE_SHEETS_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    },
    env.GOOGLE_SHEETS_PRIVATE_KEY
  );

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const data = await res.json();
  return data.access_token;
}

async function signJWT(header, payload, privateKeyPem) {
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const data = \`\${headerB64}.\${payloadB64}\`;

  const pemContents = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\\\n/g, '')
    .replace(/\\s/g, '');
  
  const binaryDer = base64Decode(pemContents);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    new TextEncoder().encode(data)
  );

  return \`\${data}.\${base64UrlEncode(signature)}\`;
}

function base64UrlEncode(data) {
  if (typeof data === 'string') data = new TextEncoder().encode(data);
  else if (data instanceof ArrayBuffer) data = new Uint8Array(data);
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
}

function base64Decode(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}`);

console.log('✓ Created sheets-client.js');

// ==================== CONVERT HANDLERS ====================
console.log('\n📁 Converting handlers...\n');

function convertHandler(source, dest, name) {
  if (!fs.existsSync(source)) {
    console.log(`⚠️  Skip ${source}`);
    return;
  }

  let code = fs.readFileSync(source, 'utf8');
  
  // Remove Node imports
  code = code.replace(/import.*from\s+['"]googleapis['"];?\s*/g, '');
  code = code.replace(/import.*from\s+['"]fs['"];?\s*/g, '');
  code = code.replace(/import.*from\s+['"]path['"];?\s*/g, '');
  
  // Add Worker import
  if (!code.includes('sheets-client')) {
    code = `import { getSheetsClient } from '../utils/sheets-client.js';\n\n` + code;
  }
  
  // Replace googleapis usage
  code = code.replace(/const auth = new google\.auth\.GoogleAuth\([^}]+}\s*\);?/gs, '');
  code = code.replace(/const sheets = google\.sheets\([^)]+\);?/g, 'const sheets = await getSheetsClient(env);');
  
  // Convert handler signature
  code = code.replace(/export default async function handler\s*\(\s*req\s*,\s*res\s*\)/g, `export async function ${name}(request, env)`);
  
  // Remove response headers
  code = code.replace(/res\.setHeader\([^)]+\);?\s*/g, '');
  
  // Convert responses
  code = code.replace(/return res\.status\((\d+)\)\.json\(([^)]+)\)/g, 
    'return new Response(JSON.stringify($2), { status: $1, headers: { "Content-Type": "application/json" } })');
  code = code.replace(/res\.status\((\d+)\)\.json\(([^)]+)\)/g, 
    'return new Response(JSON.stringify($2), { status: $1, headers: { "Content-Type": "application/json" } })');
  code = code.replace(/return res\.status\((\d+)\)\.end\(\)/g, 
    'return new Response(null, { status: $1 })');
  
  // Handle request body
  if (code.includes('req.body')) {
    const match = code.match(new RegExp(`export async function ${name}\\s*\\([^)]*\\)\\s*\\{`));
    if (match) {
      code = code.replace(match[0], `${match[0]}\n  const body = request.method === "POST" ? await request.json() : {};`);
    }
    code = code.replace(/req\.body/g, 'body');
  }
  
  // Handle query params
  if (code.includes('req.query')) {
    const match = code.match(new RegExp(`export async function ${name}\\s*\\([^)]*\\)\\s*\\{`));
    if (match) {
      code = code.replace(match[0], `${match[0]}\n  const url = new URL(request.url);\n  const query = Object.fromEntries(url.searchParams);`);
    }
    code = code.replace(/req\.query/g, 'query');
  }
  
  code = code.replace(/req\.method/g, 'request.method');
  code = code.replace(/process\.env\./g, 'env.');
  
  fs.writeFileSync(dest, code);
  console.log(`✓ ${source} → ${dest}`);
}

convertHandler('api/update-sheet.js', 'cf-src/handlers/update-sheet.js', 'handleUpdateSheet');
convertHandler('api/update-departures-sheet.js', 'cf-src/handlers/update-departures-sheet.js', 'handleUpdateDeparturesSheet');

// Other handlers...
const handlers = {
  'stations.js': `export async function handleStations(request, env) {
  try {
    const res = await fetch('https://mapabus.vercel.app/all.json');
    const stations = await res.json();
    const map = {};
    stations.forEach(s => {
      if (s.id && s.name && s.coords) {
        map[s.id] = { name: s.name, coords: [parseFloat(s.coords[0]), parseFloat(s.coords[1])] };
      }
    });
    return new Response(JSON.stringify(map), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}`,
  'vehicles.js': `export async function handleVehicles(request, env) {
  const url = new URL(request.url);
  const lines = url.searchParams.get('lines')?.split(',').map(l => l.trim());
  
  try {
    const res = await fetch(\`https://rt.buslogic.baguette.pirnet.si/beograd/rt.json?_=\${Date.now()}\`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' }
    });
    const data = await res.json();
    
    const vehicles = [];
    const tripUpdates = [];
    
    data.entity?.forEach(e => {
      if (e.vehicle?.position) {
        const v = e.vehicle;
        const routeId = parseInt(v.trip.routeId, 10).toString();
        if (lines && !lines.includes(routeId)) return;
        if (!v.vehicle.label || (v.vehicle.label.startsWith('P') && v.vehicle.label.length < 6)) return;
        
        vehicles.push({
          id: v.vehicle.id,
          label: v.vehicle.label,
          routeId: v.trip.routeId,
          startTime: v.trip.startTime,
          lat: parseFloat(v.position.latitude),
          lon: parseFloat(v.position.longitude)
        });
      }
      
      if (e.tripUpdate?.vehicle?.id && e.tripUpdate.stopTimeUpdate?.length > 0) {
        tripUpdates.push({
          vehicleId: e.tripUpdate.vehicle.id,
          destination: e.tripUpdate.stopTimeUpdate[e.tripUpdate.stopTimeUpdate.length - 1].stopId
        });
      }
    });
    
    return new Response(JSON.stringify({ vehicles, tripUpdates, timestamp: Date.now() }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}`,
  'hourly.js': `import { getSheetsClient } from '../utils/sheets-client.js';

export async function handleHourlyCheck(request, env) {
  try {
    const sheets = await getSheetsClient(env);
    const id = env.GOOGLE_SPREADSHEET_ID;
    const now = new Date();
    const bg = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Belgrade' }));
    const hour = bg.getHours();
    
    if (hour === 0) {
      const polasci = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'Polasci!A:J' });
      if (polasci.data.values?.length > 0) {
        await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: 'Juce!A:J' });
        await sheets.spreadsheets.values.update({ spreadsheetId: id, range: 'Juce!A1', valueInputOption: 'RAW', resource: { values: polasci.data.values } });
      }
      await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: 'Polasci!A:J' });
      await sheets.spreadsheets.values.update({ spreadsheetId: id, range: 'Polasci!A1', valueInputOption: 'RAW', resource: { values: [['Reset at ' + bg.toLocaleString('sr-RS')]] } });
    }
    
    return new Response(JSON.stringify({ success: true, time: bg.toLocaleString('sr-RS'), action: hour === 0 ? 'reset' : 'check' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}`
};

Object.entries(handlers).forEach(([file, code]) => {
  fs.writeFileSync(`cf-src/handlers/${file}`, code);
  console.log(`✓ Created ${file}`);
});

// ==================== BUNDLE ASSETS ====================
console.log('\n📦 Bundling assets...\n');

const assets = {};
['public/index.html', 'public/app.min.js', 'public/route-mapping.json'].forEach(file => {
  if (fs.existsSync(file)) {
    assets[path.basename(file)] = fs.readFileSync(file, 'utf8');
    console.log(`✓ ${file}`);
  }
});

// Extract SVE HTML
if (fs.existsSync('api/sve.js')) {
  const sve = fs.readFileSync('api/sve.js', 'utf8');
  const match = sve.match(/const html = `([^`]+)`/s);
  if (match) {
    assets['sve.html'] = match[1];
    console.log('✓ sve.html');
  }
}

fs.writeFileSync('cf-src/assets.js', `export const STATIC_ASSETS = ${JSON.stringify(assets, null, 2)};`);
console.log('\n✓ assets.js');

// ==================== MAIN WORKER ====================
console.log('\n🔗 Creating main worker...\n');

fs.writeFileSync('cf-src/index.js', `import { STATIC_ASSETS } from './assets.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      let res;

      if (path === '/api/vehicles') {
        const { handleVehicles } = await import('./handlers/vehicles.js');
        res = await handleVehicles(request, env);
      }
      else if (path === '/api/update-sheet') {
        const { handleUpdateSheet } = await import('./handlers/update-sheet.js');
        res = await handleUpdateSheet(request, env);
      }
      else if (path === '/api/update-departures-sheet') {
        const { handleUpdateDeparturesSheet } = await import('./handlers/update-departures-sheet.js');
        res = await handleUpdateDeparturesSheet(request, env);
      }
      else if (path === '/api/hourly-check') {
        const { handleHourlyCheck } = await import('./handlers/hourly.js');
        res = await handleHourlyCheck(request, env);
      }
      else if (path === '/api/stations') {
        const { handleStations } = await import('./handlers/stations.js');
        res = await handleStations(request, env);
      }
      else if (path === '/api/config') {
        res = new Response(JSON.stringify({
          refreshInterval: 60000,
          mapCenter: [44.8125, 20.4612],
          mapZoom: 13,
          colors: ['#e74c3c', '#3498db', '#9b59b6', '#2ecc71', '#f1c40f', '#e67e22', '#1abc9c', '#34495e', '#d35400', '#c0392b', '#2980b9', '#8e44ad', '#27ae60', '#f39c12', '#16a085']
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      else if (path.startsWith('/data/shapes')) {
        const file = path.split('/').pop();
        const data = await fetch(\`https://mapabus.vercel.app/data/\${file}\`);
        res = new Response(await data.text(), { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=3600' } });
      }
      else if (path === '/api/sve') {
        res = new Response(STATIC_ASSETS['sve.html'], { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      else {
        const file = path === '/' ? 'index.html' : path.substring(1);
        const content = STATIC_ASSETS[file];
        if (!content) return new Response('Not Found', { status: 404, headers: cors });
        
        const types = { html: 'text/html', js: 'application/javascript', css: 'text/css', json: 'application/json' };
        const ext = file.split('.').pop();
        res = new Response(content, { headers: { 'Content-Type': types[ext] || 'text/plain', 'Cache-Control': 'public, max-age=3600' } });
      }

      const headers = new Headers(res.headers);
      Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
      return new Response(res.body, { status: res.status, headers });
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  },

  async scheduled(event, env, ctx) {
    const { handleHourlyCheck } = await import('./handlers/hourly.js');
    const req = new Request('https://worker/hourly', { headers: { 'X-Cron': 'true' } });
    await handleHourlyCheck(req, env);
  }
};`);

console.log('✓ index.js');

// ==================== WRANGLER CONFIG ====================
fs.writeFileSync('cf-wrangler.toml', `name = "mapbus"
main = "cf-src/index.js"
compatibility_date = "2024-01-01"

[triggers]
crons = ["0 * * * *"]

# Set secrets: wrangler secret put GOOGLE_SHEETS_CLIENT_EMAIL
# wrangler secret put GOOGLE_SHEETS_PRIVATE_KEY  
# wrangler secret put GOOGLE_SPREADSHEET_ID`);

console.log('✓ cf-wrangler.toml');

console.log('\n✅ Build complete!\n');
console.log('📝 Deploy steps:');
console.log('1. wrangler secret put GOOGLE_SHEETS_CLIENT_EMAIL');
console.log('2. wrangler secret put GOOGLE_SHEETS_PRIVATE_KEY');
console.log('3. wrangler secret put GOOGLE_SPREADSHEET_ID');
console.log('4. wrangler deploy --config cf-wrangler.toml');
