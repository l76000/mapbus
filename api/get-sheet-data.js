import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Google Sheets autentifikacija
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    // Učitaj podatke iz sheet-a
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'BazaVozila!A2:E', // Preskoči header red
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      return res.status(200).json({ 
        success: true, 
        vehicles: [],
        count: 0 
      });
    }

    // Formatiraj podatke
    const vehicles = rows.map(row => ({
      vozilo: row[0] || '',
      linija: row[1] || '',
      polazak: row[2] || '',
      smer: row[3] || '',
      timestamp: row[4] || ''
    }));

    res.status(200).json({ 
      success: true, 
      vehicles: vehicles,
      count: vehicles.length,
      lastUpdate: vehicles[0]?.timestamp || null
    });

  } catch (error) {
    console.error('Google Sheets error:', error);
    res.status(500).json({ 
      error: 'Failed to read sheet',
      details: error.message 
    });
  }
}
