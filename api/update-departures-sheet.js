// src/handlers/update-departures-sheet.js - FIXED for Cloudflare Workers
import { getSheetsClient } from '../utils/sheets-client.js';

export async function handleUpdateDeparturesSheet(request, env) {
  // CORS headers
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200 });
  }

  // ===== GET za čitanje podataka =====
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const isYesterdayRequest = url.searchParams.get('yesterday') === 'true';
    const sheetName = isYesterdayRequest ? 'Juce' : 'Polasci';
    
    console.log(`=== Reading ${sheetName} Sheet ===`);
    
    try {
      const sheets = await getSheetsClient(env);
      const spreadsheetId = env.GOOGLE_SPREADSHEET_ID;

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:J`,
      });

      const rows = response.data.values || [];
      const routes = [];
      let currentRoute = null;
      let currentDirection = null;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row[0] || row[0].includes('resetovan')) continue;
        
        if (row[0].startsWith('Linija ')) {
          if (currentRoute) routes.push(currentRoute);
          currentRoute = {
            routeName: row[0].replace('Linija ', '').trim(),
            directions: []
          };
        }
        else if (row[0].startsWith('Smer: ') && currentRoute) {
          currentDirection = {
            directionName: row[0].replace('Smer: ', '').trim(),
            departures: []
          };
          currentRoute.directions.push(currentDirection);
        }
        else if (row[0] === 'Polazak') continue;
        else if (currentDirection && row[0] && row[0].match(/^\d{1,2}:\d{2}/)) {
          currentDirection.departures.push({
            startTime: row[0],
            vehicleLabel: row[1] || '',
            timestamp: row[2] || ''
          });
        }
      }

      if (currentRoute) routes.push(currentRoute);

      return new Response(JSON.stringify({
        success: true,
        routes: routes,
        totalRoutes: routes.length,
        sheetName: sheetName
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Read error:', error);
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // ===== POST za ažuriranje - čita iz Baza sheet-a =====
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  console.log('=== Updating Polasci from Baza Sheet ===');
  
  try {
    const sheets = await getSheetsClient(env);
    const spreadsheetId = env.GOOGLE_SPREADSHEET_ID;

    // KORAK 1: Pročitaj podatke iz Baza sheet-a
    console.log('Reading from Baza sheet...');
    const bazaResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Baza!A2:F',
    });

    const bazaRows = bazaResponse.data.values || [];
    
    if (bazaRows.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No data in Baza sheet',
        newDepartures: 0,
        updatedDepartures: 0
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`Found ${bazaRows.length} vehicles in Baza`);

    // Datum danas (u Beogradu)
    const now = new Date();
    const belgradTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Belgrade' }));
    const todayDate = belgradTime.toLocaleDateString('sr-RS', { 
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    
    const currentHour = belgradTime.getHours();
    const currentMinute = belgradTime.getMinutes();

    console.log(`Today's date: ${todayDate}, Current time: ${currentHour}:${currentMinute}`);

    // Grupisanje po linija/smer
    const routeMap = {};
    let processedToday = 0;

    bazaRows.forEach(row => {
      const vozilo = row[0] || '';
      const linija = row[1] || '';
      const polazak = row[2] || '';
      const smer = row[3] || '';
      const timestamp = row[4] || '';
      const datumFull = row[5] || '';

      if (!vozilo || !linija || !polazak || !smer) return;

      const datum = datumFull.split(' ')[0].trim();
      
      // Samo današnja vozila
      if (datum !== todayDate) return;

      // Dodaj u routeMap
      if (!routeMap[linija]) {
        routeMap[linija] = {};
      }
      
      if (!routeMap[linija][smer]) {
        routeMap[linija][smer] = [];
      }
      
      routeMap[linija][smer].push({
        startTime: polazak,
        vehicleLabel: vozilo,
        timestamp: timestamp
      });
      
      processedToday++;
    });

    console.log(`Processed ${processedToday} valid departures`);
    console.log(`Grouped into ${Object.keys(routeMap).length} routes`);

    if (Object.keys(routeMap).length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No vehicles seen today',
        newDepartures: 0,
        updatedDepartures: 0
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // KORAK 2: Proveri/kreiraj Polasci sheet
    const sheetName = 'Polasci';
    let sheetId = null;
    
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === sheetName
    );
    
    if (existingSheet) {
      sheetId = existingSheet.properties.sheetId;
    } else {
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: { rowCount: 60000, columnCount: 10 }
              }
            }
          }]
        }
      });
      sheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
    }

    // KORAK 3: Pročitaj postojeće podatke iz Polasci
    let existingData = [];
    const existingDeparturesMap = new Map();
    const routeStructure = new Map();
    
    try {
      const readResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:J`,
      });
      existingData = readResponse.data.values || [];

      let currentRoute = null;
      let currentDirection = null;
      
      for (let i = 0; i < existingData.length; i++) {
        const row = existingData[i];
        
        if (row[0] && row[0].startsWith('Linija ')) {
          currentRoute = row[0].replace('Linija ', '').trim();
          if (!routeStructure.has(currentRoute)) {
            routeStructure.set(currentRoute, new Map());
          }
        } 
        else if (currentRoute && row[0] && row[0].startsWith('Smer: ')) {
          currentDirection = row[0].replace('Smer: ', '').trim();
          if (!routeStructure.get(currentRoute).has(currentDirection)) {
            routeStructure.get(currentRoute).set(currentDirection, []);
          }
        }
        else if (currentRoute && currentDirection && row[0] && row[0].match(/^\d{1,2}:\d{2}/)) {
          const startTime = row[0];
          const vehicleLabel = row[1] || '';
          const oldTimestamp = row[2] || '';
          
          const key = `${currentRoute}|${currentDirection}|${startTime}|${vehicleLabel}`;
          existingDeparturesMap.set(key, {
            row: i,
            startTime,
            vehicleLabel,
            timestamp: oldTimestamp
          });
          
          routeStructure.get(currentRoute).get(currentDirection).push({
            startTime,
            vehicleLabel,
            timestamp: oldTimestamp
          });
        }
      }
      
      console.log(`Mapped ${existingDeparturesMap.size} existing departures`);
      
    } catch (readError) {
      console.log('No existing data, starting fresh');
    }

    // KORAK 4: Integracija novih podataka
    let updatedCount = 0;
    let newCount = 0;

    for (let route in routeMap) {
      const directions = routeMap[route];
      
      if (!routeStructure.has(route)) {
        routeStructure.set(route, new Map());
      }
      
      for (let direction in directions) {
        if (!routeStructure.get(route).has(direction)) {
          routeStructure.get(route).set(direction, []);
        }
        
        const departures = directions[direction];
        const existingDepartures = routeStructure.get(route).get(direction);
        
        departures.forEach(dep => {
          const key = `${route}|${direction}|${dep.startTime}|${dep.vehicleLabel}`;
          
          if (existingDeparturesMap.has(key)) {
            const index = existingDepartures.findIndex(
              d => d.startTime === dep.startTime && d.vehicleLabel === dep.vehicleLabel
            );
            if (index !== -1) {
              existingDepartures[index].timestamp = dep.timestamp;
              updatedCount++;
            }
          } else {
            existingDepartures.push(dep);
            newCount++;
          }
        });
        
        existingDepartures.sort((a, b) => a.startTime.localeCompare(b.startTime));
      }
    }

    console.log(`Updates: ${updatedCount}, New: ${newCount}`);

    // KORAK 5: Regeneriši sheet
    const allRows = [];
    const formatRequests = [];
    let currentRow = 0;

    const sortedRoutes = Array.from(routeStructure.keys()).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.replace(/\D/g, '')) || 0;
      return numA - numB;
    });

    for (let route of sortedRoutes) {
      allRows.push([`Linija ${route}`, '', '', '', '', '', '', '', '', '']);
      formatRequests.push({
        repeatCell: {
          range: {
            sheetId: sheetId,
            startRowIndex: currentRow,
            endRowIndex: currentRow + 1,
            startColumnIndex: 0,
            endColumnIndex: 10
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.12, green: 0.24, blue: 0.45 },
              textFormat: {
                foregroundColor: { red: 1, green: 1, blue: 1 },
                fontSize: 14,
                bold: true
              }
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)'
        }
      });
      currentRow++;

      const directions = routeStructure.get(route);
      const sortedDirections = Array.from(directions.keys()).sort();

      for (let direction of sortedDirections) {
        allRows.push([`Smer: ${direction}`, '', '', '', '', '', '', '', '', '']);
        formatRequests.push({
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: currentRow,
              endRowIndex: currentRow + 1,
              startColumnIndex: 0,
              endColumnIndex: 10
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.85, green: 0.92, blue: 0.95 },
                textFormat: {
                  foregroundColor: { red: 0.12, green: 0.24, blue: 0.45 },
                  fontSize: 12,
                  bold: true
                }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        });
        currentRow++;

        allRows.push(['Polazak', 'Vozilo', 'Poslednji put viđen', '', '', '', '', '', '', '']);
        formatRequests.push({
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: currentRow,
              endRowIndex: currentRow + 1,
              startColumnIndex: 0,
              endColumnIndex: 3
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
                textFormat: { fontSize: 10, bold: true }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        });
        currentRow++;

        const departures = directions.get(direction);
        departures.forEach(dep => {
          allRows.push([dep.startTime, dep.vehicleLabel, dep.timestamp, '', '', '', '', '', '', '']);
          currentRow++;
        });

        allRows.push(['', '', '', '', '', '', '', '', '', '']);
        currentRow++;
      }

      allRows.push(['', '', '', '', '', '', '', '', '', '']);
      currentRow++;
    }

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:J`
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      resource: { values: allRows }
    });
    console.log(`✓ Wrote ${allRows.length} rows to sheet`);

    if (formatRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests: formatRequests }
      });
      console.log(`✓ Applied ${formatRequests.length} format rules`);
    }

    const timestamp = new Date().toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    console.log('=== Update Complete ===');

    return new Response(JSON.stringify({ 
      success: true, 
      newDepartures: newCount,
      updatedDepartures: updatedCount,
      totalRows: allRows.length,
      timestamp,
      sheetUsed: sheetName
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ 
      error: 'Update failed',
      details: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
