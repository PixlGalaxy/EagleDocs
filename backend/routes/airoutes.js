import express from "express";
import { spawn } from "child_process";

const router = express.Router();

router.post("/", async (req, res) => {
  const { prompt } = req.body;
  console.log("🟢 Received prompt:", prompt);

  try {
    const ollama = spawn("ollama", ["run", "gemma:2b"]);


    let output = "";

    ollama.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
    });

    ollama.stderr.on("data", (data) => {
      console.error("⚠️ Ollama error:", data.toString());
    });

    ollama.on("close", (code) => {
      console.log(`✅ Ollama exited with code ${code}`);

      res.json({
        response: output.trim() || "No response received from Ollama.",
      });
    });

    ollama.stdin.write(prompt + "\n");
    ollama.stdin.end();
  } catch (err) {
    console.error("❌ Error running Ollama:", err);
    res.status(500).json({ error: "Failed to run Ollama" });
  }
});

export default router;
