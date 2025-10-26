import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// --- STARTUP DEBUG LOGGING ---
console.log('--- Checking Environment Variables on STARTUP ---');
const apiKeyFromEnv = process.env.GEMINI_API_KEY;
if (apiKeyFromEnv) {
  // Log key parts securely
  console.log(`GEMINI_API_KEY found on startup. Starts with: ${apiKeyFromEnv.substring(0, 5)}, Ends with: ${apiKeyFromEnv.substring(apiKeyFromEnv.length - 4)}`);
} else {
  console.log('GEMINI_API_KEY is NOT FOUND or empty in process.env on STARTUP!');
}
console.log('--- End Startup Check ---');
// --- END DEBUG LOGGING ---


const app = express();
const PORT = process.env.PORT || 3001;

// --- MODEL CONFIGURATION (Updated Default Model) ---
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'; // Set a modern, stable default
const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const DISABLE_GEMINI = (process.env.DISABLE_GEMINI || 'false').toLowerCase() === 'true';

const allowedOrigins = [
  'https://nodemesh-ai-frontend.onrender.com', // Ensure this matches your frontend URL
  'http://localhost:5173'
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
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));
app.options('*', cors({ // Handle preflight requests
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));


app.use(express.json());

// Axios instance with sane defaults
const http = axios.create({
  timeout: 15000,
});

/**
 * Robustly extracts and parses JSON that may be wrapped in Markdown code fences.
 */
function extractJson(text) {
  if (!text) return null;
  // Regex to capture content inside ```json...``` or a standalone {...}
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```|({[\s\S]*})/); 
  if (!jsonMatch) return null;
  
  // Use captured group 1 (from ```json) or group 2 (from standalone {})
  const jsonString = jsonMatch[1] || jsonMatch[2]; 
  if (!jsonString) return null;
  
  try {
    return JSON.parse(jsonString.trim()); 
  } catch (error) {
    console.error('Failed to parse JSON from Gemini response:', error.message, 'Raw text:', text);
    return null;
  }
}

/**
 * Calls the Gemini API with automatic model fallback and improved logging.
 */
