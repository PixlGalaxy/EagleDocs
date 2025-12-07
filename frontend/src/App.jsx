import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ChatPage from './pages/ChatPage';
import InstructorPage from './pages/InstructorPage';
import NotFound from './pages/NotFound';
import Developers from './pages/Developers';
import About from './pages/About';
import TermsOfService from './pages/TermsOfServicePage';
import PrivacyPolicy from './pages/PrivacyPolicy';
import Contact from './pages/ContactPage';
import GitHubPage from './pages/GitHubPage';
import { AuthProvider, useAuth } from './context/AuthContext';

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-700">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

const GuestRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-700">
        Loading...
      </div>
    );
  }

  if (user) {
    return <Navigate to={user.role === 'instructor' ? '/instructor' : '/chat'} replace />;
  }

  return children;
};

const InstructorRoute = ({ children }) => {
  const { user } = useAuth();

  if (user?.role !== 'instructor') {
    return <Navigate to="/chat" replace />;
  }

  return children;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/login"
            element={(
              <GuestRoute>
                <LoginPage />
              </GuestRoute>
            )}
          />
          <Route
            path="/register"
            element={(
              <GuestRoute>
                <RegisterPage />
              </GuestRoute>
            )}
          />
          <Route
            path="/chat"
            element={(
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/instructor"
            element={(
              <ProtectedRoute>
                <InstructorRoute>
                  <InstructorPage />
                </InstructorRoute>
              </ProtectedRoute>
            )}
          />
          <Route path="/developers" element={<Developers />} />
          <Route path="/about" element={<About />} />
          <Route path="/tos" element={<TermsOfService />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/github" element={<GitHubPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
