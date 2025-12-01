// auth-check.js - Provera autentifikacije na stranici

(async function() {
    const token = localStorage.getItem('authToken');
    
    // Ako nema tokena, preusmeri na login
    if (!token) {
        window.location. href = '/login. html';
        return;
    }

    // Verifikuj token sa serverom
    try {
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'verify', 
                token: token,
                userAgent: navigator.userAgent // Šalje informacije o uređaju
            })
        });

        const data = await response. json();

        if (! data.success) {
            // Token nije validan, obriši ga i preusmeri na login
            localStorage. removeItem('authToken');
            localStorage.removeItem('username');
            window.location.href = '/login.html';
            return;
        }

        // Token validan, nastavi sa stranom
        console.log('✓ Autentifikovan kao:', data.username);
        
        // Dodaj logout dugme
        addLogoutButton(data.username);

    } catch (error) {
        console. error('Auth error:', error);
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        window. location.href = '/login.html';
    }
})();

function addLogoutButton(username) {
    // Proveri da li već postoji logout dugme
    if (document.getElementById('logoutContainer')) return;
    
    const logoutContainer = document.createElement('div');
    logoutContainer.id = 'logoutContainer';
    logoutContainer.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        z-index: 9999;
        background: rgba(255, 255, 255, 0. 95);
        padding: 8px 15px;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: sans-serif;
    `;

    logoutContainer.innerHTML = `
        <span style="font-size: 12px; color: #666;">👤 ${username}</span>
        <button onclick="logout()" style="
            background: #e74c3c;
            color: white;
            border: none;
            padding: 5px 12px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
        ">Odjavi se</button>
    `;

    document.body.appendChild(logoutContainer);
}

window.logout = function() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('username');
    window. location.href = '/login.html';
}
