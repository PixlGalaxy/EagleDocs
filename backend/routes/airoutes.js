import express from "express";
import fetch from "node-fetch";

const router = express.Router();

router.post("/", async (req, res) => {
  const { message } = req.body;
  console.log("📩 Received from frontend:", message);

  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3",
        prompt: message,
        stream: false
      }),
    });

    const data = await response.json();
    console.log("🤖 Ollama replied:", data);

    res.json({ reply: data.response });
  } catch (error) {
    console.error("❌ Error connecting to Ollama:", error);
    res.status(500).json({ error: "Failed to connect to Ollama" });
  }
});

export default router;
