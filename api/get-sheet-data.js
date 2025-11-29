import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    // Generiši ime sheet-a za današnji datum
    const now = new Date();
    const dateStr = now.toLocaleDateString('sr-RS', {
      timeZone: 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).split('.').reverse().join('-').replace(/\.$/, '');

    const sheetName = dateStr;
    console.log(`Reading from sheet: ${sheetName}`);

    // Proveri da li sheet postoji
    let sheetExists = false;
    try {
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      sheetExists = spreadsheet.data.sheets.some(
        s => s.properties.title === sheetName
      );
    } catch (error) {
      console.error('Error checking sheets:', error.message);
    }

    if (!sheetExists) {
      console.log(`Sheet "${sheetName}" does not exist yet`);
      return res.status(200).json({ 
        success: true, 
        vehicles: [],
        count: 0,
        message: `Nema podataka za ${dateStr}`
      });
    }

    // Čitaj podatke iz današnjeg sheet-a
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:F`,
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      return res.status(200).json({ 
        success: true, 
        vehicles: [],
        count: 0,
        sheetName: sheetName
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

    res.status(200).json({ 
      success: true, 
      vehicles: vehicles,
      count: vehicles.length,
      lastUpdate: vehicles[vehicles.length - 1]?.timestamp || null,
      sheetName: sheetName
    });

  } catch (error) {
    console.error('Google Sheets error:', error);
    res.status(500).json({ 
      error: 'Failed to read sheet',
      details: error.message 
    });
  }
}
