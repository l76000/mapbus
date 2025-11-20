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
 
        .bus-marker {
            border-radius: 50%;
            color: white;
            font-weight: bold;
            display: flex;
            justify-content: center;
            align-items: center;
            border: 2px solid white;
            box-shadow: 0 0 4px rgba(0,0,0,0.5);
            font-size: 12px;
        }
 
        .marker-red { background-color: #e74c3c; }
        .marker-blue { background-color: #3498db; }
        .marker-gray { background-color: #95a5a6; }
    </style>
</head>
<body>
 
    <div id="map"></div>
 
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
 
    <script>
        var map = L.map('map').setView([44.8125, 20.4612], 13);
 
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
 
        var markersLayer = L.layerGroup().addTo(map);
        var sviPodaci = []; 
        
        const url = '/api/proxy';
 
        function ucitajAutobuse() {
            fetch(url)
                .then(response => {
                    if (!response.ok) throw new Error('Mreža nije dostupna');
                    return response.json();
                })
                .then(data => {
                    if (data && data.entity) {
                        sviPodaci = data.entity;
                        nacrtajMarkere();
                    }
                })
                .catch(error => {
                    console.error('Greška:', error);
                    alert('Greška pri učitavanju podataka. Proverite konzolu.');
                });
        }
 
        function nacrtajMarkere() {
            markersLayer.clearLayers();
 
            sviPodaci.forEach(entitet => {
                if (entitet.vehicle && entitet.vehicle.position) {
 
                    var info = entitet.vehicle;
                    var trip = info.trip;
                    var routeNum = parseInt(trip.routeId);
 
                    var pos = info.position;
                    var lat = parseFloat(pos.latitude);
                    var lon = parseFloat(pos.longitude);
 
                    var markerClass = 'marker-gray';
                    if (trip.tripId && trip.tripId.includes('A_RD')) {
                        markerClass = 'marker-red';
                    } else if (trip.tripId && trip.tripId.includes('B_RD')) {
                        markerClass = 'marker-blue';
                    }
 
                    var customIcon = L.divIcon({
                        className: 'custom-div-icon',
                        html: '<div class="bus-marker ' + markerClass + '" style="width: 30px; height: 30px;">' + routeNum + '</div>',
                        iconSize: [30, 30],
                        iconAnchor: [15, 15]
                    });
 
                    var marker = L.marker([lat, lon], {icon: customIcon});
 
                    var popupSadrzaj = '<b>Linija:</b> ' + routeNum + '<br>' +
                                       '<b>Vozilo:</b> ' + info.vehicle.label + '<br>' +
                                       '<b>Polazak:</b> ' + trip.startTime;
                    marker.bindPopup(popupSadrzaj);
 
                    markersLayer.addLayer(marker);
                }
            });
        }
 
        ucitajAutobuse();
 
    </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