async function callGemini(prompt, model = GEMINI_MODEL) {
  if (!GEMINI_API_KEY) {
    console.error('CRITICAL: Missing GEMINI_API_KEY environment variable in callGemini!');
    throw new Error('Missing GEMINI_API_KEY environment variable');
  }

  const modelsToTry = [];
  
  // 1. Primary Model (from env/default)
  if (model) modelsToTry.push(model);
  
  // 2. FIXED FALLBACK: Use gemini-2.5-flash for reliability and speed
  if (!modelsToTry.includes('gemini-2.5-flash')) modelsToTry.push('gemini-2.5-flash'); 
  
  // 3. SECONDARY FALLBACK: Use gemini-2.0-flash
  if (!modelsToTry.includes('gemini-2.0-flash')) modelsToTry.push('gemini-2.0-flash');

  // gemini-pro removed for reliability
  let lastError;
  for (const m of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_API_KEY}`;
    console.log(`Attempting Gemini call to model: ${m}`);
    try {
      const response = await http.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        
        // --- ADDED SAFETY SETTINGS TO LOWER THE THRESHOLD FOR BORDERLINE TOPICS ---
        safetySettings: [
            { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
        ]
        // --- END: ADDED SAFETY SETTINGS ---
      });

      const candidates = response.data?.candidates;
      if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        const promptFeedback = response.data?.promptFeedback;
        if (promptFeedback?.blockReason) {
            console.error(`Gemini request blocked for model ${m}. Reason: ${promptFeedback.blockReason}`);
            lastError = new Error(`Gemini request blocked (Reason: ${promptFeedback.blockReason})`);
            continue;
        }
        lastError = new Error('No candidates in Gemini response');
        continue;
      }
      
      const finishReason = candidates[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
          if (finishReason === 'SAFETY') {
              console.error(`Gemini generation stopped for model ${m} due to safety.`);
              lastError = new Error(`Gemini response blocked due to safety settings (Finish Reason: ${finishReason})`);
              continue;
          }
      }

      const parts = candidates[0]?.content?.parts;
      const textParts = parts
        ?.filter(part => part && typeof part.text === 'string')
        .map(part => part.text);

      const candidate = textParts?.join('');
      if (candidate) {
        if (m !== model && model) console.warn(`Gemini initial model ${model} failed, fell back to model: ${m}`);
        console.log(`Successfully received response from Gemini model: ${m}`);
        return candidate;
      }

      lastError = new Error('Empty text content from Gemini response');

    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const errorData = error.response?.data;

      console.error(`Gemini API error for model ${m}:`, error.message);
      if (errorData) {
        console.error(`Gemini API error details for ${m} (Status: ${status}):`, JSON.stringify(errorData, null, 2));
      }

      // Retry logic: Retry on temporary failures (503, 429) or network timeouts (ECONNABORTED)
      const retriable = status === 429 || status === 500 || status === 503 || error.code === 'ECONNABORTED'; 
      console.warn(`Gemini call failed for model ${m}${status ? ` (Status: ${status})` : ''}${error.code ? ` (Code: ${error.code})` : ''}. ${retriable ? 'Trying next fallback...' : ''}`);
      if (!retriable) break; 
    }
  }
  console.error('All Gemini model attempts failed.');
  throw lastError || new Error('Gemini call failed after trying all fallbacks');
}

/**
 * Fallback intent detection using regex, used if Gemini is disabled or fails.
 */
function fallbackIntentDetection(userMessage) {
    const lower = userMessage.toLowerCase();
    
    // --- EXPANDED WEATHER KEYWORDS ---
    const weatherKeywords = /(weather|forecast|temp|temperature|rain|snow|storm|climate|alert|alerts|wind|humidity|sun|cloudy|condition|conditions)/i;
    // --- END EXPANDED WEATHER KEYWORDS ---

    // --- EXPANDED NEWS KEYWORDS ---
    const newsKeywords = /(news|headline|headlines|article|articles|update|updates|breaking|latest|today's|report|current|developments)/i;
    // --- END EXPANDED NEWS KEYWORDS ---

    if (weatherKeywords.test(lower)) {
        let location = '';
        // Look for 'in/for/at LOCATION' or 'weather LOCATION' or 'how is LOCATION'
        const locationMatch = userMessage.match(/(?:in|for|at|weather|how is the|what is the|show me the)\s+([A-Z][A-Za-z\s,.'-]+)(?:[\.!,?]|$)/i);
        if (locationMatch && locationMatch[1]) {
            location = locationMatch[1].trim().replace(/['.]/g, '');
        }
        if (!location) {
             const cleaned = userMessage.replace(weatherKeywords, '').replace(/\b(?:what is|what's|how is|how's|tell me about|about|the|get me the)\b/gi, '').trim();
             if (cleaned && /^[A-Z]/.test(cleaned)) {
                location = cleaned.replace(/['.]/g, '');
             }
        }
        return { intent: 'weather', location: location || '', topic: '' };
    }

    if (newsKeywords.test(lower)) {
        let topic = '';
        // Look for 'about/on TOPIC' or 'news/headlines on/about TOPIC'
        const topicMatch = userMessage.match(/(?:about|on|regarding|of|news|headlines|latest|updates)\s+([A-Za-z0-9\s,.'-]+)(?:[\.!,?]|$)/i);
        if (topicMatch && topicMatch[1]) {
            topic = topicMatch[1].trim().replace(/['.]/g, '');
        }
        if (!topic) {
             const cleaned = userMessage.replace(newsKeywords, '').replace(/\b(?:about|on|regarding|of|for|the|latest|top|get me)\b/gi, '').trim();
             if (cleaned) {
                topic = cleaned.replace(/['.]/g, '');
             }
        }
        return { intent: 'news', location: '', topic: topic || '' };
    }

    return { intent: 'general', location: '', topic: '' };
}


/**
 * Uses Gemini for robust intent and entity extraction.
 */
async function detectIntent(userMessage) {
  // --- PROMPT OPTIMIZED FOR RELIABILITY AND SPEED ---
  const prompt = `Classify the user message into one intent: "weather", "news", or "general".
- If intent is "weather", extract the location (city, state, country). Use "" if no clear location.
- If intent is "news", extract the topic (e.g., "tech", "politics"). Use "" if no clear topic.
- Respond ONLY with a JSON object wrapped in \`\`\`json.
User: "${userMessage}"
Response strictly in JSON:`;
  // ------------------------------------------------------------------

  try {
    if (!DISABLE_GEMINI) {
        // Use the faster model explicitly for this quick task
        const raw = await callGemini(prompt, 'gemini-2.5-flash'); 
        const parsed = extractJson(raw);
        if (parsed && parsed.intent) {
            return {
                intent: parsed.intent.toLowerCase(), // Normalize the intent output
                location: parsed.location ?? '',
                topic: parsed.topic ?? '',
            };
        } else {
            console.warn('Failed to parse valid JSON intent from Gemini, using fallback. Raw:', raw);
        }
    }
  } catch (error) {
    console.error('Gemini intent detection failed, using fallback:', error.message || String(error));
  }

  return fallbackIntentDetection(userMessage);
}


