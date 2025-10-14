import React from 'react';
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

function App() {
  const isAuthenticated = localStorage.getItem('token');

  return (
    <Router>
      <Routes> 

        {/* Catch-all for unmatched routes */}
        <Route path="*" element={<NotFound />} />

        {/* Anyone can view homepage */}
        <Route path="/" element={<HomePage />} />

        {/* If authenticated, go to /chat. Otherwise, show login. */}
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/chat" /> : <LoginPage />}
        />

        {/* If authenticated, go to /chat. Otherwise, show register. */}
        <Route
          path="/register"
          element={isAuthenticated ? <Navigate to="/chat" /> : <RegisterPage />}
        />

        {/* Anyone can visit /chat, whether logged in or not. */}
        <Route path="/chat" element={<ChatPage />} />

        {/* Developers Page */}
        <Route path="/developers" element={<Developers />} />

        {/* About Page */}
        <Route path="/about" element={<About />} />

        {/* TermsOfService Page */}
        <Route path="/tos" element={<TermsOfService />} />
        
        {/* PrivacyPolicy Page */}
        <Route path="/privacy" element={<PrivacyPolicy />} />

        {/* Contact Page */}
        <Route path="/contact" element={<Contact />} />

        {/* GitHub Page */}
        <Route path="/github" element={<GitHubPage />} />

      </Routes>
    </Router>
  );
}

export default App;
