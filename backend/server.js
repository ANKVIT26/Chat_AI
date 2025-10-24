import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// --- VERY IMPORTANT DEBUG LOGGING ---
console.log('--- Checking Environment Variables on STARTUP ---');
const apiKeyFromEnv = process.env.GEMINI_API_KEY;
if (apiKeyFromEnv) {
  console.log(`GEMINI_API_KEY found on startup. Starts with: ${apiKeyFromEnv.substring(0, 5)}, Ends with: ${apiKeyFromEnv.substring(apiKeyFromEnv.length - 4)}`);
} else {
  console.log('GEMINI_API_KEY is NOT FOUND or empty in process.env on STARTUP!');
}
console.log('--- End Startup Check ---');
// --- END DEBUG LOGGING ---


const app = express();
const PORT = process.env.PORT || 3001;

const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // This line still reads it for the rest of the app
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const DISABLE_GEMINI = (process.env.DISABLE_GEMINI || 'false').toLowerCase() === 'true';

const allowedOrigins = [
  'https://nodemesh-ai-frontend.onrender.com', // Ensure this matches your frontend URL
  'http://localhost:5173'
];
// (Keep the rest of your CORS setup, functions like callGemini, endpoints like /chat, etc., exactly as they were in the code you just provided)

// ... (rest of your code from the previous message) ...

// --- Make sure this part is also included at the end ---
app.get('/', (_req, res) => {
  res.type('text/plain').send('NodeMesh Chat Backend OK - Debug Build'); // Add identifier
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => { // Listen on 0.0.0.0 for Render
  console.log(`Server listening on port ${PORT}`);
  console.log(`Using Gemini Model: ${GEMINI_MODEL}`);
  console.log(`Gemini Disabled: ${DISABLE_GEMINI}`);
  console.log(`Allowed Origins: ${allowedOrigins.join(', ')}`);
});