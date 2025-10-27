import fetch from "node-fetch";
console.log("🚀 Test file started");
async function testOllama() {

  console.log("🟡 Sending request to Ollama...");

  try {
    const res = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3",
        prompt: "What is symmetric encryption?",
        stream: false
      })
    });

    console.log("🔵 Response status:", res.status);
    const text = await res.text(); // print raw text in case JSON parse fails
    console.log("🟢 Raw response:\n", text);
  } catch (err) {
    console.error("❌ Error talking to Ollama:", err.message);
  }
}

testOllama();
