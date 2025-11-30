import React, { useState, useRef, useEffect } from 'react';
import { Plus, Search, UserCircle, Menu, X, BookOpen, GraduationCap, Lightbulb, Paperclip } from 'lucide-react';


const ChatPage = () => {
  
  {/* STATE VARIABLES */}
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const [showMenu, setShowMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const selectedChatTitle = messages.length > 0 ? 'Chat' : 'Start a New Chat';
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const createdUrlsRef = useRef(new Set());
  const [account, setAccount] = useState(null);
  const [currentClass, setCurrentClass] = useState("Showing All");
  const [classMenuOpen, setClassMenuOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  //popup states
  const [showJoinClassPopup, setShowJoinClassPopup] = useState(false);
  const [classCodeInput, setClassCodeInput] = useState("");
  const [currentClassId, setCurrentClassId] = useState(null);


  const [showSwitchClassPopup, setShowSwitchClassPopup] = useState(false);
  const [classList, setClassList] = useState([]);
  
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [deleteAccountMessage, setDeleteAccountMessage] = useState("");

  const [showAnnouncementsPopup, setShowAnnouncementsPopup] = useState(false);
  const [announcements, setAnnouncements] = useState([]);

  {/* INITIALIZE APP */}
  async function initializeApp() {
    const token = localStorage.getItem("token");

    if (!token) {
      return;
    }
    resetState();
    const acc = await fetchAccount();

    const accountData = acc.account ?? acc;
    setAccount(accountData);

    await getClasses(accountData.accountType);
    await fetchConversations();

  }

  function resetState() {
    setMessages([]);
    setInput('');
    setShowMenu(false);
    setSidebarOpen(false);
    setAttachments([]);
    setAccount(null);
    setCurrentClass("Showing All");
    setClassMenuOpen(false);
    setConversations([]);
    setCurrentConversationId(null);
  }

    
  {/* FILE ATTACHMENT HANDLERS */}
  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };
  
  {/* FETCH ACCOUNT INFO */}
  async function fetchAccount() {
    const token = localStorage.getItem("token");
    console.log("fetchAccount() token =", token);

    const res = await fetch("http://localhost:5000/account", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    const json = await res.json();
    console.log("fetchAccount() returned:", json);
    return json;
  }

  {/* JOIN CLASS */}
  async function handleJoinClass() {
    const token = localStorage.getItem("token");

    try {
      const res = await fetch("http://localhost:5000/student/addClassMember", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ class_key: classCodeInput })
      });

      const data = await res.json();
      alert(data.message);

      setShowJoinClassPopup(false);
      setClassCodeInput("");

    } catch (error) {
      console.error("Error joining class:", error);
      alert("Server error. Try again.");
    }
  }

  {/* FETCH CLASSES */}
  async function getClasses(accountType) {
    const token = localStorage.getItem("token");

    try {
      const res = await fetch("http://localhost:5000/getClasses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ accountType })
      });

      const data = await res.json();
      setClassList(data.classes || []);
    } catch (error) {
      console.error("Error fetching classes:", error);
    }
  }

  {/* FETCH CONVERSATIONS */}
  async function fetchConversations() {
    const token = localStorage.getItem("token");
      if (!token) {
    console.warn("No token — skipping fetchConversations");
    return;
    }

    try {
      const res = await fetch("http://localhost:5000/getConversations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          class_id: currentClassId
        })
      });

      const data = await res.json();
      setConversations(data.rows || []);

    } catch (error) {
      console.error("Error loading conversations:", error);
    }
  }

  {/* LOAD ANNOUNCEMENTS */}
  async function loadAnnouncements() {
    const token = localStorage.getItem("token");

    if (!currentClassId) {
      alert("Select a class to view announcements");
      return;
    }

    try {
      const res = await fetch("http://localhost:5000/getAnnouncements", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ class_id: currentClassId })
      });

      const data = await res.json();
      setAnnouncements(data.announcements || []);
      setShowAnnouncementsPopup(true);

    } catch (error) {
      console.error("Error loading announcements:", error);
    }
  }

  {/* LOAD CHAT LOGS */}
  async function loadChatLogs(conversation_id) {
    const token = localStorage.getItem("token");

    try {
      const res = await fetch("http://localhost:5000/getChatLogs", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ conversation_id })
      });

      const data = await res.json();

      if (data.rows) {
        const formatted = data.rows.map(log => ({
          id: log.chatlog_id,
          content: log.chat,
          sender: log.chat_type === "question" ? "user" : "assistant"
        }));

        setMessages(formatted);
      }
    } catch (error) {
      console.error("Error loading chat logs:", error);
    }
  }


  {/* SWITCH CLASS POPUP */}
    async function openSwitchClassPopup() {
      const token = localStorage.getItem("token");

      try {
        const res = await fetch("http://localhost:5000/getClasses", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ 
            accountType: account?.accountType
          })
        });

        const data = await res.json();
        setClassList(data.classes || []);
        setShowSwitchClassPopup(true);
        setClassMenuOpen(false);

      } catch (error) {
        console.error("Error fetching classes:", error);
        alert("Error fetching classes");
      }
    }

  {/* CREATE CONVERSATION */}
  async function createConversation(title) {
    const token = localStorage.getItem("token");
    if(currentClassId === "Showing All") {
      setCurrentClassId(null);
    }
    try {
      const res = await fetch("http://localhost:5000/createConversation", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ title, class_id: currentClassId})
      });
      if(currentClass === "null") {
        setCurrentClass("Showing All");
      }
      const data = await res.json();
      return data.conversation_id; 
    } catch (error) {
      console.error("Error creating conversation:", error);
    }

  }

  {/* SAVE CHAT LOG */}
  async function saveChatLog(conversation_id, chat_type, chat) {
    const token = localStorage.getItem("token");

    try {
      await fetch("http://localhost:5000/saveChatLog", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ conversation_id, chat_type, chat })
      });
    } catch (error) {
      console.error("Error saving chat log:", error);
    }
  }

  {/* LEAVE CLASS */} 
  async function handleLeaveClass() {
    if (!currentClassId) {
      alert("You must select a class before leaving.");
      return;
    }

    const token = localStorage.getItem("token");

    try {
      const res = await fetch("http://localhost:5000/leaveClass", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ class_id: currentClassId })
      });

      const data = await res.json();
      alert(data.message);

      // Reset UI
      setCurrentClass("Showing All");
      setCurrentClassId(null);
      setMessages([]);
      setCurrentConversationId(null);

      // Reload classes
      getClasses(account?.accountType);

    } catch (error) {
      console.error("Error leaving class:", error);
      alert("Error leaving class");
    }
  }

  {/* DELETE ACCOUNT */}
  async function handleDeleteAccount() {
    const token = localStorage.getItem("token");

    try {
      const res = await fetch("http://localhost:5000/deleteAccount", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          account_id: account?.account_id
        })
      });

      const data = await res.json();

      if (data.message?.toLowerCase().includes("success")) {
        setDeleteAccountMessage("Account deleted. Redirecting...");

        setTimeout(() => {
          localStorage.removeItem("token");
          window.location.href = "/login";
        }, 1500);
      } else {
        setDeleteAccountMessage(data.message || "Unable to delete account");
      }

    } catch (err) {
      console.error("Delete account error:", err);
      setDeleteAccountMessage("Server error");
    }
  }

  {/* ATTACHMENT HANDLERS */}
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

  {/* CLEANUP CREATED URLS */}
  useEffect(() => {
    return () => {
      createdUrlsRef.current.forEach((u) => {
        try { URL.revokeObjectURL(u); } catch (e) {}
      });
      createdUrlsRef.current.clear();
    };
  }, []);

  {/* GENERATE ASSISTANT RESPONSE */}
  const generateAssistantResponse = (userMessage) => {
    return {
      id: Date.now() + 1,
      content: `This is a simulated response to: "${userMessage}"`,
      sender: 'assistant'
    };
  };

  {/* HANDLE SEND MESSAGE */}
  const handleSend = async (e) => {
      e.preventDefault();
      if (!input.trim() && attachments.length === 0) return;

      let conversationId = currentConversationId;

      if (!conversationId) {
        conversationId = await createConversation(input); 
        setCurrentConversationId(conversationId);
        fetchConversations();
      }

      const userMessage = {
        id: Date.now(),
        content: input,
        sender: "user",
        attachments: attachments.map((a) => ({
          id: a.id,
          name: a.name,
          url: a.url,
          type: a.type
        }))
      };

      //Save user message to database
      await saveChatLog(conversationId, "question", input);

      //AI MESSAGE
      const assistantMessage = generateAssistantResponse(input);

      //Save AI message to DB
      await saveChatLog(conversationId, "ai", assistantMessage.content);
      

      //Update UI
      setMessages((prev) => [...prev, userMessage, assistantMessage]);

      // Clear input & attachments
      setInput("");
      setAttachments([]);
      
    };


  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  {/*Initialize App on Load*/}
  useEffect(() => {
    initializeApp();
  }, []);


  {/*fetch conversations and chat logs when account or class changes*/}
  useEffect(() => {
    if (!account) return;
    fetchConversations();
  }, [account, currentClassId]);

  {/*fetch chat logs when conversation changes*/}
  useEffect(() => {
    if (!currentConversationId) return;
    loadChatLogs(currentConversationId);
  }, [currentConversationId]);


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
          {/* Sidebar Logo */}
          <div className="flex items-center justify-between px-4 py-5 text-xl font-semibold">
            <div className="flex items-center gap-2">
              <img src="/EagleDocs Logo.png" alt="EagleDocs" className="w-8 h-8" />
              <span className="hidden md:inline">EagleDocs</span>
            </div>
            <button className="md:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="h-6 w-6 text-gray-500" />
            </button>
          </div>
          {/* Sidebar New Chat & Search */}
          <div className="px-4">
            <button
              className="w-full flex items-center gap-2 text-sm bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
              onClick={() => {
                setMessages([]);
                setInput("");
                setCurrentConversationId(null);
              }}
            >
              <Plus className="h-4 w-4" /> New Chat
            </button>
            <div className="mt-4 relative">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search chats"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              />
            </div>
          </div>
          {/* Conversation List */}
          <div className="px-4 mt-6 text-xs text-gray-500 dark:text-gray-400">Recent</div>
            {(() => {
              const filteredConversations = conversations.filter((c) =>
                c.conversation_title?.toLowerCase().includes(searchQuery.toLowerCase())
              );
              return (
                <ul className="mt-1 text-sm px-4 space-y-1 overflow-y-auto flex-1">
                  {filteredConversations.length > 0 ? (
                    filteredConversations.map((c) => (
                      <li
                        key={c.conversation_id}
                        className="text-gray-800 dark:text-gray-200 hover:bg-gray-200 
                                dark:hover:bg-gray-800 px-3 py-2 rounded cursor-pointer"
                        onClick={() => {
                          setCurrentConversationId(c.conversation_id);
                          loadChatLogs(c.conversation_id);
                          
                        }}
                      >
                        {c.conversation_title}
                      </li>
                    ))
                  ) : (
                    <li className="text-gray-500 dark:text-gray-400 px-3 py-2">
                      No conversations found
                    </li>
                  )}
                </ul>
              );
            })()}

        </div>
        {/* Sidebar Bottom User Info */}
        <div className="border-t px-4 py-3">
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-2 w-full hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1 rounded"
            >
              <UserCircle className="h-6 w-6 text-gray-500" />
              <span className="text-sm text-gray-800 dark:text-gray-200">{account ? account.email : "Loading..."}</span>
            </button>
            {showMenu && (
              <div className="absolute bottom-10 left-0 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-md z-10">
                <button
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-800"
                  onClick={() => {
                    setShowSettingsModal(true);
                    setProfileOpen(false);
                  }}
                >
                  Settings
                </button>

                <button
                  onClick={() => {
                    localStorage.removeItem("token");
                    window.location.href = "/login"; 
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col ml-0 md:ml-90">

            {/* TOP TASKBAR */}
            <div className="w-full bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <button
                  className="text-sm font-medium text-gray-800 dark:text-gray-200 hover:text-blue-500" onClick={loadAnnouncements}>
                  Announcements
                </button>
              </div>
              <div className="relative">
                <button
                  onClick={() => setClassMenuOpen(!classMenuOpen)}
                  className="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1 hover:text-blue-500"
                >
                  {currentClass}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {/* Class Dropdown Menu */}
                {classMenuOpen && (
                  <div className="absolute right-0 mt-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded shadow-lg w-40 z-20">
                    <button
                      onClick={openSwitchClassPopup}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Switch Class
                    </button>
                    <button
                      onClick={() => { 
                        setClassMenuOpen(false);
                        setShowJoinClassPopup(true);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700">
                      Join Class
                  </button>
                  <button
                    onClick={handleLeaveClass}
                    className="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Leave Class
                  </button>
                  </div>
                )}
              </div>
            </div>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 md:hidden">
            <button onClick={() => setSidebarOpen(true)}>
              <Menu className="h-6 w-6 text-gray-700 dark:text-gray-200" />
            </button>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{selectedChatTitle}</div>
        <div className="w-6" />
      </div>
        {/* Messages */}
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


              {/* JOIN CLASS POPUP */}
              {showJoinClassPopup && (
                <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
                  <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-80 shadow-xl border border-gray-200 dark:border-gray-700">      
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
                      Enter Class Code
                    </h2>
                    <input type="text" value={classCodeInput}
                      onChange={(e) => setClassCodeInput(e.target.value)}
                      placeholder="Class Code"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="flex justify-end gap-3 mt-5">
                      <button
                        onClick={() => setShowJoinClassPopup(false)}
                        className="px-4 py-2 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleJoinClass}
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg"
                      >
                        Join
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* SETTINGS POPUP */}
              {showSettingsModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
                  <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-96 shadow-xl border border-gray-200 dark:border-gray-700">
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
                      Settings
                    </h2>

                    {/* DELETE ACCOUNT BUTTON */}
                    <button
                      onClick={handleDeleteAccount}
                      className="w-full px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 text-sm"
                    >
                      Delete Account
                    </button>
                    {deleteAccountMessage && ( <p className="text-center mt-3 text-sm text-red-500">{deleteAccountMessage} </p> )}

                    <div className="flex justify-end gap-2 mt-5">
                      <button
                        onClick={() => {
                          setShowSettingsModal(false);
                          setDeleteAccountMessage("");
                        }}
                        className="px-4 py-2 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ANNOUNCEMENTS POPUP */}
              {showAnnouncementsPopup && (
                <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
                  <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-[90vw] h-[85vh] shadow-xl border border-gray-200 dark:border-gray-700 overflow-y-auto">
                    <div className="flex justify-between items-center mb-6">
                      <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                        Announcements — {currentClass}
                      </h2>
                      <button
                        onClick={() => setShowAnnouncementsPopup(false)}
                        className="px-4 py-2 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800">
                        Close
                      </button>
                    </div>

                    {announcements.length === 0 ? (
                      <div className="text-gray-600 dark:text-gray-300 text-lg text-center mt-20">
                        No announcements for this class.
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {announcements.map((a) => (
                            <div
                              key={a.announcement_id}
                              className="p-6 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700"
                            >

                            <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                              {a.title}
                            </div>

                            <div className="text-sm leading-relaxed whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                              {a.announcement}
                            </div>

                            {a.due_date && (
                              <div className="text-sm text-red-500 dark:text-red-400 mt-3">
                                <strong>Due:</strong> {new Date(a.due_date).toLocaleString()}
                              </div>
                            )}
                            
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                              Posted: {new Date(a.created_at).toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                  </div>
                </div>
              )}


              {/* SWITCH CLASS POPUP */}
              {showSwitchClassPopup && (
                <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
                  <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-96 shadow-xl border border-gray-200 dark:border-gray-700">

                    <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
                      Select a Class
                    </h2>

                    {/* Class list */}
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {classList.length > 0 ? (
                        classList.map((c, index) => (
                          <button
                            key={index}
                            className="w-full text-left px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                            onClick={() => {
                              setCurrentClass(c.class_name);
                              setCurrentClassId(c.class_id);
                              setShowSwitchClassPopup(false);
                              setMessages([]);
                              setCurrentConversationId(null);
                              fetchConversations();
                            }}

                          >
                            {c.class_name}
                          </button>
                        ))
                      ) : (
                        <div className="text-gray-600 dark:text-gray-300 text-sm text-center py-3">
                          No classes found.
                        </div>
                      )}
                    </div>
                    <div className="flex justify-end gap-2 mt-5">
                      <button
                        onClick={() => {
                          setCurrentClass("Showing All");
                          setCurrentClassId(null);
                          setMessages([]);
                          setCurrentConversationId(null);
                          setShowSwitchClassPopup(false);
                        }}
                        className="px-3 py-2 text-sm rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700"
                      >
                        Show All
                      </button>

                      {/* Close button */}
                      <button
                        onClick={() => setShowSwitchClassPopup(false)}
                        className="px-4 py-2 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}

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