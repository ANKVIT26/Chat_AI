import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const DISABLE_GEMINI = (process.env.DISABLE_GEMINI || 'false').toLowerCase() === 'true';

app.use(express.json());
// Replace with your actual frontend URL
const allowedOrigin = 'https://nodemesh-frontend.onrender.com';

app.use(cors({
  origin: allowedOrigin,
  credentials: true
}));

// Axios instance with sane defaults
const http = axios.create({
  timeout: 15000,
});

function extractJson(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('Failed to parse JSON from Gemini response:', error);
    return null;
  }
}

async function callGemini(prompt, model = GEMINI_MODEL, hasRetried = false) {
  if (!GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY environment variable');
  }

  const modelsToTry = [];
  // Start with requested model, then fallbacks
  if (model) modelsToTry.push(model);
  if (!modelsToTry.includes('gemini-2.0-flash')) modelsToTry.push('gemini-2.0-flash');
  if (!modelsToTry.includes('gemini-1.5-flash')) modelsToTry.push('gemini-1.5-flash');
  if (!modelsToTry.includes('gemini-pro')) modelsToTry.push('gemini-pro');

  let lastError;
  for (const m of modelsToTry) {
    // Use v1beta endpoint which is more stable
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_API_KEY}`;
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
      });
      
      // Safely extract text from response
      const candidates = response.data?.candidates;
      if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        lastError = new Error('No candidates in Gemini response');
        continue;
      }
      
      const parts = candidates[0]?.content?.parts;
      if (!parts || !Array.isArray(parts) || parts.length === 0) {
        lastError = new Error('No parts in Gemini response');
        continue;
      }
      
      // Collect text from all parts
      const textParts = parts
        .filter(part => part && typeof part.text === 'string')
        .map(part => part.text);
      
      if (textParts.length === 0) {
        lastError = new Error('No text content in Gemini response');
        continue;
      }
      
      const candidate = textParts.join('');
      if (candidate) {
        if (m !== model) console.warn(`Gemini fell back to model: ${m}`);
        return candidate;
      }
      
      lastError = new Error('Empty text in Gemini response');
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const errorData = error.response?.data;

      // Log more details for debugging
      console.error('Gemini API error:', error.message);
      if (errorData) {
        console.error('Gemini API error details:', JSON.stringify(errorData, null, 2));
      } else if (error.response) {
        console.error('Gemini API error response:', JSON.stringify(error.response, null, 2));
      } else {
        console.error('Gemini API error (no response):', error);
      }

      const retriable = status === 404 || status === 429 || status === 500 || status === 503;
      console.warn(`Gemini call failed for model ${m}${status ? ` (${status})` : ''}. ${retriable ? 'Trying next fallback...' : ''}`);
      if (!retriable) break;
    }
  }
  throw lastError || new Error('Gemini call failed');
}

function fallbackIntentDetection(userMessage) {
  const lower = userMessage.toLowerCase();
  const weatherKeywords = /(weather|forecast|temperature|rain|snow|storm|climate|alert|alerts|wind)/i;
  const newsKeywords = /(news|headline|headlines|article|articles|update|updates|breaking)/i;

  if (weatherKeywords.test(lower)) {
    let location = '';
    const locationMatch = userMessage.match(/(?:in|for|at)\s+([A-Za-z\s,]+?)(?:[\.!,?]|$)/i);
    if (locationMatch) {
      location = locationMatch[1].trim();
    }
    if (!location) {
      const cleaned = userMessage.replace(weatherKeywords, '').replace(/\b(?:in|for|at)\b/gi, '').trim();
      if (cleaned) {
        location = cleaned;
      }
    }
    return { intent: 'weather', location, topic: '' };
  }

  if (newsKeywords.test(lower)) {
    let topic = '';
    const topicMatch = userMessage.match(/(?:about|on|regarding|of)\s+([A-Za-z\s,]+?)(?:[\.!,?]|$)/i);
    if (topicMatch) {
      topic = topicMatch[1].trim();
    }
    if (!topic) {
      const cleaned = userMessage.replace(newsKeywords, '').replace(/\b(?:about|on|regarding|of)\b/gi, '').trim();
      if (cleaned) {
        topic = cleaned;
      }
    }
    return { intent: 'news', location: '', topic };
  }

  return { intent: 'general', location: '', topic: '' };
}

async function detectIntent(userMessage) {
  const prompt = `You will classify the following user message into one of three intents: "weather", "news", or "general".
If the intent is "weather", also extract the most relevant location mentioned (city or country). If you cannot find one, return an empty string.
If the intent is "news", also extract the topic or keywords the user is interested in. If none are provided, use an empty string.
Respond strictly in JSON with the shape {"intent": "weather|news|general", "location": "", "topic": ""}.
User message: "${userMessage}"`;

  try {
    if (!DISABLE_GEMINI) {
      const raw = await callGemini(prompt);
      const parsed = extractJson(raw);
      if (parsed) {
        return {
          intent: parsed.intent ?? 'general',
          location: parsed.location ?? '',
          topic: parsed.topic ?? '',
        };
      }
    }
  } catch (error) {
    const errorMsg = error.message || String(error);
    console.error('Gemini intent detection failed, using fallback:', errorMsg);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }

  return fallbackIntentDetection(userMessage);
}

async function handleWeather(location) {
  if (!WEATHER_API_KEY) {
    return 'Weather service is not configured yet. Please add WEATHER_API_KEY.';
  }
  if (!location) {
    return 'Please provide a location so I can look up the weather for you.';
  }

  try {
    // Use forecast endpoint to get current + astronomy data
    const forecastEndpoint = 'https://api.weatherapi.com/v1/forecast.json';
    const alertsEndpoint = 'https://api.weatherapi.com/v1/alerts.json';

    const { data: weatherData } = await http.get(forecastEndpoint, {
      params: {
        key: WEATHER_API_KEY,
        q: location,
        days: 1,
        aqi: 'no',
        alerts: 'no',
      },
    });

    let alertsData;
    try {
      const { data } = await http.get(alertsEndpoint, {
        params: {
          key: WEATHER_API_KEY,
          q: location,
        },
      });
      alertsData = data;
    } catch (alertsError) {
      if (alertsError.response?.status !== 400) {
        console.warn('Weather alerts fetch issue:', alertsError.message);
      }
    }

    // Extract location info
    const locationNameParts = [
      weatherData.location?.name,
      weatherData.location?.region,
      weatherData.location?.country,
    ].filter(Boolean);
    const locationName = locationNameParts.join(', ') || location;

    // Add a warning if the returned location does not closely match the requested location
    let locationWarning = '';
    if (location && weatherData.location?.name) {
      // Compare lowercased, trimmed, and remove spaces for fuzzy match
      const requested = location.toLowerCase().replace(/\s+/g, '');
      const returned = weatherData.location.name.toLowerCase().replace(/\s+/g, '');
      if (!returned.includes(requested) && !requested.includes(returned)) {
        locationWarning = `\n⚠️ Note: Showing weather for "${locationName}" (closest match to your request: "${location}")`;
      }
    }

    // Get local time info
    const localTime = weatherData.location?.localtime; // Format: "2025-10-18 14:30"
    const localDate = new Date(localTime);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[localDate.getDay()];
    const dateStr = localDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = localDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    // Current weather
    const condition = weatherData.current?.condition?.text ?? 'No condition reported';
    const tempC = weatherData.current?.temp_c;
    const feelsLikeC = weatherData.current?.feelslike_c;
    const humidity = weatherData.current?.humidity;
    const windKph = weatherData.current?.wind_kph;

    // Astronomy data from forecast
    const astro = weatherData.forecast?.forecastday?.[0]?.astro;
    const sunrise = astro?.sunrise;
    const sunset = astro?.sunset;

    const tempText = typeof tempC === 'number' ? `${tempC}°C` : 'unavailable';
    const feelsLikeText = typeof feelsLikeC === 'number' ? `${feelsLikeC}°C` : 'unavailable';
    const humidityText = typeof humidity === 'number' ? `${humidity}%` : 'unavailable';
    const windText = typeof windKph === 'number' ? `${windKph} km/h` : 'unavailable';
    const sunriseText = sunrise || 'unavailable';
    const sunsetText = sunset || 'unavailable';

  let response = `**Weather for ${locationName}**${locationWarning}\n`;
  response += `📅 ${dayName}, ${dateStr}\n`;
  response += `🕐 Local Time: ${timeStr}\n\n`;
  response += `**Current Conditions:** ${condition}\n`;
  response += `🌡️ **Temperature:** ${tempText} (feels like ${feelsLikeText})\n`;
  response += `💧 **Humidity:** ${humidityText}\n`;
  response += `💨 **Wind Speed:** ${windText}\n`;
  response += `🌅 **Sunrise:** ${sunriseText}\n`;
  response += `🌇 **Sunset:** ${sunsetText}`;

    const alerts = alertsData?.alerts?.alert ?? [];
    if (alerts.length > 0) {
      const alertLines = alerts.map((alert, index) => {
        const headline = alert.headline ?? 'Unnamed alert';
        const severity = alert.severity ? `Severity: ${alert.severity}.` : '';
        const urgency = alert.urgency ? ` Urgency: ${alert.urgency}.` : '';
        const areas = alert.areas ? ` Areas: ${alert.areas}.` : '';
        const expires = alert.expires ? ` Expires: ${alert.expires}.` : '';
        return `${index + 1}. ${headline} ${severity}${urgency}${areas}${expires}`.trim();
      });
      response += `\n\n**⚠️ Active Weather Alerts:**\n${alertLines.join('\n')}`;
    }

    return response;
  } catch (error) {
    if (error.response?.status === 400) {
      return `I couldn't find weather information for "${location}". Please double-check the location name.`;
    }
    console.error('Weather API error:', error.message);
    return 'Sorry, I ran into an issue retrieving the weather right now.';
  }
}

