import { google } from 'googleapis';

export default async function handler(req, res) {
  // Dozvoli samo GET zahteve (za cron)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('=== Departures Sheet Reset Request ===');
  
  try {
    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    if (!clientEmail || !privateKey || !spreadsheetId) {
      return res.status(500).json({ 
        error: 'Missing environment variables'
      });
    }

    let formattedPrivateKey = privateKey;
    if (privateKey.includes('\\n')) {
      formattedPrivateKey = privateKey.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: formattedPrivateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const polasciSheetName = 'Polasci';
    const juceSheetName = 'Juce';
    
    // ===== KORAK 1: Pročitaj trenutne podatke iz Polasci sheet-a =====
    console.log('Reading current Polasci data...');
    let polasciData = [];
    
    try {
      const polasciResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${polasciSheetName}!A:J`,
      });
      polasciData = polasciResponse.data.values || [];
      console.log(`✓ Read ${polasciData.length} rows from Polasci`);
    } catch (readError) {
      console.log('⚠️ No data in Polasci sheet or sheet does not exist');
    }

    // ===== KORAK 2: Proveri/Kreiraj Juce sheet =====
    let juceSheetId = null;
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingJuceSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === juceSheetName
    );
    
    if (existingJuceSheet) {
      juceSheetId = existingJuceSheet.properties.sheetId;
      console.log(`✓ Found sheet "${juceSheetName}" (ID: ${juceSheetId})`);
    } else {
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: juceSheetName,
                gridProperties: {
                  rowCount: 10000,
                  columnCount: 10
                }
              }
            }
          }]
        }
      });
      
      juceSheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
      console.log(`✓ Created new sheet "${juceSheetName}" (ID: ${juceSheetId})`);
    }

    // ===== KORAK 3: Obriši sve iz Juce sheet-a =====
    console.log('Clearing Juce sheet...');
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${juceSheetName}!A:J`
    });
    console.log('✓ Cleared Juce sheet');

    // ===== KORAK 4: Kopiraj podatke iz Polasci u Juce (samo ako postoje) =====
    if (polasciData.length > 0) {
      console.log('Copying Polasci data to Juce...');
      
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${juceSheetName}!A1`,
        valueInputOption: 'RAW',
        resource: {
          values: polasciData
        }
      });
      
      console.log(`✓ Copied ${polasciData.length} rows to Juce`);

      // ===== KORAK 5: Kopiraj formatiranje iz Polasci u Juce =====
      // Prvo pročitaj info o Polasci sheet-u da bi dobio formatiranje
      const polasciSheet = spreadsheet.data.sheets.find(
        s => s.properties.title === polasciSheetName
      );
      
      if (polasciSheet) {
        const polasciSheetId = polasciSheet.properties.sheetId;
        
        // Kopiraj format preko copyPaste zahteva
        try {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: {
              requests: [{
                copyPaste: {
                  source: {
                    sheetId: polasciSheetId,
                    startRowIndex: 0,
                    endRowIndex: polasciData.length,
                    startColumnIndex: 0,
                    endColumnIndex: 10
                  },
                  destination: {
                    sheetId: juceSheetId,
                    startRowIndex: 0,
                    endRowIndex: polasciData.length,
                    startColumnIndex: 0,
                    endColumnIndex: 10
                  },
                  pasteType: 'PASTE_FORMAT'
                }
              }]
            }
          });
          console.log('✓ Copied formatting to Juce');
        } catch (formatError) {
          console.log('⚠️ Could not copy formatting:', formatError.message);
        }
      }
    } else {
      console.log('⚠️ No data to copy to Juce');
    }

    // ===== KORAK 6: Proveri/Kreiraj Polasci sheet ako ne postoji =====
    let polasciSheetId = null;
    const existingPolasciSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === polasciSheetName
    );
    
    if (existingPolasciSheet) {
      polasciSheetId = existingPolasciSheet.properties.sheetId;
      console.log(`✓ Found sheet "${polasciSheetName}" (ID: ${polasciSheetId})`);
    } else {
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: polasciSheetName,
                gridProperties: {
                  rowCount: 10000,
                  columnCount: 10
                }
              }
            }
          }]
        }
      });
      
      polasciSheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
      console.log(`✓ Created new sheet "${polasciSheetName}" (ID: ${polasciSheetId})`);
    }

    // ===== KORAK 7: Obriši sve podatke iz Polasci =====
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${polasciSheetName}!A1:J`
    });

    console.log(`✓ Cleared all data from sheet "${polasciSheetName}"`);

    // ===== KORAK 8: Dodaj header poruku u Polasci =====
    const timestamp = new Date().toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${polasciSheetName}!A1:J1`,
      valueInputOption: 'RAW',
      resource: {
        values: [[`Sheet resetovan u ${timestamp}`, '', '', '', '', '', '', '', '', '']]
      }
    });

    // Formatiraj header u Polasci
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          repeatCell: {
            range: {
              sheetId: polasciSheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 10
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
                textFormat: {
                  italic: true,
                  fontSize: 10
                }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        }]
      }
    });

    console.log('=== Departures Reset Complete ===');

    res.status(200).send(
      `SUCCESS - Departures reset at ${timestamp} | ` +
      `Saved ${polasciData.length} rows to Juce sheet`
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    const timestamp = new Date().toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    res.status(500).send(
      `ERROR - Reset failed at ${timestamp}: ${error.message}`
    );
  }
}
