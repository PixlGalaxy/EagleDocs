import express from "express";
const router = express.Router();

const chats = [
  { id: 1, title: "Math Midterm Review" },
  { id: 2, title: "Software Fundamentals" },
];

router.get("/", (req, res) => {
  res.json(chats);
});

export default router;