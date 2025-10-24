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

// ... (Keep all your functions: extractJson, callGemini, fallbackIntentDetection, detectIntent, handleWeather, handleNews, handleGeneralResponse) ...
// --- Make sure the rest of the code from the previous version is included here ---
function extractJson(text) {
  if (!text) return null; // Handle null/undefined input
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```|({[\s\S]*})/); // Look for ```json ... ``` or { ... }
  if (!jsonMatch) return null;
  const jsonString = jsonMatch[1] || jsonMatch[2]; // Use the captured group
  if (!jsonString) return null;
  try {
    return JSON.parse(jsonString.trim()); // Trim whitespace
  } catch (error) {
    console.error('Failed to parse JSON from Gemini response:', error, 'Raw text:', text);
    return null;
  }
}


async function callGemini(prompt, model = GEMINI_MODEL, hasRetried = false) {
  if (!GEMINI_API_KEY) {
    console.error('CRITICAL: Missing GEMINI_API_KEY environment variable in callGemini!');
    throw new Error('Missing GEMINI_API_KEY environment variable');
  }

  const modelsToTry = [];
  // Start with requested model, then fallbacks
  if (model) modelsToTry.push(model);
  if (!modelsToTry.includes('gemini-1.5-flash')) modelsToTry.push('gemini-1.5-flash'); // Use 1.5-flash as first fallback
  if (!modelsToTry.includes('gemini-pro')) modelsToTry.push('gemini-pro');

  let lastError;
  for (const m of modelsToTry) {
    // Use v1beta endpoint which is more stable
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_API_KEY}`;
    console.log(`Attempting Gemini call to model: ${m}`); // Log model being tried
    try {
      const response = await http.post(url, {
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        // Add generationConfig for safety settings if needed
        // generationConfig: {
        //   "safetySettings": [
        //       { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
        //       { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
        //       { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
        //       { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
        //   ]
        // }
      });

      // Safely extract text from response
      const candidates = response.data?.candidates;
      if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        // Check for promptFeedback which indicates blocking
        const promptFeedback = response.data?.promptFeedback;
        if (promptFeedback?.blockReason) {
            console.error(`Gemini request blocked for model ${m}. Reason: ${promptFeedback.blockReason}`);
            console.error('Safety Ratings:', JSON.stringify(promptFeedback.safetyRatings, null, 2));
            lastError = new Error(`Gemini request blocked due to safety settings (Reason: ${promptFeedback.blockReason})`);
            continue; // Try next model if possible
        }
        lastError = new Error('No candidates in Gemini response');
        console.error('No candidates in Gemini response for model:', m, 'Response Data:', JSON.stringify(response.data, null, 2));
        continue;
      }

      // Check candidate finishReason
      const finishReason = candidates[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
          console.error(`Gemini generation stopped for model ${m}. Reason: ${finishReason}`);
           // Check safety ratings on the candidate
          const safetyRatings = candidates[0]?.safetyRatings;
          if (safetyRatings) {
              console.error('Safety Ratings:', JSON.stringify(safetyRatings, null, 2));
          }
          if (finishReason === 'SAFETY') {
              lastError = new Error(`Gemini response blocked due to safety settings (Finish Reason: ${finishReason})`);
              continue; // Try next model if possible
          } else {
              lastError = new Error(`Gemini generation finished unexpectedly (Reason: ${finishReason})`);
              // Decide if other reasons are retriable or break-worthy
              // For now, let's continue to the next model for most non-STOP reasons
              continue;
          }
      }


      const parts = candidates[0]?.content?.parts;
      if (!parts || !Array.isArray(parts) || parts.length === 0) {
        lastError = new Error('No parts in Gemini response content');
         console.error('No parts in Gemini response content for model:', m, 'Candidate:', JSON.stringify(candidates[0], null, 2));
        continue;
      }

      // Collect text from all parts
      const textParts = parts
        .filter(part => part && typeof part.text === 'string')
        .map(part => part.text);

      if (textParts.length === 0) {
        lastError = new Error('No text content in Gemini response parts');
        console.error('No text content in Gemini response parts for model:', m, 'Parts:', JSON.stringify(parts, null, 2));
        continue;
      }

      const candidate = textParts.join('');
      if (candidate) {
        if (m !== model && model) console.warn(`Gemini initial model ${model} failed, fell back to model: ${m}`);
        console.log(`Successfully received response from Gemini model: ${m}`);
        return candidate;
      }

      lastError = new Error('Empty text after joining parts in Gemini response');
      console.error('Empty text after joining parts for model:', m);

    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const errorData = error.response?.data;

      // Log more details for debugging
      console.error(`Gemini API error for model ${m}:`, error.message);
      if (errorData) {
        console.error(`Gemini API error details for ${m}:`, JSON.stringify(errorData, null, 2));
      } else if (error.config) {
         // Log request config if no response data (e.g., timeout)
         console.error(`Gemini API request config for ${m}:`, { url: error.config.url, method: error.config.method, data: error.config.data });
      } else {
        console.error(`Gemini API error (no response) for ${m}:`, error);
      }


      const retriable = status === 429 || status === 500 || status === 503 || error.code === 'ECONNABORTED'; // Add timeout check
      console.warn(`Gemini call failed for model ${m}${status ? ` (Status: ${status})` : ''}${error.code ? ` (Code: ${error.code})` : ''}. ${retriable ? 'Trying next fallback...' : ''}`);
      if (!retriable) break; // Don't retry for 400, 404 etc unless specifically handled
    }
  }
   console.error('All Gemini model attempts failed.');
  throw lastError || new Error('Gemini call failed after trying all fallbacks');
}


