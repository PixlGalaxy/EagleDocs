import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import * as LoginPage from "./LoginPage.js";
import * as RegisterPage from "./RegisterPage.js";

//load environment variables early so other modules can read them
dotenv.config();

// dynamically import OllamaService after env is loaded so it reads correct defaults
const OllamaService = await import("./ollama.js");

//initialize server instance
const app = express();

//sets port number the server will listen on
const PORT = 5000;

//enables cors for all requests and allows server to parse json data
app.use(cors());
app.use(express.json());

//creates a post route for login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await LoginPage.cleanInput(email, password);
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

//creates a post route for registration
app.post("/api/register", async (req, res) => {
  const { email, password, accountType } = req.body;
  try {
    const result = await RegisterPage.cleanInput(email, password, accountType);
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

//defines route rq how to get data res how to send data
app.get("/api/uptime", (req, res) => {
  res.json({ message: "Hello from EagleDocs backend! - Backend Running" });
});

//Ollama API routes
app.post("/api/ollama/generate", async (req, res) => {
  const { prompt, model } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    const result = await OllamaService.generateResponse(prompt, model);
    const text = result && (result.text || result.response || result);
    const modelUsed = (result && result.model) || model || process.env.OLLAMA_MODEL || "unknown";
    res.json({ response: text, model: modelUsed });
  } catch (error) {
    console.error("Error in /api/ollama/generate:", error);
    res.status(500).json({ error: error.message });
  }
});

//Route to get available models
app.get("/api/ollama/models", async (req, res) => {
  try {
    const models = await OllamaService.getAvailableModels();
    res.json({ models });
  } catch (error) {
    console.error("Error in /api/ollama/models:", error);
    res.status(500).json({ error: error.message });
  }
});

//Route to check Ollama health
app.get("/api/ollama/health", async (req, res) => {
  try {
    const isHealthy = await OllamaService.checkOllamaHealth();
    res.json({ status: isHealthy ? "healthy" : "unhealthy" });
  } catch (error) {
    console.error("Error in /api/ollama/health:", error);
    res.status(500).json({ error: error.message });
  }
});

// (debug endpoint removed)

//starts the server and listens on specified port
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});




