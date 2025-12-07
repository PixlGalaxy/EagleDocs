import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { register } = useAuth();

  const detectedRole = email.trim().toLowerCase().endsWith('@fgcu.edu')
    ? 'Instructor'
    : 'Student';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);

    try {
      const created = await register(email, password);
      navigate(created.role === 'instructor' ? '/instructor' : '/chat');
    } catch (err) {
      setError(err.message || 'Unable to register');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    document.title = 'EagleDocs';
    const favicon = document.querySelector("link[rel='icon']");
    if (favicon) {
      favicon.href = '/favicon.ico';
    }
  }, []);

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-md bg-white rounded-lg shadow-md p-6 space-y-4">
        <Link to="/">
          <img src="/EagleDocs Logo.png" alt="EagleDocs Logo" className="w-32 mx-auto mb-4 cursor-pointer" />
        </Link>
        <h2 className="text-2xl font-bold text-gray-800 text-center">Register</h2>
        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}
        <div>
          <label className="block text-gray-600 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <p className="text-xs text-gray-500 mt-1">Detected role: {detectedRole}</p>
        </div>
        <div>
          <label className="block text-gray-600 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>
        <div>
          <label className="block text-gray-600 mb-1">Repeat Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        {/* Account Type Buttons */}
        <div className="flex justify-center space-x-4 mb-4">
          <button
            type="button"
            className={`flex-1 py-2 rounded-md font-semibold border-2 transition-all duration-200 ${
              accountType === 'Student'
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100'
            }`}
            onClick={() => setAccountType('Student')}
          >
            Student
          </button>

          <button
            type="button"
            className={`flex-1 py-2 rounded-md font-semibold border-2 transition-all duration-200 ${
              accountType === 'Teacher'
                ? 'bg-green-500 text-white border-green-500'
                : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100'
            }`}
            onClick={() => setAccountType('Teacher')}
          >
            Teacher
          </button>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={submitting}
          className={`w-full py-2 rounded-md text-white ${
            submitting ? 'bg-gray-300 cursor-not-allowed' : 'bg-gray-500 hover:bg-gray-600'
          }`}
        >
          {submitting ? 'Creating account...' : 'Register'}
        </button>
      </form>
    </div>
  );
}

export default RegisterPage;
