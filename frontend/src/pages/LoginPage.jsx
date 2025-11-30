import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();

    fetch('http://localhost:5000/api/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json',},
      body: JSON.stringify({email, password }),
    })
    .then(res => res.json()) 
    .then(data => 
      {
         console.log(data);
        if (data.message === "Login successful") {
            localStorage.setItem('token', data.token);
            fetchAccount().then(account =>{console.log(account);

              if(account.accountType === "student"){
                navigate("/chat", { replace: false });
              }
              else if(account.accountType === "teacher"){
                navigate('/instructor', { replace: false });
              }
              else{
                alert("Unknown account type");
              }
            });
        }
        else{
          alert(data.message);
        }
      })
    .catch((error) => 
      {console.error('Error:', error);
    });
  };

  async function fetchAccount() {
  const token = localStorage.getItem("token");
  const res = await fetch("http://localhost:5000/account", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });
  return await res.json();}


  useEffect(() => {
    document.title = 'EagleDocs';
    const favicon = document.querySelector("link[rel='icon']");
    if (favicon) {
      favicon.href = '/favicon.ico';
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
        <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">EagleDocs Login</h2>
        <div className="mb-4">
          <label className="block text-gray-600 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>
        <div className="mb-4">
          <label className="block text-gray-600 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>
        <button
          type="submit"
          className="w-full bg-blue-500 text-white py-2 rounded-md hover:bg-blue-600"
        >
          Login
        </button>
      </form>
    </div>
  );
}

export default LoginPage;