function extractNewsKeywords(text) {
  if (!text) return '';
  const lower = text.toLowerCase();
  // Remove common filler/news words and stopwords
  const blacklist = new Set([
    'news','headline','headlines','top','latest','get','me','whatever','you','u','have',
    'about','on','regarding','of','in','for','the','a','an','to','and','or','us','usa',
    'today','current'
  ]);
  return lower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !blacklist.has(w) && w.length > 2)
    .slice(0, 4) // keep it concise
    .join(' ');
}

async function handleNews(topic, originalMessage) {
  if (!NEWS_API_KEY) {
    return 'News service is not configured yet. Please add NEWS_API_KEY.';
  }
  const preparedTopic = (topic || '').trim();
  const derivedKeywords = extractNewsKeywords(preparedTopic || originalMessage);
  const hasKeywords = derivedKeywords.length > 0;

  const endpoint = 'https://newsapi.org/v2/top-headlines';
  const params = {
    country: 'us',
    pageSize: 5,
  };

  if (hasKeywords) {
    params.q = derivedKeywords;
  } else {
    params.category = 'business';
  }

  function formatArticles(articles, categoryTitle) {
    if (!articles?.length) return null;
    
    const articleList = articles.map((article, index) => {
      const title = article.title ?? 'Untitled article';
      const source = article.source?.name ?? 'Unknown source';
      const published = article.publishedAt 
        ? new Date(article.publishedAt).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          })
        : 'Unknown date';
      const url = article.url ?? '';
      const description = article.description ?? '';
      
      let formatted = `**${index + 1}. ${title}**\n`;
      formatted += `   📰 *${source}* • 🕐 ${published}\n`;
      if (description) {
        const shortDesc = description.length > 120 ? description.substring(0, 120) + '...' : description;
        formatted += `   ${shortDesc}\n`;
      }
      if (url) {
        formatted += `   🔗 [Read more](${url})\n`;
      }
      return formatted;
    });

    return `**📰 ${categoryTitle}**\n\n${articleList.join('\n')}`;
  }

  try {
    const { data } = await http.get(endpoint, { params, headers: { 'X-Api-Key': NEWS_API_KEY } });

    if (!data.articles?.length) {
      // Retry without keyword, fall back to general business headlines
      if (hasKeywords) {
        const fallbackParams = { country: 'us', category: 'business', pageSize: 5 };
        const { data: fb } = await http.get(endpoint, { params: fallbackParams, headers: { 'X-Api-Key': NEWS_API_KEY } });
        
        if (!fb.articles?.length) {
          // Try final fallback to /everything
          const from = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const { data: ev } = await http.get('https://newsapi.org/v2/everything', {
            params: { q: derivedKeywords || 'business', from, sortBy: 'publishedAt', language: 'en', pageSize: 5 },
            headers: { 'X-Api-Key': NEWS_API_KEY },
          });
          
          if (!ev.articles?.length) {
            return `I couldn't find any recent news articles${hasKeywords ? ` about "${derivedKeywords}"` : ''}.`;
          }
          
          return formatArticles(ev.articles, `Latest articles about "${derivedKeywords || 'business'}"`);
        }
        
        return formatArticles(fb.articles, "Today's Top US Business Headlines");
      }
      return `I couldn't find any news articles right now. Please try again later.`;
    }

    const categoryTitle = hasKeywords 
      ? `Latest on "${derivedKeywords}"`
      : "Today's Top US Business Headlines";
    
    return formatArticles(data.articles, categoryTitle);
  } catch (error) {
    if (error.response?.data) {
      console.error('News API error:', error.response.data);
    } else {
      console.error('News API error:', error.message);
    }
    return 'Sorry, I had trouble fetching the latest news just now. Please try again in a moment.';
  }
}

