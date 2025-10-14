import React, { useState } from "react";
import { Helmet } from "react-helmet";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

function Contact() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
  });

  const [status, setStatus] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setStatus({ type: "", message: "" });

    try {
      const response = await fetch("https://contact.eagledocs.org/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setStatus({ type: "success", message: "Message sent successfully!" });
        setFormData({ name: "", email: "", message: "" });
      } else {
        setStatus({ type: "error", message: "Failed to send message. Try again later." });
      }
    } catch (error) {
      setStatus({ type: "error", message: "An error occurred. Please try again." });
    }

    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center">
      <Helmet>
        <title>Contact - EagleDocs</title>
        <meta name="description" content="Contact the EagleDocs team for inquiries, support, or feedback." />
      </Helmet>

      {/* Navigation Bar */}
      <Navbar />

      <div className="pt-20 max-w-3xl text-center mb-12">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <img src="/EagleDocs Logo.png" alt="EagleDocs Logo" className="w-48 md:w-64" />
        </div>

        {/* Contact Title */}
        <h1 className="text-4xl font-extrabold text-gray-900 mb-4">Contact Us</h1>
        <p className="text-lg text-gray-700 leading-relaxed">
          Have questions or feedback? Reach out to us using the form below or via our social channels.
        </p>
      </div>

      {/* Contact Form */}
      <div className="w-full max-w-3xl bg-white shadow-lg rounded-lg p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 text-center">Send Us a Message</h2>
        {status.message && (
          <div
            className={`text-center text-lg font-semibold p-3 rounded-lg mb-4 ${
              status.type === "success" ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
            }`}
          >
            {status.message}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-700 font-semibold">Name</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              className="w-full mt-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-gray-700 font-semibold">Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              className="w-full mt-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-gray-700 font-semibold">Message</label>
            <textarea
              name="message"
              value={formData.message}
              onChange={handleChange}
              required
              rows="4"
              className="w-full mt-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            ></textarea>
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full py-2 rounded-lg shadow transition-colors ${
              isSubmitting
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-500 text-white hover:bg-blue-600"
            }`}
          >
            {isSubmitting ? "Sending..." : "Send Message"}
          </button>
        </form>
      </div>

      {/* Additional Contact Info */}
      <div className="max-w-3xl bg-white shadow-lg rounded-lg p-6 mt-8 mb-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 text-center">Other Ways to Reach Us</h2>
        <p className="text-lg text-gray-700 text-center mb-4">
          📧 Email: <a href="mailto:support@eagledocs.org" className="text-blue-600 hover:underline">support@eagledocs.org</a>
        </p>
        <div className="flex justify-center space-x-6">
          <a href="https://github.com/PixlGalaxy/EagleDocsFE" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-blue-500 transition-colors">
            GitHub
          </a>
          <a href="https://discord.gg/4RuUjT2jNv" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-blue-500 transition-colors">
            Discord
          </a>
          <a href="https://onlinestatus.eagledocs.org" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-blue-500 transition-colors">
            Server Status
          </a>
        </div>
      </div>

      {/* Footer */}
      <Footer />
    </div>
  );
}

export default Contact;
