import express from "express";
import cors from "cors";

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello from EagleDocs backend!" });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
