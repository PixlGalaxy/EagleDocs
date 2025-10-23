import express from "express";
import cors from "cors";

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.get("/api/uptime", (req, res) => {
  res.json({ message: "Hello from EagleDocs backend! - Backend Running" });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
