// src/handlers/get-sheet-data.js
import { getSheetsClient } from '../utils/sheets-client.js';

export async function handleGetSheetData(request, env) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const sheets = await getSheetsClient(env);
    const spreadsheetId = env.GOOGLE_SPREADSHEET_ID;
    const sheetName = 'Baza';

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:F`,
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        vehicles: [],
        count: 0,
        sheetName: sheetName
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const vehicles = rows.map(row => ({
      vozilo: row[0] || '',
      linija: row[1] || '',
      polazak: row[2] || '',
      smer: row[3] || '',
      timestamp: row[4] || '',
      datum: row[5] || ''
    }));

    return new Response(JSON.stringify({ 
      success: true, 
      vehicles: vehicles,
      count: vehicles.length,
      lastUpdate: vehicles[vehicles.length - 1]?.timestamp || null,
      sheetName: sheetName
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Google Sheets error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to read sheet',
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
