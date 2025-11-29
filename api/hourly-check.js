// api/hourly-check.js
// Endpoint koji će UptimeRobot pozivati svaki sat

export default async function handler(req, res) {
  // Dozvoli samo GET zahteve
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🕐 Hourly check triggered at:', new Date().toISOString());
    
    // KORAK 1: Preuzmi podatke o vozilima
    const baseUrl = `https://${req.headers.host}`;
    const vehiclesResponse = await fetch(`${baseUrl}/api/vehicles`, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      }
    });

    if (!vehiclesResponse.ok) {
      throw new Error(`Vehicles API failed with status ${vehiclesResponse.status}`);
    }

    const vehiclesData = await vehiclesResponse.json();
    
    if (!vehiclesData || !vehiclesData.vehicles || vehiclesData.vehicles.length === 0) {
      console.log('⚠️ No vehicles found');
      return res.status(200).send('SUCCESS - No vehicles to update');
    }

    // KORAK 2: Učitaj stations i route names (potrebno za formatiranje)
    const [stationsResponse, routeNamesResponse] = await Promise.all([
      fetch(`${baseUrl}/api/stations`),
      fetch(`${baseUrl}/route-mapping.json`)
    ]);

    const stationsMap = await stationsResponse.json();
    const routeNamesMap = await routeNamesResponse.json();

    // KORAK 3: Kreiraj vehicleDestinations mapu
    const vehicleDestinations = {};
    if (vehiclesData.tripUpdates) {
      vehiclesData.tripUpdates.forEach(update => {
        vehicleDestinations[update.vehicleId] = update.destination;
      });
    }

    // KORAK 4: Formatiraj podatke za update-sheet
    const formattedVehicles = vehiclesData.vehicles.map(vehicle => {
      const destId = vehicleDestinations[vehicle.id] || "Unknown";
      
      // Normalizuj stop ID
      let normalizedId = destId;
      if (typeof destId === 'string' && destId.length === 5 && destId.startsWith('2')) {
        normalizedId = destId.substring(1);
        normalizedId = parseInt(normalizedId, 10).toString();
      }
      
      const station = stationsMap[normalizedId];
      const destName = station ? station.name : destId;
      
      // Normalizuj route ID
      let normalizedRouteId = vehicle.routeId;
      if (typeof vehicle.routeId === 'string') {
        normalizedRouteId = parseInt(vehicle.routeId, 10).toString();
      }
      
      const routeDisplayName = routeNamesMap[normalizedRouteId] || normalizedRouteId;
      
      return {
        vehicleLabel: vehicle.label,
        routeDisplayName: routeDisplayName,
        startTime: vehicle.startTime || "N/A",
        destName: destName
      };
    });

    console.log(`📊 Formatted ${formattedVehicles.length} vehicles for update`);

    // KORAK 5: Pozovi update-sheet endpoint
    const updateResponse = await fetch(`${baseUrl}/api/update-sheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        vehicles: formattedVehicles 
      })
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`Update failed with status ${updateResponse.status}: ${errorText}`);
    }

    const result = await updateResponse.json();
    
    console.log('✅ Hourly update completed:', result);
    
    // Vrati odgovor sa ključnom rečju "SUCCESS" za UptimeRobot
    const timestamp = new Date().toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    return res.status(200).send(
      `SUCCESS - Updated at ${timestamp} | ` +
      `Vehicles: ${result.totalProcessed || 0} | ` +
      `New: ${result.newVehicles || 0} | ` +
      `Updated: ${result.updatedVehicles || 0}`
    );
    
  } catch (error) {
    console.error('❌ Hourly check error:', error);
    
    const timestamp = new Date().toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    // Vrati ERROR da UptimeRobot zna da nešto nije u redu
    return res.status(500).send(
      `ERROR - Failed at ${timestamp}: ${error.message}`
    );
  }
}
