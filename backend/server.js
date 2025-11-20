import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// --- 1. STARTUP CHECKS & CONFIG ---
console.log('--- Checking Environment Variables on STARTUP ---');
const apiKeyFromEnv = process.env.GEMINI_API_KEY;
if (apiKeyFromEnv) {
  console.log(`GEMINI_API_KEY found. Ends with: ${apiKeyFromEnv.substring(apiKeyFromEnv.length - 4)}`);
} else {
  console.error('CRITICAL: GEMINI_API_KEY is missing!');
}
console.log('--- End Startup Check ---');

const app = express();
const PORT = process.env.PORT || 3001;

// --- MEMORY STORAGE (The Fix) ---
// This variable will remember the location across requests
let lastContextLocation = null; 

// Model Config
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash'; 
const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const DISABLE_GEMINI = (process.env.DISABLE_GEMINI || 'false').toLowerCase() === 'true';

// Middleware
const allowedOrigins = [
  'https://nodemesh-ai-frontend.onrender.com', 
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json());
const http = axios.create({ timeout: 15000 });

// --- 2. CORE HELPERS ---

function extractJson(text) {
  if (!text) return null;
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```|({[\s\S]*})/); 
  if (!jsonMatch) return null;
  const jsonString = jsonMatch[1] || jsonMatch[2]; 
  try {
    return JSON.parse(jsonString.trim()); 
  } catch (error) {
    console.error('Failed to parse JSON:', error.message);
    return null;
  }
}

async function callGemini(prompt, model = GEMINI_MODEL) {
  if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');

  const modelsToTry = [model, 'gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastError;

  for (const m of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_API_KEY}`;
    try {
      const response = await http.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        safetySettings: [
            { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
        ]
      });

      const candidates = response.data?.candidates;
      if (!candidates?.length) throw new Error('No candidates returned');
      
      return candidates[0].content.parts[0].text;
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      if (status !== 429 && status !== 503) break; // Don't retry on permanent errors
      console.warn(`Model ${m} failed (${status}). Retrying fallback...`);
    }
  }
  throw lastError;
}

// --- 3. INTENT DETECTION ---

function fallbackIntentDetection(userMessage) {
    const lower = userMessage.toLowerCase();
    const weatherKeywords = /(weather|forecast|temp|rain|snow|storm|climate|wind|humidity)/i;
    const newsKeywords = /(news|headline|article|update|breaking|latest)/i;

    if (weatherKeywords.test(lower)) return { intent: 'weather', location: '', activity: '' };
    if (newsKeywords.test(lower)) return { intent: 'news', topic: '' };
    return { intent: 'general' };
}

async function detectIntent(userMessage) {
  // UPDATE: Asked Gemini to ALWAYS extract location if present, regardless of intent
  const prompt = `Classify the user message into: "weather", "news", or "general".
- Extract "location" if ANY city or country is mentioned in the message, regardless of the intent.
    (Default ambiguous cities like 'Delhi' to 'Delhi, India').
- If user asks about outdoor activities (fishing/surfing/walking/stroll), set intent to "weather" and extract "activity".
- If "news", extract "topic".
- Respond ONLY with JSON: {"intent": "...", "location": "...", "topic": "...", "activity": "..."}
User: "${userMessage}"`;

  try {
    if (!DISABLE_GEMINI) {
        const raw = await callGemini(prompt); 
        const parsed = extractJson(raw);
        if (parsed && parsed.intent) return parsed;
    }
  } catch (error) {
    console.error('Gemini intent detection failed:', error.message);
  }
  return fallbackIntentDetection(userMessage);
}

// --- 4. ANALYZERS (SENTIMENT & SARCASM) ---

async function analyzeSarcasm(userMessage) {
  const prompt = `Analyze for sarcasm. JSON: {"is_sarcastic": boolean, "intended_meaning": "string"}. Message: "${userMessage}"`;
  try {
    const raw = await callGemini(prompt); 
    return extractJson(raw); 
  } catch (error) { return null; }
}