function fallbackIntentDetection(userMessage) {
   const lower = userMessage.toLowerCase();
  const weatherKeywords = /(weather|forecast|temperature|rain|snow|storm|climate|alert|alerts|wind)/i;
  const newsKeywords = /(news|headline|headlines|article|articles|update|updates|breaking)/i;

  if (weatherKeywords.test(lower)) {
    let location = '';
    // Improved regex: look for 'in', 'for', 'at' followed by location, OR common phrases like 'weather <location>'
    const locationMatch = userMessage.match(/(?:in|for|at)\s+([A-Z][A-Za-z\s,.'-]+)(?:[\.!,?]|$)/i) ||
                          userMessage.match(/weather\s+([A-Z][A-Za-z\s,.'-]+)(?:[\.!,?]|$)/i);

    if (locationMatch && locationMatch[1]) {
      location = locationMatch[1].trim().replace(/['.]/g, ''); // Trim and remove stray quotes/periods
    }
    // Fallback: If no location found via preposition/prefix, try taking the rest of the string after removing keywords
    if (!location) {
      const cleaned = userMessage.replace(weatherKeywords, '').replace(/\b(?:what is|what's|how is|how's|tell me about|about|the)\b/gi, '').trim();
       // Check if the cleaned string looks like a potential location (starts with capital, etc.) - basic check
       if (cleaned && /^[A-Z]/.test(cleaned)) {
         location = cleaned.replace(/['.]/g, '');
       }
    }
    console.log('[Fallback Intent] Detected Weather for location:', location || 'Not Found');
    return { intent: 'weather', location: location || '', topic: '' };
  }

  if (newsKeywords.test(lower)) {
    let topic = '';
     // Improved regex: look for 'about', 'on', 'regarding' etc., or just take text after 'news'/'headlines'
    const topicMatch = userMessage.match(/(?:about|on|regarding|of)\s+([A-Za-z0-9\s,.'-]+)(?:[\.!,?]|$)/i) ||
                       userMessage.match(/(?:news|headlines|articles)\s+(?:on|about)?\s*([A-Za-z0-9\s,.'-]+)(?:[\.!,?]|$)/i);
    if (topicMatch && topicMatch[1]) {
      topic = topicMatch[1].trim().replace(/['.]/g, '');
    }
     // Fallback: Remove keywords and prepositions, take the rest
    if (!topic) {
       const cleaned = userMessage.replace(newsKeywords, '').replace(/\b(?:about|on|regarding|of|for|the|latest|top|get me)\b/gi, '').trim();
       if (cleaned) {
         topic = cleaned.replace(/['.]/g, '');
       }
    }
     console.log('[Fallback Intent] Detected News for topic:', topic || 'Not Found');
    return { intent: 'news', location: '', topic: topic || '' };
  }
   console.log('[Fallback Intent] Detected General');
  return { intent: 'general', location: '', topic: '' };
}

async function detectIntent(userMessage) {
  const prompt = `You will classify the following user message into one of three intents: "weather", "news", or "general".
If the intent is "weather", also extract the most relevant location mentioned (city, state, country, zip code, etc.). If you cannot find one, return an empty string for location.
If the intent is "news", also extract the specific topic or keywords the user is interested in (e.g., "stock market", "AI advancements", "local politics"). If none are clearly provided beyond "news" itself, use an empty string for topic.
Respond strictly in JSON format with the shape {"intent": "weather|news|general", "location": "extracted location or empty string", "topic": "extracted topic or empty string"}. Do not add any text before or after the JSON object. Example for weather in London: {"intent": "weather", "location": "London", "topic": ""} Example for news about tech: {"intent": "news", "location": "", "topic": "tech"} Example for a general question: {"intent": "general", "location": "", "topic": ""}
User message: "${userMessage}"`;

  try {
    if (!DISABLE_GEMINI) {
        console.log('Attempting Gemini intent detection for:', userMessage);
        const raw = await callGemini(prompt);
        console.log('Raw Gemini intent response:', raw);
        const parsed = extractJson(raw);
        if (parsed && parsed.intent) { // Ensure intent exists
            console.log('Parsed Gemini intent:', parsed);
            return {
                intent: parsed.intent, // Removed ?? 'general' here, rely on fallback if parsing fails
                location: parsed.location ?? '',
                topic: parsed.topic ?? '',
            };
        } else {
             console.warn('Failed to parse valid JSON intent from Gemini, using fallback.');
        }
    } else {
        console.log('Gemini disabled, using fallback intent detection.');
    }
  } catch (error) {
    const errorMsg = error.message || String(error);
    console.error('Gemini intent detection failed, using fallback:', errorMsg);
    // No need to log error.response.data here, it's logged within callGemini
  }

  // Fallback if Gemini is disabled, fails, or returns invalid JSON
  return fallbackIntentDetection(userMessage);
}


async function handleWeather(location) {
  if (!WEATHER_API_KEY) {
    console.error('Missing WEATHER_API_KEY');
    return 'Weather service is not configured yet. Please add WEATHER_API_KEY.';
  }
  if (!location) {
     console.warn('handleWeather called without location.');
    return 'Please provide a location so I can look up the weather for you.';
  }
   console.log(`Handling weather request for location: ${location}`);

  try {
    // Use forecast endpoint to get current + astronomy data
    const forecastEndpoint = 'https://api.weatherapi.com/v1/forecast.json';
    // Use alerts endpoint separately as forecast alerts might not always be reliable/present
    // const alertsEndpoint = 'https://api.weatherapi.com/v1/alerts.json'; // Decided against alerts for now based on previous code comments

    const { data: weatherData } = await http.get(forecastEndpoint, {
      params: {
        key: WEATHER_API_KEY,
        q: location,
        days: 1, // Only need current day data + minimal forecast for astro
        aqi: 'no',
        alerts: 'no', // Alerts via forecast endpoint can be unreliable
      },
    });

    // --- Removed separate alerts call based on original code structure ---

    // Extract location info robustly
    const loc = weatherData.location;
    const locationName = [loc?.name, loc?.region, loc?.country]
                            .filter(Boolean) // Remove null/empty strings
                            .join(', ') || location; // Fallback to original query

    // Add a warning if the returned location does not closely match the requested location
    let locationWarning = '';
    if (location && loc?.name) {
      const requestedLower = location.toLowerCase().replace(/[\s,.'-]/g, '');
      const returnedLower = loc.name.toLowerCase().replace(/[\s,.'-]/g, '');
       const regionLower = (loc.region || '').toLowerCase().replace(/[\s,.'-]/g, '');
       const countryLower = (loc.country || '').toLowerCase().replace(/[\s,.'-]/g, '');

      // Simple check: does any part of the returned name/region/country contain the request? Or vice-versa?
      if (!returnedLower.includes(requestedLower) &&
          !requestedLower.includes(returnedLower) &&
          !regionLower.includes(requestedLower) &&
          !countryLower.includes(requestedLower) &&
           // Also check if requested includes region/country for broader matches like "weather in USA"
           !requestedLower.includes(regionLower) &&
           !requestedLower.includes(countryLower) )
       {
        locationWarning = `\n⚠️ _Note: Showing weather for "${locationName}" as the closest match found for "${location}"._`;
      }
    }

    // Get local time info safely
    const localTimeStr = loc?.localtime; // Format: "2025-10-18 14:30"
    let timeInfo = '';
    if (localTimeStr) {
        try {
            const localDate = new Date(localTimeStr.replace(' ', 'T')); // Make ISO-like for better parsing
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayName = dayNames[localDate.getDay()];
            const dateStr = localDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            const timeStr = localDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            timeInfo = `📅 ${dayName}, ${dateStr}\n🕐 Local Time: ${timeStr}\n\n`;
        } catch (timeError) {
            console.warn("Could not parse location time:", localTimeStr, timeError);
        }
    }


    // Current weather safely
    const current = weatherData.current;
    const condition = current?.condition?.text ?? 'N/A';
    const tempC = current?.temp_c;
    const feelsLikeC = current?.feelslike_c;
    const humidity = current?.humidity;
    const windKph = current?.wind_kph;
    const windDir = current?.wind_dir;

    // Astronomy data from forecast safely
    const astro = weatherData.forecast?.forecastday?.[0]?.astro;
    const sunrise = astro?.sunrise;
    const sunset = astro?.sunset;

    // Format safely, providing defaults
    const tempText = typeof tempC === 'number' ? `${tempC}°C` : 'N/A';
    const feelsLikeText = typeof feelsLikeC === 'number' ? `${feelsLikeC}°C` : 'N/A';
    const humidityText = typeof humidity === 'number' ? `${humidity}%` : 'N/A';
    const windText = typeof windKph === 'number' ? `${windKph} km/h ${windDir || ''}`.trim() : 'N/A';
    const sunriseText = sunrise || 'N/A';
    const sunsetText = sunset || 'N/A';

    let response = `**Weather for ${locationName}**${locationWarning}\n`;
    response += timeInfo; // Add formatted time string if available
    response += `**Condition:** ${condition}\n`;
    response += `🌡️ **Temp:** ${tempText} (Feels like: ${feelsLikeText})\n`;
    response += `💧 **Humidity:** ${humidityText}\n`;
    response += `💨 **Wind:** ${windText}\n`;
    response += `🌅 **Sunrise:** ${sunriseText}\n`;
    response += `🌇 **Sunset:** ${sunsetText}`;

    // --- Removed alerts section ---

    return response;
  } catch (error) {
     console.error('Weather API error:', error.message);
     if (error.response?.status === 400) {
        // Specific error for location not found from WeatherAPI
        console.warn(`WeatherAPI returned 400 for location: ${location}`, error.response.data);
        return `I couldn't find weather information for "${location}". Please check the spelling or try a larger nearby city.`;
     }
      if (error.response?.data) {
           console.error('Weather API response data:', error.response.data);
      }
    return 'Sorry, I encountered an issue while trying to retrieve the weather information.';
  }
}

function extractNewsKeywords(text) {
  if (!text) return '';
  const lower = text.toLowerCase();
  // Remove common filler/news words and stopwords more aggressively
  const blacklist = new Set([
     'news','headline','headlines','top','latest','get','me','what','is','are','the','a','an','to',
     'and','or','us','usa','about','on','regarding','of','in','for','tell','give','updates','update',
     'current', 'breaking', 'article', 'articles', 'information', 'summary', 'details'
  ]);
  // Also remove very short words and pure numbers after splitting
  return lower
    .replace(/[^a-z0-9\s-]/g, ' ') // Allow hyphens in keywords
    .split(/\s+/)
    .filter(w => w && !blacklist.has(w) && w.length > 2 && !/^\d+$/.test(w))
    .slice(0, 5) // Allow slightly more keywords
    .join(' ');
}

async function handleNews(topic, originalMessage) {
  if (!NEWS_API_KEY) {
    console.error('Missing NEWS_API_KEY');
    return 'News service is not configured yet. Please add NEWS_API_KEY.';
  }

  const preparedTopic = (topic || '').trim();
  // Derive keywords from topic first, then fallback to original message if topic is empty
  const derivedKeywords = extractNewsKeywords(preparedTopic || originalMessage);
  const hasSpecificKeywords = derivedKeywords.length > 0;

  console.log(`Handling news request. Original topic: "${topic}", Original message: "${originalMessage}", Derived keywords: "${derivedKeywords}"`);


  const baseParams = { pageSize: 5, language: 'en' }; // Use language=en
  let endpoint = 'https://newsapi.org/v2/';
  let params = { ...baseParams };
  let requestDescription = '';


  if (hasSpecificKeywords) {
      endpoint += 'everything'; // Use /everything for keyword searches for better results
      params.q = derivedKeywords;
      params.sortBy = 'relevancy'; // 'publishedAt' or 'relevancy'
      requestDescription = `about "${derivedKeywords}"`;
       console.log(`NewsAPI /everything search with keywords: ${derivedKeywords}`);
  } else {
      endpoint += 'top-headlines';
      // Fallback categories if no keywords - more diverse than just business
      params.country = 'us'; // Top headlines are country-specific
      params.category = 'general'; // Broader category
      requestDescription = 'general US top headlines';
       console.log('NewsAPI /top-headlines search for general US news.');
  }


  function formatArticles(articles, categoryTitle) {
    if (!articles?.length) {
         console.log('formatArticles called with no articles.');
        return null;
    }

    const articleList = articles.map((article, index) => {
      const title = article.title ?? 'Untitled Article';
       // Remove source name if already in title (e.g., " - CNN")
       const sourceName = article.source?.name ?? 'Unknown Source';
       const cleanedTitle = title.replace(new RegExp(`\\s+-\\s+${sourceName}$`), '').trim();

      const published = article.publishedAt
        ? new Date(article.publishedAt).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
          })
        : 'Unknown Date';
      const url = article.url ?? '';
       // Clean up description if present
      const description = (article.description || article.content || '')
                            .replace(/<[^>]+>/g, '') // Remove HTML tags
                            .replace(/\[\+\d+\s*chars\]$/, '') // Remove "[+1234 chars]"
                            .trim();


      let formatted = `**${index + 1}. ${cleanedTitle}**\n`;
      formatted += `   📰 _${sourceName}_ • 🕐 ${published}\n`;
      if (description) {
        // Limit description length more reasonably
        const shortDesc = description.length > 150 ? description.substring(0, 150) + '...' : description;
        formatted += `    L ${shortDesc}\n`; // Use a different marker?
      }
      if (url && url.startsWith('http')) { // Ensure URL is valid
        formatted += `   🔗 [Read more](${url})\n`;
      }
      return formatted;
    }).filter(Boolean); // Filter out any potentially empty entries if formatting fails

    if (articleList.length === 0) return null; // Check again after filtering

    return `**📰 ${categoryTitle}**\n\n${articleList.join('\n')}`;
  }


  try {
    const { data } = await http.get(endpoint, { params, headers: { 'X-Api-Key': NEWS_API_KEY } });

     console.log(`NewsAPI Response Status: ${data.status}, Total Results: ${data.totalResults}`);

    if (!data.articles?.length) {
       console.warn(`No articles found for initial request: ${requestDescription}`);
      // If keyword search (/everything) failed, try /top-headlines with keywords OR category fallback
      if (hasSpecificKeywords) {
          console.log('Retrying NewsAPI /top-headlines with keywords or category...');
          const fallbackParams = { ...baseParams, country: 'us' };
          if(derivedKeywords) fallbackParams.q = derivedKeywords; // Try top headlines with same keyword
          else fallbackParams.category = 'general'; // Or general if keywords were weak

          const { data: fbData } = await http.get('https://newsapi.org/v2/top-headlines', {
              params: fallbackParams,
              headers: { 'X-Api-Key': NEWS_API_KEY }
          });

           console.log(`NewsAPI Fallback Response Status: ${fbData.status}, Total Results: ${fbData.totalResults}`);

          if (!fbData.articles?.length) {
               console.warn(`No articles found even in fallback request.`);
              return `I couldn't find any recent news articles ${requestDescription}. Try different keywords?`;
          }

          const fallbackTitle = derivedKeywords ? `Top Headlines matching "${derivedKeywords}"` : "Today's General US Headlines";
          return formatArticles(fbData.articles, fallbackTitle);
      }
      // If initial request was already /top-headlines and failed
      return `I couldn't find any ${requestDescription} right now. Please try again later.`;
    }

    // Success on first try
    const categoryTitle = hasSpecificKeywords
      ? `News about "${derivedKeywords}"`
      : "Today's General US Headlines";

    return formatArticles(data.articles, categoryTitle);

  } catch (error) {
     console.error('News API request failed:', error.message);
    if (error.response?.data) {
        // Log specific NewsAPI error codes/messages
      console.error('News API Error Details:', error.response.data);
       if(error.response.data.code === 'rateLimited') {
           return 'Sorry, I am currently unable to fetch news due to rate limits. Please try again later.';
       }
       if(error.response.data.code === 'apiKeyInvalid' || error.response.data.code === 'apiKeyMissing') {
           return 'News service API key is invalid or missing. Please contact the administrator.';
       }
    }
    return 'Sorry, I had trouble fetching the latest news just now. Please try again in a moment.';
  }
}

async function handleGeneralResponse(userMessage) {
  const prompt = `You are a helpful and friendly assistant named NodeMesh. Answer the user's message concisely and directly. Avoid unnecessary introductory phrases. If asked about your identity, mention you are NodeMesh, an AI assistant.
User message: "${userMessage}"`;
  try {
    if (DISABLE_GEMINI) {
        console.log('Gemini disabled, providing standard fallback for general response.');
      throw new Error('Gemini disabled via env');
    }
     console.log('Handling general response with Gemini for:', userMessage);
    const raw = await callGemini(prompt);
     console.log('Raw Gemini general response:', raw);
    // Basic cleanup: trim and remove potential markdown code fences if API wraps response
    const cleaned = raw.trim().replace(/^```[\s\S]*?\n([\s\S]*?)\n```$/, '$1').trim();
    return cleaned || "I received an empty response. Could you please rephrase?"; // Handle empty response case
  } catch (error) {
    const errorMsg = error.message || String(error);
    // Error already logged in callGemini if it's an API error
    if (!errorMsg.startsWith('Gemini')) { // Log only if it's not already logged
        console.error('Gemini general response failed:', errorMsg);
    }
    // Provide a slightly more informative fallback
    return "I'm currently having trouble connecting to my core AI functions. You could try asking for weather or news, or rephrase your question.";
  }
}


// --- MAIN CHAT ENDPOINT ---
app.post('/chat', async (req, res) => {
  // --- REMOVED DEBUG LOGGING FROM HERE ---
  // console.log('--- Debugging Environment Variables ---');
  // ...
  // console.log('--- End Debugging ---');
  // --- END REMOVED LOGGING ---

  const { message } = req.body;
  if (!message) {
    console.warn('/chat endpoint called without message');
    return res.status(400).json({ error: 'Message is required.' });
  }
   console.log(`Received message: "${message}"`);

  try {
    const { intent, location, topic } = await detectIntent(message);
    let reply = "Sorry, I couldn't process that request."; // Default reply

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
     // Log the specific error at the endpoint level
    console.error('Error in /chat endpoint processing:', error.message);
     // If it's a known error type (like from callGemini), it might already be logged in detail.
     // Log stack trace for unexpected errors
     if (!error.response && !error.message.startsWith('Gemini')) {
         console.error(error.stack);
     }

    // Check if it's the specific "Missing GEMINI_API_KEY" error from callGemini
    if (error.message === 'Missing GEMINI_API_KEY environment variable') {
        return res.status(500).json({ error: 'Server configuration error: AI service key is missing.' });
    }

    // Check if error object has Gemini API error details attached (less likely now as handled in callGemini)
    if (error.response?.data && error.config?.url?.includes('googleapis')) {
      console.error('Re-logging Gemini API error details at endpoint:', JSON.stringify(error.response.data, null, 2));
      return res.status(500).json({ error: 'AI service request failed.', details: error.response.data.error?.message || 'Unknown API error' });
    }

    // Generic fallback error
    return res.status(500).json({ error: 'Sorry, something went wrong while processing your request.' });
  }
});


// Simple health endpoints for connectivity checks
app.get('/', (_req, res) => {
  res.type('text/plain').send('NodeMesh Chat Backend OK'); // Slightly more descriptive
});

app.get('/healthz', (_req, res) => {
  // Could add checks here (e.g., can reach Gemini auth endpoint) if needed
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => { // Ensure listening on all interfaces for Render
  console.log(`Server listening on port ${PORT}`);
  // Log critical environment variables (excluding keys) on startup for verification
  console.log(`Using Gemini Model: ${GEMINI_MODEL}`);
  console.log(`Gemini Disabled: ${DISABLE_GEMINI}`);
  console.log(`Allowed Origins: ${allowedOrigins.join(', ')}`);
});