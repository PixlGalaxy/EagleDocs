import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';

function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate email domain
    const emailRegex = /^[a-zA-Z0-9._%+-]+@eagle\.fgcu\.edu$/;
    if (!emailRegex.test(email)) {
      setEmailError(true);
      return;
    }

    // Validate passwords match
    if (password !== confirmPassword) {
      setPasswordError(true);
      return;
    }

    // Simulated registration logic
    localStorage.setItem('token', 'mockToken'); // Save a mock token
    navigate('/chat'); // Redirect to chat page
  };

  useEffect(() => {
    document.title = 'EagleDocs'; // Page Title
    const favicon = document.querySelector("link[rel='icon']");
    if (favicon) {
      favicon.href = '/favicon.ico'; // Page Icon
    }
  }, []);

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-white rounded-lg shadow-md p-6"
      >
        {/* Logo inside the form */}
        <Link to="/">
          <img
            src="/EagleDocs Logo.png"
            alt="EagleDocs Logo"
            className="w-32 mx-auto mb-6 cursor-pointer"
          />
        </Link>
        <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Register</h2>
        <div className="mb-4">
          <label className="block text-gray-600 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(false); // Reset email error when typing
            }}
            className={`w-full px-4 py-2 border rounded-md focus:outline-none ${
              emailError ? 'border-red-500' : 'focus:ring-2 focus:ring-blue-500'
            }`}
            required
          />
          {emailError && (
            <p className="text-red-500 text-sm mt-2">
              Please use a valid FGCU email (e.g., Pixl@eagle.fgcu.edu).
            </p>
          )}
        </div>
        <div className="mb-4">
          <label className="block text-gray-600 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(false); // Reset password error when typing
            }}
            className={`w-full px-4 py-2 border rounded-md focus:outline-none ${
              passwordError ? 'border-red-500' : 'focus:ring-2 focus:ring-blue-500'
            }`}
            required
          />
        </div>
        <div className="mb-4">
          <label className="block text-gray-600 mb-1">Repeat Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setPasswordError(false); // Reset password error when typing
            }}
            className={`w-full px-4 py-2 border rounded-md focus:outline-none ${
              passwordError ? 'border-red-500' : 'focus:ring-2 focus:ring-blue-500'
            }`}
            required
          />
          {passwordError && (
            <p className="text-red-500 text-sm mt-2">Passwords do not match.</p>
          )}
        </div>
        <button
          type="submit"
          className="w-full bg-gray-500 text-white py-2 rounded-md hover:bg-gray-600"
        >
          Register
        </button>
      </form>
    </div>
  );
}

export default RegisterPage;