async function analyzeSentiment(userMessage) {
  const prompt = `Does the user sound "low", "sad", "depressed", "anxious", "tired", or "worried"? JSON: {"is_low_mood": boolean}. Message: "${userMessage}"`;
  try {
    const raw = await callGemini(prompt);
    return extractJson(raw);
  } catch (error) { return { is_low_mood: false }; }
}

async function getGitaSupport(userMessage) {
  const prompt = `You are a wise spiritual guide rooted in the Bhagavad Gita. The user is feeling low/anxious.
  Respond STRICTLY in this JSON format:
  {
    "sanskrit": "Sanskrit verse",
    "english_transliteration": "English letters",
    "meaning": "Comforting explanation connecting verse to: ${userMessage}"
  }`;
  try {
    const raw = await callGemini(prompt);
    return extractJson(raw);
  } catch (error) { return null; }
}

// --- 5. HANDLERS ---

async function handleWeather(location, activity) {
  if (!WEATHER_API_KEY) return 'Weather service is not configured.';
  
  // Sanitize Location
  let queryLocation = location;
  if (typeof location === 'object' && location !== null) {
    queryLocation = location.city || location.name || location.location || JSON.stringify(location);
  }
  queryLocation = String(queryLocation).trim();

  if (queryLocation.toLowerCase() === 'delhi') queryLocation = 'New Delhi, India';
  if (!queryLocation) return 'Please provide a valid location.';

  try {
    const { data } = await http.get('https://api.weatherapi.com/v1/forecast.json', {
      params: { key: WEATHER_API_KEY, q: queryLocation, days: 1, aqi: 'no', alerts: 'no' }
    });

    const c = data.current;
    const loc = data.location;
    const astro = data.forecast?.forecastday?.[0]?.astro;

    let timeInfo = '';
    if (loc.localtime) {
        const localDate = new Date(loc.localtime);
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = dayNames[localDate.getDay()];
        const dateStr = localDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = localDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        timeInfo = `📅 ${dayName}, ${dateStr} 🕐 Local Time: ${timeStr}\n`;
    }

    let response = `**Weather for ${loc.name}, ${loc.region}, ${loc.country}**\n${timeInfo}` +
                   `**Condition:** ${c.condition.text}\n` +
                   `🌡️ **Temp:** ${c.temp_c}°C (Feels like: ${c.feelslike_c}°C)\n` +
                   `💧 **Humidity:** ${c.humidity}%\n` +
                   `💨 **Wind:** ${c.wind_kph} km/h ${c.wind_dir}\n` +
                   `🌅 **Sunrise:** ${astro?.sunrise || 'N/A'} | 🌇 **Sunset:** ${astro?.sunset || 'N/A'}`;

    if (activity) {
        const advicePrompt = `
        User wants to know if it's good for: "${activity}".
        Weather: ${c.condition.text}, ${c.temp_c}C, Wind ${c.wind_kph}kph, Humidity ${c.humidity}%.
        Provide a recommendation starting with "✅ Yes", "❌ No", or "⚠️ Maybe" and explain why based on the data.`;
        
        try {
            const advice = await callGemini(advicePrompt);
            response += `\n\n**Activity Outlook (${activity}):**\n${advice}`;
        } catch (e) { response += `\n\n(Could not generate specific advice for ${activity})`; }
    }

    return response;

  } catch (error) {
    console.error(`Weather Error for "${queryLocation}":`, error.response?.data || error.message);
    return `I couldn't find weather information for "${queryLocation}".`;
  }
}

function extractNewsKeywords(text) {
    if (!text) return '';
    const blacklist = ['news','headline','latest','about','on','for','update'];
    return text.toLowerCase().split(/\s+/).filter(w => !blacklist.includes(w) && w.length > 2).join(' ');
}

