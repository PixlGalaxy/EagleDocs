import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Nicolas's backend modules
import * as LoginPage from "./LoginPage.js";
import * as RegisterPage from "./RegisterPage.js";

// Your chat + AI routes
import chatRoutes from "./routes/chatRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";

dotenv.config();
const app = express();

const PORT = process.env.PORT || 5000;

// Core middleware
app.use(cors());
app.use(express.json());

/* ------------------------------------------
   YOUR ORIGINAL ROUTES
------------------------------------------- */
app.use("/api/chats", chatRoutes);
app.use("/api/ai", aiRoutes);

/* ------------------------------------------
   LOGIN ROUTE (Nicolas)
------------------------------------------- */
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await LoginPage.cleanInput(username, password);
    res.json({ message: result });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

/* ------------------------------------------
   REGISTER ROUTE (Nicolas)
------------------------------------------- */
app.post("/api/register", async (req, res) => {
  const { email, password, accountType } = req.body;

  try {
    const result = await RegisterPage.cleanInput(email, password, accountType);
    res.json({ message: result });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

/* ------------------------------------------
   HEALTH CHECK
------------------------------------------- */
app.get("/healthz", (req, res) => res.json({ ok: true }));

/* ------------------------------------------
   START SERVER
------------------------------------------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
