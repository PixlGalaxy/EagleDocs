import express from "express";
import cors from "cors";
import * as LoginPage from "./LoginPage.js";
import * as RegisterPage from "./RegisterPage.js";

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

//starts the server and listens on specified port
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});




