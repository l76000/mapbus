import { google } from 'googleapis';
import crypto from 'crypto';

// Funkcija za heširanje lozinke
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Funkcija za verifikaciju lozinke
function verifyPassword(password, hashedPassword) {
  return hashPassword(password) === hashedPassword;
}

// Funkcija za parsiranje User-Agent-a u čitljiv format
function parseUserAgent(userAgent) {
  if (!userAgent) return 'Nepoznat uređaj';

  let device = '';
  let browser = '';

  // Prepoznavanje uređaja/OS-a
  if (userAgent.includes('iPhone')) {
    device = 'iPhone';
  } else if (userAgent.includes('iPad')) {
    device = 'iPad';
  } else if (userAgent.includes('Android')) {
    // Pokušaj da izvučeš model uređaja
    const androidMatch = userAgent. match(/Android[^;]*;\s*([^)]+)\)/);
    if (androidMatch) {
      let model = androidMatch[1]. trim();
      // Ukloni "Build/..." deo ako postoji
      model = model.replace(/\s*Build\/.*$/i, ''). trim();
      
      // Prepoznaj proizvođača
      if (model.toLowerCase().startsWith('sm-') || model.toLowerCase(). includes('samsung')) {
        device = `Samsung ${model. replace(/samsung/gi, '').trim()}`;
      } else if (model.toLowerCase().startsWith('redmi') || model.toLowerCase(). startsWith('m') && model.includes('k')) {
        device = `Xiaomi ${model}`;
      } else if (model.toLowerCase(). includes('xiaomi')) {
        device = model;
      } else if (model.toLowerCase(). startsWith('rmx')) {
        device = `Realme ${model}`;
      } else if (model.toLowerCase(). startsWith('cph')) {
        device = `OPPO ${model}`;
      } else if (model.toLowerCase().startsWith('v') && /^v\d/i.test(model)) {
        device = `Vivo ${model}`;
      } else if (model.toLowerCase(). includes('huawei') || model.toLowerCase(). startsWith('els') || model.toLowerCase(). startsWith('jny')) {
        device = `Huawei ${model. replace(/huawei/gi, ''). trim()}`;
      } else if (model.toLowerCase().startsWith('pixel')) {
        device = `Google ${model}`;
      } else if (model.toLowerCase(). includes('oneplus')) {
        device = model;
      } else if (model.toLowerCase(). startsWith('lm-')) {
        device = `LG ${model}`;
      } else if (model.toLowerCase(). startsWith('moto') || model.toLowerCase(). startsWith('xt')) {
        device = `Motorola ${model}`;
      } else {
        device = `Android (${model})`;
      }
    } else {
      device = 'Android';
    }
  } else if (userAgent.includes('Windows NT 10.0')) {
    if (userAgent.includes('Windows NT 10.0; Win64') && userAgent.includes('rv:') === false) {
      // Može biti Windows 10 ili 11, ali ne možemo tačno znati
      device = 'Windows 10/11';
    } else {
      device = 'Windows 10/11';
    }
  } else if (userAgent.includes('Windows NT 6.3')) {
    device = 'Windows 8. 1';
  } else if (userAgent.includes('Windows NT 6.2')) {
    device = 'Windows 8';
  } else if (userAgent.includes('Windows NT 6. 1')) {
    device = 'Windows 7';
  } else if (userAgent.includes('Mac OS X')) {
    device = 'macOS';
  } else if (userAgent.includes('Linux')) {
    device = 'Linux';
  } else if (userAgent.includes('CrOS')) {
    device = 'Chrome OS';
  } else {
    device = 'Nepoznat OS';
  }

  // Prepoznavanje browsera
  if (userAgent.includes('Edg/')) {
    const match = userAgent.match(/Edg\/(\d+)/);
    browser = match ? `Edge ${match[1]}` : 'Edge';
  } else if (userAgent.includes('OPR/') || userAgent.includes('Opera')) {
    const match = userAgent. match(/OPR\/(\d+)/);
    browser = match ? `Opera ${match[1]}` : 'Opera';
  } else if (userAgent.includes('Chrome/') && ! userAgent.includes('Edg/') && !userAgent. includes('OPR/')) {
    const match = userAgent. match(/Chrome\/(\d+)/);
    browser = match ?  `Chrome ${match[1]}` : 'Chrome';
  } else if (userAgent.includes('Firefox/')) {
    const match = userAgent.match(/Firefox\/(\d+)/);
    browser = match ? `Firefox ${match[1]}` : 'Firefox';
  } else if (userAgent.includes('Safari/') && !userAgent. includes('Chrome')) {
    const match = userAgent.match(/Version\/(\d+)/);
    browser = match ? `Safari ${match[1]}` : 'Safari';
  } else if (userAgent.includes('MSIE') || userAgent.includes('Trident/')) {
    browser = 'Internet Explorer';
  } else {
    browser = 'Nepoznat browser';
  }

  return `${device} / ${browser}`;
}