/**
 * Handles the weather API call.
 */
async function handleWeather(location) {
  if (!WEATHER_API_KEY) {
    console.error('Missing WEATHER_API_KEY');
    return 'Weather service is not configured yet. Please add WEATHER_API_KEY.';
  }
  if (!location) {
    return 'Please provide a location so I can look up the weather for you.';
  }
  console.log(`Handling weather request for location: ${location}`);

  try {
    // FIX 1: Corrected URL from Markdown link to plain string
    const forecastEndpoint = '[https://api.weatherapi.com/v1/forecast.json](https://api.weatherapi.com/v1/forecast.json)';
    const { data: weatherData } = await http.get(forecastEndpoint, {
      params: {
        key: WEATHER_API_KEY,
        q: location,
        days: 1, 
        aqi: 'no',
        alerts: 'no',
      },
    });

    const loc = weatherData.location;
    const locationName = [loc?.name, loc?.region, loc?.country].filter(Boolean).join(', ') || location;
    
    const current = weatherData.current;
    if (!current) {
        throw new Error("Weather data unavailable for this location.");
    }
    
    const localTimeStr = loc?.localtime;
    let timeInfo = '';
     if (localTimeStr) {
         try {
             const localDate = new Date(localTimeStr.replace(' ', 'T'));
             const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
             const dayName = dayNames[localDate.getDay()];
             const dateStr = localDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
             const timeStr = localDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
             timeInfo = `📅 ${dayName}, ${dateStr}\n🕐 Local Time: ${timeStr}\n\n`;
         } catch (timeError) {
             console.warn("Could not parse location time:", localTimeStr, timeError);
         }
     }
    
    const tempText = typeof current?.temp_c === 'number' ? `${current.temp_c}°C` : 'N/A';
    const feelsLikeText = typeof current?.feelslike_c === 'number' ? `${current.feelslike_c}°C` : 'N/A';
    const humidityText = typeof current?.humidity === 'number' ? `${current.humidity}%` : 'N/A';
    const windText = typeof current?.wind_kph === 'number' ? `${current.wind_kph} km/h ${current?.wind_dir || ''}`.trim() : 'N/A';
    const sunriseText = weatherData.forecast?.forecastday?.[0]?.astro?.sunrise || 'N/A';
    const sunsetText = weatherData.forecast?.forecastday?.[0]?.astro?.sunset || 'N/A';

    let response = `**Weather for ${locationName}**\n`;
    response += timeInfo;
    response += `**Condition:** ${current?.condition?.text ?? 'N/A'}\n`;
    response += `🌡️ **Temp:** ${tempText} (Feels like: ${feelsLikeText})\n`;
    response += `💧 **Humidity:** ${humidityText}\n`;
    response += `💨 **Wind:** ${windText}\n`;
    response += `🌅 **Sunrise:** ${sunriseText}\n`;
    response += `🌇 **Sunset:** ${sunsetText}`;

    return response;

  } catch (error) {
    console.error('Weather API error:', error.message);
    if (error.response?.status === 400) {
      console.warn(`WeatherAPI returned 400 for location: ${location}`, error.response.data);
      return `I couldn't find weather information for "${location}". Please check the spelling or try a larger nearby city.`;
    }
    return 'Sorry, I encountered an issue while trying to retrieve the weather information.';
  }
}

/**
 * Handles news-related requests by first attempting a high-quality summary from Gemini,
 * and falling back to the NewsAPI if Gemini fails.
 */
function extractNewsKeywords(text) {
    if (!text) return '';
    const lower = text.toLowerCase();
    const blacklist = new Set([
        'news','headline','headlines','top','latest','get','me','what','is','are','the','a','an','to',
        'and','or','us','usa','about','on','regarding','of','in','for','tell','give','updates','update',
        'current', 'breaking', 'article', 'articles', 'information', 'summary', 'details'
    ]);
    return lower
        .replace(/[^a-z0-9\s-]/g, ' ') 
        .split(/\s+/)
        .filter(w => w && !blacklist.has(w) && w.length > 2 && !/^\d+$/.test(w))
        .slice(0, 5)
        .join(' ');
}

