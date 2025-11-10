import { useState, useEffect, useRef } from 'react';
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
  MoreHorizontal
} from 'lucide-react';

const InstructorPage = () => {
  const [selectedNav, setSelectedNav] = useState('home');
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [isProfileOpen, setProfileOpen] = useState(false);
  const [isAuthenticated, setAuthenticated] = useState(true);
  const username = 'Instructor Jane'; // placeholder; replace with real user data as available
  const initials = username
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const profileRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    }
    if (isProfileOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProfileOpen]);
  
  const navigationItems = [
    { id: 'home', label: 'Home', icon: <Home size={20} /> },
    { id: 'modules', label: 'Modules', icon: <BookOpen size={20} /> },
    { id: 'people', label: 'People', icon: <Users size={20} /> },
    { id: 'calendar', label: 'Calendar', icon: <Calendar size={20} /> },
    { id: 'discussions', label: 'Discussions', icon: <MessageSquare size={20} /> },
    { id: 'files', label: 'Files', icon: <File size={20} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={20} /> }
  ];

  const announcements = [
    {
      id: 1,
      title: 'Welcome to the Course',
      date: 'Nov 5, 2025',
      preview: 'Welcome to the Fall 2025 semester! Please review the syllabus...'
    },
    {
      id: 2,
      title: 'Module 1 Now Available',
      date: 'Nov 5, 2025',
      preview: 'The first module has been published and is ready for review...'
    }
  ];

  const upcomingAssignments = [
    {
      id: 1,
      title: 'Course Introduction Quiz',
      dueDate: 'Nov 10, 2025',
      points: 10
    },
    {
      id: 2,
      title: 'Assignment 1: Project Proposal',
      dueDate: 'Nov 15, 2025',
      points: 50
    }
  ];

  return (
      <div className="min-h-screen bg-gray-50 relative">
      <Helmet>
        <title>Course Dashboard - EagleDocs</title>
      </Helmet>

      {/* Course Header */}
        <header className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-30">
          <div className={`transition-all duration-300 ${isSidebarOpen ? 'pl-64' : 'pl-0'} w-full`}>
            <div className="px-6">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => setSidebarOpen(!isSidebarOpen)}
                    className="p-2 rounded-md text-gray-500 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    {isSidebarOpen ? (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    ) : (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 6h16M4 12h16M4 18h16"
                      />
                    )}
                  </svg>
                </button>
                <h1 className="text-xl font-semibold text-gray-900">
                  CSE 101: Introduction to Computer Science
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <button className="p-2 text-gray-400 hover:text-gray-500">
                  <Bell size={20} />
                </button>
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700">
                  <Plus size={16} className="mr-2" />
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <nav
        className={`fixed left-0 top-0 bottom-0 w-64 bg-gray-800 text-white transform transition-all duration-300 ease-in-out z-20 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="pt-20 px-4 relative h-full">
          <ul className="space-y-2">
            {navigationItems.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => setSelectedNav(item.id)}
                  className={`w-full flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-gray-500 ${
                    selectedNav === item.id
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  <span className="mr-3">{item.icon}</span>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>

          {/* Profile area at bottom of sidebar */}
          <div className="absolute left-0 right-0 bottom-4 px-4">
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen(!isProfileOpen)}
                className="w-full flex items-center p-2 rounded-md hover:bg-gray-700 focus:outline-none"
              >
                <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-sm font-medium text-white">{initials}</div>
                <div className="ml-3 flex-1 text-left">
                  <div className="text-sm font-medium">{isAuthenticated ? username : 'Guest'}</div>
                  <div className="text-xs text-gray-300">{isAuthenticated ? 'Signed in' : 'Not signed in'}</div>
                </div>
                <ChevronRight size={16} className={`text-gray-300 transition-transform ${isProfileOpen ? 'rotate-90' : ''}`} />
              </button>

              {isProfileOpen && (
                <div className="absolute left-0 bottom-14 w-full z-30 bg-gray-700 text-white rounded-md shadow-lg overflow-hidden">
                  <div className="px-3 py-2 text-sm border-b border-gray-600">Signed in as <strong className="text-white">{username}</strong></div>
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-gray-600"
                    onClick={() => {
                      // open settings - replace with real navigation when available
                      console.log('Open settings');
                      setProfileOpen(false);
                    }}
                  >
                    Settings
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-gray-600"
                    onClick={() => {
                      // toggle authentication for demo purposes
                      setAuthenticated((s) => !s);
                      setProfileOpen(false);
                    }}
                  >
                    {isAuthenticated ? 'Log out' : 'Log in'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className={`transition-all duration-300 ${isSidebarOpen ? 'ml-64' : 'ml-0'}`}>
        <div className="pt-20 px-6 max-w-7xl mx-auto">
          <div className="flex-1 space-y-6">
            {/* Course Overview Section */}
            <section className="bg-white rounded-lg shadow">
              <div className="p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">
                  Course Overview
                </h2>
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Recent Announcements */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                      Recent Announcements
                    </h3>
                    <div className="space-y-4">
                      {announcements.map((announcement) => (
                        <div
                          key={announcement.id}
                          className="border-l-4 border-blue-500 bg-blue-50 p-4"
                        >
                          <div className="flex justify-between items-start">
                            <h4 className="text-sm font-medium text-gray-900">
                              {announcement.title}
                            </h4>
                            <span className="text-xs text-gray-500">
                              {announcement.date}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-gray-600">
                            {announcement.preview}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Upcoming Assignments */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                      Upcoming Assignments
                    </h3>
                    <div className="bg-white rounded-lg border border-gray-200">
                      {upcomingAssignments.map((assignment, index) => (
                        <div
                          key={assignment.id}
                          className={`p-4 flex items-center justify-between ${
                            index !== upcomingAssignments.length - 1
                              ? 'border-b border-gray-200'
                              : ''
                          }`}
                        >
                          <div>
                            <h4 className="text-sm font-medium text-gray-900">
                              {assignment.title}
                            </h4>
                            <p className="text-xs text-gray-500">
                              Due: {assignment.dueDate}
                            </p>
                          </div>
                          <div className="flex items-center">
                            <span className="text-sm text-gray-600 mr-2">
                              {assignment.points} pts
                            </span>
                            <ChevronRight size={16} className="text-gray-400" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Modules Section */}
            <section className="bg-white rounded-lg shadow">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-medium text-gray-900">Modules</h2>
                  <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                    View All
                  </button>
                </div>
                <div className="space-y-2">
                  {[1, 2, 3].map((module) => (
                    <div
                      key={module}
                      className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium text-gray-900">
                          Module {module}: Introduction to Programming
                        </h3>
                        <button className="p-2 hover:bg-gray-100 rounded-full">
                          <MoreHorizontal size={16} className="text-gray-400" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
};

export default InstructorPage;