// Google Sheets setup
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?. replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis. com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const USERS_SHEET = 'Users';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, username, password, token, userIndex, status, captcha, userAgent } = 
    req.method === 'POST' ? req.body : req. query;

  try {
    let users = [];
    
    try {
      const response = await sheets. spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A:I`, // Prošireno na I kolonu za DeviceHistory
      });

      const rows = response.data. values || [];
      
      if (rows.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}!A1:I1`,
          valueInputOption: 'RAW',
          resource: {
            values: [['Username', 'PasswordHash', 'Status', 'RegisteredAt', 'LastIP', 'IPHistory', 'IsAdmin', 'LastAccess', 'DeviceHistory']]
          }
        });
      } else {
        users = rows. slice(1). map(row => ({
          username: row[0] || '',
          passwordHash: row[1] || '',
          status: row[2] || 'pending',
          registeredAt: row[3] || '',
          lastIP: row[4] || '',
          ipHistory: row[5] || '',
          isAdmin: row[6] === 'true' || row[6] === 'TRUE' || false,
          lastAccess: row[7] || '',
          deviceHistory: row[8] || '', // Nova kolona
        }));
      }
    } catch (error) {
      if (error.message && error.message.includes('Unable to parse range')) {
        console.log('Creating Users sheet...');
        
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [{
              addSheet: {
                properties: {
                  title: USERS_SHEET
                }
              }
            }]
          }
        });
        
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}!A1:I1`,
          valueInputOption: 'RAW',
          resource: {
            values: [['Username', 'PasswordHash', 'Status', 'RegisteredAt', 'LastIP', 'IPHistory', 'IsAdmin', 'LastAccess', 'DeviceHistory']]
          }
        });
        
        console.log('Users sheet created successfully');
      } else {
        throw error;
      }
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               'unknown';

    // Parsiraj User-Agent iz headera ili body-ja
    const rawUserAgent = userAgent || req.headers['user-agent'] || '';
    const parsedDevice = parseUserAgent(rawUserAgent);

    // ====== REGISTRACIJA ======
    if (action === 'register') {
      if (!captcha || captcha.trim() === '') {
        return res.status(400).json({ 
          success: false, 
          message: 'Molimo potvrdite da niste robot' 
        });
      }

      const existingUser = users. find(u => 
        u.username. toLowerCase() === username. toLowerCase()
      );

      if (existingUser) {
        return res.status(400).json({ 
          success: false, 
          message: 'Korisničko ime već postoji' 
        });
      }

      const now = new Date(). toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });
      const hashedPassword = hashPassword(password);

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A:I`,
        valueInputOption: 'RAW',
        resource: {
          values: [[username, hashedPassword, 'pending', now, ip, ip, 'false', '', parsedDevice]]
        }
      });

      return res.status(200).json({ 
        success: true, 
        message: 'Zahtev za registraciju poslat!  Čekajte odobrenje.' 
      });
    }

    // ====== LOGIN ======
    if (action === 'login') {
      const user = users.find(u => u.username === username);

      if (!user) {
        return res.status(401).json({ 
          success: false, 
          message: 'Pogrešno korisničko ime ili lozinka' 
        });
      }

      // Proveri da li je lozinka hešovana ili plain text (za migraciju starih naloga)
      let isPasswordValid = false;
      let needsMigration = false;

      if (verifyPassword(password, user.passwordHash)) {
        // Lozinka je već hešovana i tačna
        isPasswordValid = true;
      } else if (user.passwordHash === password) {
        // Stara plain text lozinka - treba migrirati
        isPasswordValid = true;
        needsMigration = true;
      }

      if (! isPasswordValid) {
        return res. status(401).json({ 
          success: false, 
          message: 'Pogrešno korisničko ime ili lozinka' 
        });
      }

      if (user.status !== 'approved') {
        return res.status(403).json({ 
          success: false, 
          message: user.status === 'rejected' ? 'Nalog je odbijen' : 'Nalog još nije odobren' 
        });
      }

      // Ažuriraj IP, uređaj i poslednji pristup
      const userIdx = users.findIndex(u => u. username === username);
      const ipHistory = user.ipHistory ?  `${user.ipHistory}, ${ip}` : ip;
      const deviceHistory = user.deviceHistory 
        ? (user.deviceHistory. includes(parsedDevice) ? user.deviceHistory : `${user.deviceHistory}, ${parsedDevice}`)
        : parsedDevice;
      const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });

      // Ako je potrebna migracija, hešuj lozinku
      const passwordToStore = needsMigration ? hashPassword(password) : user.passwordHash;

      await sheets.spreadsheets.values. update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!B${userIdx + 2}:I${userIdx + 2}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[passwordToStore, user.status, user.registeredAt, ip, ipHistory, user.isAdmin ?  'true' : 'false', now, deviceHistory]]
        }
      });

      if (needsMigration) {
        console.log(`✓ Migrated password for user: ${username}`);
      }

      const token = Buffer.from(`${username}:${Date.now()}`). toString('base64');

      return res.status(200).json({ 
        success: true, 
        message: 'Uspešna prijava',
        token: token,
        username: username,
        isAdmin: user.isAdmin
      });
    }

    // ====== PROVERA TOKENA ======
    if (action === 'verify') {
      if (!token) {
        return res.status(401).json({ success: false, message: 'Nema tokena' });
      }

      try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const [tokenUsername, timestamp] = decoded.split(':');

        const user = users.find(u => u.username === tokenUsername);
        
        if (!user || user.status !== 'approved') {
          return res.status(401).json({ success: false, message: 'Nevažeći token' });
        }

        const tokenAge = Date.now() - parseInt(timestamp);
        if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
          return res. status(401).json({ success: false, message: 'Token je istekao' });
        }

        // Ažuriraj poslednji pristup i uređaj pri svakoj verifikaciji
        const userIdx = users. findIndex(u => u.username === tokenUsername);
        const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });
        
        // Dodaj uređaj u istoriju ako već nije tu
        const deviceHistory = user. deviceHistory 
          ? (user.deviceHistory.includes(parsedDevice) ? user.deviceHistory : `${user.deviceHistory}, ${parsedDevice}`)
          : parsedDevice;

        await sheets.spreadsheets.values. update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}!H${userIdx + 2}:I${userIdx + 2}`,
          valueInputOption: 'RAW',
          resource: {
            values: [[now, deviceHistory]]
          }
        });

        return res.status(200).json({ success: true, username: tokenUsername, isAdmin: user.isAdmin });
      } catch (e) {
        return res.status(401).json({ success: false, message: 'Nevažeći token' });
      }
    }

    // ====== LISTA KORISNIKA (za admin) ======
    if (action === 'listUsers') {
      if (! token) {
        return res.status(401).json({ success: false, message: 'Neautorizovan pristup' });
      }

      try {
        const decoded = Buffer. from(token, 'base64').toString('utf-8');
        const [tokenUsername] = decoded.split(':');
        const requestUser = users.find(u => u.username === tokenUsername);
        
        if (! requestUser || ! requestUser.isAdmin) {
          return res.status(403).json({ success: false, message: 'Nemate admin privilegije' });
        }
      } catch (e) {
        return res.status(401).json({ success: false, message: 'Nevažeći token' });
      }

      const sanitizedUsers = users. map(u => ({
        username: u.username,
        status: u.status,
        registeredAt: u.registeredAt,
        lastIP: u.lastIP,
        ipHistory: u.ipHistory,
        isAdmin: u.isAdmin,
        lastAccess: u. lastAccess,
        deviceHistory: u.deviceHistory // Dodato
      }));

      return res.status(200).json({ success: true, users: sanitizedUsers });
    }

    // ====== AŽURIRANJE STATUSA (za admin) ======
    if (action === 'updateStatus') {
      if (!token) {
        return res.status(401).json({ success: false, message: 'Neautorizovan pristup' });
      }

      try {
        const decoded = Buffer.from(token, 'base64'). toString('utf-8');
        const [tokenUsername] = decoded.split(':');
        const requestUser = users.find(u => u. username === tokenUsername);
        
        if (!requestUser || ! requestUser.isAdmin) {
          return res.status(403).json({ success: false, message: 'Nemate admin privilegije' });
        }
      } catch (e) {
        return res. status(401).json({ success: false, message: 'Nevažeći token' });
      }

      if (! userIndex || !status) {
        return res.status(400).json({ 
          success: false, 
          message: 'Nedostaju parametri' 
        });
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!C${userIndex}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[status]]
        }
      });

      return res.status(200). json({ success: true, message: 'Status ažuriran' });
    }

    return res.status(400).json({ error: 'Nevažeća akcija' });

  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Server greška',
      details: error.message 
    });
  }
}
