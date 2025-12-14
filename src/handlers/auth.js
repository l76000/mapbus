// src/handlers/auth.js
// IDENTIČAN kod kao api/auth.js, samo prilagođen za Cloudflare Workers

import { getSheetsClient } from '../utils/sheets-client.js';

// Hash password
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verify password
async function verifyPassword(password, hashedPassword) {
  const hash = await hashPassword(password);
  return hash === hashedPassword;
}

export async function handleAuth(request, env) {
  const { method } = request;
  
  let body;
  if (method === 'POST') {
    body = await request.json();
  } else if (method === 'GET') {
    const url = new URL(request.url);
    body = Object.fromEntries(url.searchParams);
  } else {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const { action } = body;

  try {
    const sheets = await getSheetsClient(env);
    const SPREADSHEET_ID = env.GOOGLE_SPREADSHEET_ID;
    const USERS_SHEET = 'Users';

    // Get IP
    const ip = request.headers.get('CF-Connecting-IP') || 
               request.headers.get('X-Real-IP') || 
               request.headers.get('X-Forwarded-For')?.split(',')[0] || 
               'unknown';

    // Load users
    let users = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A:I`
      });

      const rows = response.data.values || [];
      
      if (rows.length === 0) {
        // Create header
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}!A1:I1`,
          valueInputOption: 'RAW',
          resource: {
            values: [['Username', 'PasswordHash', 'Status', 'RegisteredAt', 'LastIP', 'IPHistory', 'IsAdmin', 'LastAccess', 'Favorites']]
          }
        });
      } else {
        users = rows.slice(1).map(row => ({
          username: row[0] || '',
          passwordHash: row[1] || '',
          status: row[2] || 'pending',
          registeredAt: row[3] || '',
          lastIP: row[4] || '',
          ipHistory: row[5] || '',
          isAdmin: row[6] === 'true' || row[6] === 'TRUE' || false,
          lastAccess: row[7] || '',
          favorites: row[8] || ''
        }));
      }
    } catch (error) {
      if (error.message && error.message.includes('Unable to parse range')) {
        // Create sheet
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [{
              addSheet: {
                properties: { title: USERS_SHEET }
              }
            }]
          }
        });
        
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}!A1:I1`,
          valueInputOption: 'RAW',
          resource: {
            values: [['Username', 'PasswordHash', 'Status', 'RegisteredAt', 'LastIP', 'IPHistory', 'IsAdmin', 'LastAccess', 'Favorites']]
          }
        });
      } else {
        throw error;
      }
    }

    // Handle actions
    switch (action) {
      case 'register':
        return await handleRegister(body, ip, sheets, SPREADSHEET_ID, USERS_SHEET, users);
      
      case 'login':
        return await handleLogin(body, ip, sheets, SPREADSHEET_ID, USERS_SHEET, users);
      
      case 'verify':
        return await handleVerify(body, sheets, SPREADSHEET_ID, USERS_SHEET, users);
      
      case 'listUsers':
        return await handleListUsers(body, users);
      
      case 'updateStatus':
        return await handleUpdateStatus(body, sheets, SPREADSHEET_ID, USERS_SHEET, users);
      
      case 'getUserData':
        return await handleGetUserData(body, users);
      
      case 'saveFavorites':
        return await handleSaveFavorites(body, sheets, SPREADSHEET_ID, USERS_SHEET, users);
      
      case 'changePassword':
        return await handleChangePassword(body, sheets, SPREADSHEET_ID, USERS_SHEET, users);
      
      default:
        return jsonResponse({ error: 'Invalid action' }, 400);
    }

  } catch (error) {
    console.error('Auth error:', error);
    return jsonResponse({ 
      success: false, 
      error: 'Server error',
      details: error.message 
    }, 500);
  }
}

// REGISTER
async function handleRegister(body, ip, sheets, SPREADSHEET_ID, USERS_SHEET, users) {
  const { username, password, captcha } = body;

  if (!captcha || captcha.trim() === '') {
    return jsonResponse({ 
      success: false, 
      message: 'Molimo potvrdite da niste robot' 
    }, 400);
  }

  const existingUser = users.find(u => 
    u.username.toLowerCase() === username.toLowerCase()
  );

  if (existingUser) {
    return jsonResponse({ 
      success: false, 
      message: 'Korisničko ime već postoji' 
    }, 400);
  }

  const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });
  const hashedPassword = await hashPassword(password);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${USERS_SHEET}!A:I`,
    valueInputOption: 'RAW',
    resource: {
      values: [[username, hashedPassword, 'pending', now, ip, ip, 'false', '', '']]
    }
  });

  return jsonResponse({ 
    success: true, 
    message: 'Zahtev za registraciju poslat! Čekajte odobrenje.' 
  });
}

