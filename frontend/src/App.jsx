import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ChatPage from './pages/ChatPage';
import NotFound from './pages/NotFound';
import Developers from './pages/Developers';
import About from './pages/About';
import TermsOfService from './pages/TermsOfServicePage';
import PrivacyPolicy from './pages/PrivacyPolicy';
import Contact from './pages/ContactPage';
import GitHubPage from './pages/GitHubPage';
import InstructorPage from './pages/InstructorPage';
import StudentChatView from './pages/StudentChatView';

function App() {

  return (
    <Router>
      <Routes>

        {/* Catch-all for unmatched routes */}
        <Route path="*" element={<NotFound />} />

        {/* Public homepage */}
        <Route path="/" element={<HomePage />} />

        {/* Login + Register always visible (NO REDIRECT BASED ON TOKEN) */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Chat page */}
        <Route path="/chat" element={<ChatPage />} />

        {/* Developer Page */}
        <Route path="/developers" element={<Developers />} />

        {/* About Page */}
        <Route path="/about" element={<About />} />

        {/* Terms of Service */}
        <Route path="/tos" element={<TermsOfService />} />

        {/* Privacy Policy */}
        <Route path="/privacy" element={<PrivacyPolicy />} />

        {/* Contact Page */}
        <Route path="/contact" element={<Contact />} />

        {/* GitHub Page */}
        <Route path="/github" element={<GitHubPage />} />

        {/* Instructor Dashboard */}
        <Route path="/instructor" element={<InstructorPage />} />

        <Route path="/StudentChatView" element={<StudentChatView />} />


      </Routes>
    </Router>
  );
}

export default App;
