//ChatPage.jsx

import React, { useState, useRef, useEffect } from 'react';
import { Plus, Search, UserCircle, Menu, X, BookOpen, GraduationCap, Lightbulb } from 'lucide-react';

const ChatPage = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const messagesEndRef = useRef(null);
  const [showMenu, setShowMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const selectedChatTitle = messages.length > 0 ? 'Chat' : 'Start a New Chat';

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const newMessage = {
      id: Date.now(),
      content: input,
      sender: 'user'
    };
    setMessages([newMessage, ...messages]);
    setInput('');
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const suggestions = [
    { icon: <BookOpen className="h-5 w-5" />, text: 'Help me study for a test' },
    { icon: <GraduationCap className="h-5 w-5" />, text: 'Explain this concept' },
    { icon: <Lightbulb className="h-5 w-5" />, text: 'Give me ideas for a project' },
  ];

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      {/* Sidebar */}
      <div className={`fixed z-50 md:relative md:translate-x-0 top-0 left-0 h-full w-64 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 flex flex-col justify-between transition-transform duration-300 transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:flex`}>
        <div>
          <div className="flex items-center justify-between px-4 py-5 text-xl font-semibold">
            <div className="flex items-center gap-2">
              <img src="/EagleDocs Logo.png" alt="EagleDocs" className="w-8 h-8" />
              <span className="hidden md:inline">EagleDocs</span>
            </div>
            <button className="md:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="h-6 w-6 text-gray-500" />
            </button>
          </div>
          <div className="px-4">
            <button className="w-full flex items-center gap-2 text-sm bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
              <Plus className="h-4 w-4" /> New Chat
            </button>
            <div className="mt-4 relative">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search chats"
                className="w-full pl-9 pr-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              />
            </div>
          </div>
          <div className="px-4 mt-6 text-xs text-gray-500 dark:text-gray-400">Recent</div>
          <ul className="mt-1 text-sm px-4 space-y-1 overflow-y-auto flex-1">
            <li className="text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 px-3 py-2 rounded cursor-pointer">Math Midterm Review</li>
            <li className="text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 px-3 py-2 rounded cursor-pointer">Software Fundamentals</li>
            <li className="text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 px-3 py-2 rounded cursor-pointer">Physics 2 Concepts</li>
            <li className="text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 px-3 py-2 rounded cursor-pointer">Quiz Questions</li>
          </ul>
        </div>
        <div className="border-t px-4 py-3">
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-2 w-full hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1 rounded"
            >
              <UserCircle className="h-6 w-6 text-gray-500" />
              <span className="text-sm text-gray-800 dark:text-gray-200">Pixl</span>
            </button>
            {showMenu && (
              <div className="absolute bottom-10 left-0 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-md z-10">
                <button className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700">Settings</button>
                <button className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700">Sign Out</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col ml-0 md:ml-64">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 md:hidden">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="h-6 w-6 text-gray-700 dark:text-gray-200" />
          </button>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{selectedChatTitle}</div>
          <div className="w-6" />
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col-reverse px-6 pt-6 pb-28">
          <div ref={messagesEndRef} />
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center mt-10 space-y-4 text-sm text-gray-600 dark:text-gray-400">
              {suggestions.map((s, i) => (
                <button key={i} className="flex items-center gap-2 bg-gray-200 dark:bg-gray-800 px-4 py-2 rounded hover:bg-gray-300 dark:hover:bg-gray-700">
                  {s.icon}
                  {s.text}
                </button>
              ))}
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`my-1 max-w-xl px-4 py-2 rounded-lg text-sm ${
                  msg.sender === 'user'
                    ? 'bg-blue-500 text-white self-end'
                    : 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-white self-start'
                }`}
              >
                {msg.content}
              </div>
            ))
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={handleSend}
          className="absolute bottom-0 left-0 md:left-64 right-0 p-4 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800"
        >
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type here..."
              className="flex-1 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 rounded-md text-sm focus:outline-none"
            />
            <button
              type="submit"
              className="bg-blue-500 text-white px-4 py-2 rounded-md text-sm hover:bg-blue-600"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatPage;