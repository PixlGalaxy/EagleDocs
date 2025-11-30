import React, { useState, useEffect, useRef } from "react";
import { Menu, X, Search, UserCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

const StudentChatView = () => {
  {/* STATES */}
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [className, setClassName] = useState("Class");
  const messagesEndRef = useRef(null);

  const studentId = Number(localStorage.getItem("viewStudentId"));
  const classId = Number(localStorage.getItem("viewClassId"));
  const [studentEmail, setStudentEmail] = useState("");

  {/* Load Current Class Name */}
  async function loadClassName() {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("http://localhost:5000/getClasses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ accountType: "teacher" })
      });

      const data = await res.json();
      if (data.classes) {
        const cls = data.classes.find((c) => c.class_id === classId);
        if (cls) setClassName(cls.class_name);
      }
    } catch (err) {
      console.error("Error loading class name:", err);
    }
  }

  {/* Load Student Info */}
  async function loadStudentInfo() {
    try {
      const token = localStorage.getItem("token");

      const res = await fetch("http://localhost:5000/getStudentInfo", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ student_id: studentId })
      });

      const data = await res.json();

      if (data.student) {
        setStudentEmail(data.student.email);
      }
    } catch (err) {
      console.error("Error loading student info:", err);
    }
  }

  {/* Fetch Conversations for Student in Class */}
  async function fetchConversations() {
    try {
      const token = localStorage.getItem("token");

      const res = await fetch("http://localhost:5000/getStudentConversations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          student_id: studentId,
          class_id: classId
        })
      });

      const data = await res.json();

      setConversations(data.rows || data.conversations || []);
    } catch (error) {
      console.error("Error fetching conversations:", error);
    }
  }

  {/* Load Chat Logs for Selected Conversation */}
  async function loadChatLogs(conversation_id) {
    try {
      const token = localStorage.getItem("token");

      const res = await fetch("http://localhost:5000/getChatLogs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ conversation_id })
      });

      const data = await res.json();

      const logs = data.rows || [];

      const formatted = logs.map((log) => ({
        id: log.chatlog_id,
        content: log.chat,
        sender: log.chat_type === "question" ? "student" : "assistant"
      }));

      setMessages(formatted);
    } catch (error) {
      console.error("Error loading chat logs:", error);
    }
  }

  {/* Auto-scroll to bottom on new messages */}
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initial load
  useEffect(() => {
    loadClassName();
    fetchConversations();
    loadStudentInfo();
  }, []);

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">

      {/* SIDEBAR */}
      <div
        className={`fixed z-50 md:relative md:translate-x-0 top-0 left-0 h-full w-64 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 flex flex-col justify-between transition-transform duration-300 transform ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } md:flex`}
      >
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

          {/* SEARCH */}
          <div className="px-4 mt-4 relative">
            <Search className="h-4 w-4 absolute left-7 top-2.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search chats"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
            />
          </div>

          {/* CONVERSATION LIST */}
          <div className="px-4 mt-4 text-xs text-gray-500 dark:text-gray-400">
            Conversations
          </div>

          <ul className="mt-1 text-sm px-4 space-y-1 overflow-y-auto flex-1">
            {conversations.length > 0 ? (
              conversations
                .filter((c) =>
                  c.conversation_title
                    ?.toLowerCase()
                    .includes(searchQuery.toLowerCase())
                )
                .map((c) => (
                  <li
                    key={c.conversation_id}
                    onClick={() => {
                      setCurrentConversationId(c.conversation_id);
                      loadChatLogs(c.conversation_id);
                    }}
                    className={`px-3 py-2 rounded cursor-pointer ${
                      currentConversationId === c.conversation_id
                        ? "bg-gray-800 dark:text-gray-200 font-semibold"
                        : "text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800"
                    }`}
                  >
                    {c.conversation_title}
                  </li>
                ))
            ) : (
              <li className="text-gray-500 px-3 py-2">No conversations</li>
            )}
          </ul>
        </div>

        {/* STUDENT INFO */}
        <div className="border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <UserCircle className="h-6 w-6 text-gray-500" />
            <span className="text-sm text-gray-800 dark:text-gray-200">
              {studentEmail || "Loading email..."}
            </span>
          </div>
        </div>
      </div>

      {/* RIGHT SIDE MAIN CONTENT */}
      <div className="flex-1 flex flex-col">

        {/* TOP TASKBAR */}
        <div className="w-full bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2"></div>
              {/* BACK BUTTON */}
              <button
                onClick={() => {
                  localStorage.removeItem("viewStudentId");
                  localStorage.removeItem("viewClassId");

                  navigate("/instructor");

                  setTimeout(() => {
                    window.location.reload();
                  }, 50);
                }}
                className="text-sm px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 
                          dark:bg-gray-800 dark:hover:bg-gray-700 
                          text-gray-800 dark:text-gray-200"
              >
                ← Back to Dashboard
              </button>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {className}
          </div>
        </div>
        

        {/* CHAT CONTENT */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 dark:text-gray-400">
              Select a conversation to view messages
            </div>
          ) : (
            <div className="flex flex-col">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`border-b border-gray-200 dark:border-gray-800 ${
                    msg.sender === "student"
                      ? "bg-white dark:bg-gray-900"
                      : "bg-gray-50 dark:bg-gray-800"
                  }`}
                >
                  <div className="max-w-3xl mx-auto px-4 py-6 flex gap-4">
                    <div className="w-7 h-7 flex-shrink-0">
                      {msg.sender === "student" ? (
                        <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm">
                          S
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-sm bg-green-500 flex items-center justify-center text-white text-sm">
                          A
                        </div>
                      )}
                    </div>
                    <div className="text-sm text-gray-800 dark:text-gray-100">
                      {msg.content}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default StudentChatView;
