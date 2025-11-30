import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  // Očitaj koji fajl korisnik traži iz query parametra
  // Npr: /api/shapes?file=gradske ili /api/shapes (default)
  const fileType = req.query.file || 'default';
  
  try {
    let filePath;
    
    if (fileType === 'gradske') {
      filePath = path.join(process.cwd(), 'api', 'shapes_gradske.txt');
    } else {
      filePath = path.join(process.cwd(), 'api', 'shapes.txt');
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache za 1h
    res.status(200).send(fileContent);
  } catch (error) {
    console.error('Error reading shapes file:', error);
    res.status(500).json({ 
      error: 'Failed to load shapes data',
      file: fileType,
      details: error.message 
    });
  }
}
