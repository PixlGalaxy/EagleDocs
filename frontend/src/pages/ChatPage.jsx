import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, UserCircle, Menu, X, BookOpen, GraduationCap, Lightbulb } from 'lucide-react';
import { apiRequest } from '../utils/api';
import { useAuth } from '../context/AuthContext';

const ChatPage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [chats, setChats] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    const loadChats = async () => {
      try {
        const data = await apiRequest('/chats');
        if (!isMounted) return;
        setChats(data.chats);
        setError('');
        if (data.chats.length) {
          setSelectedChatId((prev) => prev ?? data.chats[0].id);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message);
        }
      } finally {
        if (isMounted) {
          setLoadingChats(false);
        }
      }
    };

    loadChats();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedChatId) {
      setMessages([]);
      setLoadingMessages(false);
      return;
    }

    let isMounted = true;
    setLoadingMessages(true);

    const loadMessages = async () => {
      try {
        const data = await apiRequest(`/chats/${selectedChatId}`);
        if (isMounted) {
          setMessages(data.messages);
          setError('');
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message);
        }
      } finally {
        if (isMounted) {
          setLoadingMessages(false);
        }
      }
    };

    loadMessages();

    return () => {
      isMounted = false;
    };
  }, [selectedChatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCreateChat = async () => {
    setError('');
    setCreatingChat(true);
    try {
      const data = await apiRequest('/chats', {
        method: 'POST',
        body: { title: 'New Chat' },
      });
      setChats((prev) => [data.chat, ...prev]);
      setSelectedChatId(data.chat.id);
      setMessages([]);
      setSidebarOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingChat(false);
    }
  };

  const handleSelectChat = (chatId) => {
    setSelectedChatId(chatId);
    setSidebarOpen(false);
    setShowMenu(false);
    setError('');
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !selectedChatId || sending) {
      return;
    }

    const content = input.trim();
    setSending(true);
    setError('');

    try {
      const data = await apiRequest(`/chats/${selectedChatId}/messages`, {
        method: 'POST',
        body: { content },
      });
      setMessages((prev) => [...prev, data.userMessage, data.aiMessage]);
      setInput('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleLogout = async () => {
    setShowMenu(false);
    await logout();
    navigate('/login');
  };

  const selectedChat = chats.find((chat) => chat.id === selectedChatId);
  const selectedChatTitle = selectedChat?.title || 'Start a New Chat';

  const filteredChats = chats.filter((chat) =>
    chat.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const suggestions = [
    { icon: <BookOpen className="h-5 w-5" />, text: 'Help me study for a test' },
    { icon: <GraduationCap className="h-5 w-5" />, text: 'Explain this concept' },
    { icon: <Lightbulb className="h-5 w-5" />, text: 'Give me ideas for a project' },
  ];

  const disableInput = !selectedChatId || sending;

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <div
        className={`fixed z-50 md:relative md:translate-x-0 top-0 left-0 h-full w-64 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 flex flex-col justify-between transition-transform duration-300 transform ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } md:flex`}
      >
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-5 text-xl font-semibold">
            <div className="flex items-center gap-2">
              <img src="/EagleDocs Logo.png" alt="EagleDocs" className="w-8 h-8" />
              <span className="hidden md:inline">EagleDocs</span>
            </div>
            <button className="md:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="h-6 w-6 text-gray-500" />
            </button>
          </div>
          <div className="px-4 space-y-4">
            <button
              className="w-full flex items-center gap-2 text-sm bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-60"
              onClick={handleCreateChat}
              disabled={creatingChat}
            >
              <Plus className="h-4 w-4" /> {creatingChat ? 'Creating...' : 'New Chat'}
            </button>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search chats"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              />
            </div>
          </div>
          <div className="px-4 mt-6 text-xs text-gray-500 dark:text-gray-400">Recent</div>
          <ul className="mt-1 text-sm px-4 space-y-1 overflow-y-auto h-[calc(100%-220px)]">
            {loadingChats ? (
              <li className="text-gray-500">Loading chats...</li>
            ) : filteredChats.length ? (
              filteredChats.map((chat) => (
                <li
                  key={chat.id}
                  onClick={() => handleSelectChat(chat.id)}
                  className={`cursor-pointer px-3 py-2 rounded transition-colors ${
                    chat.id === selectedChatId
                      ? 'bg-blue-100 text-blue-700 dark:bg-gray-800'
                      : 'text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800'
                  }`}
                >
                  {chat.title}
                </li>
              ))
            ) : (
              <li className="text-gray-500">No chats yet</li>
            )}
          </ul>
        </div>
        <div className="border-t px-4 py-3">
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-2 w-full hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1 rounded"
            >
              <UserCircle className="h-6 w-6 text-gray-500" />
              <span className="text-sm text-gray-800 dark:text-gray-200">{user?.username}</span>
            </button>
            {showMenu && (
              <div className="absolute bottom-10 left-0 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-md z-10">
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col ml-0 md:ml-64">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 md:hidden">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="h-6 w-6 text-gray-700 dark:text-gray-200" />
          </button>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{selectedChatTitle}</div>
          <div className="w-6" />
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col px-6 pt-6 pb-28">
          {error && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
              {error}
            </div>
          )}
          {loadingMessages ? (
            <div className="flex flex-1 items-center justify-center text-gray-500">Loading messages...</div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 space-y-4 text-sm text-gray-600 dark:text-gray-400">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setInput(s.text)}
                  className="flex items-center gap-2 bg-gray-200 dark:bg-gray-800 px-4 py-2 rounded hover:bg-gray-300 dark:hover:bg-gray-700"
                >
                  {s.icon}
                  {s.text}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`my-2 max-w-xl px-4 py-2 rounded-lg text-sm ${
                    msg.sender === 'user'
                      ? 'bg-blue-500 text-white self-end ml-auto'
                      : 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-white mr-auto'
                  }`}
                >
                  {msg.content}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <form
          onSubmit={handleSend}
          className="absolute bottom-0 left-0 md:left-64 right-0 p-4 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800"
        >
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={selectedChatId ? 'Type here...' : 'Create a chat to get started'}
              disabled={disableInput}
              className="flex-1 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 rounded-md text-sm focus:outline-none"
            />
            <button
              type="submit"
              disabled={disableInput}
              className={`px-4 py-2 rounded-md text-sm text-white ${
                disableInput ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatPage;
