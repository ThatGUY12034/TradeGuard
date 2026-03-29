// api/config.js
module.exports = function handler(req, res) {
  res.status(200).json({
    GROQ_API_KEY: process.env.GROQ_API_KEY || null
  });
};