const express = require("express");
const cors = require("cors");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(cors());
app.use(express.json());
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "home.html")));
app.use(express.static(__dirname));


if (!GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is not set. AI endpoints will fail until it is configured.");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

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
Analyze this sales data and give a short, useful summary:
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

// ════════════════════════════════════════
// AI ORDER EXTRACTION ENDPOINT
// ════════════════════════════════════════

app.post("/extract-order", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    const prompt = `
Extract wholesale order from voice text. Return ONLY valid JSON. No markdown.

Text: "${text}"

Product words:
aloo=potato, pyaaz=onion, pyaz=onion, peyaj=onion, adrak=ginger, ada=ginger, lahsun=garlic, roshun=garlic, chawal=rice, chal=rice, atta=atta, maida=maida, dim=egg, egg=egg.

Rules:
- Extract customer, phone, items, paymentMode, deliveryStatus.
- Units only: kg, g, piece.
- PaymentMode only: cash, upi, credit.
- deliveryStatus only: pending, delivered.
- cash/case = cash.
- upi/gpay/google pay/phonepe = upi.
- credit/udhar/baki/due = credit.
- delivered/delivery done/diye diyechi/de diyechi/ho gaya = delivered.
- pending/not delivered/baaki = pending.
- sellingPrice means rate per unit.
- price = qty * sellingPrice.
- If unit is g, price = (qty / 1000) * sellingPrice.
- totalAmount = sum of item prices.
- If unclear, use "" for text and 0 for numbers.
- Return numbers as numbers, not strings.

JSON format:
{
  "customer": "",
  "phone": "",
  "items": [
    {
      "product": "",
      "qty": 0,
      "unit": "kg",
      "sellingPrice": 0,
      "price": 0
    }
  ],
  "paymentMode": "cash",
  "deliveryStatus": "pending",
  "totalAmount": 0
}
`;

    const response = await ai.models.generateContent({
      model: "models/gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.1,
        maxOutputTokens: 500
      }
    });

    let rawText = response.text.trim();

    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("No JSON found in Gemini response: " + rawText);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (Array.isArray(parsed.items)) {
      parsed.items = parsed.items.map(item => {
        const qty = Number(item.qty) || 0;
        const sellingPrice = Number(item.sellingPrice) || 0;
        const unit = item.unit || "kg";

        let price = 0;

        if (unit === "g") {
          price = (qty / 1000) * sellingPrice;
        } else {
          price = qty * sellingPrice;
        }

        return {
          product: item.product || "",
          qty,
          unit,
          sellingPrice,
          price
        };
      });

      parsed.totalAmount = parsed.items.reduce((sum, item) => sum + item.price, 0);
    }

    parsed.customer = parsed.customer || "";
    parsed.phone = parsed.phone || "";
    parsed.paymentMode = parsed.paymentMode || "cash";
    parsed.deliveryStatus = parsed.deliveryStatus || "pending";

    res.json(parsed);

  } catch (error) {
    console.error("Extract order error:", error);
    res.status(500).json({ error: "Failed to extract order", details: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

