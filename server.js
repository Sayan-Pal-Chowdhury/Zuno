const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { PromptTemplate } = require("@langchain/core/prompts");
const { JsonOutputParser } = require("@langchain/core/output_parsers");

const app = express();
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const QDRANT_URL = (process.env.QDRANT_URL || "").replace(/\/$/, "");
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "zuno_business_memory";
const VECTOR_SIZE = 256;

app.use(cors());
app.use(express.json());
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "home.html")));
app.use(express.static(__dirname));


if (!GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is not set. AI endpoints will fail until it is configured.");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const businessQueryPrompt = PromptTemplate.fromTemplate(`
You are Zuno, a business assistant for a small shopkeeper.
Answer the user's question using ONLY the retrieved Zuno business context below.
If the context does not contain enough data, say what is missing and suggest the next useful action.
Do not invent sales, customers, products, dates, or amounts.
Keep the answer short, practical, and shopkeeper-friendly.
Return ONLY valid JSON with this shape:
{{"answer":"","insights":[""],"sources":[""],"confidence":0}}

User question:
"{question}"

Retrieved Zuno business context:
{context}
`);

const businessQueryParser = new JsonOutputParser();

function createBusinessQueryChain() {
  const model = new ChatGoogleGenerativeAI({
    apiKey: GEMINI_API_KEY,
    model: "gemini-2.5-flash",
    temperature: 0.1,
    maxOutputTokens: 900,
    json: true
  });
  return businessQueryPrompt.pipe(model).pipe(businessQueryParser);
}

async function answerBusinessQuestionWithLangChain(question, safeContext) {
  const chain = createBusinessQueryChain();
  return chain.invoke({
    question: String(question).slice(0, 500),
    context: JSON.stringify(safeContext)
  });
}

function isQdrantConfigured() {
  return Boolean(QDRANT_URL);
}

async function qdrantFetch(pathname, options = {}) {
  if (!isQdrantConfigured()) throw new Error("QDRANT_URL is not configured");
  const headers = {
    "Content-Type": "application/json",
    ...(QDRANT_API_KEY ? { "api-key": QDRANT_API_KEY } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${QDRANT_URL}${pathname}`, { ...options, headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Qdrant ${response.status}: ${text || response.statusText}`);
  }
  return response.json().catch(() => ({}));
}

async function ensureQdrantCollection() {
  if (!isQdrantConfigured()) return false;
  try {
    await qdrantFetch(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}`);
    return true;
  } catch (error) {
    if (!String(error.message || "").includes("404")) throw error;
  }
  await qdrantFetch(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}`, {
    method: "PUT",
    body: JSON.stringify({
      vectors: {
        size: VECTOR_SIZE,
        distance: "Cosine"
      }
    })
  });
  return true;
}

async function createEmbedding(text, taskType = "RETRIEVAL_DOCUMENT") {
  const cleanText = String(text || "").trim().slice(0, 1000);
  if (!cleanText) throw new Error("No text provided");
  const response = await ai.models.embedContent({
    model: "text-embedding-004",
    contents: [cleanText],
    config: {
      taskType,
      outputDimensionality: VECTOR_SIZE
    }
  });
  const values = response.embeddings?.[0]?.values || response.embeddings?.[0]?.embedding?.values || [];
  if (!Array.isArray(values) || !values.length) {
    throw new Error("No embedding returned");
  }
  return values.map(Number);
}

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

Rules: intent is add_sale/add_inventory/query/unknown. Prefer add_sale when quantities and products are present. Match products to known products. Units only kg,g,piece. paymentMode only cash,upi,credit,"". paid/paid delivered means cash delivered unless credit/upi is said. deliveryStatus only delivered,pending,"". Parse dates like 5th june 2026, 5 june, on 5th into YYYY-MM-DD. If no date is said, date is "". If one total bill amount is given for multiple items, split item prices reasonably using known selling prices/quantities so sum equals totalAmount. If a product number is ambiguous, put it in price and set needsClarification true. For partial credit, amountPaid is paid amount.

JSON keys exactly:
{"intent":"add_sale","date":"","customer":"","phone":"","paymentMode":"","deliveryStatus":"","amountPaid":0,"totalAmount":0,"items":[{"product":"","qty":0,"unit":"kg","sellingPrice":0,"sellingUnit":"kg","price":0,"needsClarification":false,"clarification":""}],"confidence":0}
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

app.post("/embed-text", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    }

    const { text, taskType = "RETRIEVAL_DOCUMENT" } = req.body || {};
    const embedding = await createEmbedding(text, taskType);
    res.json({ embedding });
  } catch (error) {
    console.error("Embed text error:", error);
    res.status(500).json({ error: "Failed to embed text", details: error.message });
  }
});

app.post("/vector-memory/upsert", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    }

    const { userId, memoryId, text, type = "general" } = req.body || {};
    const cleanUserId = String(userId || "").trim().slice(0, 120);
    const cleanMemoryId = String(memoryId || "").trim();
    const cleanText = String(text || "").trim().slice(0, 500);
    if (!cleanUserId || !cleanMemoryId || !cleanText) {
      return res.status(400).json({ error: "userId, memoryId and text are required" });
    }

    const embedding = await createEmbedding(cleanText, "RETRIEVAL_DOCUMENT");
    let indexed = false;
    let vectorDb = "firestore-fallback";

    if (isQdrantConfigured()) {
      await ensureQdrantCollection();
      await qdrantFetch(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points?wait=true`, {
        method: "PUT",
        body: JSON.stringify({
          points: [{
            id: cleanMemoryId,
            vector: embedding,
            payload: {
              userId: cleanUserId,
              memoryId: cleanMemoryId,
              text: cleanText,
              type: String(type || "general").slice(0, 40),
              active: true,
              updatedAt: new Date().toISOString()
            }
          }]
        })
      });
      indexed = true;
      vectorDb = "qdrant";
    }

    res.json({ embedding, vectorDb, indexed, collection: QDRANT_COLLECTION });
  } catch (error) {
    console.error("Vector memory upsert error:", error);
    res.status(500).json({ error: "Failed to upsert vector memory", details: error.message });
  }
});

