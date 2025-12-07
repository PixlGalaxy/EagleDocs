// About.jsx
import React, { useState } from "react";
import { Helmet } from "react-helmet";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

function About() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Graph Data
const data = [
  { name: "MMLU", AzulAI: 69, Llama4: 85, DeepSeekR1: 98 },
  { name: "GSM8K", AzulAI: 78, Llama4: 85, DeepSeekR1: 91 },
  { name: "HumanEval", AzulAI: 73, Llama4: 78, DeepSeekR1: 88 },
  { name: "C-Eval", AzulAI: 46, Llama4: 77, DeepSeekR1: 81 },
];


  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center">
      <Helmet>
        <title>About - EagleDocs</title>
        <meta name="description" content="Learn more about EagleDocs and its AI-powered educational system." />
      </Helmet>

      {/* Navigation Bar */}
      <Navbar />

      <div className="pt-20 max-w-3xl text-center mb-12">

        {/* Logo */}
        <div className="flex justify-center mb-8">
            <img src="/EagleDocs Logo.png" alt="EagleDocs Logo" className="w-48 md:w-64" />
        </div>
        
        {/* About Text */}
        <h1 className="text-4xl font-extrabold text-gray-900 mb-4">About EagleDocs</h1>
        <p className="text-lg text-gray-700 leading-relaxed mt-4">
          EagleDocs is powered by <span className="font-bold text-blue-600">AzulAI</span>, 
          our proprietary tuning built on top of <span className="font-semibold">GPT-OSS 20B</span>. 
          Azul is optimized for student support, mathematical reasoning, and education-focused tasks.
        </p>
        <p className="text-lg text-gray-700 leading-relaxed mt-4">
          The platform integrates modern, open-source AI models enhanced specifically for education. 
          Our current model, <span className="font-bold text-blue-600">AzulAI</span>, is built on 
          <span className="font-semibold"> GPT-OSS 20B</span> and optimized for student learning, 
          mathematical reasoning, and accurate explanations across academic subjects.
        </p>
      </div>

      {/* Comparison Graph */}
      <div className="w-full max-w-4xl bg-white shadow-lg rounded-lg p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 text-center">AI Model Benchmark Comparison</h2>
        <p className="text-xs text-gray-500 text-center mt-2">
          Source: arXiv 2508.12461 — Benchmarks: MMLU, GSM8K, HumanEval, C-Eval
        </p>

        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 10 }}>
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis label={{ value: "Accuracy (%)", angle: -90, position: "insideLeft", fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="AzulAI" fill="#0070FF" name="AzulAI (GPT-OSS 20B)" />
            <Bar dataKey="Llama4" fill="#FF7F0E" name="Llama 4 Scout 109B" />
            <Bar dataKey="DeepSeekR1" fill="#2ca02c" name="DeepSeek-R1 70B" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Server Details */}
        <div className="max-w-3xl bg-white shadow-lg rounded-lg p-6 mt-8 mb-12">
        <h2 className="text-3xl font-extrabold text-gray-900 mb-6 text-center">
            Server Specifications
        </h2>
        
        <p className="text-lg text-gray-700 leading-relaxed text-center mb-6">
            EagleDocs is powered by <span className="font-bold text-indigo-600">Zaylar</span>, a high-performance server designed for AI workloads and efficiency.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* CPU */}
            <div className="flex items-center space-x-4 bg-gray-100 p-4 rounded-lg shadow">
            <i className="icon-cpu text-4xl text-black-700"></i>
            <div>
                <h3 className="text-xl font-semibold text-gray-900">CPU</h3>
                <p className="text-gray-700">Dual Intel Xeon E5-2696 V3</p>
            </div>
            </div>

            {/* RAM */}
            <div className="flex items-center space-x-4 bg-gray-100 p-4 rounded-lg shadow">
            <i className="icon-memory text-4xl text-black-700"></i>
            <div>
                <h3 className="text-xl font-semibold text-gray-900">Memory</h3>
                <p className="text-gray-700">512GB DDR4 ECC</p>
            </div>
            </div>

            {/* GPU - RX 7900 XTX */}
            <div className="flex items-center space-x-4 bg-gray-100 p-4 rounded-lg shadow md:col-span-2">
            <i className="icon-cpu-pinning text-4xl text-black-700"></i>
            <div>
                <h3 className="text-xl font-semibold text-gray-900">GPU</h3>
                <p className="text-gray-700">AMD Radeon RX 7900 XTX (24GB VRAM)</p>
            </div>
            </div>

            {/* HDD - Exos 14TB */}
            <div className="flex items-center space-x-4 bg-gray-100 p-4 rounded-lg shadow">
            <i className="icon-disk text-4xl text-black-700"></i>
            <div>
                <h3 className="text-xl font-semibold text-gray-900">Storage (HDD)</h3>
                <p className="text-gray-700">2× Seagate Exos 14TB (RAID-1)</p>
            </div>
            </div>

            {/* NVMe - Kingston 2TB */}
            <div className="flex items-center space-x-4 bg-gray-100 p-4 rounded-lg shadow">
            <i className="icon-nvme text-4xl text-black-700"></i>
            <div>
                <h3 className="text-xl font-semibold text-gray-900">Storage (NVMe)</h3>
                <p className="text-gray-700">2× Kingston 2TB (RAID-1)</p>
            </div>
            </div>

        </div>
      </div>
      {/* Footer */}
      <Footer />
    </div>
  );
}

export default About;
