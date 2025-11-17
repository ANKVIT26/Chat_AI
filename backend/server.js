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
  
  // 3. SECONDARY FALLBACK: Use gemini-2.0-flash
  if (!modelsToTry.includes('gemini-2.0-flash')) modelsToTry.push('gemini-2.0-flash');

  // gemini-pro removed due to previous 404 errors
  let lastError;
  for (const m of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_API_KEY}`;
    console.log(`Attempting Gemini call to model: ${m}`);
    try {
      const response = await http.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        
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
    const forecastEndpoint = 'https://api.weatherapi.com/v1/forecast.json';
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

    try {
        const geminiPrompt = `You are a responsible, helpful and factual news summarization assistant. 
        Please provide a concise answer to the following request based on current, verifiable information. 
        If a specific list or set of facts is requested, provide them directly. Keep the response under 250 words.
        Request: "${originalMessage}"`;

        console.log(`Attempting Gemini General Answer for News Request: "${originalMessage}"`);
        // Using the primary model (e.g., gemini-2.5-flash) for factual answering
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

    let endpoint = 'https://newsapi.org/v2/';
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

                const { data: fbData } = await http.get('https://newsapi.org/v2/top-headlines', {
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
async function analyzeSarcasm(userMessage) {
  // FEW-SHOT PROMPT: We give the model examples (shots) of what we want.
  const prompt = `
You are an expert in analyzing text for sarcasm. Respond STRICTLY with a JSON object.
Analyze the user's message for sarcasm. Identify the literal meaning vs. the intended meaning.

Example 1:
Message: "Oh, just great. My computer crashed right before my presentation. I'm so thrilled."
Analysis: {
  "is_sarcastic": true,
  "literal_meaning": "The user is thrilled and happy their computer crashed.",
  "intended_meaning": "The user is very annoyed and upset their computer crashed."
}

Example 2:
Message: "I just got a promotion! This is the best day!"
Analysis: {
  "is_sarcastic": false,
  "literal_meaning": "The user is happy about their promotion.",
  "intended_meaning": "The user is happy about their promotion."
}

Example 3:
Message: "You're a real genius."
Context: (This message was sent after the bot made a simple mistake)
Analysis: {
  "is_sarcastic": true,
  "literal_meaning": "The bot is a genius.",
  "intended_meaning": "The user thinks the bot made a dumb mistake."
}

---

Message: "${userMessage}"
Analysis:
  `;

  try {
    // Re-use your existing Gemini caller
    const raw = await callGemini(prompt); 
    return extractJson(raw); // Re-use your existing JSON extractor
  } catch (error) {
    console.warn("Sarcasm analysis failed (proceeding without it):", error.message);
    return null;
  }
}

async function getGitaSupport(userMessage) {
  const prompt = `
You are a wise and empathetic spiritual guide deeply versed in the Bhagavad Gita. 
The user is feeling low, tired, or anxious. Find the most relevant Shloka (verse) to soothe their specific state of mind.

Respond STRICTLY in this JSON format:
{
  "sanskrit": "The Sanskrit verse in Devanagari",
  "english_transliteration": "The verse in English letters",
  "meaning": "A comforting explanation of the verse connecting to the user's situation"
}

Example 1 (Anxiety/Worry):
User: "I'm so worried about the results of my exam, I can't sleep."
Response: {
  "sanskrit": "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन |",
  "english_transliteration": "Karmanye vadhikaraste Ma Phaleshu Kadachana",
  "meaning": "Krishna reminds us in Chapter 2, Verse 47: You have a right to perform your prescribed duties, but you are not entitled to the fruits of your actions. Let go of the anxiety over the result; focus only on doing your best right now."
}

Example 2 (Mental Exhaustion/Burnout):
User: "I just feel like giving up. My mind is constantly racing and I'm tired."
Response: {
  "sanskrit": "यतो यतो निश्चरति मनश्चञ्चलमस्थिरम् | ततस्ततो नियम्यैतदात्मन्येव वशं नयेत् ||",
  "english_transliteration": "Yato yato nishcharati manash chanchalam asthiram...",
  "meaning": "In Chapter 6, Verse 26, we are taught that whenever the restless and unsteady mind wanders, one must bring it back under the control of the Self. It is okay to be tired; gently bring your focus back to the present moment without judgment."
}