async function handleGeneralResponse(userMessage) {
  const prompt = `You are a helpful assistant. Answer the user's message in a concise and friendly way.
User message: "${userMessage}"`;
  try {
    if (DISABLE_GEMINI) {
      throw new Error('Gemini disabled via env');
    }
    const raw = await callGemini(prompt);
    return raw.trim();
  } catch (error) {
    const errorMsg = error.message || String(error);
    console.error('Gemini general response failed, using fallback:', errorMsg);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    return "I'm having trouble reaching my AI brain right now, but you can try again in a bit or ask for weather or news updates.";
  }
}

app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  try {
    const { intent, location, topic } = await detectIntent(message);
    let reply;

    if (intent === 'weather') {
      reply = await handleWeather(location);
    } else if (intent === 'news') {
      reply = await handleNews(topic, message);
    } else {
      reply = await handleGeneralResponse(message);
    }

    return res.json({ reply, intent, location, topic });
  } catch (error) {
    console.error('Chat endpoint error:', error);
    // If Gemini error details are present, include them in the response
    if (error.response?.data) {
      return res.status(500).json({ error: 'Gemini API error', details: error.response.data });
    }
    return res.status(500).json({ error: error.message || 'Something went wrong while processing your request.' });
  }
});

// Simple health endpoints for connectivity checks
app.get('/', (_req, res) => {
  res.type('text/plain').send('OK');
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

