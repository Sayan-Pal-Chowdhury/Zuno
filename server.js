const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
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

app.post("/chat-helper", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    }

    const { text, products = [], aliases = {}, customers = [] } = req.body || {};
    if (!text) return res.status(400).json({ error: "No text provided" });

    const safeProducts = products.slice(0, 80).map(product => ({
      name: String(product.name || "").slice(0, 60),
      unit: product.unit || "piece",
      sellingPrice: Number(product.sellingPrice || 0),
      sellingUnit: product.sellingUnit || product.unit || "piece"
    })).filter(product => product.name);

    const safeCustomers = customers.slice(0, 40).map(customer => ({
      name: String(customer.name || "").slice(0, 60),
      phone: String(customer.phone || "").slice(0, 15)
    })).filter(customer => customer.name);

    const prompt = `
Return ONLY minified valid JSON. No markdown. No explanation.
Parse this small shop chat message into a sale draft.

User text:
"${String(text).slice(0, 500)}"

Known products:
${JSON.stringify(safeProducts)}

Known aliases:
${JSON.stringify(aliases)}

Known customers:
${JSON.stringify(safeCustomers)}

Understand spelling mistakes and Bengali/Hindi shop words:
cast/cas/cahs/csh = cash
credut/credt/baki/udhar/due = credit
delivred/deliverd/done/diyechi/diya = delivered
pendng/later/not delivered = pending
rosun/roshun/lahsun = garlic
alu/aloo = potato
pyaj/piyaj/peyaj = onion
ada/adrak = ginger

Rules: intent is add_sale/add_inventory/query/unknown. Prefer add_sale when quantities and products are present. Match products to known products. Units only kg,g,piece. paymentMode only cash,upi,credit,"". deliveryStatus only delivered,pending,"". If a product number is ambiguous, put it in price and set needsClarification true. For partial credit, amountPaid is paid amount.

JSON keys exactly:
{"intent":"add_sale","customer":"","phone":"","paymentMode":"","deliveryStatus":"","amountPaid":0,"items":[{"product":"","qty":0,"unit":"kg","sellingPrice":0,"sellingUnit":"kg","price":0,"needsClarification":false,"clarification":""}],"confidence":0}
`;

    const response = await ai.models.generateContent({
      model: "models/gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.05,
        maxOutputTokens: 1500,
        responseMimeType: "application/json"
      }
    });

    const rawText = response.text.trim().replace(/```json/g, "").replace(/```/g, "").trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in Gemini response: " + rawText);

    const parsed = JSON.parse(jsonMatch[0]);
    parsed.items = Array.isArray(parsed.items) ? parsed.items.slice(0, 12) : [];
    res.json(parsed);
  } catch (error) {
    console.error("Chat helper error:", error);
    res.status(500).json({ error: "Failed to parse chat", details: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
