//ChatPage.jsx

import React, { useState, useRef, useEffect } from 'react';
import { Plus, Search, UserCircle, Menu, X, BookOpen, GraduationCap, Lightbulb, Paperclip } from 'lucide-react';

const ChatPage = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const messagesEndRef = useRef(null);
  const [showMenu, setShowMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const selectedChatTitle = messages.length > 0 ? 'Chat' : 'Start a New Chat';
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const createdUrlsRef = useRef(new Set());

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const newFiles = files.map((file, idx) => ({
      id: Date.now() + idx,
      file,
      url: URL.createObjectURL(file),
      name: file.name,
      type: file.type,
      size: file.size,
    }));
    newFiles.forEach(f => createdUrlsRef.current.add(f.url));
    setAttachments((prev) => [...prev, ...newFiles]);
    // reset input so same file can be selected again if needed
    e.target.value = null;
  };

  const removeAttachment = (id) => {
    setAttachments((prev) => {
      const toRemove = prev.find((p) => p.id === id);
      if (toRemove) URL.revokeObjectURL(toRemove.url);
      if (toRemove) createdUrlsRef.current.delete(toRemove.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  // cleanup any created object URLs when component unmounts
  useEffect(() => {
    return () => {
      createdUrlsRef.current.forEach((u) => {
        try { URL.revokeObjectURL(u); } catch (e) {}
      });
      createdUrlsRef.current.clear();
    };
  }, []);

  const generateAssistantResponse = (userMessage) => {
    return {
      id: Date.now() + 1,
      content: `This is a simulated response to: "${userMessage}"`,
      sender: 'assistant'
    };
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim() && attachments.length === 0) return;

    const userMessage = {
      id: Date.now(),
      content: input,
      sender: 'user',
      attachments: attachments.map((a) => ({ id: a.id, name: a.name, url: a.url, type: a.type }))
    };

    const assistantMessage = generateAssistantResponse(input);
    setMessages([...messages, userMessage, assistantMessage]);

    // clear input and current attachment selections (message keeps its copies)
    setInput('');
    setAttachments([]);
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
      <div className="flex-1 flex flex-col ml-0 md:ml-90">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 md:hidden">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="h-6 w-6 text-gray-700 dark:text-gray-200" />
          </button>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{selectedChatTitle}</div>
          <div className="w-6" />
        </div>

        <div className="flex-1 overflow-y-auto">
          <div ref={messagesEndRef} />
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full space-y-4">
              <h1 className="text-4xl font-semibold mb-8 text-gray-800 dark:text-gray-200">EagleDocs</h1>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl px-4">
                {suggestions.map((s, i) => (
                  <button key={i} className="flex items-center gap-2 bg-gray-200 dark:bg-gray-800 px-4 py-3 rounded hover:bg-gray-300 dark:hover:bg-gray-700 text-sm">
                    {s.icon}
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`border-b border-gray-200 dark:border-gray-800 ${
                    msg.sender === 'user' ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800'
                  }`}
                >
                  <div className="max-w-3xl mx-auto px-4 py-6 flex gap-4">
                    <div className="w-7 h-7 flex-shrink-0">
                      {msg.sender === 'user' ? (
                        <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm">
                          U
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-sm bg-blue-500 flex items-center justify-center text-white text-sm">
                          A
                        </div>
                      )}
                    </div>
                          <div className="prose dark:prose-invert flex-1">
                            <div className="text-sm text-gray-800 dark:text-gray-100">
                              {msg.content}
                            </div>

                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-3">
                                {msg.attachments.map((att) => (
                                  att.type && att.type.startsWith('image/') ? (
                                    <img key={att.id} src={att.url} alt={att.name} className="w-40 h-28 object-cover rounded" />
                                  ) : (
                                    <a key={att.id} href={att.url} download={att.name} className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded text-sm text-gray-700 dark:text-gray-200">
                                      <Paperclip className="h-4 w-4" />
                                      <span className="truncate max-w-[8rem]">{att.name}</span>
                                    </a>
                                  )
                                ))}
                              </div>
                            )}
                          </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={handleSend}
          className="absolute bottom-0 left-0 md:left-64 right-0 bg-white dark:bg-gray-900"
        >
          <div className="max-w-3xl mx-auto px-4 py-4">
            <div className="relative border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
              {/* preview selected attachments */}
              {attachments.length > 0 && (
                <div className="p-3 border-b border-gray-100 dark:border-gray-800 flex gap-2 overflow-x-auto">
                  {attachments.map((att) => (
                    <div key={att.id} className="relative">
                      {att.type && att.type.startsWith('image/') ? (
                        <img src={att.url} alt={att.name} className="w-24 h-16 object-cover rounded" />
                      ) : (
                        <div className="w-36 h-12 flex items-center px-2 bg-gray-100 dark:bg-gray-800 rounded text-sm">
                          <Paperclip className="h-4 w-4 mr-2" />
                          <span className="truncate">{att.name}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        className="absolute -top-1 -right-1 bg-white dark:bg-gray-900 rounded-full p-0.5 shadow"
                        aria-label="Remove attachment"
                      >
                        <X className="h-4 w-4 text-gray-600" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows="1"
                placeholder="Send a message..."
                className="w-full resize-none bg-white dark:bg-gray-900 pr-12 pl-12 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800 dark:text-white text-sm"
              />

              {/* hidden file input */}
              <input ref={fileInputRef} onChange={handleFileChange} type="file" multiple className="hidden" />

              {/* attach button (left) */}
              <button
                type="button"
                onClick={handleAttachClick}
                className="absolute left-3 bottom-2.5 p-1 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Attach file"
              >
                <Paperclip className="h-5 w-5" />
              </button>

              <button
                type="submit"
                className="absolute right-3 bottom-2.5 p-1 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent transition-colors"
              >
                <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </div>
            <div className="text-center text-xs text-gray-600 dark:text-gray-400 mt-2">
              Free Research Preview. EagleDocs may produce inaccurate information about people, places, or facts.
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatPage;