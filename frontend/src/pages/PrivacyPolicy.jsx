import React from "react";
import { Helmet } from "react-helmet";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center">
      <Helmet>
        <title>Privacy Policy - EagleDocs</title>
        <meta name="description" content="Review the Privacy Policy of EagleDocs and learn how we handle user data." />
      </Helmet>

      {/* Navigation Bar */}
      <Navbar />

      <div className="pt-20 max-w-4xl text-center mb-12">
        {/* Title */}
        <h1 className="text-4xl font-extrabold text-gray-900 mb-6">Privacy Policy</h1>

        {/* Last Updated Notice */}
        <p className="text-gray-600 text-sm mb-6">Last updated: February 2025</p>

        {/* Introduction */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Introduction</h2>
          <p className="text-gray-700 leading-relaxed">
            EagleDocs values your privacy. This Privacy Policy explains what information we collect, how we use it, and the steps we take to protect it.
          </p>
        </div>

        {/* Data Collection */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">2. What Data We Collect</h2>
          <p className="text-gray-700 leading-relaxed">
            When you use EagleDocs, we may collect the following types of information:
          </p>
          <ul className="list-disc list-inside text-gray-700 mt-2">
            <li><strong>Personal Information:</strong> Name, email address.</li>
            <li><strong>Usage Data:</strong> Pages visited, interactions with AI, and system logs.</li>
            <li><strong>Cookies:</strong> Small data files stored on your device for better user experience.</li>
          </ul>
        </div>

        {/* How Data is Used */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">3. How We Use Your Data</h2>
          <p className="text-gray-700 leading-relaxed">
            EagleDocs uses collected data to:
          </p>
          <ul className="list-disc list-inside text-gray-700 mt-2">
            <li>Improve AI-generated responses.</li>
            <li>Analyze website usage for enhancements.</li>
            <li>Provide customer support and respond to inquiries.</li>
            <li>Ensure security and prevent misuse.</li>
          </ul>
        </div>

        {/* Data Protection */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Data Protection</h2>
          <p className="text-gray-700 leading-relaxed">
            We implement security measures to protect your data, including encryption and secure servers. However, no method of data transmission is 100% secure.
          </p>
        </div>

        {/* Third-Party Services */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Third-Party Services</h2>
          <p className="text-gray-700 leading-relaxed">
            EagleDocs may use third-party services (e.g., analytics, hosting). These services have their own privacy policies, which we encourage you to review.
          </p>
        </div>

        {/* User Rights */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Your Rights</h2>
          <p className="text-gray-700 leading-relaxed">
            You have the right to:
          </p>
          <ul className="list-disc list-inside text-gray-700 mt-2">
            <li>Request access to your personal data.</li>
            <li>Request deletion or correction of your data.</li>
            <li>Opt-out of non-essential data collection.</li>
          </ul>
          <p className="text-gray-700 leading-relaxed mt-2">
            To exercise these rights, contact us at <a href="mailto:support@eagledocs.org" className="text-blue-600 hover:underline">support@eagledocs.org</a>.
          </p>
        </div>

        {/* Cookie Policy */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Cookie Policy</h2>
          <p className="text-gray-700 leading-relaxed">
            We use cookies to enhance your experience. You can disable cookies in your browser settings, but some features may not function properly.
          </p>
        </div>

        {/* Changes to Privacy Policy */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Changes to This Policy</h2>
          <p className="text-gray-700 leading-relaxed">
            We may update this Privacy Policy periodically. Continued use of EagleDocs after updates constitutes acceptance of the revised policy.
          </p>
        </div>

        {/* Contact Section */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6 mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Contact Information</h2>
          <p className="text-gray-700 leading-relaxed">
            If you have any questions about this Privacy Policy, contact us at:  
          </p>
          <p className="text-lg text-gray-700 text-center mt-4">
            📧 <a href="mailto:support@eagledocs.org" className="text-blue-600 hover:underline">support@eagledocs.org</a>
          </p>
        </div>
      </div>

      {/* Footer */}
      <Footer />
    </div>
  );
}

export default PrivacyPolicy;
