import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chatRoutes from "./routes/chatRoutes.js";
import aiRoutes from "./routes/airoutes.js"; 

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// routes
app.use("/api/chats", chatRoutes);
app.use("/api/ai", aiRoutes);

const PORT = process.env.PORT || 5000;
app.get("/healthz", (req, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

