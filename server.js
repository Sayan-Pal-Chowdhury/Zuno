const express = require("express");
const cors = require("cors");
const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(cors());
app.use(express.json());

// 🔑 put NEW API key here
const ai = new GoogleGenAI({ apiKey: "AIzaSyBg7R84r0xNvEblFohcOHiB137xkhmr4Gk" });

app.get("/models", async (req, res) => {
  try {
    const models = await ai.models.list();
    console.log(models);
    res.json(models);
  } catch (err) {
    console.error(err);
    res.send("error");
  }
});

app.post("/summary", async (req, res) => {
  try {
    const sales = req.body.sales;

    const prompt = `
    You are a business analyst.
    Analyze this sales data and give a short summary:
    ${JSON.stringify(sales)}
    `;

    const response = await ai.models.generateContent({
      model: "models/gemini-2.5-flash",
      contents: prompt,
    });

    res.json({ summary: response.text });

  } catch (error) {
    console.error(error);
    res.status(500).json({ summary: "Error generating summary" });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));