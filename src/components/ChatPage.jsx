// ChatPage.jsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { BeatLoader } from 'react-spinners';

function ChatPage() {
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('chatHistory');
    return saved ? JSON.parse(saved) : [];
  });
  const [userMessage, setUserMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const textAreaRef = useRef(null);
  const messagesEndRef = useRef(null);
  const buffer = useRef('');

  // History
  useEffect(() => {
    localStorage.setItem('chatHistory', JSON.stringify(messages));
  }, [messages]);

  // TextArea Auto Adjust
  const adjustTextareaHeight = useCallback(() => {
    if (!textAreaRef.current) return;
    
    requestAnimationFrame(() => {
      const textarea = textAreaRef.current;
      const previousHeight = textarea.style.height;
      
      textarea.style.height = 'auto';
      const newHeight = `${Math.min(textarea.scrollHeight, 200)}px`;
      
      if (previousHeight !== newHeight) {
        textarea.style.height = newHeight;
      }
    });
  }, []);

  // Scroll
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({
      behavior,
      block: 'nearest',
    });
  }, []);

  // Change Handler
  const handleChange = useCallback((e) => {
    setUserMessage(e.target.value);
    adjustTextareaHeight();
  }, [adjustTextareaHeight]);

  // Chunks Processing
  const processChunk = useCallback((chunk) => {
    buffer.current += chunk;
    const lines = buffer.current.split('\n');
    
    lines.slice(0, -1).forEach((line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.message?.content) {
          setMessages(prev => prev.map((msg, idx) => 
            idx === prev.length - 1 ? {
              ...msg,
              content: msg.content + parsed.message.content
            } : msg
          ));
        }
      } catch (err) {
        console.error('Error parsing JSON:', err);
      }
    });
    
    buffer.current = lines[lines.length - 1];
  }, []);

  // Message Send Handler
  const handleSendMessage = async () => {
    if (!userMessage.trim() || isStreaming) return;

    const newMessages = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    setUserMessage('');
    adjustTextareaHeight();
    setError(null);
    setIsStreaming(true);

    try {
      const response = await fetch('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.1:8b-instruct-fp16',
          messages: newMessages,
          stream: true,
        }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = { role: 'assistant', content: '' };
      
      setMessages(prev => [...prev, assistantMessage]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        processChunk(chunk);
        scrollToBottom('auto');
      }
    } catch (err) {
      setError(err.message);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `**Error:** ${err.message}`
      }]);
    } finally {
      setIsStreaming(false);
      buffer.current = '';
    }
  };

  // Markdown Components 
  const MarkdownComponents = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      return !inline && match ? (
        <SyntaxHighlighter
          style={vscDarkPlus}
          language={match[1]}
          PreTag="div"
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    table({ children }) {
      return (
        <div className="overflow-x-auto">
          <table className="w-full my-2 border-collapse">
            {children}
          </table>
        </div>
      );
    },
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar Mobile */}
      <aside className={`fixed md:relative inset-0 z-20 md:block w-64 bg-gray-900 dark:bg-gray-800 
        transform transition-transform duration-300 ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="p-4">
          <button
            className="w-full bg-gray-700 hover:bg-gray-600 text-white py-3 px-4 rounded-lg
                       transition-all duration-200 flex items-center justify-center gap-2"
            onClick={() => setMessages([])}
          >
            <span className="text-xl">+</span> New Chat
          </button>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {isMenuOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/50 md:hidden"
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      {/* Principal Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Superior Bar */}
        <div className="md:hidden p-2 border-b border-gray-200 dark:border-gray-700 flex items-center">
          <button
            className="text-gray-600 dark:text-gray-300 p-2"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="ml-2 text-lg font-semibold dark:text-white">EagleDocs</h1>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 md:p-4">
          <div className="max-w-3xl mx-auto space-y-4 md:space-y-6">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`p-3 md:p-4 rounded-xl max-w-[95%] md:max-w-[85%] prose dark:prose-invert ${
                    msg.role === 'user'
                      ? 'bg-gray-200 dark:bg-gray-700 ml-auto'
                      : 'bg-blue-500 dark:bg-blue-700 text-white mr-auto'
                  }`}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={MarkdownComponents}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
            
            {isStreaming && (
              <div className="flex justify-start">
                <div className="p-4 rounded-xl bg-blue-500 dark:bg-blue-700 text-white mr-auto">
                  <BeatLoader size={8} color="#ffffff" />
                </div>
              </div>
            )}
            
            {error && (
              <div className="p-3 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-100 rounded-lg">
                Error: {error}
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Optimized Text Input */}
        <footer className="border-t border-gray-200 dark:border-gray-700 p-2 md:p-4">
          <div className="max-w-3xl mx-auto flex flex-col md:flex-row gap-2 md:gap-3">
            <textarea
              ref={textAreaRef}
              className="w-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-xl p-2 md:p-3
                       focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                       resize-none overflow-hidden text-gray-900 dark:text-gray-100
                       placeholder-gray-400 dark:placeholder-gray-500 text-sm md:text-base
                       transition-all duration-100 ease-linear"
              rows="1"
              placeholder="Type your message..."
              value={userMessage}
              onChange={handleChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isStreaming) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              style={{
                willChange: 'height',
                transform: 'translateZ(0)'
              }}
            />
            <button
              className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600
                         text-white px-4 py-2 md:px-6 md:py-3 rounded-xl transition-all duration-200
                         disabled:opacity-50 disabled:cursor-not-allowed text-sm md:text-base"
              onClick={handleSendMessage}
              disabled={isStreaming}
            >
              {isStreaming ? 'Sending...' : 'Send'}
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default ChatPage;

//   ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡤⠴⠒⠒⠒⢒⡶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⠞⠁⠀⠀⠀⠀⠀⡾⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡴⠁⠀⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠞⠁⠀⢀⣀⣀⣀⡀⠀⠀⢧⠀⠀⠀⠀⠀⡴⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⠀⠀⠀⠀⠀⠀⢀⣰⠿⠒⠋⠉⠉⠀⠀⠀⠈⠉⠓⠾⢄⣀⠀⠀⢠⡇⠸⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⠀⠀⠀⠀⠀⠀⣩⠏⠉⠒⢒⣲⡤⠤⣀⣀⠀⠀⠀⠀⠀⠈⠑⢤⡘⡄⠀⢳⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⠀
//   ⠀⠀⠀⠀⠀⢰⠾⣣⠴⠚⠉⠉⠀⠀⠀⠀⠀⠉⠓⠀⠀⠀⠀⠀⠀⠙⣧⠀⠀⢣⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡤⣔⡿⡍⡇
//   ⠀⠀⠀⠀⠀⢸⡼⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠆⠀⠀⢳⡀⠀⠀⠀⠀⠀⣀⡤⠞⠋⣡⠞⠉⠀⣇⡇
//   ⠀⠀⠀⠀⣴⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡠⠴⠒⠛⠓⠚⠉⠉⠉⠁⠀⣴⡟⠁⠀⠀⠀⣿⠁
//   ⠀⠀⠀⣼⣁⣠⡤⢴⠖⠒⠒⠦⠤⢴⣶⣢⠤⠤⠔⠚⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣞⡞⠀⠀⠀⠀⢰⢿⠀
//   ⠀⠀⠀⠉⠉⢙⣦⠞⠀⡠⠞⠉⢉⡷⡄⠉⢙⡶⠃⠀⠀⠀⢀⣠⣦⣤⣄⡀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡎⡼⠀⠀⠀⠀⠀⡜⡞⠀
//   ⠀⠀⠀⣤⡖⠛⠀⠀⡜⠁⠀⡴⢋⣀⣹⣠⠋⠀⠀⠀⠀⣰⣿⠿⠛⠛⠿⣿⣷⣄⡀⠀⠀⠀⠀⠀⡼⢰⠃⠀⠀⠀⠀⡼⢱⠃⠀
//    ⢀⣴⠛⠀⠀⠀⢼⠁⠀⣼⢁⣿⡬⣿⠃⠀⠀⠀⠀⠐⠋⠁⠀⠀⠀⠀⠀⠙⢿⣷⣄⠀⠀⠀⣸⢃⡏⠀⠀⠀⢀⡜⢡⠏⠀⠀
//   ⠀⠸⡿⠀⠀⠀⠀⢻⡀⠀⠀⠀⠉⢠⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⣿⠁⣀⡜⠁⡼⠀⠀⠀⡠⠋⣰⠋⠀⠀⠀
//   ⠀⠀⣧⠀⠀⠀⠀⠈⢳⣀⣙⣦⡤⠋⠀⠀⠀⠀⠀⠀⠀⣰⠄⠀⠀⠀⠀⠀⠀⢤⠀⣹⠌⢩⠏⢠⣇⣠⠴⠊⢀⡼⠁⠀⠀⠀⠀
//   ⠀⠀⠘⡆⢀⡴⠖⠋⠉⠉⠀⠀⠀⠀⠀⠀⠀⠘⢧⣤⣾⣷⣿⣿⣿⣷⣦⡀⠀⢸⠀⠻⣾⠉⠀⠀⠀⠀⢀⣠⠋⠀⠀⠀⠀⠀⠀
//   ⠀⠀⢠⡟⣥⠤⠦⠤⠤⢤⣀⣀⠀⠀⠀⠀⠀⠀⠀⠉⠁⠀⠀⠉⠛⠿⣿⣿⣄⣸⠀⠈⠻⣇⠀⢀⣀⠤⠟⠓⠃⠀⠀⠀⠀⠀⠀
//   ⠀⠀⠸⡆⢧⡀⠀⠀⠀⠀⠀⠈⠙⠲⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠉⠁⠀⠀⠀⣸⡍⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⠀⠀⢳⡄⠙⢦⡀⠀⠀⠀⣀⡤⠞⠁⠀⠀⠀⠀⢀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⡿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⠀⠀⠀⠙⢦⣀⣉⣷⡚⠉⠀⠀⠀⠀⠀⠀⠀⢀⡾⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⠼⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⠀⠀⣦⣴⠚⢁⡾⠋⠉⠳⢤⣀⢀⣀⣀⣠⠔⠋⠀⠀⠀⠀⠀⠀⣀⣠⠤⠖⠋⠁⢀⣺⣆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⠀⢰⣷⡇⠀⡞⠀⠀⠀⠀⠀⡼⠋⠉⠁⠀⠀⣀⣀⠤⠴⠒⠊⠉⠉⠀⠀⠀⠀⠀⣼⣿⠻⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⠀⠈⢯⡛⢦⡀⠀⠀⠀⢀⡾⠥⠤⠔⠒⠊⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠰⡆⣸⣹⠛⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⠀⠀⢠⡿⠀⢹⣶⣶⣖⡋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⡟⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⠀⢀⡿⠿⠉⠉⠋⠀⠀⠉⠙⠶⣄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⡀⠹⢤⣀⣀⣀⣀⣀⡠⠀⠀⠀⠀⠀⠀⠀⠀⠀
//   ⠀⡰⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠢⣄⠀⠀⠀⡀⠀⠀⠀⠀⠀⠀⠀⣼⠇⠀⠀⠀⠀⠀⠙⠋⠩⠿⢿⣁⠀⠀⠀⠀⠀⠀
//   ⡼⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠳⡄⠀⠉⠑⠶⢤⣀⣀⣠⣴⡟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠿⣅⠀⠀⠀⠀⠀
//   ⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠂⠀⠀⠀⠀⠀⠉⠉⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢦⠀⠀⠀⠀
//   ⡅⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀
//   ⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣇⠀⠀⠀
//   ⠁
// 2025 PIXL Galaxy 