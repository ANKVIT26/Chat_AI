import { useState, useRef, useEffect } from "react";
import "./App.css";
import axios from "axios";
import ReactMarkdown from "react-markdown";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return true;
    }
    return false;
  });

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

  async function callBackend(question) {
    try {
      const response = await axios.post(`${API_BASE_URL}/chat`, { message: question });
      return response.data.reply;
    } catch (error) {
      console.error("Backend error:", error);
      return "Sorry - Something went wrong. Please try again!";
    }
  }

  async function generateAnswer(e) {
    e.preventDefault();
    if (!question.trim()) return;

    setGeneratingAnswer(true);
    const currentQuestion = question;
    setQuestion("");

    setChatHistory(prev => [...prev, { type: 'question', content: currentQuestion }]);

    try {
      const aiResponse = await callBackend(currentQuestion);
      setChatHistory(prev => [...prev, { type: 'answer', content: aiResponse }]);
      setAnswer(aiResponse);
    } catch (error) {
      console.log(error);
      setAnswer("Sorry - Something went wrong. Please try again!");
    }

    setGeneratingAnswer(false);
  }

  return (
    <div className={`fixed inset-0 transition-colors duration-500 ${darkMode ? 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900' : 'bg-gradient-to-r from-blue-50 to-blue-100'}`}>
      <div className="h-full max-w-4xl mx-auto flex flex-col p-3">
        <header className="flex items-center justify-between py-4">
          <a href="https://github.com/ANKVIT26/KNWOUT" target="_blank" rel="noopener noreferrer">
            <h1 className={`text-4xl font-bold ${darkMode ? 'text-cyan-300 hover:text-cyan-400' : 'text-blue-500 hover:text-blue-600'}`}>Chat AI</h1>
          </a>
          <button
            className={`ml-4 px-4 py-2 rounded-lg font-semibold shadow-md ${darkMode ? 'bg-gray-700 text-cyan-200 hover:bg-gray-600' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
            onClick={() => setDarkMode(d => !d)}
            type="button"
          >
            {darkMode ? '🌙 Dark' : '☀️ Light'}
          </button>
        </header>

        <div ref={chatContainerRef} className={`flex-1 overflow-y-auto mb-4 rounded-lg shadow-lg p-4 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          {chatHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <div className={`rounded-xl p-8 max-w-2xl shadow-md ${darkMode ? 'bg-gray-900' : 'bg-blue-50'}`}>
                <h2 className={`text-2xl font-bold mb-4 ${darkMode ? 'text-cyan-300' : 'text-blue-600'}`}>Welcome to Chat AI! 👋</h2>
                <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Ask me about general knowledge, tech, writing, or problem solving.</p>
              </div>
            </div>
          ) : (
            <>
              {chatHistory.map((chat, index) => (
                <div key={index} className={`mb-4 ${chat.type === 'question' ? 'text-right' : 'text-left'}`}>
                  <div className={`inline-block max-w-[80%] p-3 rounded-lg ${chat.type === 'question' 
                    ? darkMode ? 'bg-cyan-700 text-white rounded-br-none' : 'bg-blue-500 text-white rounded-br-none'
                    : darkMode ? 'bg-gray-700 text-cyan-100 rounded-bl-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'
                  }`}>
                    <ReactMarkdown>{chat.content}</ReactMarkdown>
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

        <form onSubmit={generateAnswer} className={`rounded-lg shadow-lg p-4 ${darkMode ? 'bg-gray-900' : 'bg-white'}`}>
          <div className="flex gap-2">
            <textarea
              required
              className={`flex-1 border rounded p-3 resize-none ${darkMode ? 'bg-gray-800 border-gray-700 text-cyan-100 placeholder-gray-400' : 'border-gray-300'}`}
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
              className={`px-6 py-2 font-semibold rounded-md shadow-md ${darkMode ? 'bg-cyan-700 text-white' : 'bg-blue-500 text-white'} ${generatingAnswer ? 'opacity-50 cursor-not-allowed' : ''}`}
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
