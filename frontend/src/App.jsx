import { useState, useRef, useEffect } from "react";
import "./App.css";
import axios from "axios";
// IMPORTANT: We are now using these components instead of manual divs
// Ensure these import paths are correct based on where you saved the files.
// If they are in src/components, use "./components/ChatBubble".
// If they are in src directly, use "./ChatBubble".
import ChatBubble from "./components/ChatBubble"; 
import TypingIndicator from "./components/TypingIndicator";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

function App() {
  // Dark mode state
  const [darkMode, setDarkMode] = useState(() => {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return true;
    }
    return false;
  });

  const [chatHistory, setChatHistory] = useState([]);
  const [question, setQuestion] = useState("");
  const [generatingAnswer, setGeneratingAnswer] = useState(false);
  const chatContainerRef = useRef(null);

  // Auto-scroll to bottom
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
    setQuestion(""); 

    // Add user question to history
    setChatHistory(prev => [...prev, { type: 'question', content: currentQuestion }]);

    try {
      // Route everything to your backend
      const response = await axios.post(`${API_BASE_URL}/chat`, { 
        message: currentQuestion 
      });
      
      const aiResponse = response.data.reply;
      setChatHistory(prev => [...prev, { type: 'answer', content: aiResponse }]);
      
    } catch (error) {
      console.error("Error:", error.response?.data || error.message);
      const errorMessage = "Sorry - Something went wrong connecting to the server.";
      setChatHistory(prev => [...prev, { type: 'answer', content: errorMessage }]);
    }
    setGeneratingAnswer(false);
  }

  return (
    <div className={`fixed inset-0 transition-colors duration-500 ${darkMode ? 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900' : 'bg-gradient-to-r from-blue-50 to-blue-100'}`}>
      <div className="h-full max-w-4xl mx-auto flex flex-col p-3">
        
        {/* Header */}
        <header className="flex items-center justify-between py-4">
          <a href="https://github.com/ANKVIT26" target="_blank" rel="noopener noreferrer" className="block">
            <h1 className={`text-4xl font-bold transition-colors ${darkMode ? 'text-cyan-300 hover:text-cyan-400' : 'text-blue-500 hover:text-blue-600'}`}>
              Chat AI
            </h1>
          </a>
          <button
            className={`ml-4 px-4 py-2 rounded-lg font-semibold shadow-md transition-all duration-200 focus:outline-none ${darkMode ? 'bg-gray-700 text-cyan-200 hover:bg-gray-600' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
            onClick={() => setDarkMode((d) => !d)}
            aria-label="Toggle dark mode"
          >
            {darkMode ? '🌙 Dark' : '☀️ Light'}
          </button>
        </header>

        {/* Chat Container */}
        <div 
          ref={chatContainerRef}
          className={`flex-1 overflow-y-auto mb-4 rounded-lg shadow-lg p-4 hide-scrollbar transition-colors duration-500 ${darkMode ? 'bg-gray-800/90' : 'bg-white/80 backdrop-blur-sm'}`}
        >
          {chatHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 animate-fade-in">
              <div className={`rounded-xl p-8 max-w-2xl shadow-md ${darkMode ? 'bg-gray-900/60' : 'bg-blue-50/60'}`}> 
                <h2 className={`text-2xl font-bold mb-4 ${darkMode ? 'text-cyan-300' : 'text-blue-600'}`}>Welcome to Chat AI! 👋</h2>
                <p className={`mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}> 
                  I'm here to help. You can ask me about:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                  {[
                    { icon: "🌦️", text: "Weather & Activities" },
                    { icon: "📰", text: "Latest News" },
                    { icon: "🕉️", text: "Gita Wisdom" },
                    { icon: "💡", text: "General Knowledge" }
                  ].map((item, idx) => (
                    <div key={idx} className={`p-4 rounded-lg shadow-sm transition-all duration-200 hover:scale-105 cursor-pointer flex items-center gap-2 ${darkMode ? 'bg-gray-800 text-cyan-200 hover:bg-gray-700' : 'bg-white text-blue-700 hover:bg-blue-50'}`}> 
                      <span>{item.icon}</span> {item.text} 
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* --- FIX: Using ChatBubble Component Here --- */
            <div className="flex flex-col space-y-2">
              {chatHistory.map((chat, index) => (
                <ChatBubble 
                  key={index}
                  message={chat.content}
                  isUser={chat.type === 'question'}
                />
              ))}
              
              {/* --- FIX: Using TypingIndicator Here --- */ }
              {generatingAnswer && (
                <div className="flex justify-start mt-2 animate-fade-in">
                  <TypingIndicator />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input Form */}
        <form onSubmit={generateAnswer} className={`rounded-lg shadow-lg p-4 transition-colors duration-500 ${darkMode ? 'bg-gray-900' : 'bg-white'}`}>
          <div className="flex gap-2 items-end">
            <textarea
              required
              className={`flex-1 border rounded-lg p-3 focus:outline-none focus:ring-2 resize-none transition-all duration-200 max-h-32 min-h-[50px] ${darkMode ? 'bg-gray-800 border-gray-700 text-cyan-100 focus:border-cyan-400 focus:ring-cyan-400 placeholder-gray-400' : 'border-gray-300 focus:border-blue-400 focus:ring-blue-400'}`}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask anything..."
              rows="1"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  generateAnswer(e);
                }
              }}
            ></textarea>
            <button
              type="submit"
              className={`px-6 py-3 font-semibold rounded-md shadow-md transition-all duration-200 transform active:scale-95 focus:outline-none ${darkMode ? 'bg-cyan-700 text-white hover:bg-cyan-800' : 'bg-blue-500 text-white hover:bg-blue-600'} ${generatingAnswer ? 'opacity-50 cursor-not-allowed' : ''}`}
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
