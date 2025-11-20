export default function handler(req, res) {
  // Dodajte logiku za proveru autentifikacije
  const { auth } = req.query;
  
  if (auth !== 'your-secret-token') {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  // Servišite zaštićeni sadržaj
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <head><title>Zaštićena stranica</title></head>
      <body>
        <h1>Ovo je zaštićeni sadržaj</h1>
      </body>
    </html>
  `);
}