app.post("/vector-memory/search", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    }

    const { userId, question, limit = 5 } = req.body || {};
    const cleanUserId = String(userId || "").trim().slice(0, 120);
    const cleanQuestion = String(question || "").trim().slice(0, 500);
    const safeLimit = Math.max(1, Math.min(10, Number(limit || 5)));
    if (!cleanUserId || !cleanQuestion) {
      return res.status(400).json({ error: "userId and question are required" });
    }

    const embedding = await createEmbedding(cleanQuestion, "RETRIEVAL_QUERY");
    if (!isQdrantConfigured()) {
      return res.json({ vectorDb: "firestore-fallback", configured: false, embedding, memories: [] });
    }

    await ensureQdrantCollection();
    const result = await qdrantFetch(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points/search`, {
      method: "POST",
      body: JSON.stringify({
        vector: embedding,
        limit: safeLimit,
        with_payload: true,
        filter: {
          must: [
            { key: "userId", match: { value: cleanUserId } },
            { key: "active", match: { value: true } }
          ]
        }
      })
    });

    const memories = (result.result || [])
      .map(point => ({
        id: point.payload?.memoryId || point.id,
        text: point.payload?.text || "",
        type: point.payload?.type || "general",
        score: Number(point.score || 0)
      }))
      .filter(memory => memory.text && memory.score >= 0.35)
      .slice(0, safeLimit);

    res.json({ vectorDb: "qdrant", configured: true, memories });
  } catch (error) {
    console.error("Vector memory search error:", error);
    res.status(500).json({ error: "Failed to search vector memory", details: error.message });
  }
});

app.post("/business-query", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    }

    const { question, context = {} } = req.body || {};
    if (!question) return res.status(400).json({ error: "No question provided" });

    const safeContext = {
      intent: String(context.intent || "general").slice(0, 40),
      dateRange: String(context.dateRange || "").slice(0, 80),
      totals: context.totals || {},
      topCustomers: Array.isArray(context.topCustomers) ? context.topCustomers.slice(0, 10) : [],
      creditCustomers: Array.isArray(context.creditCustomers) ? context.creditCustomers.slice(0, 10) : [],
      lowStock: Array.isArray(context.lowStock) ? context.lowStock.slice(0, 12) : [],
      topProducts: Array.isArray(context.topProducts) ? context.topProducts.slice(0, 12) : [],
      recentSales: Array.isArray(context.recentSales) ? context.recentSales.slice(0, 12) : [],
      pendingOrders: Array.isArray(context.pendingOrders) ? context.pendingOrders.slice(0, 10) : [],
      notes: Array.isArray(context.notes) ? context.notes.slice(0, 10) : []
    };

    const parsed = await answerBusinessQuestionWithLangChain(question, safeContext);
    res.json({
      answer: String(parsed.answer || "").slice(0, 1200),
      insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 5).map(String) : [],
      sources: Array.isArray(parsed.sources) ? parsed.sources.slice(0, 5).map(String) : [],
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0)))
    });
  } catch (error) {
    console.error("Business query error:", error);
    res.status(500).json({ error: "Failed to answer business query", details: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
