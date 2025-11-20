// src/components/ChatBubble.jsx
import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

export default function ChatBubble({ message, isUser }) {
  // Initialize state
  const [displayedText, setDisplayedText] = useState(isUser ? message : '');
  const [isTyping, setIsTyping] = useState(!isUser);

  useEffect(() => {
    // If it's the user, show text immediately
    if (isUser) {
      setDisplayedText(message);
      setIsTyping(false);
      return;
    }

    // If it's the bot, RESET text to prevent "stuttering" / duplication
    setDisplayedText(''); 
    setIsTyping(true);

    let i = 0;
    const typingSpeed = 10; 
    
    const intervalId = setInterval(() => {
      const charToAdd=message.charAt(i);
      setDisplayedText((prev) => {
        if (i >= message.length) return prev;
        return prev + charToAdd;
      });
      
      i++;
      if (i >= message.length) {
        clearInterval(intervalId);
        setIsTyping(false);
      }
    }, typingSpeed);

    return () => clearInterval(intervalId);
    
  }, [message, isUser]);

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] p-4 shadow-md ${
          isUser
            ? 'bg-blue-600 text-white rounded-2xl rounded-tr-none'
            : 'bg-white border border-gray-200 text-gray-800 rounded-2xl rounded-tl-none'
        }`}
      >
        <div className={`prose ${isUser ? 'prose-invert' : ''} max-w-none text-sm sm:text-base leading-relaxed break-words`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message}</p>
          ) : (
            <ReactMarkdown>{displayedText}</ReactMarkdown>
          )}
        </div>
        
        {!isUser && isTyping && (
          <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-blue-500 animate-pulse"></span>
        )}
      </div>
    </div>
  );
}
