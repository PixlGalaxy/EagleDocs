import React, { useState } from "react";
import { Link } from "react-router-dom";

function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 bg-white bg-opacity-90 shadow-sm backdrop-blur-sm z-50">
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-6">
            {/* Mobile Logo */}
            <Link to="/" className="md:hidden">
              <img
                src="/EagleDocs Logo.png"
                alt="EagleDocs Logo"
                className="w-10 md:hidden"
              />
            </Link>

            {/* Navigation Links */}
            <div
              className={`md:flex items-center space-x-6 ${
                isMenuOpen
                  ? "absolute top-full left-0 right-0 bg-white py-4 px-6 shadow-lg text-center"
                  : "hidden"
              }`}
            >
              <div className="flex flex-col space-y-3 md:flex-row md:space-y-0 md:space-x-6">
                <Link
                  to="/"
                  className="text-gray-600 hover:text-blue-500 transition-colors py-2 md:py-0"
                >
                  Home
                </Link>
                <Link
                  to="/about"
                  className="text-gray-600 hover:text-blue-500 transition-colors py-2 md:py-0"
                >
                  About
                </Link>
                <Link
                  to="/developers"
                  className="text-gray-600 hover:text-blue-500 transition-colors py-2 md:py-0"
                >
                  Developers
                </Link>
                <Link
                  to="/github"
                  className="text-gray-600 hover:text-blue-500 transition-colors py-2 md:py-0"
                >
                  GitHub
                </Link>
                <a
                  href="https://discord.gg/CFS9DSe9RX"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 hover:text-blue-500 transition-colors py-2 md:py-0"
                >
                  Discord
                </a>

                {/* Fallback link for mobile */}
                <a
                  href="https://onlinestatus.eagledocs.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="md:hidden text-gray-600 hover:text-blue-500 transition-colors py-2 md:py-0"
                >
                  Server Status
                </a>
              </div>
            </div>
          </div>

          {/* Right: Server Status Badge */}
          <div className="hidden md:block">
            <a
              href="https://onlinestatus.eagledocs.org"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="EagleDocs Server Status"
              title="EagleDocs Server Status"
            >
              <iframe
                src="https://onlinestatus.eagledocs.org/badge?theme=light"
                width="280"
                height="30"
                frameBorder="0"
                scrolling="no"
                style={{
                  colorScheme: "none",
                  border: "0",
                }}
                title="EagleDocs Server Status"
              />
            </a>
          </div>

          {/* Hamburger Menu (Mobile) */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden text-gray-600 hover:text-blue-500"
          >
            {isMenuOpen ? (
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            ) : (
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
