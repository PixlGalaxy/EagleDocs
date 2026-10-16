import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppConfigProvider } from './context/AppConfigContext';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { I18nProvider } from './i18n/I18nContext';
import { ConfirmProvider } from './components/ui/confirm';
import BootSplash from './components/ui/BootSplash';
import { BrandLoaderBlock } from './components/ui/BrandLoader';
import { AdminRoute, GuestRoute, ProtectedRoute } from './components/layout/routes';
import ScrollToTop from './components/layout/ScrollToTop';
import NotFound from './pages/landing/NotFound';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import { CheckEmailPage, ForgotPasswordPage, ResetPasswordPage, VerifyPage } from './pages/auth/VerifyPages';

// Each page loads when it is opened: the landing's animations and the chat's markdown stay out of the first download.
const HomePage = lazy(() => import('./pages/landing/HomePage'));
const DevelopersPage = lazy(() => import('./pages/landing/DevelopersPage'));
const GitHubPage = lazy(() => import('./pages/landing/GitHubPage'));
const ContactPage = lazy(() => import('./pages/landing/ContactPage'));
const PrivacyPolicy = lazy(() => import('./pages/landing/LegalPages').then((m) => ({ default: m.PrivacyPolicy })));
const TermsOfService = lazy(() => import('./pages/landing/LegalPages').then((m) => ({ default: m.TermsOfService })));
const ConsentPage = lazy(() => import('./pages/auth/ConsentPage'));
const ChatPage = lazy(() => import('./pages/chat/ChatPage'));
const AboutPage = lazy(() => import('./pages/landing/AboutPage'));
const CourseDetailPage = lazy(() => import('./pages/courses/CourseDetailPage'));
const FilesPage = lazy(() => import('./pages/files/FilesPage'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));
const AdminPage = lazy(() => import('./pages/admin/AdminPage'));
const CoursesPage = lazy(() => import('./pages/courses/CoursesPage'));

const App = () => (
  <BrowserRouter>
    <ScrollToTop />
    <AppConfigProvider>
      {/* Auth wraps I18n/Theme: language and appearance are account data. */}
      <AuthProvider>
        <I18nProvider>
          <ThemeProvider>
            <ConfirmProvider>
            <BootSplash />
            <Suspense fallback={<BrandLoaderBlock className="min-h-[100dvh]" />}>
            <Routes>
              {/* Landing (public navbar with About, Developers, GitHub...) */}
              <Route path="/" element={<HomePage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/developers" element={<DevelopersPage />} />
              <Route path="/github" element={<GitHubPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/tos" element={<TermsOfService />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />

              {/* Auth */}
              <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
              <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
              <Route path="/check-email" element={<GuestRoute><CheckEmailPage /></GuestRoute>} />
              <Route path="/verify" element={<VerifyPage />} />
              <Route path="/forgot-password" element={<GuestRoute><ForgotPasswordPage /></GuestRoute>} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              {/* OAuth consent for MCP clients (ChatGPT, Claude...) */}
              <Route path="/oauth/consent" element={<ConsentPage />} />

              {/* App (Webin Cloud style navbar) */}
              <Route element={<ProtectedRoute />}>
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/chat/:chatId" element={<ChatPage />} />
                <Route path="/courses" element={<CoursesPage />} />
                <Route path="/courses/:courseId" element={<CourseDetailPage />} />
                <Route path="/files" element={<FilesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route element={<AdminRoute />}>
                  <Route path="/admin" element={<AdminPage />} />
                </Route>
              </Route>

              <Route path="/home" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            </ConfirmProvider>
          </ThemeProvider>
        </I18nProvider>
      </AuthProvider>
    </AppConfigProvider>
  </BrowserRouter>
);

export default App;
