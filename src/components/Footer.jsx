import React from "react";
import { Link } from "react-router-dom";

function Footer() {
  return (
    <footer className="w-full bg-white shadow-md py-4 px-6 flex flex-col md:flex-row justify-between items-center text-gray-600">
      {/* Main Links */}
      <div className="flex space-x-6">
        <Link to="/tos" className="hover:text-blue-500 text-gray-600">Terms of Service</Link>
        <Link to="/privacy" className="hover:text-blue-500 text-gray-600">Privacy Policy</Link>
        <Link to="/contact" className="hover:text-blue-500 text-gray-600">Contact</Link>
      </div>

      {/* Credtis */}
      <p className="text-sm text-gray-500 mt-4 md:mt-0">{new Date().getFullYear()} EagleDocs</p>
    </footer>
  );
}

export default Footer;