async function handleNews(topic, originalMessage) {
    if (!NEWS_API_KEY) {
        console.error('Missing NEWS_API_KEY');
        return 'News service is not configured yet. Please add NEWS_API_KEY.';
    }

    // 1. PRIMARY ATTEMPT: Use Gemini to answer the factual/summary question directly
    try {
        const geminiPrompt = `You are a helpful and factual news summarization assistant. 
        Please provide a concise answer to the following request based on current, verifiable information. 
        If a specific list or set of facts is requested, provide them directly. Keep the response under 150 words.
        Request: "${originalMessage}"`;

        console.log(`Attempting Gemini General Answer for News Request: "${originalMessage}"`);
        // Use the primary model for high-quality, reliable factual answering
        const raw = await callGemini(geminiPrompt, GEMINI_MODEL); 
        
        const cleaned = raw.trim().replace(/^```[\s\S]*?\n([\s\S]*?)\n```$/, '$1').trim();

        // Check if Gemini returned a useful, non-generic answer
        if (cleaned && !cleaned.toLowerCase().includes("cannot fulfill")) {
            console.log('Gemini successfully provided a direct answer for the news/fact query.');
            return cleaned;
        }

        // If Gemini fails to provide a good answer, fall through to News API search
        console.warn('Gemini failed to generate a direct answer. Falling back to NewsAPI search...');

    } catch (geminiError) {
        console.warn(`Gemini failed to answer the news request directly (${geminiError.message}). Falling back to NewsAPI...`);
        // Continue to NewsAPI logic below
    }


    // 2. FALLBACK ATTEMPT: Use NewsAPI search for headlines and articles
    
    const preparedTopic = (topic || '').trim();
    const derivedKeywords = extractNewsKeywords(preparedTopic || originalMessage);
    const hasSpecificKeywords = derivedKeywords.length > 0;

    // FIX 2a: Corrected URL from Markdown link to plain string
    let endpoint = '[https://newsapi.org/v2/](https://newsapi.org/v2/)';
    const baseParams = { pageSize: 5, language: 'en' };
    let params = { ...baseParams };
    let requestDescription = '';

    if (hasSpecificKeywords) {
        endpoint += 'everything';
        params.q = derivedKeywords;
        params.sortBy = 'relevancy';
        requestDescription = `about "${derivedKeywords}"`;
    } else {
        endpoint += 'top-headlines';
        params.country = 'us'; 
        params.category = 'general';
        requestDescription = 'general US top headlines';
    }

    function formatArticles(articles, categoryTitle) {
        if (!articles?.length) return null;

        const articleList = articles.map((article, index) => {
            const title = article.title ?? 'Untitled Article';
            const sourceName = article.source?.name ?? 'Unknown Source';
            const cleanedTitle = title.replace(new RegExp(`\\s+-\\s+${sourceName}$`), '').trim();
            const published = article.publishedAt
                ? new Date(article.publishedAt).toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
                : 'Unknown Date';
            const description = (article.description || article.content || '').replace(/<[^>]+>/g, '').replace(/\[\+\d+\s*chars\]$/, '').trim();
            const url = article.url ?? '';

            let formatted = `**${index + 1}. ${cleanedTitle}**\n`;
            formatted += `    📰 _${sourceName}_ • 🕐 ${published}\n`;
            if (description) {
                const shortDesc = description.length > 150 ? description.substring(0, 150) + '...' : description;
                formatted += `    ${shortDesc}\n`;
            }
            if (url && url.startsWith('http')) {
                formatted += `    🔗 [Read more](${url})\n`;
            }
            return formatted;
        }).filter(Boolean);

        return `**📰 ${categoryTitle}**\n\n${articleList.join('\n')}`;
    }

    try {
        const { data } = await http.get(endpoint, { params, headers: { 'X-Api-Key': NEWS_API_KEY } });

        if (!data.articles?.length) {
            if (hasSpecificKeywords) {
                console.log('Retrying NewsAPI /top-headlines with keywords or category...');
                const fallbackParams = { ...baseParams, country: 'us' };
                if(derivedKeywords) fallbackParams.q = derivedKeywords;
                else fallbackParams.category = 'general'; 

                // FIX 2b: Corrected URL from Markdown link to plain string
                const { data: fbData } = await http.get('[https://newsapi.org/v2/top-headlines](https://newsapi.org/v2/top-headlines)', {
                    params: fallbackParams,
                    headers: { 'X-Api-Key': NEWS_API_KEY }
                });

                if (!fbData.articles?.length) {
                    return `I couldn't find any recent news articles ${requestDescription}. Try different keywords?`;
                }
                
                const fallbackTitle = derivedKeywords ? `Top Headlines matching "${derivedKeywords}"` : "Today's General US Headlines";
                return formatArticles(fbData.articles, fallbackTitle);
            }
            return `I couldn't find any ${requestDescription} right now. Please try again later.`;
        }

        const categoryTitle = hasSpecificKeywords
            ? `News about "${derivedKeywords}"`
            : "Today's General US Headlines";

        return formatArticles(data.articles, categoryTitle);

    } catch (newsError) {
        console.error('News API request failed:', newsError.message);
        if (newsError.response?.data?.code === 'rateLimited') {
            return 'Sorry, I am currently unable to fetch news due to rate limits. Please try again later.';
        }
        return 'Sorry, I had trouble fetching the latest news just now. Please try again in a moment.';
    }
}

