import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

function GitHubPage() {
  const [frontendLastUpdate, setFrontendLastUpdate] = useState(null);
  const [backendLastUpdate, setBackendLastUpdate] = useState(null);

  // Fetch last update from GitHub API
  useEffect(() => {
    const fetchRepoData = async (repo, setUpdate) => {
      try {
        const response = await fetch(`https://api.github.com/repos/PixlGalaxy/${repo}`);
        const data = await response.json();
        if (data.pushed_at) {
          const lastUpdated = new Date(data.pushed_at).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          });
          setUpdate(lastUpdated);
        }
      } catch (error) {
        console.error(`Error fetching ${repo} data:`, error);
      }
    };

    fetchRepoData("EagleDocsFE", setFrontendLastUpdate);
    fetchRepoData("EagleDocsBE", setBackendLastUpdate);
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-gray-100">
      <Helmet>
        <title>GitHub - EagleDocs</title>
        <meta name="description" content="Contribute to EagleDocs by collaborating on our GitHub repositories." />
      </Helmet>

      {/* Navigation Bar */}
      <Navbar />

      {/* Main Content */}
      <div className="flex-grow flex flex-col items-center">
        <div className="pt-20 max-w-4xl text-center mb-12">
          {/* Title */}
          <h1 className="text-4xl font-extrabold text-gray-900 mb-6">Leave Your Mark on EagleDocs</h1>
          <p className="text-lg text-gray-700 leading-relaxed">
            EagleDocs is an open-source project, and you can be part of it!  
            Contribute with code, report issues, or enhance our features by submitting a <strong>Pull Request</strong>.
          </p>
        </div>

        {/* GitHub Repositories Section */}
        <div className="w-full max-w-3xl bg-white shadow-lg rounded-lg p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">Contribute to the Project</h2>

          <div className="flex flex-col md:flex-row justify-between items-center">
            {/* Frontend Repository */}
            <div className="flex flex-col items-center w-full md:w-1/2 mb-6 md:mb-0">
              <img src="/EagleDocs Logo.png" alt="EagleDocs Frontend" className="w-32 md:w-40 mb-4" />
              <h3 className="text-xl font-semibold text-gray-800">Frontend</h3>
              <p className="text-gray-600 text-sm">User interface and website experience</p>
              <p className="text-gray-500 text-xs mt-1">Last update: {frontendLastUpdate || "Loading..."}</p>
              <a
                href="https://github.com/PixlGalaxy/EagleDocsFE"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 text-blue-600 hover:underline font-semibold"
              >
                View on GitHub
              </a>
            </div>

            {/* Backend Repository */}
            <div className="flex flex-col items-center w-full md:w-1/2">
              <img src="/EagleDocsBE Logo.png" alt="EagleDocs Backend" className="w-32 md:w-40 mb-4" />
              <h3 className="text-xl font-semibold text-gray-800">Backend</h3>
              <p className="text-gray-600 text-sm">Processing system and API</p>
              <p className="text-gray-500 text-xs mt-1">Last update: {backendLastUpdate || "Loading..."}</p>
              <a
                href="https://github.com/PixlGalaxy/EagleDocsBE"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 text-blue-600 hover:underline font-semibold"
              >
                View on GitHub
              </a>
            </div>
          </div>
        </div>

        {/* General GitHub Link */}
        <div className="max-w-3xl bg-white shadow-lg rounded-lg p-6 mt-8 mb-12 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Contribute Today</h2>
          <p className="text-gray-700">
            EagleDocs improves with the help of the community. If you have ideas, improvements, or find bugs,  
            feel free to submit a <strong>Pull Request</strong> on any of our repositories.
          </p>
          <div className="mt-4">
            <a
              href="https://github.com/PixlGalaxy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-semibold text-blue-600 hover:underline"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <Footer />
    </div>
  );
}

export default GitHubPage;
