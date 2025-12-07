import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

function HomePage() {
  const [text, setText] = useState('');
  const [charIndex, setCharIndex] = useState(0);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [clickCount, setClickCount] = useState(0);
  const [isLogoAnimated, setIsLogoAnimated] = useState(false);

  const phrases = [
    'Your Knowledge, Our Mission.',
    'Elevating Education For Every Eagle.',
    'Smart Learning Made Simple.',
    'Empowering Eagles, One Question At A Time.',
    'AI-Powered Learning, Specialized For You.',
    'Turning Challenges Into Achievements.',
    'Discover. Learn. Excel.',
    'Your Academic Companion At FGCU.'
  ];

  useEffect(() => {
    document.title = 'EagleDocs';
    const favicon = document.querySelector("link[rel='icon']");
    if (favicon) {
      favicon.href = '/favicon.ico';
    }
  }, []);

  useEffect(() => {
    if (charIndex < phrases[phraseIndex].length) {
      const timeout = setTimeout(() => {
        setText((prevText) => prevText + phrases[phraseIndex][charIndex]);
        setCharIndex((prevCharIndex) => prevCharIndex + 1);
      }, 50);
      return () => clearTimeout(timeout);
    } else {
      const timeout = setTimeout(() => {
        setText('');
        setCharIndex(0);
        setPhraseIndex((prevPhraseIndex) => (prevPhraseIndex + 1) % phrases.length);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [charIndex, phraseIndex, phrases]);

  const handleLogoClick = () => {
    setClickCount(clickCount + 1);
    if (clickCount + 1 === 10) {
      setIsLogoAnimated(true);
      setTimeout(() => {
        setIsLogoAnimated(false);
        setClickCount(0);
      }, 3000);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-gray-100 to-blue-50">
      <Helmet>
        <title>Home - EagleDocs</title>
      </Helmet>

      {/* Navbar */}
      <Navbar />

      {/* Main Content */}
      <div className="flex-grow flex items-center justify-center">
        <div className="max-w-xl sm:max-w-3xl md:max-w-5xl w-full bg-white shadow-lg rounded-lg overflow-hidden mx-4">
          <div className="flex flex-col md:flex-row">
            {/* Left Column */}
            <div className="w-full md:w-1/2 p-4 sm:p-6 md:p-8 flex flex-col justify-center">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-gray-800 mb-4 text-center md:text-left">
                Introducing EagleDocs
              </h1>
              <p className="text-gray-600 text-base sm:text-lg mb-6 leading-relaxed text-center md:text-left">
                {text}
                <span className="blinking-cursor">.</span>
              </p>
            </div>

            {/* Right Column */}
            <div className="w-full md:w-1/2 p-4 sm:p-6 md:p-8 flex flex-col items-center justify-center">
              <img
                src="/EagleDocs Logo.png"
                alt="EagleDocs Logo"
                className={`w-24 md:w-32 mb-6 transition-all duration-300 ${
                  isLogoAnimated ? 'falling-logo' : ''
                }`}
                onClick={handleLogoClick}
              />
              <div className="flex space-x-4 mb-4">
                <Link
                  to="/login"
                  className="px-4 sm:px-6 py-2 sm:py-3 bg-blue-500 text-white rounded-lg shadow hover:bg-blue-600 transition-colors text-sm sm:text-base"
                >
                  Sign In
                </Link>
                <Link
                  to="/register"
                  className="px-4 sm:px-6 py-2 sm:py-3 bg-gray-500 text-white rounded-lg shadow hover:bg-gray-600 transition-colors text-sm sm:text-base"
                >
                  Register
                </Link>
              </div>
              <Link
                to="/chat"
                className="inline-flex items-center space-x-1 text-sm text-blue-500 hover:text-blue-600"
              >
                <span>Try EagleDocs BETA </span>
                <svg width="0.625rem" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 9L9 1M9 1H2.5M9 1V7.22222" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
      {/* Footer */}
      <Footer />
    </div>
  );
}

export default HomePage;