Example 3 (Feeling Low/Depressed):
User: "I feel really sad and low today, like nothing matters."
Response: {
  "sanskrit": "मात्रास्पर्शास्तु कौन्तेय शीतोष्णसुखदुःखदाः | आगमापायिनोऽनित्यास्तांस्तितिक्षस्व भारत ||",
  "english_transliteration": "Matra-sparshas tu kaunteya shitoshna-sukha-duhkha-dah...",
  "meaning": "Chapter 2, Verse 14 tells us that happiness and distress are temporary, like the appearance of winter and summer seasons. They arise from sense perception, and one must learn to tolerate them without being disturbed. This heaviness will pass."
}

---
User Message: "${userMessage}"
  `;

  try {
    if (!DISABLE_GEMINI) {
       const raw = await callGemini(prompt);
       return extractJson(raw); 
    }
    return null;
  } catch (error) {
    console.error("Gita support failed:", error.message);
    return null;
  }
}
async function analyzeSentiment(userMessage) {
  const prompt = `
  Analyze the sentiment of the following message. 
  Does the user sound "low", "sad", "depressed", "anxious", "tired", or "mentally exhausted"? 
  Respond with JSON: {"is_low_mood": true/false}
  
  Message: "${userMessage}"`;

  try {
    if (!DISABLE_GEMINI) {
        const raw = await callGemini(prompt);
        return extractJson(raw);
    }
    return { is_low_mood: false };
  } catch (error) {
    return { is_low_mood: false };
  }
}
/**
 * Handles general questions using Gemini.
 */
async function handleGeneralResponse(userMessage) {
  // 1. CONCURRENT ANALYSIS: Run all "meta-checks" in parallel
  // We use Promise.all to save time. Both checks run simultaneously.
  let sarcasmResult = null;
  let sentimentResult = null;

  if (!DISABLE_GEMINI) {
    console.log('Running concurrent analysis for:', userMessage);
    
    // Start both tasks independently
    const sarcasmTask = analyzeSarcasm(userMessage);
    const sentimentTask = analyzeSentiment(userMessage); // Ensure this function exists from previous steps

    // Wait for both to finish (or fail gracefully)
    try {
      [sarcasmResult, sentimentResult] = await Promise.all([sarcasmTask, sentimentTask]);
    } catch (error) {
      console.error("One of the analysis tasks failed:", error.message);
      // Continue execution; we can still generate a response without these insights
    }
  }

  // 2. CHECK FOR SPECIAL INTERVENTIONS (Gita Support)
  // If sentiment is low, we might override the standard response entirely
  if (sentimentResult?.is_low_mood) {
    console.log("Low mood detected. Attempting to fetch Gita wisdom...");
    const gitaResponse = await getGitaSupport(userMessage); // Ensure this function exists
    
    if (gitaResponse) {
      // Return the Gita response immediately, bypassing the standard persona
      return `I sense you might be going through a tough moment. Here is some timeless wisdom from the Bhagavad Gita:\n\n` +
             `**${gitaResponse.sanskrit}**\n` +
             `*${gitaResponse.english_transliteration}*\n\n` +
             `${gitaResponse.meaning}`;
    }
  }
  // 3. CONSTRUCT DYNAMIC SYSTEM INSTRUCTION
  // Start with your base persona
  let systemInstruction = `You are a helpful and friendly assistant named NodeMesh. Answer the user's message concisely and directly. Avoid unnecessary introductory phrases. If asked about your identity, mention you are NodeMesh, an AI assistant.`;

  // Inject Sarcasm Context (if detected)
  if (sarcasmResult?.is_sarcastic) {
    console.log('Sarcasm detected context added to prompt.');
    systemInstruction += `
    \n[IMPORTANT: TONE ANALYSIS]
    The user's input is SARCASTIC.
    - Literal Meaning: "${sarcasmResult.literal_meaning}"
    - INTENDED Meaning: "${sarcasmResult.intended_meaning}"
    
    Ignore the literal meaning. Respond directly to the INTENDED meaning.
    You may acknowledge the sarcasm gently, but ensure you address their actual frustration or intent.`;
  }

  // 4. FINAL GENERATION
  const prompt = `${systemInstruction}\nUser message: "${userMessage}"`;

  try {
    if (DISABLE_GEMINI) {
      throw new Error('Gemini disabled via env');
    }

    console.log('Generating final response...');
    const raw = await callGemini(prompt);
    const cleaned = raw.trim().replace(/^```[\s\S]*?\n([\s\S]*?)\n```$/, '$1').trim();
    return cleaned || "I received an empty response. Could you please rephrase?";

  } catch (error) {
    const errorMsg = error.message || String(error);
    if (!errorMsg.startsWith('Gemini')) {
      console.error('Gemini general response failed:', errorMsg);
    }
    return "I'm having trouble reaching my AI brain right now. You could try asking for weather or news updates.";
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
