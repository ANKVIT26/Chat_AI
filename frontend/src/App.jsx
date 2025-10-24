import { useState, useRef, useEffect } from "react";
import "./App.css";
import axios from "axios";
import ReactMarkdown from "react-markdown";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

function App() {
  // Dark mode state
  const [darkMode, setDarkMode] = useState(() => {
    // Try to use system preference on first load
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return true;
    }
    return false;
  });
  // Gemini API helper for general questions only
  async function callGemini(question) {
    try {
      const response = await axios({
        url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${
          import.meta.env.VITE_API_GENERATIVE_LANGUAGE_CLIENT
        }`,
        method: "post",
        data: {
          contents: [{ parts: [{ text: question }] }],
        },
      });
      return response.data.candidates[0].content.parts[0].text;
    } catch (error) {
      console.log(error);
      return "Sorry - Something went wrong. Please try again!";
    }
  }
  const [chatHistory, setChatHistory] = useState([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [generatingAnswer, setGeneratingAnswer] = useState(false);

  const chatContainerRef = useRef(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory, generatingAnswer]);

  async function generateAnswer(e) {
    e.preventDefault();
    if (!question.trim()) return;

    setGeneratingAnswer(true);
    const currentQuestion = question;
    setQuestion(""); // Clear input immediately after sending

    // Add user question to chat history
    setChatHistory(prev => [...prev, { type: 'question', content: currentQuestion }]);

    // Simple intent detection
    const lower = currentQuestion.toLowerCase();
    const isWeather = /(weather|update|forecast|temperature|rain|snow|storm|climate|alert|alerts|wind)/i.test(lower);
    const isNews = /(news|headline|headlines|article|articles|update|updates|breaking)/i.test(lower);

    try {
      let aiResponse;
      if (isWeather || isNews) {
        // Use backend for weather/news
        const response = await axios.post(`${API_BASE_URL}/chat`, { message: currentQuestion });
        aiResponse = response.data.reply;
      } else {
        // Use Gemini API directly for general questions
        aiResponse = await callGemini(currentQuestion);
      }
      setChatHistory(prev => [...prev, { type: 'answer', content: aiResponse }]);
      setAnswer(aiResponse);
    } catch (error) {
      console.error("Error:", error.response?.data || error.message);
      setAnswer("Sorry - Something went wrong. Please try again!");
    }
    setGeneratingAnswer(false);
  }

  return (
    <div className={`fixed inset-0 transition-colors duration-500 ${darkMode ? 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900' : 'bg-gradient-to-r from-blue-50 to-blue-100'}`}>
      <div className="h-full max-w-4xl mx-auto flex flex-col p-3">
        {/* Fixed Header */}
        <header className="flex items-center justify-between py-4">
          <a href="https://github.com/ANKVIT26" 
             target="_blank" 
             rel="noopener noreferrer"
             className="block">
            <h1 className={`text-4xl font-bold transition-colors ${darkMode ? 'text-cyan-300 hover:text-cyan-400' : 'text-blue-500 hover:text-blue-600'}`}>Chat AI</h1>
          </a>
          <button
            className={`ml-4 px-4 py-2 rounded-lg font-semibold shadow-md transition-all duration-200 focus:outline-none darkmode-toggle ${darkMode ? 'bg-gray-700 text-cyan-200 hover:bg-gray-600' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
            onClick={() => setDarkMode((d) => !d)}
            type="button"
            aria-label="Toggle dark mode"
          >
            {darkMode ? '🌙 Dark' : '☀️ Light'}
          </button>
        </header>

        {/* Scrollable Chat Container - Updated className */}
        <div 
          ref={chatContainerRef}
          className={`flex-1 overflow-y-auto mb-4 rounded-lg shadow-lg p-4 hide-scrollbar transition-colors duration-500 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}
        >
          {chatHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <div className={`rounded-xl p-8 max-w-2xl shadow-md ${darkMode ? 'bg-gray-900' : 'bg-blue-50'}`}> 
                <h2 className={`text-2xl font-bold mb-4 ${darkMode ? 'text-cyan-300' : 'text-blue-600'}`}>Welcome to Chat AI! 👋</h2>
                <p className={`mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}> 
                  I'm here to help you with anything you'd like to know. You can ask me about:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                  <div className={`p-4 rounded-lg shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer ${darkMode ? 'bg-gray-800 text-cyan-200 hover:bg-gray-700' : 'bg-white text-blue-700 hover:bg-blue-50'}`}> <span className="text-blue-500">💡</span> General knowledge </div>
                  <div className={`p-4 rounded-lg shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer ${darkMode ? 'bg-gray-800 text-cyan-200 hover:bg-gray-700' : 'bg-white text-blue-700 hover:bg-blue-50'}`}> <span className="text-blue-500">🔧</span> Technical questions </div>
                  <div className={`p-4 rounded-lg shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer ${darkMode ? 'bg-gray-800 text-cyan-200 hover:bg-gray-700' : 'bg-white text-blue-700 hover:bg-blue-50'}`}> <span className="text-blue-500">📝</span> Writing assistance </div>
                  <div className={`p-4 rounded-lg shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer ${darkMode ? 'bg-gray-800 text-cyan-200 hover:bg-gray-700' : 'bg-white text-blue-700 hover:bg-blue-50'}`}> <span className="text-blue-500">🤔</span> Problem solving </div>
                </div>
                <p className={`mt-6 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}> 
                  Just type your question below and press Enter or click Send!
                </p>
              </div>
            </div>
          ) : (
            <>
              {chatHistory.map((chat, index) => (
                <div key={index} className={`mb-4 ${chat.type === 'question' ? 'text-right' : 'text-left'}`}>
                  <div className={`inline-block max-w-[80%] p-3 rounded-lg overflow-auto hide-scrollbar transition-all duration-200 ${
                    chat.type === 'question' 
                      ? darkMode ? 'bg-cyan-700 text-white rounded-br-none hover:bg-cyan-800' : 'bg-blue-500 text-white rounded-br-none hover:bg-blue-600'
                      : darkMode ? 'bg-gray-700 text-cyan-100 rounded-bl-none hover:bg-gray-600' : 'bg-gray-100 text-gray-800 rounded-bl-none hover:bg-gray-200'
                  }`}>
                    <ReactMarkdown className="overflow-auto hide-scrollbar">{chat.content}</ReactMarkdown>
                  </div>
                </div>
              ))}
            </>
          )}
          {generatingAnswer && (
            <div className="text-left">
              <div className="inline-block bg-gray-100 p-3 rounded-lg animate-pulse">
                Thinking...
              </div>
            </div>
          )}
        </div>

        {/* Fixed Input Form */}
        <form onSubmit={generateAnswer} className={`rounded-lg shadow-lg p-4 transition-colors duration-500 ${darkMode ? 'bg-gray-900' : 'bg-white'}`}>
          <div className="flex gap-2">
            <textarea
              required
              className={`flex-1 border rounded p-3 focus:ring-2 resize-none transition-colors duration-200 ${darkMode ? 'bg-gray-800 border-gray-700 text-cyan-100 focus:border-cyan-400 focus:ring-cyan-400 placeholder-gray-400' : 'border-gray-300 focus:border-blue-400 focus:ring-blue-400'}`}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask anything..."
              rows="2"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  generateAnswer(e);
                }
              }}
            ></textarea>
            <button
              type="submit"
              className={`px-6 py-2 font-semibold rounded-md shadow-md transition-all duration-200 transform hover:scale-105 focus:outline-none send-btn ${darkMode ? 'bg-cyan-700 text-white hover:bg-cyan-800' : 'bg-blue-500 text-white hover:bg-blue-600'} ${generatingAnswer ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={generatingAnswer}
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
