import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  UserCircle,
  Menu,
  X,
  BookOpen,
  GraduationCap,
  Lightbulb,
  ListFilter,
  FileSearch,
  ExternalLink,
  Edit3,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiRequest, API_ORIGIN } from '../utils/api';
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
  const [courses, setCourses] = useState([]);
  const [selectedCourseCrn, setSelectedCourseCrn] = useState('');
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [sourceByMessage, setSourceByMessage] = useState({});
  const [renamingChatId, setRenamingChatId] = useState(null);
  const [deletingChatId, setDeletingChatId] = useState(null);
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
    let isMounted = true;

    const loadCourses = async () => {
      try {
        const data = await apiRequest('/courses');
        if (!isMounted) return;
        setCourses(data.courses || []);
        setError('');
      } catch (err) {
        if (isMounted) {
          setError(err.message);
        }
      } finally {
        if (isMounted) {
          setLoadingCourses(false);
        }
      }
    };

    loadCourses();

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
    setSourceByMessage({});
    setStatusMessage('');

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
    const tempUserId = `temp-user-${Date.now()}`;
    const tempAiId = `temp-ai-${Date.now()}`;

    setSending(true);
    setError('');
    setStatusMessage(selectedCourseCrn ? 'Searching course materials...' : 'Generating answer...');
    setMessages((prev) => [
      ...prev,
      { id: tempUserId, sender: 'user', content },
      { id: tempAiId, sender: 'ai', content: '' },
    ]);
    setInput('');

    try {
      const response = await fetch(`${API_BASE_URL}/chats/${selectedChatId}/messages/stream`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, courseCrn: selectedCourseCrn || undefined }),
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(text || 'Unable to send message');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;

      while (!completed) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const lines = part.split('\n').filter(Boolean);
          const eventLine = lines.find((line) => line.startsWith('event:'));
          const dataLine = lines.find((line) => line.startsWith('data:'));
          if (!eventLine || !dataLine) continue;

          const eventType = eventLine.replace('event:', '').trim();
          let data;
          try {
            data = JSON.parse(dataLine.replace('data:', '').trim());
          } catch {
            data = {};
          }

          if (eventType === 'status') {
            setStatusMessage(data.message || '');
            continue;
          }

          if (eventType === 'chatRenamed') {
            setChats((prev) => prev.map((chat) => (chat.id === data.chatId ? { ...chat, title: data.title } : chat)));
            continue;
          }

          if (eventType === 'token') {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempAiId
                  ? { ...msg, content: `${msg.content || ''}${data.content || ''}` }
                  : msg
              )
            );
            continue;
          }

          if (eventType === 'done') {
            completed = true;
            setStatusMessage('');
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id === tempUserId && data.userMessage) {
                  return data.userMessage;
                }
                if (msg.id === tempAiId && data.aiMessage) {
                  return { ...data.aiMessage, sender: 'ai' };
                }
                return msg;
              })
            );
            if (data.aiMessage?.id) {
              setSourceByMessage((prev) => ({ ...prev, [data.aiMessage.id]: data.sources || [] }));
            }
            break;
          }

          if (eventType === 'error') {
            throw new Error(data.message || 'AI response failed');
          }
        }
      }
    } catch (err) {
      setError(err.message);
      setMessages((prev) => prev.filter((msg) => msg.id !== tempUserId && msg.id !== tempAiId));
    } finally {
      setSending(false);
      setStatusMessage('');
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

  const selectedCourseInfo = courses.find(
    (course) => course.crn?.toUpperCase() === selectedCourseCrn.toUpperCase()
  );

  const activeCourseLabel = selectedCourseCrn
    ? `Using course RAG: ${selectedCourseInfo ? `${selectedCourseInfo.code} (CRN ${selectedCourseInfo.crn})` : selectedCourseCrn}`
    : 'Default chat (no RAG)';

  const markdownComponents = {
    code({ inline, className, children, ...props }) {
      if (inline) {
        return (
          <code
            className="bg-gray-200 dark:bg-gray-800 px-1 py-0.5 rounded text-xs"
            {...props}
          >
            {children}
          </code>
        );
      }

      return (
        <pre className="bg-gray-900 text-gray-100 rounded-md p-3 overflow-x-auto text-xs" {...props}>
          <code className={className}>{children}</code>
        </pre>
      );
    },
    table({ children }) {
      return <table className="min-w-full border border-gray-300 text-sm">{children}</table>;
    },
    th({ children }) {
      return <th className="border border-gray-300 px-2 py-1 bg-gray-100">{children}</th>;
    },
    td({ children }) {
      return <td className="border border-gray-300 px-2 py-1">{children}</td>;
    },
    p({ children }) {
      return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
    },
  };

  const suggestions = [
    { icon: <BookOpen className="h-5 w-5" />, text: 'Help me study for a test' },
    { icon: <GraduationCap className="h-5 w-5" />, text: 'Explain this concept' },
    { icon: <Lightbulb className="h-5 w-5" />, text: 'Give me ideas for a project' },
  ];

  const disableInput = !selectedChatId || sending;

  const handleRenameChat = async (chatId) => {
    const current = chats.find((c) => c.id === chatId);
    const proposed = window.prompt('Chat title', current?.title || '');
    if (!proposed || !proposed.trim()) return;
    setRenamingChatId(chatId);
    try {
      const data = await apiRequest(`/chats/${chatId}`, {
        method: 'PATCH',
        body: { title: proposed },
      });
      setChats((prev) => prev.map((chat) => (chat.id === chatId ? data.chat : chat)));
    } catch (err) {
      setError(err.message);
    } finally {
      setRenamingChatId(null);
    }
  };

  const handleDeleteChat = async (chatId) => {
    if (!window.confirm('Delete this chat? Messages will be removed.')) return;
    setDeletingChatId(chatId);
    try {
      await apiRequest(`/chats/${chatId}`, { method: 'DELETE' });
      setChats((prev) => {
        const remaining = prev.filter((chat) => chat.id !== chatId);
        if (selectedChatId === chatId) {
          setSelectedChatId(remaining[0]?.id || null);
          setMessages([]);
          setSourceByMessage({});
        }
        return remaining;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingChatId(null);
    }
  };

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
                  className={`group cursor-pointer px-3 py-2 rounded transition-colors ${
                    chat.id === selectedChatId
                      ? 'bg-blue-100 text-blue-700 dark:bg-gray-800'
                      : 'text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{chat.title}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameChat(chat.id);
                        }}
                        disabled={renamingChatId === chat.id}
                        className="p-1 rounded hover:bg-gray-300 dark:hover:bg-gray-700 disabled:opacity-60"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteChat(chat.id);
                        }}
                        disabled={deletingChatId === chat.id}
                        className="p-1 rounded hover:bg-red-100 text-red-600 dark:hover:bg-red-900 disabled:opacity-60"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
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
          <div className="mb-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <ListFilter className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Select a course RAG</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">{activeCourseLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedCourseCrn}
                onChange={(e) => setSelectedCourseCrn(e.target.value)}
                disabled={loadingCourses}
                className="text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded px-3 py-2"
              >
                <option value="">Default chat</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.crn}>
                    {course.code} (CRN {course.crn}) — {course.name}
                  </option>
                ))}
              </select>
              {selectedCourseCrn ? (
                <span className="text-xs text-green-700 bg-green-100 px-2 py-1 rounded-full">
                  RAG active
                </span>
              ) : (
                <span className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded-full">
                  No RAG
                </span>
              )}
            </div>
          </div>
          {statusMessage && (
            <div className="flex items-center gap-2 mb-3 text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded px-3 py-2">
              <FileSearch className="h-4 w-4" />
              <span>{statusMessage}</span>
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
            <div className="flex-1 overflow-y-auto flex flex-col gap-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`max-w-3xl px-4 py-3 rounded-lg text-sm shadow-sm border ${
                    msg.sender === 'user'
                      ? 'bg-blue-500 text-white self-end ml-auto border-blue-600'
                      : 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white mr-auto border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                    className="prose prose-sm dark:prose-invert max-w-none"
                  >
                    {msg.content}
                  </ReactMarkdown>
                  {msg.sender === 'ai' && sourceByMessage[msg.id]?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {sourceByMessage[msg.id].map((source) => (
                        <a
                          key={`${source.documentId}-${source.pageRange?.start || ''}-${source.pageRange?.end || ''}`}
                          href={`${API_BASE_URL}${source.url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-800 rounded border border-emerald-200 hover:bg-emerald-100 text-xs"
                        >
                          <FileSearch className="h-4 w-4" />
                          <span className="font-medium">{source.documentName}</span>
                          {source.pageRange && (
                            <span className="text-[11px] text-emerald-700">
                              {source.pageRange.start === source.pageRange.end
                                ? `(p.${source.pageRange.start})`
                                : `(p.${source.pageRange.start}-${source.pageRange.end})`}
                            </span>
                          )}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ))}
                    </div>
                  )}
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
