export default function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  // Return the API key from environment variables
  res.status(200).json({
    GROQ_API_KEY: process.env.GROQ_API_KEY || null
  });
}