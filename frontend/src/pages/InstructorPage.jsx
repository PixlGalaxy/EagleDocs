import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';   
import { Helmet } from 'react-helmet';
import {
  Home,
  BookOpen,
  Users,
  Calendar,
  MessageSquare,
  File,
  Settings,
  ChevronRight,
  Bell,
  Plus,
  MoreHorizontal,
  Bot
} from 'lucide-react';

const InstructorPage = () => {
  const navigate = useNavigate();

  {/* STATE VARIABLES */}
  const [selectedNav, setSelectedNav] = useState('home');
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [isProfileOpen, setProfileOpen] = useState(false);
  const [isAuthenticated, setAuthenticated] = useState(true);
  const [account, setAccount] = useState(null);
  const username = account ? account.email : 'Loading...';
  const initials = username
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const profileRef = useRef(null);
  const [classes, setClasses] = useState([]);
  const [showStudentsModal, setShowStudentsModal] = useState(false);
  const [selectedClass, setSelectedClass] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [className, setClassName] = useState('');
  const [classKey, setClassKey] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementClassId, setAnnouncementClassId] = useState('');
  const [announcementContent, setAnnouncementContent] = useState('');
  const [includeDueDate, setIncludeDueDate] = useState(false);
  const [announcementDueDate, setAnnouncementDueDate] = useState('');
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [selectedAnnouncementClass, setSelectedAnnouncementClass] = useState("");
  const [loadedAnnouncements, setLoadedAnnouncements] = useState([]);
  const [showViewAnnouncementModal, setShowViewAnnouncementModal] = useState(false);
  const [activeAnnouncement, setActiveAnnouncement] = useState(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [deleteAccountMessage, setDeleteAccountMessage] = useState("");
  const [students, setStudents] = useState([]);

  
  {/* LOAD ACCOUNT AND CLASSES */}
  useEffect(() => {
    async function loadAccount() {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("http://localhost:5000/account", {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        });
        const data = await res.json();
        setAccount(data);
      } catch (err) {
        console.error('Fetch account error:', err);
      }
    }
    loadAccount();
  }, []);

  async function deleteClass(classId) {
    if (!classId) {
      console.error("deleteClass() missing classId");
      return;
    }

    const confirmDelete = window.confirm(
      "Are you sure you want to delete this class and ALL DATA (announcements, students, conversations)?"
    );

    if (!confirmDelete) return;

    try {
      const token = localStorage.getItem("token");

      const res = await fetch("http://localhost:5000/deleteClass", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ class_id: classId })
      });

      const data = await res.json();

      alert(data.message);

      if (data.message?.toLowerCase().includes("success")) {
        // Remove from UI
        setClasses((prev) => prev.filter((c) => c.class_id !== classId));
        setShowStudentsModal(false);
      }
    } catch (err) {
      console.error("Delete class error:", err);
      alert("Server error. Try again.");
    }
  }


  {/* LOAD CLASSES */}
  useEffect(() => {
    async function loadClasses() {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("http://localhost:5000/getClasses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            accountType: account.accountType
          })
        });
        const data = await res.json();
        if (data.classes) {
          setClasses(data.classes);
        } else {
          console.error("Unexpected response:", data);
        }
      } catch (err) {
        console.error("Failed to load classes:", err);
      }
    }
    if (account) loadClasses();
  }, [account]);

  {/* LOAD ANNOUNCEMENTS FOR CLASS */}
  async function loadAnnouncementsForClass(classId) {
  try {
      const token = localStorage.getItem('token');
      const res = await fetch("http://localhost:5000/getAnnouncements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ class_id: classId })
      });

      const data = await res.json();
      if (data.announcements) {
        setLoadedAnnouncements(data.announcements);
      } else {
        setLoadedAnnouncements([]);
      }
    } catch (err) {
      console.error("Error loading announcements:", err);
    }
  }

  {/* LOAD STUDENTS FOR CLASS */}
  async function loadStudentsForClass(classId) {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("http://localhost:5000/getStudentsInClass", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ class_id: classId })
      });

      const data = await res.json();
      if (data.students) {
        setStudents(data.students);
      } else {
        setStudents([]);
      }
    } catch (err) {
      console.error("Error loading students:", err);
    }
  }

  {/* DELETE ANNOUNCEMENT */}
  async function handleDeleteAnnouncement() {
    if (!activeAnnouncement) return;

    const token = localStorage.getItem("token");

    try {
      const res = await fetch("http://localhost:5000/deleteAnnouncement", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          announcement_id: activeAnnouncement.announcement_id
        })
      });

      const data = await res.json();

      if (data.message?.toLowerCase().includes("success")) {
        setLoadedAnnouncements((prev) =>
          prev.filter((a) => a.announcement_id !== activeAnnouncement.announcement_id)
        );

        setShowViewAnnouncementModal(false);
        setActiveAnnouncement(null);
      } else {
        alert(data.message || "Failed to delete announcement");
      }
    } catch (err) {
      console.error("Delete announcement error:", err);
      alert("Server error");
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

  {/* PROFILE DROPDOWN HANDLER */}
  useEffect(() => {
    function handleClickOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    }
    if (isProfileOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProfileOpen]);

  {/* CREATE CLASS */}
  async function handleCreateClass() {
    setModalMessage('');

    if (!className.trim() || !classKey.trim()) {
      setModalMessage('Class name and key are required.');
      return;
    }

    const token = localStorage.getItem('token');

    try {
      const res = await fetch('http://localhost:5000/teacher/createClass', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          class_name: className,
          class_key: classKey
        })
      });

      const data = await res.json();

      if (res.ok && (data.message?.toLowerCase().includes('created'))) {
        setModalMessage(data.message);
        setClassName('');
        setClassKey('');
      } else {
        setModalMessage(data.message || 'Failed to create class');
      }
    } catch (err) {
      console.error('Create class error:', err);
      setModalMessage('Server error. Try again.');
    }
  }

  {/* CREATE ANNOUNCEMENT */}
  async function handleCreateAnnouncement() {
    setAnnouncementMessage('');

    if (!announcementTitle.trim()) {
      setAnnouncementMessage('Title is required.');
      return;
    }
    if (!announcementClassId) {
      setAnnouncementMessage('Please select a class.');
      return;
    }
    if (!announcementContent.trim()) {
      setAnnouncementMessage('Content is required.');
      return;
    }
    if (includeDueDate && !announcementDueDate) {
      setAnnouncementMessage('Please select a due date or uncheck the box.');
      return;
    }

    const token = localStorage.getItem('token');

    try {
      const res = await fetch('http://localhost:5000/createAnnouncement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          class_id: announcementClassId,
          title: announcementTitle,
          content: announcementContent,
          due_date: includeDueDate && announcementDueDate ? announcementDueDate : null
        })
      });

      const data = await res.json();

      if (res.ok && data.message?.toLowerCase().includes('success')) {
        setAnnouncementMessage(data.message || 'Announcement created successfully.');

        //reset fields
        setAnnouncementTitle('');
        setAnnouncementClassId('');
        setAnnouncementContent('');
        setIncludeDueDate(false);
        setAnnouncementDueDate('');
      } else {
        setAnnouncementMessage(data.message || 'Failed to create announcement.');
      }
    } catch (err) {
      console.error('Create announcement error:', err);
      setAnnouncementMessage('Server error. Try again.');
    }
  }

  const navigationItems = [
    { id: 'home', label: 'Home', icon: <Home size={20} /> },
    //{ id: 'Ai', label: 'Talk to AI', icon: <Bot size={20} /> },
  ];

  return (
    <div className="min-h-screen bg-gray-200 relative">
      <Helmet>
        <title>Instructor Dashboard - EagleDocs</title>
      </Helmet>

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-30">
        <div className={`transition-all duration-300 ${isSidebarOpen ? 'pl-64' : 'pl-0'} w-full`}>
          <div className="px-6">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => setSidebarOpen(!isSidebarOpen)}
                  className="p-2 rounded-md text-gray-500 hover:text-gray-600 hover:bg-gray-100"
                >
                  {isSidebarOpen ? "❌" : "☰"}
                </button>
                <h1 className="text-xl font-semibold text-gray-900">
                  Instructor Dashboard
                </h1>
              </div>
              <div className="flex items-center space-x-3">
                <Bell size={20} className="text-gray-600" />
                <button
                  className="inline-flex items-center px-4 py-2 rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                  onClick={() => setShowAnnouncementModal(true)}
                >
                  <Plus size={16} className="mr-2" />
                  Create Announcement
                </button>
                <button
                  className="inline-flex items-center px-4 py-2 rounded-md text-white bg-blue-600 hover:bg-blue-700"
                  onClick={() => setShowCreateModal(true)}
                >
                  <Plus size={16} className="mr-2" />
                  Create Class
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <nav
        className={`fixed left-0 top-0 bottom-0 w-64 bg-gray-800 text-white transform transition-all duration-300 z-40 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="pt-4 px-4 relative h-full flex flex-col justify-between">
          {/* TOP NAVIGATION */}
          <div>
            <ul className="space-y-2">
              {navigationItems.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => setSelectedNav(item.id)}
                    className={`w-full flex items-center px-4 py-3 rounded-lg transition ${
                      selectedNav === item.id
                        ? 'bg-gray-700 text-white'
                        : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    <span className="mr-3">{item.icon}</span>
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* BOTTOM ACCOUNT BOX */}
          <div className="border-t border-gray-700 pt-3 mt-3 relative" ref={profileRef}>
            <button
              onClick={() => setProfileOpen(!isProfileOpen)}
              className="w-full flex items-center gap-3 px-2 py-2 hover:bg-gray-700 rounded"
            >
              <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold">
                {initials}
              </div>
              <span className="text-sm text-gray-200 truncate">{username}</span>
              <ChevronRight size={16} className="ml-auto text-gray-300" />
            </button>

            {/* FIXED: Absolute-positioned Dropdown */}
            {isProfileOpen && (
              <div
                className="
                  absolute bottom-full mb-2 left-0 w-full
                  bg-gray-900 border border-gray-700 rounded-lg shadow-xl
                  z-50
                "
              >
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
                  className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-gray-800"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main className={`transition-all duration-300 ${isSidebarOpen ? 'ml-64' : 'ml-0'}`}>
        <div className="pt-20 px-6 max-w-7xl mx-auto">
          <div className="flex-1 space-y-6">

            {/* Announcements Section */}
            <section className="bg-white rounded-lg shadow-lg border border-gray-300">
              <div className="p-6">

                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-medium text-gray-900">Announcements</h2>

                  <select
                    className="text-sm text-black border border-black bg-white rounded px-2 py-1 w-48 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    value={selectedAnnouncementClass}
                    onChange={(e) => {
                      const classId = e.target.value;
                      setSelectedAnnouncementClass(classId);
                      loadAnnouncementsForClass(classId);
                    }}
                  >
                    <option value="">Select class</option>
                    {classes.map((cls) => (
                      <option key={cls.class_id} value={cls.class_id}>
                        {cls.class_name}
                      </option>
                    ))}
                  </select>

                </div>

                {!selectedAnnouncementClass && (
                  <p className="text-gray-600 italic">Choose a class to see its announcements.</p>
                )}

                {selectedAnnouncementClass && (
                  <div className="space-y-4 mt-4">
                    {loadedAnnouncements.length === 0 && (
                      <p className="text-gray-600 italic">No announcements for this class.</p>
                    )}

                    {loadedAnnouncements.map((a) => (
                      <div
                        key={a.announcement_id}
                        onClick={() => {
                          setActiveAnnouncement(a);
                          setShowViewAnnouncementModal(true);
                        }}
                        className="border border-blue-100 border-l-4 border-l-blue-500 bg-blue-50 p-4 rounded-md cursor-pointer hover:shadow-md transition"
                      >
                        <div className="flex justify-between">
                          <h4 className="text-sm font-medium text-gray-900">{a.title}</h4>
                          <span className="text-xs text-gray-500">
                            {a.due_date ? new Date(a.due_date).toLocaleDateString() : ""}
                          </span>
                        </div>

                      <p
                        className="mt-1 text-sm text-gray-700"
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis"
                        }}
                      >
                        {a.announcement}
                      </p>
                      </div>
                    ))}
                  </div>
                )}

              </div>
            </section>

            {/* Classes Section */}
            <section className="bg-white rounded-xl shadow-lg border border-gray-300">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-medium text-gray-900">Your Classes</h2>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {classes.length > 0 ? (
                    classes.map((cls) => (
                      <div
                        key={cls.class_id}
                        onClick={() => {
                          setSelectedClass(cls);
                          loadStudentsForClass(cls.class_id);
                          setShowStudentsModal(true);
                        }}

                        className="cursor-pointer p-5 bg-white border border-gray-300 rounded-xl shadow-lg hover:shadow-xl transition"

                      >
                        <h3 className="text-lg font-bold text-gray-900">
                          {cls.class_name}
                        </h3>

                        <p className="text-sm text-gray-600 mt-2">
                          <span className="font-semibold text-gray-800">Class ID:</span> {cls.class_id}
                        </p>
                        <p className="text-sm text-gray-600">
                          <span className="font-semibold text-gray-800">Class Key:</span> {cls.class_key}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-600">No classes found.</p>
                  )}
                </div>
              </div>
            </section>

          </div>
        </div>
      </main>


{/* STUDENTS POPUP MODAL */}
{showStudentsModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center">
    
    {/* DARK BACKDROP */}
    <div
      className="absolute inset-0 bg-black opacity-40"
      onClick={() => setShowStudentsModal(false)}
    />

    {/* MAIN POPUP */}
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl z-50 w-full max-w-md border border-gray-200 relative flex flex-col">

      {/* HEADER */}
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {selectedClass?.class_name}
      </h2>

      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
        Students in this class - Click a student to view their chats
      </p>

      {/* STUDENTS LIST (scrollable) */}
      <div className="flex-1 max-h-64 overflow-y-auto pr-1 mb-4">
        {students.length === 0 ? (
          <p className="text-gray-600 italic">No students enrolled in this class.</p>
        ) : (
          students.map((s) => (
            <div
              key={s.member_id}
              className="p-2 mb-2 bg-gray-100 rounded-md border border-gray-300 cursor-pointer hover:bg-gray-200 transition"
              onClick={() => {
                if (!s.student_id) {
                  console.error("NO STUDENT ID FOUND IN:", s);
                  return;
                }

                localStorage.setItem("viewStudentId", s.student_id);
                localStorage.setItem("viewClassId", selectedClass.class_id);

                navigate("/StudentChatView");
              }}
            >
              <p className="font-medium text-gray-900 text-sm">{s.email}</p>
              <p className="text-xs text-gray-500">
                Joined: {new Date(s.joined_at).toLocaleDateString()}
              </p>
            </div>
          ))
        )}
      </div>

      {/* FOOTER BUTTONS */}
      <div className="flex justify-between items-center mt-2 pt-3 border-t border-gray-300">

        {/* DELETE CLASS BUTTON */}
        <button
          className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
          onClick={() => deleteClass(selectedClass.class_id)}
        >
          Delete Class
        </button>

        {/* CLOSE BUTTON */}
        <button
          className="px-4 py-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          onClick={() => setShowStudentsModal(false)}
        >
          Close
        </button>

      </div>

    </div>
  </div>
)}



      {/* Create Class Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black opacity-40"
            onClick={() => setShowCreateModal(false)}
          />
          <div className="bg-white rounded-lg shadow-lg z-50 w-full max-w-md p-6 relative border border-gray-200">
            <h3 className="text-lg text-gray-700 font-bold mb-4">Create Class</h3>

            <label className="block text-sm text-gray-700 mb-1">Class Name</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-3 py-2 mb-3"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
            />

            <label className="block text-sm text-gray-700 mb-1">Class Key</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-3 py-2 mb-3"
              value={classKey}
              onChange={(e) => setClassKey(e.target.value)}
            />

            {modalMessage && (
              <div className="text-sm text-center mb-3 text-red-600">{modalMessage}</div>
            )}

            <div className="flex justify-end space-x-2">
              <button
                className="px-4 py-2 rounded hover:bg-gray-200"
                onClick={() => {
                  setShowCreateModal(false);
                  setModalMessage('');
                }}
              >
                Cancel
              </button>

              <button
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                onClick={handleCreateClass}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Announcement Modal */}
      {showViewAnnouncementModal && activeAnnouncement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black opacity-40"
            onClick={() => setShowViewAnnouncementModal(false)}
          />

          <div className="bg-white rounded-lg shadow-lg z-50 w-full max-w-lg p-6 border border-gray-300">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              {activeAnnouncement.title}
            </h3>

            <p className="text-sm text-gray-600 mb-2">
              <strong>Created:</strong>{" "}
              {new Date(activeAnnouncement.created_at).toLocaleDateString()}
            </p>

            {activeAnnouncement.due_date && (
              <p className="text-sm text-gray-600 mb-4">
                <strong>Due:</strong>{" "}
                {new Date(activeAnnouncement.due_date).toLocaleDateString()}
              </p>
            )}

            <div className="p-3 bg-gray-100 rounded border border-gray-300 mb-6">
              <p className="text-gray-800 whitespace-pre-wrap">
                {activeAnnouncement.announcement}
              </p>
            </div>

            <div className="flex justify-between">
              <button
                className="px-4 py-2 rounded hover:bg-gray-200"
                onClick={() => setShowViewAnnouncementModal(false)}
              >
                Close
              </button>
              <button
                className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
                onClick={handleDeleteAnnouncement}
              >
                Delete Announcement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black opacity-40"
            onClick={() => {
              setShowSettingsModal(false);
              setDeleteAccountMessage("");
            }}
          />

          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 border border-gray-200 z-50">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Settings</h3>

            <div className="space-y-4">

              {/* DELETE ACCOUNT BUTTON */}
              <button
                className="w-full px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700"
                onClick={handleDeleteAccount}
              >
                Delete Account
              </button>

              {deleteAccountMessage && (
                <p className="text-center text-sm text-red-600">{deleteAccountMessage}</p>
              )}
            </div>

            <div className="flex justify-end mt-6">
              <button
                className="px-4 py-2 rounded hover:bg-gray-200"
                onClick={() => {
                  setShowSettingsModal(false);
                  setDeleteAccountMessage("");
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Create Announcement Modal */}
      {showAnnouncementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black opacity-40"
            onClick={() => setShowAnnouncementModal(false)}
          />
          <div className="bg-white rounded-lg shadow-lg z-50 w-full max-w-md p-6 relative border border-gray-200">
            <h3 className="text-lg text-gray-700 font-bold mb-4">Create Announcement</h3>

            <label className="block text-sm text-gray-700 mb-1">Title</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-3 py-2 mb-3"
              value={announcementTitle}
              onChange={(e) => setAnnouncementTitle(e.target.value)}
            />

            <label className="block text-sm text-gray-700 mb-1">Class</label>
            <select
              className="w-full border border-gray-300 rounded px-3 py-2 mb-3"
              value={announcementClassId}
              onChange={(e) => setAnnouncementClassId(e.target.value)}
            >
              <option value="">Select a class</option>
              {classes.map((cls) => (
                <option key={cls.class_id} value={cls.class_id}>
                  {cls.class_name}
                </option>
              ))}
            </select>

            <label className="block text-sm text-gray-700 mb-1">Content</label>
            <textarea
              className="w-full border border-gray-300 rounded px-3 py-2 mb-3 h-24"
              value={announcementContent}
              onChange={(e) => setAnnouncementContent(e.target.value)}
            />

            <div className="flex items-center mb-3">
              <input
                id="includeDueDate"
                type="checkbox"
                className="mr-2"
                checked={includeDueDate}
                onChange={(e) => setIncludeDueDate(e.target.checked)}
              />
              <label htmlFor="includeDueDate" className="text-sm text-gray-700">
                Include Due Date
              </label>
            </div>

            {includeDueDate && (
              <div className="mb-3">
                <label className="block text-sm text-gray-700 mb-1">Due Date</label>
                <input
                  type="date"
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  value={announcementDueDate}
                  onChange={(e) => setAnnouncementDueDate(e.target.value)}
                />
              </div>
            )}

            {announcementMessage && (
              <div className="text-sm text-center mb-3 text-red-600">
                {announcementMessage}
              </div>
            )}

            <div className="flex justify-end space-x-2">
              <button
                className="px-4 py-2 rounded hover:bg-gray-200"
                onClick={() => {
                  setShowAnnouncementModal(false);
                  setAnnouncementMessage('');
                }}
              >
                Cancel
              </button>

              <button
                className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                onClick={handleCreateAnnouncement}
              >
                Save Announcement
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default InstructorPage;
