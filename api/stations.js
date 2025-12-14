import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  const isAuthenticated = req.session?.user || req.cookies?.authToken;
  
  if (!isAuthenticated) {
    return res.status(401).json({ error: 'Unauthorized' }); // Vrati JSON grešku
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {

    const filePath = path.join(process.cwd(), 'public', 'all.json');
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const stations = JSON.parse(fileContent);


    const stationsMap = {};

    stations.forEach(station => {
      if (station.id && station.name && station.coords) {
        stationsMap[station.id] = {
          name: station.name,
          coords: [parseFloat(station.coords[0]), parseFloat(station.coords[1])]
        };
      }
    });

    res.status(200).json(stationsMap);

  } catch (error) {
    console.error('Error loading stations:', error);
    res.status(500).json({ 
      error: 'Failed to load stations',
      message: error.message 
    });
  }
}
