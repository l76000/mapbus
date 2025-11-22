export default function handler(req, res) {
  const html = `
<!DOCTYPE html>
<html lang="sr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sva Vozila</title>
 
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
 
    <style>
        body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
        #map { height: 100vh; width: 100%; }
 
        .bus-icon-container { background: none; border: none; }
        .bus-wrapper { position: relative; width: 50px; height: 56px; transition: all 0.3s ease; }
 
        .bus-circle {
            width: 32px; height: 32px; border-radius: 50%; 
            color: white; 
            display: flex; justify-content: center; align-items: center;
            font-weight: bold; font-size: 13px;
            border: 2px solid white; box-shadow: 0 3px 6px rgba(0,0,0,0.4);
            position: absolute; top: 0; left: 50%; transform: translateX(-50%);
            z-index: 20;
        }
        
        .bus-garage-label {
            position: absolute; 
            top: 36px; 
            left: 50%; 
            transform: translateX(-50%);
            font-size: 9px;
            font-weight: bold;
            color: white;
            background: rgba(0, 0, 0, 0.7);
            padding: 2px 5px;
            border-radius: 3px;
            white-space: nowrap;
            z-index: 19;
        }
 
        /* Strelica */
        .bus-arrow {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10;
            transition: transform 0.5s linear;
        }
        .arrow-head {
            width: 0; height: 0; 
            border-left: 7px solid transparent;
            border-right: 7px solid transparent;
            border-bottom: 12px solid #333;
            position: absolute; top: 0px; left: 50%; transform: translateX(-50%);
        }
        
        /* Stil za loading karticu */
        .loading-card {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: white;
            padding: 30px 40px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            text-align: center;
            z-index: 1000;
            font-size: 18px;
            color: #333;
        }
        
        .loading-card.hidden {
            display: none;
        }
        
        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #3498db;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto 15px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        /* Stil za spojenu karticu - gore desno */
        .combined-card {
            position: fixed;
            top: 10px;
            right: 10px;
            background-color: white;
            padding: 10px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 999;
            width: 220px;
        }
        
        .refresh-timer {
            padding: 8px;
            border-bottom: 1px solid #eee;
            margin-bottom: 10px;
            font-size: 14px;
            color: #333;
            text-align: center;
        }
        
        .refresh-timer strong {
            color: #3498db;
        }
        
        .search-section input {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
            box-sizing: border-box;
        }
        
        .search-section input:focus {
            outline: none;
            border-color: #3498db;
        }
        
        .search-results {
            margin-top: 8px;
            max-height: 80px;
            overflow-y: auto;
            border-top: 1px solid #eee;
            padding-top: 5px;
        }
        
        .search-results:empty {
            display: none;
        }
        
        .search-result-item {
            padding: 8px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 13px;
            margin-bottom: 4px;
            background-color: #f8f9fa;
            transition: background-color 0.2s;
        }
        
        .search-result-item:hover {
            background-color: #e9ecef;
        }
        
        .search-result-item strong {
            color: #3498db;
        }
        
        /* Custom scrollbar za rezultate */
        .search-results::-webkit-scrollbar {
            width: 6px;
        }
        
        .search-results::-webkit-scrollbar-track {
            background: #f1f1f1;
            border-radius: 3px;
        }
        
        .search-results::-webkit-scrollbar-thumb {
            background: #888;
            border-radius: 3px;
        }
        
        .search-results::-webkit-scrollbar-thumb:hover {
            background: #555;
        }
        
        /* POPUP STIL */
        .popup-content { font-size: 13px; line-height: 1.4; }
        .popup-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .popup-label { font-weight: bold; color: #555; }
    </style>
</head>
<body>
 
    <div id="loadingCard" class="loading-card">
        <div class="spinner"></div>
        <div>Učitavanje...</div>
    </div>
    
    <div class="combined-card">
        <div class="refresh-timer">
            Sledeće ažuriranje za: <strong id="timer">65</strong>s
        </div>
        <div class="search-section">
            <input type="text" id="searchInput" placeholder="Pretraži vozilo...">
            <div id="searchResults" class="search-results"></div>
        </div>
    </div>
 
    <div id="map"></div>
 
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
 
    <script>
        var map = L.map('map').setView([44.8125, 20.4612], 13);
 
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
 
        var markersLayer = L.layerGroup().addTo(map);
        var sviPodaci = []; 
        var allMarkers = {}; // Čuvamo sve markere sa njihovim vozilima
        
        // Mapa boja za smerove
        var directionColorMap = {};
        
        // Mapa stanica: id -> {name, coords}
        var stationsMap = {};
        
        // Paleta boja
        const colors = [
            '#e74c3c', '#3498db', '#9b59b6', '#2ecc71', '#f1c40f', 
            '#e67e22', '#1abc9c', '#34495e', '#d35400', '#c0392b',
            '#2980b9', '#8e44ad', '#27ae60', '#f39c12', '#16a085'
        ];
        
        const url = '/api/proxy';
        const REFRESH_INTERVAL = 65000; // 65 sekundi
        const COUNTDOWN_START = 65; // Početak odbrojavanja
        var refreshTimer;
        var countdown;
        var remainingSeconds = COUNTDOWN_START;
        
        // ================= FUNKCIJA ZA NORMALIZACIJU =================
        
        function normalizeStopId(stopId) {
            if (typeof stopId === 'string' && stopId.length === 5 && stopId.startsWith('2')) {
                let normalized = stopId.substring(1);
                normalized = parseInt(normalized, 10).toString();
                return normalized;
            }
            return stopId;
        }

        function normalizeRouteId(routeId) {
            if (typeof routeId === 'string') {
                return parseInt(routeId, 10).toString();
            }
            return routeId;
        }
        
        // ================= FILTER ZA GARAŽNE BROJEVE =================
        
        function isValidGarageNumber(label) {
            if (!label || typeof label !== 'string') return false;
            
            if (label.startsWith('P')) {
                return label.length >= 6;
            }
            
            return true;
        }
        
        // ================= UČITAVANJE STANICA =================
        
        async function loadStations() {
            try {
                const response = await fetch('/all.json');
                if (!response.ok) throw new Error("Greška pri učitavanju stanica");
                const stations = await response.json();
                
                console.log("✅ Učitano stanica:", stations.length);
                
                stations.forEach(station => {
                    if (station.id && station.name && station.coords) {
                        stationsMap[station.id] = {
                            name: station.name,
                            coords: [parseFloat(station.coords[0]), parseFloat(station.coords[1])]
                        };
                    }
                });
                
                console.log(\`✅ Mapa stanica ima \${Object.keys(stationsMap).length} unosa\`);
            } catch (error) {
                console.error("❌ Greška pri učitavanju stanica:", error);
            }
        }
        
        // Učitaj stanice pri inicijalizaciji
        loadStations();
 
        function ucitajAutobuse() {
            // Prikaži loading karticu
            document.getElementById('loadingCard').classList.remove('hidden');
            
            fetch(url)
                .then(response => {
                    if (!response.ok) throw new Error('Mreža nije dostupna');
                    return response.json();
                })
                .then(data => {
                    // Sakrij loading karticu
                    document.getElementById('loadingCard').classList.add('hidden');
                    
                    if (data && data.entity) {
                        sviPodaci = data.entity;
                        nacrtajMarkere();
                    }
                })
                .catch(error => {
                    console.error('Greška:', error);
                    document.getElementById('loadingCard').classList.add('hidden');
                    alert('Greška pri učitavanju podataka. Proverite konzolu.');
                });
        }
        
        function calculateBearing(startLat, startLng, destLat, destLng) {
            const y = Math.sin((destLng - startLng) * Math.PI / 180) * Math.cos(destLat * Math.PI / 180);
            const x = Math.cos(startLat * Math.PI / 180) * Math.sin(destLat * Math.PI / 180) -
                      Math.sin(startLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) * Math.cos((destLng - startLng) * Math.PI / 180);
            const brng = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
            return brng;
        }
 
        function nacrtajMarkere() {
            markersLayer.clearLayers();
            allMarkers = {}; // Resetuj markere
            
            // NOVA LOGIKA: Mapa po vehicleId umesto po tripId
            let vehicleDestinations = {};
            
            sviPodaci.forEach(e => {
                if (e.tripUpdate && e.tripUpdate.trip && e.tripUpdate.stopTimeUpdate && e.tripUpdate.vehicle) {
                    const updates = e.tripUpdate.stopTimeUpdate;
                    const vehicleId = e.tripUpdate.vehicle.id;
                    
                    if (updates.length > 0 && vehicleId) {
                        const lastStopId = updates[updates.length - 1].stopId;
                        vehicleDestinations[vehicleId] = lastStopId;
                    }
                }
            });
 
            sviPodaci.forEach(entitet => {
                if (entitet.vehicle && entitet.vehicle.position) {
 
                    var info = entitet.vehicle;
                    var trip = info.trip;
                    var routeNum = parseInt(trip.routeId);
                    var vehicleLabel = info.vehicle.label;
                    var vehicleId = info.vehicle.id;
                    
                    // FILTRIRANJE: Proveri da li je garažni broj validan
                    if (!isValidGarageNumber(vehicleLabel)) {
                        return; // Preskoči ovo vozilo
                    }
 
                    var pos = info.position;
                    var lat = parseFloat(pos.latitude);
                    var lon = parseFloat(pos.longitude);
                    
                    // Određivanje destinacije i smera
                    const destId = vehicleDestinations[vehicleId] || "Unknown";
                    const normalizedId = normalizeStopId(destId);
                    const station = stationsMap[normalizedId];
                    const destName = station ? station.name : destId;
                    
                    // Kreiranje jedinstvenog ključa za smer (kombinacija linije i destinacije)
                    const uniqueDirKey = \`\${routeNum}_\${destId}\`;
                    
                    // Dodeli boju za ovaj smer ako već nije dodeljena
                    if (!directionColorMap[uniqueDirKey]) {
                        const nextColorIndex = Object.keys(directionColorMap).length % colors.length;
                        directionColorMap[uniqueDirKey] = colors[nextColorIndex];
                    }
                    
                    const markerColor = directionColorMap[uniqueDirKey];
                    
                    // Izračunaj ugao ka destinaciji
                    let rotation = 0;
                    let hasAngle = false;
 
                    if (station && station.coords) {
                        rotation = calculateBearing(lat, lon, station.coords[0], station.coords[1]);
                        hasAngle = true;
                    }
 
                    const arrowDisplay = hasAngle ? 'block' : 'none';
 
                    const iconHtml = \`
                        <div class="bus-wrapper">
                            <div class="bus-arrow" style="transform: rotate(\${rotation}deg); display: \${arrowDisplay};">
                                <div class="arrow-head" style="border-bottom-color: \${markerColor}; filter: brightness(0.6);"></div>
                            </div>
                            <div class="bus-circle" style="background: \${markerColor};">
                                \${routeNum}
                            </div>
                            <div class="bus-garage-label">\${vehicleLabel}</div>
                        </div>
                    \`;
 
                    var customIcon = L.divIcon({
                        className: 'bus-icon-container',
                        html: iconHtml,
                        iconSize: [50, 56],
                        iconAnchor: [25, 28]
                    });
 
                    var marker = L.marker([lat, lon], {icon: customIcon});
 
                    var popupSadrzaj = \`
                        <div class="popup-content">
                            <div class="popup-row"><span class="popup-label">Linija:</span> <b>\${routeNum}</b></div>
                            <div class="popup-row"><span class="popup-label">Vozilo:</span> \${vehicleLabel}</div>
                            <div class="popup-row"><span class="popup-label">Polazak:</span> \${trip.startTime}</div>
                            <hr style="margin: 5px 0; border-color:#eee;">
                            <div class="popup-row"><span class="popup-label">Smer (ide ka):</span> <span style="color:\${markerColor}; font-weight:bold;">\${destName}</span></div>
                        </div>
                    \`;
                    
                    marker.bindPopup(popupSadrzaj);
 
                    markersLayer.addLayer(marker);
                    
                    // Čuvaj marker sa podacima o vozilu
                    allMarkers[vehicleLabel] = {
                        marker: marker,
                        lat: lat,
                        lon: lon,
                        routeNum: routeNum,
                        vehicleLabel: vehicleLabel,
                        startTime: trip.startTime,
                        destName: destName
                    };
                }
            });
        }
        
        // Funkcija za pretragu
        function searchVehicles(query) {
            const resultsContainer = document.getElementById('searchResults');
            resultsContainer.innerHTML = '';
            
            if (!query || query.trim() === '') {
                return;
            }
            
            const searchTerm = query.toLowerCase().trim();
            const matchedVehicles = [];
            
            // Pretraži samo po oznaci vozila
            for (let vehicleLabel in allMarkers) {
                if (vehicleLabel.toLowerCase().includes(searchTerm)) {
                    matchedVehicles.push(allMarkers[vehicleLabel]);
                }
            }
            
            // Prikaži samo prva 2 rezultata
            const resultsToShow = matchedVehicles.slice(0, 2);
            
            resultsToShow.forEach(vehicle => {
                const resultItem = document.createElement('div');
                resultItem.className = 'search-result-item';
                resultItem.innerHTML = '<strong>Vozilo:</strong> ' + vehicle.vehicleLabel + 
                                      '<br><small>Linija: ' + vehicle.routeNum + '</small>';
                
                resultItem.onclick = function() {
                    // Centriraj mapu na vozilo
                    map.setView([vehicle.lat, vehicle.lon], 16);
                    // Otvori popup
                    vehicle.marker.openPopup();
                    // Očisti pretragu
                    document.getElementById('searchInput').value = '';
                    resultsContainer.innerHTML = '';
                };
                
                resultsContainer.appendChild(resultItem);
            });
        }
        
        // Event listener za input polje
        document.getElementById('searchInput').addEventListener('input', function(e) {
            searchVehicles(e.target.value);
        });
        
        function startCountdown() {
            // Očisti prethodni countdown ako postoji
            if (countdown) {
                clearInterval(countdown);
            }
            
            remainingSeconds = COUNTDOWN_START;
            document.getElementById('timer').textContent = remainingSeconds;
            
            countdown = setInterval(function() {
                remainingSeconds--;
                document.getElementById('timer').textContent = remainingSeconds;
                
                if (remainingSeconds <= 0) {
                    clearInterval(countdown);
                }
            }, 1000);
        }
        
        function startAutoRefresh() {
            refreshTimer = setInterval(function() {
                ucitajAutobuse();
                startCountdown();
            }, REFRESH_INTERVAL);
        }
 
        // Početno učitavanje
        ucitajAutobuse();
        startCountdown();
        startAutoRefresh();
 
    </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
