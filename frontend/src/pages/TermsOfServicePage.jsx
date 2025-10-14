import React from "react";
import { Helmet } from "react-helmet";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

function TermsOfService() {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center">
      <Helmet>
        <title>Terms of Service - EagleDocs</title>
        <meta name="description" content="Review the Terms of Service for EagleDocs before using the platform." />
      </Helmet>

      {/* Navigation Bar */}
      <Navbar />

      <div className="pt-20 max-w-4xl text-center mb-12">
        {/* Title */}
        <h1 className="text-4xl font-extrabold text-gray-900 mb-6">Terms of Service</h1>

        {/* Last Updated Notice */}
        <p className="text-gray-600 text-sm mb-6">Last updated: February 2025</p>

        {/* Disclaimer Section */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Acceptance of Terms</h2>
          <p className="text-gray-700 leading-relaxed">
            By accessing or using EagleDocs, you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, you may not use the platform.
          </p>
        </div>

        {/* AI Disclaimer */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">2. AI Limitations & Accuracy</h2>
          <p className="text-gray-700 leading-relaxed">
            EagleDocs utilizes artificial intelligence to generate responses and educational content. While we strive to provide accurate and helpful information, the AI may generate incorrect, misleading, or outdated answers. Users should independently verify any critical information before relying on it.
          </p>
          <p className="text-gray-700 leading-relaxed mt-2">
            EagleDocs and its developers are not responsible for any consequences resulting from the use of AI-generated content. This includes, but is not limited to, misinformation, misinterpretations, or actions taken based on AI-provided guidance.
          </p>
        </div>

        {/* Liability Section */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">3. Limitation of Liability</h2>
          <p className="text-gray-700 leading-relaxed">
            EagleDocs, its creators, and affiliates are not liable for any direct, indirect, incidental, or consequential damages arising from the use or inability to use the platform. Users assume full responsibility for their use of EagleDocs and any decisions made based on its content.
          </p>
          <p className="text-gray-700 leading-relaxed mt-2">
            The platform is provided "as is" without any warranties, express or implied, including but not limited to warranties of merchantability or fitness for a particular purpose.
          </p>
        </div>

        {/* User Responsibilities */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">4. User Responsibilities</h2>
          <p className="text-gray-700 leading-relaxed">
            Users agree not to misuse EagleDocs for illegal, unethical, or harmful activities. This includes attempting to exploit, manipulate, or bypass the AI for unintended purposes.
          </p>
          <p className="text-gray-700 leading-relaxed mt-2">
            EagleDocs reserves the right to suspend or terminate access to users who violate these terms.
          </p>
        </div>

        {/* Privacy Policy Link */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Privacy Policy</h2>
          <p className="text-gray-700 leading-relaxed">
            EagleDocs collects and processes user data in accordance with its <a href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</a>. By using the platform, you consent to this data processing.
          </p>
        </div>

        {/* Changes to Terms */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Changes to These Terms</h2>
          <p className="text-gray-700 leading-relaxed">
            EagleDocs reserves the right to update these Terms of Service at any time. Continued use of the platform after changes are made constitutes acceptance of the revised terms.
          </p>
        </div>

        {/* Contact Section */}
        <div className="bg-white shadow-lg rounded-lg p-6 text-left mt-6 mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Contact Information</h2>
          <p className="text-gray-700 leading-relaxed">
            If you have any questions regarding these Terms of Service, please contact us at:  
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

export default TermsOfService;