// LOGIN
async function handleLogin(body, ip, sheets, SPREADSHEET_ID, USERS_SHEET, users) {
  const { username, password } = body;

  const user = users.find(u => u.username === username);

  if (!user) {
    return jsonResponse({ 
      success: false, 
      message: 'Pogrešno korisničko ime ili lozinka' 
    }, 401);
  }

  let isPasswordValid = false;
  let needsMigration = false;

  if (await verifyPassword(password, user.passwordHash)) {
    isPasswordValid = true;
  } else if (user.passwordHash === password) {
    isPasswordValid = true;
    needsMigration = true;
  }

  if (!isPasswordValid) {
    return jsonResponse({ 
      success: false, 
      message: 'Pogrešno korisničko ime ili lozinka' 
    }, 401);
  }

  if (user.status !== 'approved') {
    return jsonResponse({ 
      success: false, 
      message: user.status === 'rejected' ? 'Nalog je odbijen' : 'Nalog još nije odobren' 
    }, 403);
  }

  const userIdx = users.findIndex(u => u.username === username);
  const ipHistory = user.ipHistory ? `${user.ipHistory}, ${ip}` : ip;
  const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });

  const passwordToStore = needsMigration ? await hashPassword(password) : user.passwordHash;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${USERS_SHEET}!B${userIdx + 2}:I${userIdx + 2}`,
    valueInputOption: 'RAW',
    resource: {
      values: [[passwordToStore, user.status, user.registeredAt, ip, ipHistory, user.isAdmin ? 'true' : 'false', now, user.favorites || '']]
    }
  });

  if (needsMigration) {
    console.log(`✓ Migrated password for user: ${username}`);
  }

  const authToken = btoa(`${username}:${Date.now()}`);

  return jsonResponse({ 
    success: true, 
    message: 'Uspešna prijava',
    token: authToken,
    username: username,
    isAdmin: user.isAdmin
  });
}

// VERIFY
async function handleVerify(body, sheets, SPREADSHEET_ID, USERS_SHEET, users) {
  const { token } = body;

  if (!token) {
    return jsonResponse({ success: false, message: 'Nema tokena' }, 401);
  }

  try {
    const decoded = atob(token);
    const [tokenUsername, timestamp] = decoded.split(':');

    const user = users.find(u => u.username === tokenUsername);
    
    if (!user || user.status !== 'approved') {
      return jsonResponse({ success: false, message: 'Nevažeći token' }, 401);
    }

    const tokenAge = Date.now() - parseInt(timestamp);
    if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
      return jsonResponse({ success: false, message: 'Token je istekao' }, 401);
    }

    const userIdx = users.findIndex(u => u.username === tokenUsername);
    const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${USERS_SHEET}!H${userIdx + 2}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[now]]
      }
    });

    return jsonResponse({ success: true, username: tokenUsername, isAdmin: user.isAdmin });
  } catch (e) {
    return jsonResponse({ success: false, message: 'Nevažeći token' }, 401);
  }
}

// LIST USERS
async function handleListUsers(body, users) {
  const { token } = body;

  if (!token) {
    return jsonResponse({ success: false, message: 'Neautorizovan pristup' }, 401);
  }

  try {
    const decoded = atob(token);
    const [tokenUsername] = decoded.split(':');
    const requestUser = users.find(u => u.username === tokenUsername);
    
    if (!requestUser || !requestUser.isAdmin) {
      return jsonResponse({ success: false, message: 'Nemate admin privilegije' }, 403);
    }
  } catch (e) {
    return jsonResponse({ success: false, message: 'Nevažeći token' }, 401);
  }

  const sanitizedUsers = users.map(u => ({
    username: u.username,
    status: u.status,
    registeredAt: u.registeredAt,
    lastIP: u.lastIP,
    ipHistory: u.ipHistory,
    isAdmin: u.isAdmin,
    lastAccess: u.lastAccess
  }));

  return jsonResponse({ success: true, users: sanitizedUsers });
}

// UPDATE STATUS
async function handleUpdateStatus(body, sheets, SPREADSHEET_ID, USERS_SHEET, users) {
  const { token, userIndex, status } = body;

  if (!token) {
    return jsonResponse({ success: false, message: 'Neautorizovan pristup' }, 401);
  }

  try {
    const decoded = atob(token);
    const [tokenUsername] = decoded.split(':');
    const requestUser = users.find(u => u.username === tokenUsername);
    
    if (!requestUser || !requestUser.isAdmin) {
      return jsonResponse({ success: false, message: 'Nemate admin privilegije' }, 403);
    }
  } catch (e) {
    return jsonResponse({ success: false, message: 'Nevažeći token' }, 401);
  }

  if (!userIndex || !status) {
    return jsonResponse({ 
      success: false, 
      message: 'Nedostaju parametri' 
    }, 400);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${USERS_SHEET}!C${userIndex}`,
    valueInputOption: 'RAW',
    resource: {
      values: [[status]]
    }
  });

  return jsonResponse({ success: true, message: 'Status ažuriran' });
}

