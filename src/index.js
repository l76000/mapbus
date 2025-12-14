// src/index.js - Glavni Cloudflare Worker
// Sve API rute iz api/ foldera prebačene ovde

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
      
      // AUTH API
      if (path === '/api/auth') {
        const { handleAuth } = await import('./handlers/auth');
        response = await handleAuth(request, env);
      }
      
      // VEHICLES API
      else if (path === '/api/vehicles') {
        const { handleVehicles } = await import('./handlers/vehicles');
        response = await handleVehicles(request, env);
      }
      
      // SHEETS APIs
      else if (path === '/api/get-sheet-data') {
        const { handleGetSheetData } = await import('./handlers/sheets');
        response = await handleGetSheetData(request, env);
      }
      else if (path === '/api/update-sheet') {
        const { handleUpdateSheet } = await import('./handlers/sheets');
        response = await handleUpdateSheet(request, env);
      }
      else if (path === '/api/update-departures-sheet') {
        const { handleUpdateDeparturesSheet } = await import('./handlers/sheets');
        response = await handleUpdateDeparturesSheet(request, env);
      }
      else if (path === '/api/reset-departures') {
        const { handleResetDepartures } = await import('./handlers/sheets');
        response = await handleResetDepartures(request, env);
      }
      
      // HOURLY CHECK (za cron)
      else if (path === '/api/hourly-check') {
        const { handleHourlyCheck } = await import('./handlers/hourly');
        response = await handleHourlyCheck(request, env);
      }
      
      // CONFIG API
      else if (path === '/api/config') {
        response = new Response(JSON.stringify({
          refreshInterval: 60000,
          mapCenter: [44.8125, 20.4612],
          mapZoom: 13,
          colors: [
            '#e74c3c', '#3498db', '#9b59b6', '#2ecc71', '#f1c40f',
            '#e67e22', '#1abc9c', '#34495e', '#d35400', '#c0392b',
            '#2980b9', '#8e44ad', '#27ae60', '#f39c12', '#16a085'
          ]
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // STATIONS API
      else if (path === '/api/stations') {
        const { handleStations } = await import('./handlers/stations');
        response = await handleStations(request, env);
      }
      
      // SHAPES API
      else if (path === '/api/shapes.txt' || path === '/api/shapes_gradske.txt') {
        const { handleShapes } = await import('./handlers/shapes');
        response = await handleShapes(request, env, path);
      }
      
      // SPECIAL PAGES (HTML servers)
      else if (path === '/api/sve') {
        response = await serveHTMLPage('sve.html');
      }
      else if (path === '/api/linije') {
        response = await serveHTMLPage('linije.html');
      }
      else if (path === '/api/baza.html') {
        response = await serveHTMLPage('baza-dashboard.html');
      }
      
      // ==================== STATIC FILES ====================
      else {
        response = await serveStaticFile(path, env);
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

  // Cron trigger za hourly-check
  async scheduled(event, env, ctx) {
    console.log('Cron triggered at:', new Date().toISOString());
    
    try {
      const { handleHourlyCheck } = await import('./handlers/hourly');
      
      // Kreiraj mock request
      const request = new Request('https://worker/api/hourly-check', {
        method: 'GET',
        headers: { 'X-Cron-Trigger': 'true' }
      });
      
      await handleHourlyCheck(request, env);
      console.log('Cron completed successfully');
    } catch (error) {
      console.error('Cron error:', error);
    }
  }
};

// Serve HTML pages
async function serveHTMLPage(filename) {
  // Učitaj HTML iz bundled assets
  const html = STATIC_ASSETS[filename];
  
  if (!html) {
    return new Response('Page not found', { status: 404 });
  }

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// Serve static files
async function serveStaticFile(path, env) {
  // Root path
  if (path === '/' || path === '') {
    path = '/index.html';
  }

  // Remove leading slash
  const filename = path.substring(1);
  
  // Get from bundled assets
  const content = STATIC_ASSETS[filename];
  
  if (!content) {
    return new Response('Not Found', { status: 404 });
  }

  // Determine content type
  const contentType = getContentType(filename);

  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

// Get content type
function getContentType(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  const types = {
    'html': 'text/html; charset=utf-8',
    'js': 'application/javascript; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'svg': 'image/svg+xml',
    'txt': 'text/plain; charset=utf-8',
    'ico': 'image/x-icon'
  };
  return types[ext] || 'application/octet-stream';
}

// Static assets storage (bundled with worker)
const STATIC_ASSETS = {}; // Biće popunjeno tokom build-a