/**
 * Handles general questions using Gemini.
 */
async function handleGeneralResponse(userMessage) {
  // --- IMPROVED PROMPT FOR ESSAY GENERATION (Approx 200 words) ---
  const prompt = `You are a helpful and friendly AI assistant named NodeMesh. Write a cohesive, well-structured essay of approximately 200 words (about 300 tokens) on the following topic. Do not include any introductory or concluding conversational phrases outside of the essay itself.
Topic: "${userMessage}"`;
  // -------------------------------------------------------------
  
  try {
    if (DISABLE_GEMINI) {
        console.log('Gemini disabled, providing standard fallback for general response.');
        throw new Error('Gemini disabled via env');
    }
    console.log('Handling general response with Gemini for:', userMessage);
    
    // Use the model provided by the environment variable (or default)
    const raw = await callGemini(prompt); 
    
    // Basic cleanup: trim and remove potential markdown code fences if API wraps response
    const cleaned = raw.trim().replace(/^```[\s\S]*?\n([\s\S]*?)\n```$/, '$1').trim();
    return cleaned || "I received an empty response. Could you please rephrase?";

  } catch (error) {
    const errorMsg = error.message || String(error);
    if (!errorMsg.startsWith('Gemini')) { 
        console.error('Gemini general response failed:', errorMsg);
    }
    // This fallback message is returned to the user when the AI core fails.
    return "I'm currently having trouble connecting to my core AI functions. You could try asking for weather or news, or rephrase your question.";
  }
}


// --- MAIN CHAT ENDPOINT ---
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    console.warn('/chat endpoint called without message');
    return res.status(400).json({ error: 'Message is required.' });
  }
  console.log(`Received message: "${message}"`);

  try {
    const { intent, location, topic } = await detectIntent(message);
    let reply = "Sorry, I couldn't process that request."; 

    console.log(`Detected Intent: ${intent}, Location: ${location || 'N/A'}, Topic: ${topic || 'N/A'}`);

    if (intent === 'weather') {
      reply = await handleWeather(location);
    } else if (intent === 'news') {
      reply = await handleNews(topic, message);
    } else { // 'general' or any unexpected intent
      reply = await handleGeneralResponse(message);
    }

    console.log(`Sending reply (length: ${reply?.length || 0})`);
    return res.json({ reply, intent, location, topic });

  } catch (error) {
    console.error('Error in /chat endpoint processing:', error.message);
    
    if (error.message === 'Missing GEMINI_API_KEY environment variable') {
      return res.status(500).json({ error: 'Server configuration error: AI service key is missing.' });
    }

    // Generic fallback error for anything else that crashes the main endpoint thread
    return res.status(500).json({ error: 'Sorry, something went wrong while processing your request.' });
  }
});


// Simple health endpoints for connectivity checks
app.get('/', (_req, res) => {
  res.type('text/plain').send('NodeMesh Chat Backend OK'); 
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => { 
  console.log(`Server listening on port ${PORT}`);
  console.log(`Using Gemini Model: ${GEMINI_MODEL}`);
  console.log(`Gemini Disabled: ${DISABLE_GEMINI}`);
  console.log(`Allowed Origins: ${allowedOrigins.join(', ')}`);
});