// GET USER DATA
async function handleGetUserData(body, users) {
  const { token } = body;

  if (!token) {
    return jsonResponse({ success: false, message: 'Nema tokena' }, 401);
  }

  try {
    const decoded = atob(token);
    const [tokenUsername, timestamp] = decoded.split(':');

    const user = users.find(u => u.username === tokenUsername);
    
    if (!user || user.status !== 'approved') {
      return jsonResponse({ success: false, message: 'Nevažeći token' }, 401);
    }

    const tokenAge = Date.now() - parseInt(timestamp);
    if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
      return jsonResponse({ success: false, message: 'Token je istekao' }, 401);
    }

    return jsonResponse({ 
      success: true, 
      username: tokenUsername,
      favorites: user.favorites || ''
    });
  } catch (e) {
    return jsonResponse({ success: false, message: 'Nevažeći token' }, 401);
  }
}

// SAVE FAVORITES
async function handleSaveFavorites(body, sheets, SPREADSHEET_ID, USERS_SHEET, users) {
  const { token, favorites } = body;

  if (!token) {
    return jsonResponse({ success: false, message: 'Nema tokena' }, 401);
  }

  try {
    const decoded = atob(token);
    const [tokenUsername, timestamp] = decoded.split(':');

    const user = users.find(u => u.username === tokenUsername);
    
    if (!user || user.status !== 'approved') {
      return jsonResponse({ success: false, message: 'Nevažeći token' }, 401);
    }

    const tokenAge = Date.now() - parseInt(timestamp);
    if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
      return jsonResponse({ success: false, message: 'Token je istekao' }, 401);
    }

    const userIdx = users.findIndex(u => u.username === tokenUsername);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${USERS_SHEET}!I${userIdx + 2}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[favorites || '']]
      }
    });

    return jsonResponse({ success: true, message: 'Omiljene linije sačuvane' });
  } catch (e) {
    console.error('Save favorites error:', e);
    return jsonResponse({ success: false, message: 'Greška pri čuvanju' }, 500);
  }
}

// CHANGE PASSWORD
async function handleChangePassword(body, sheets, SPREADSHEET_ID, USERS_SHEET, users) {
  const { token, currentPassword, newPassword } = body;

  if (!token) {
    return jsonResponse({ success: false, message: 'Nema tokena' }, 401);
  }

  if (!currentPassword || !newPassword) {
    return jsonResponse({ success: false, message: 'Nedostaju parametri' }, 400);
  }

  try {
    const decoded = atob(token);
    const [tokenUsername, timestamp] = decoded.split(':');

    const user = users.find(u => u.username === tokenUsername);
    
    if (!user || user.status !== 'approved') {
      return jsonResponse({ success: false, message: 'Nevažeći token' }, 401);
    }

    const tokenAge = Date.now() - parseInt(timestamp);
    if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
      return jsonResponse({ success: false, message: 'Token je istekao' }, 401);
    }

    let isPasswordValid = false;
    if (await verifyPassword(currentPassword, user.passwordHash)) {
      isPasswordValid = true;
    } else if (user.passwordHash === currentPassword) {
      isPasswordValid = true;
    }

    if (!isPasswordValid) {
      return jsonResponse({ success: false, message: 'Pogrešna trenutna lozinka' }, 400);
    }

    const newHashedPassword = await hashPassword(newPassword);
    const userIdx = users.findIndex(u => u.username === tokenUsername);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${USERS_SHEET}!B${userIdx + 2}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[newHashedPassword]]
      }
    });

    return jsonResponse({ success: true, message: 'Lozinka uspešno promenjena' });
  } catch (e) {
    console.error('Change password error:', e);
    return jsonResponse({ success: false, message: 'Greška pri promeni lozinke' }, 500);
  }
}

// Helper
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
