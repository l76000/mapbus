import { google } from 'googleapis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('=== Reading Juce (Yesterday) Sheet ===');
  
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    const sheetName = 'Juce';

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

    return res.status(200).json({
      success: true,
      routes: routes,
      totalRoutes: routes.length,
      totalRows: rows.length
    });

  } catch (error) {
    console.error('Read error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