async function handleNews(topic, originalMessage) {
    if (!NEWS_API_KEY) return 'News service is not configured.';

    try {
        const prompt = `Summarize the latest news request: "${originalMessage}". If specific facts, list them. Under 200 words.`;
        const raw = await callGemini(prompt);
        if (raw && !raw.includes("cannot fulfill")) return raw; 
    } catch (e) { console.warn("Gemini news summary failed, using API fallback."); }

    const keywords = extractNewsKeywords(topic || originalMessage);
    try {
        const { data } = await http.get('https://newsapi.org/v2/top-headlines', {
            params: { country: 'us', category: keywords ? undefined : 'general', q: keywords || undefined, pageSize: 5 },
            headers: { 'X-Api-Key': NEWS_API_KEY }
        });

        if (!data.articles?.length) return "No recent news articles found.";

        const articles = data.articles.map((a, i) => 
            `**${i + 1}. ${a.title}**\n   📰 *${a.source.name}*` + (a.url ? ` • [Read](${a.url})` : '')
        ).join('\n\n');
        
        return `**📰 Latest Headlines:**\n\n${articles}`;
    } catch (e) { return "Sorry, I couldn't fetch the news right now."; }
}

async function handleGeneralResponse(userMessage) {
  const lower = userMessage.toLowerCase();
  const distressKeywords = [
    'worried', 'worry', 'anxious', 'anxiety', 'sad', 'depressed', 'scared', 
    'fear', 'stress', 'tired', 'burnout', 'fail', 'failure', 'exam', 'results', 'sleep', 'lost'
  ];
  const hasDistressKeyword = distressKeywords.some(word => lower.includes(word));

  let sarcasmResult = null;
  let sentimentResult = { is_low_mood: hasDistressKeyword }; 

  if (!DISABLE_GEMINI) {
    const tasks = [analyzeSarcasm(userMessage)];
    if (!hasDistressKeyword) tasks.push(analyzeSentiment(userMessage));

    try {
      const results = await Promise.all(tasks);
      sarcasmResult = results[0];
      if (!hasDistressKeyword && results[1]) sentimentResult = results[1];
    } catch (e) { console.error("Analysis failed", e); }
  }

  if (sentimentResult?.is_low_mood) {
    console.log(">> Low mood detected. Fetching Gita wisdom...");
    const gitaData = await getGitaSupport(userMessage);
    if (gitaData) {
      return `I sense you might be going through a tough moment. Here is some timeless wisdom from the Bhagavad Gita:\n\n` +
             `**${gitaData.sanskrit}**\n` +
             `*${gitaData.english_transliteration}*\n\n` +
             `${gitaData.meaning}`;
    }
  }

  let instruction = `You are NodeMesh, a helpful AI assistant. Answer concisely.`;
  if (sarcasmResult?.is_sarcastic) {
    instruction += `\nCONTEXT: The user is being sarcastic (Intended: "${sarcasmResult.intended_meaning}"). Be witty/playful back.`;
  }

  try {
    const raw = await callGemini(`${instruction}\nUser: "${userMessage}"`);
    return raw.trim();
  } catch (e) { return "I'm here if you need to talk."; }
}

// --- 6. ENDPOINTS ---

app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required.' });

  try {
    console.log(`\nNew Request: "${message}"`);
    
    // 1. Detect intent
    // Note: 'location' might be detected here even if intent is 'general'
    let { intent, location, topic, activity } = await detectIntent(message);
    
    // --- CONTEXT MEMORY LOGIC ---
    // If a new location was found, save it.
    if (location && typeof location === 'string' && location.length > 0) {
        lastContextLocation = location;
        console.log(`📍 Context Updated: Location set to "${lastContextLocation}"`);
    }

    // If no location found in THIS message, but we need one, check memory.
    if (!location && (intent === 'weather' || activity)) {
        if (lastContextLocation) {
            location = lastContextLocation;
            console.log(`🧠 Context Recall: Using saved location "${location}"`);
        }
    }
    // ----------------------------

    let reply;

    if (intent === 'weather') {
      reply = await handleWeather(location, activity);
    } else if (intent === 'news') {
      reply = await handleNews(topic, message);
    } else {
      reply = await handleGeneralResponse(message);
    }

    res.json({ reply, intent, location, topic });

  } catch (error) {
    console.error('Server Error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/', (_req, res) => res.send('NodeMesh Backend Running'));
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
