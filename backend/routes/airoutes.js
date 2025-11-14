import express from "express";
import { spawn } from "child_process";

const router = express.Router();

router.post("/", async (req, res) => {
  const { prompt } = req.body;
  console.log("🟢 Received prompt:", prompt);

  try {
    // Launch Ollama process
    const ollama = spawn("ollama", ["run", "llama3"]);

    let output = "";

    // Capture Ollama output
    ollama.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text); // Print streaming output to backend console
    });

    // Capture errors from Ollama
    ollama.stderr.on("data", (data) => {
      console.error("⚠️ Ollama error:", data.toString());
    });

    // When Ollama finishes, send the collected output back to the client
    ollama.on("close", (code) => {
      console.log(`✅ Ollama exited with code ${code}`);
      res.json({ reply: output.trim() || "No response received from Ollama." });
    });

    // Send the user’s input to the model
    ollama.stdin.write(prompt + "\n");
    ollama.stdin.end();

    // Safety timeout: kill Ollama if it hangs too long (10 seconds)
    setTimeout(() => {
      if (!ollama.killed) {
        ollama.kill();
        console.log("⏱️ Force-closed Ollama (timeout)");
      }
    }, 10000);
  } catch (err) {
    console.error("❌ Error running Ollama:", err);
    res.status(500).json({ error: "Failed to run Ollama" });
  }
});

export default router;
