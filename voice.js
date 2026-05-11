// ════════════════════════════════════════
//   ZUNO VOICE ASSISTANT — voice.js
//   Reusable module — add to any page:
//   <link rel="stylesheet" href="voice.css">
//   <script type="module" src="voice.js"></script>
// ════════════════════════════════════════

import { db, auth, userCol } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, getDocs, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ── STATE ── */
let userId       = null;
let recognition  = null;
let isRecording  = false;
let transcript   = "";
let extractedData = null;

/* ── AUTH ── */
onAuthStateChanged(auth, user => {
  if (user) userId = user.uid;
});

/* ── BUILD UI ── */
function buildVoiceUI() {
  // Mic button
  const micBtn = document.createElement("button");
  micBtn.id        = "zunomicBtn";
  micBtn.className = "zuno-mic-btn";
  micBtn.title     = "Hold to speak your order";
  micBtn.innerHTML = `
    <span class="zuno-mic-icon">🎙️</span>
    <div class="zuno-mic-spinner"></div>
  `;

  // Tooltip
  const tooltip = document.createElement("div");
  tooltip.id        = "zunoTooltip";
  tooltip.className = "zuno-mic-tooltip";
  tooltip.textContent = "Hold to speak";

  // Toast
  const toast = document.createElement("div");
  toast.id        = "zunoVoiceToast";
  toast.className = "zuno-voice-toast";

  // Review modal overlay
  const overlay = document.createElement("div");
  overlay.id        = "zunoVoiceOverlay";
  overlay.className = "zuno-voice-overlay";
  overlay.innerHTML = `
    <div class="zuno-voice-modal" id="zunoVoiceModal">
      <div class="zuno-modal-handle"></div>

      <div class="zuno-modal-header">
        <div class="zuno-modal-title-wrap">
          <div class="zuno-modal-avatar">🎙️</div>
          <div>
            <div class="zuno-modal-title">Review Order</div>
            <div class="zuno-modal-sub">Edit anything before confirming</div>
          </div>
        </div>
        <button class="zuno-modal-close" id="zunoModalClose">✕</button>
      </div>

      <div class="zuno-transcript-strip" id="zunoTranscriptStrip">
        <div class="zuno-transcript-label">You said</div>
        <span id="zunoTranscriptText"></span>
      </div>

      <div class="zuno-error-msg" id="zunoErrorMsg"></div>

      <div class="zuno-modal-body">

        <!-- CUSTOMER -->
        <div class="zuno-section-label">Customer</div>
        <div class="zuno-customer-row">
          <div class="zuno-field">
            <div class="zuno-field-label">Name</div>
            <input class="zuno-field-input" id="zunoVoiceName" placeholder="Customer name" type="text">
          </div>
          <div class="zuno-field">
            <div class="zuno-field-label">Phone</div>
            <input class="zuno-field-input" id="zunoVoicePhone" placeholder="Phone number" type="tel">
          </div>
        </div>

        <!-- ITEMS -->
        <div class="zuno-section-label">Items</div>
        <div class="zuno-items-wrap" id="zunoItemsWrap"></div>
        <button class="zuno-add-item-btn" id="zunoAddItemBtn">+ Add Item</button>

        <!-- TOTAL -->
        <div class="zuno-total-bar" style="margin-top:14px">
          <span class="zuno-total-label">Order Total</span>
          <span class="zuno-total-value" id="zunoOrderTotal">₹0</span>
        </div>

        <!-- OPTIONS -->
        <div class="zuno-section-label">Order Details</div>
        <div class="zuno-options-row">
          <div class="zuno-field">
            <div class="zuno-field-label">Payment</div>
            <select class="zuno-field-input zuno-field-select" id="zunoVoicePayment">
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="credit">Credit</option>
            </select>
          </div>
          <div class="zuno-field">
            <div class="zuno-field-label">Status</div>
            <select class="zuno-field-input zuno-field-select" id="zunoVoiceStatus">
              <option value="pending">🕐 Pending</option>
              <option value="delivered">✅ Delivered</option>
            </select>
          </div>
        </div>

      </div>

      <div class="zuno-modal-footer">
        <button class="zuno-btn zuno-btn-cancel" id="zunoCancelBtn">Cancel</button>
        <button class="zuno-btn zuno-btn-form"   id="zunoFormBtn">✏️ Edit in Form</button>
        <button class="zuno-btn zuno-btn-confirm" id="zunoConfirmBtn">✓ Confirm</button>
      </div>
    </div>
  `;

  document.body.appendChild(micBtn);
  document.body.appendChild(tooltip);
  document.body.appendChild(toast);
  document.body.appendChild(overlay);

  initEvents();
}

/* ── EVENTS ── */
function initEvents() {
  const micBtn  = document.getElementById("zunomicBtn");
  const tooltip = document.getElementById("zunoTooltip");
  const overlay = document.getElementById("zunoVoiceOverlay");

  // Show tooltip on hover
  micBtn.addEventListener("mouseenter", () => showTooltip("Hold to speak your order"));
  micBtn.addEventListener("mouseleave", () => hideTooltip());

  // Press and hold — mouse
  micBtn.addEventListener("mousedown",  startRecording);
  micBtn.addEventListener("mouseup",    stopRecording);
  micBtn.addEventListener("mouseleave", () => { if (isRecording) stopRecording(); });

  // Press and hold — touch
  micBtn.addEventListener("touchstart", e => { e.preventDefault(); startRecording(); });
  micBtn.addEventListener("touchend",   e => { e.preventDefault(); stopRecording(); });

  // Close modal
  document.getElementById("zunoModalClose").addEventListener("click", closeModal);
  document.getElementById("zunoCancelBtn").addEventListener("click", closeModal);

  // Close on overlay click
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeModal();
  });

  // Add item
  document.getElementById("zunoAddItemBtn").addEventListener("click", () => {
    addItemRow({ product: "", qty: "", unit: "kg", sellingPrice: "", price: "" });
    recalcTotal();
  });

  // Edit in form
  document.getElementById("zunoFormBtn").addEventListener("click", goToForm);

  // Confirm
  document.getElementById("zunoConfirmBtn").addEventListener("click", confirmOrder);
}

/* ── SPEECH RECOGNITION ── */
function startRecording() {
  if (isRecording) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    showVoiceToast("⚠ Speech recognition not supported. Use Chrome or Android.");
    return;
  }

  isRecording  = true;
  transcript   = "";

  recognition = new SpeechRecognition();
  recognition.continuous    = true;
  recognition.interimResults = true;
  recognition.lang          = ""; // empty = auto-detect language

  const micBtn = document.getElementById("zunomicBtn");
  micBtn.classList.add("recording");
  micBtn.innerHTML = `
    <div class="zuno-waveform">
      <div class="zuno-waveform-bar"></div>
      <div class="zuno-waveform-bar"></div>
      <div class="zuno-waveform-bar"></div>
      <div class="zuno-waveform-bar"></div>
      <div class="zuno-waveform-bar"></div>
    </div>
  `;

  showTooltip("🔴 Recording… Release to process");

  recognition.onresult = event => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) transcript += t + " ";
      else interim = t;
    }
    showTooltip("🔴 " + (transcript || interim).slice(-40));
  };

  recognition.onerror = err => {
    console.error("Speech error:", err);
    resetMicBtn();
    showVoiceToast("⚠ Could not hear you. Try again.");
  };

  recognition.start();
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;

  if (recognition) {
    recognition.stop();
    recognition = null;
  }

  const micBtn = document.getElementById("zunomicBtn");
  micBtn.classList.remove("recording");
  micBtn.classList.add("processing");
  micBtn.innerHTML = `
    <span class="zuno-mic-icon">🎙️</span>
    <div class="zuno-mic-spinner"></div>
  `;

  showTooltip("⚡ Processing…");

  setTimeout(() => {
    const finalText = transcript.trim();
    if (!finalText) {
      resetMicBtn();
      showVoiceToast("Nothing heard. Try again.");
      return;
    }
    extractOrder(finalText);
  }, 400);
}

function resetMicBtn() {
  const micBtn = document.getElementById("zunomicBtn");
  micBtn.classList.remove("recording", "processing");
  micBtn.innerHTML = `
    <span class="zuno-mic-icon">🎙️</span>
    <div class="zuno-mic-spinner"></div>
  `;
  hideTooltip();
}

/* ── AI EXTRACTION ── */
async function extractOrder(text) {
  try {
    const response = await fetch("https://zuno-production.up.railway.app/extract-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, userId })
    });

    if (!response.ok) throw new Error("Server error");

    const data = await response.json();

    if (data.error) {
      resetMicBtn();
      showVoiceToast("⚠ Could not extract order. Try again.");
      return;
    }

    extractedData = data;
    showReviewModal(text, data);
    resetMicBtn();

  } catch (err) {
    console.error("Extract error:", err);
    resetMicBtn();
    showVoiceToast("⚠ Server error. Is server running?");
  }
}

/* ── REVIEW MODAL ── */
function showReviewModal(rawText, data) {
  // Set transcript
  document.getElementById("zunoTranscriptText").textContent = rawText;

  // Customer
  document.getElementById("zunoVoiceName").value    = data.customer || "";
  document.getElementById("zunoVoicePhone").value   = data.phone    || "";
  document.getElementById("zunoVoicePayment").value = data.paymentMode || "cash";
  document.getElementById("zunoVoiceStatus").value  = data.deliveryStatus || "pending";

  // Items
  const wrap = document.getElementById("zunoItemsWrap");
  wrap.innerHTML = "";

  const items = data.items && data.items.length > 0
    ? data.items
    : [{ product: "", qty: "", unit: "kg", sellingPrice: "", price: "" }];

  items.forEach(item => addItemRow(item));

  // Error reset
  document.getElementById("zunoErrorMsg").classList.remove("show");

  recalcTotal();

  // Open overlay
  document.getElementById("zunoVoiceOverlay").classList.add("open");
}

/* ── ITEM ROW ── */
function addItemRow(item = {}) {
  const wrap = document.getElementById("zunoItemsWrap");
  const row  = document.createElement("div");
  row.className = "zuno-item-row";

  row.innerHTML = `
    <input class="zuno-item-input" placeholder="Product" value="${item.product || ""}" type="text" data-field="product">
    <input class="zuno-item-input" placeholder="Qty" value="${item.qty || ""}" type="number" data-field="qty">
    <select class="zuno-item-select" data-field="unit">
      <option value="kg"    ${item.unit === "kg"    ? "selected" : ""}>kg</option>
      <option value="g"     ${item.unit === "g"     ? "selected" : ""}>gram</option>
      <option value="piece" ${item.unit === "piece" ? "selected" : ""}>piece</option>
    </select>
    <input class="zuno-item-input" placeholder="₹/unit" value="${item.sellingPrice || ""}" type="number" data-field="sellingPrice">
    <button class="zuno-remove-item" title="Remove">✕</button>
  `;

  // Remove button
  row.querySelector(".zuno-remove-item").addEventListener("click", () => {
    row.remove();
    recalcTotal();
  });

  // Auto-calc on change
  row.querySelectorAll("[data-field]").forEach(el => {
    el.addEventListener("input", () => recalcTotal());
    el.addEventListener("change", () => recalcTotal());
  });

  wrap.appendChild(row);
  recalcTotal();
}

/* ── RECALC TOTAL ── */
function recalcTotal() {
  const rows  = document.querySelectorAll(".zuno-item-row");
  let   total = 0;

  rows.forEach(row => {
    const qty   = Number(row.querySelector("[data-field='qty']").value)          || 0;
    const sp    = Number(row.querySelector("[data-field='sellingPrice']").value) || 0;
    const unit  = row.querySelector("[data-field='unit']").value;

    let lineTotal = 0;
    if (qty && sp) {
      lineTotal = unit === "g" ? (qty / 1000) * sp : qty * sp;
    }
    total += lineTotal;
  });

  document.getElementById("zunoOrderTotal").textContent =
    "₹" + Math.round(total).toLocaleString("en-IN");
}

/* ── COLLECT ORDER DATA FROM MODAL ── */
function collectOrderData() {
  const customer       = document.getElementById("zunoVoiceName").value.trim();
  const phone          = document.getElementById("zunoVoicePhone").value.trim();
  const paymentMode    = document.getElementById("zunoVoicePayment").value;
  const deliveryStatus = document.getElementById("zunoVoiceStatus").value;

  const rows = document.querySelectorAll(".zuno-item-row");
  const items = [];
  let totalAmount = 0;
  let totalProfit = 0;

  rows.forEach(row => {
    const product      = row.querySelector("[data-field='product']").value.trim().toLowerCase();
    const qty          = Number(row.querySelector("[data-field='qty']").value)          || 0;
    const unit         = row.querySelector("[data-field='unit']").value;
    const sellingPrice = Number(row.querySelector("[data-field='sellingPrice']").value) || 0;

    if (!product || !qty || !sellingPrice) return;

    let lineTotal = unit === "g" ? (qty / 1000) * sellingPrice : qty * sellingPrice;
    lineTotal = Math.round(lineTotal * 100) / 100;

    items.push({ product, qty, unit, sellingPrice, price: lineTotal, profit: null, hasCost: false });
    totalAmount += lineTotal;
  });

  return { customer, phone, paymentMode, deliveryStatus, items, totalAmount, totalProfit };
}

/* ── CONFIRM — SAVE ORDER ── */
async function confirmOrder() {
  if (!userId) {
    showVoiceToast("Please login first");
    return;
  }

  const { customer, phone, paymentMode, deliveryStatus, items, totalAmount } = collectOrderData();

  if (items.length === 0) {
    showError("Please add at least one item with product, qty and price.");
    return;
  }

  const confirmBtn = document.getElementById("zunoConfirmBtn");
  confirmBtn.classList.add("loading");
  confirmBtn.textContent = "Saving…";

  try {
    // Generate order number
    const orderNumber = await getNextOrderNumber();

    const today = new Date().toISOString().split("T")[0];

    const saleData = {
      orderNumber,
      date:            today,
      customer,
      phone,
      items,
      totalAmount:     Math.round(totalAmount),
      totalProfit:     0,
      paymentMode,
      deliveryStatus,
      creditType:      null,
      amountPaid:      0,
      creditAmount:    0,
      createdVia:      "voice"
    };

    await addDoc(userCol(userId, "sales"), saleData);

    // Deduct inventory if delivered
    if (deliveryStatus === "delivered") {
      await deductInventory(items);
    }

    closeModal();
    showVoiceToast(`✓ Order ${orderNumber} saved!`);

    // If on index page refresh will happen via onSnapshot
    // If on another page, optionally navigate
    const isOrderPage = window.location.pathname.includes("index");
    if (!isOrderPage) {
      setTimeout(() => {
        if (confirm("Go to Orders page to view the saved order?")) {
          window.location.href = "/index.html";
        }
      }, 500);
    }

  } catch (err) {
    console.error("Save error:", err);
    showError("Error saving order. Please try again.");
    confirmBtn.classList.remove("loading");
    confirmBtn.textContent = "✓ Confirm";
  }
}

/* ── EDIT IN FORM ── */
function goToForm() {
  const data = collectOrderData();

  // Store in sessionStorage for index.html to pick up
  sessionStorage.setItem("zunoVoiceOrder", JSON.stringify(data));
  closeModal();

  if (!window.location.pathname.includes("index")) {
    window.location.href = "/index.html?voice=1";
  } else {
    // Already on index — fill form
    fillFormFromVoice(data);
  }
}

/* ── FILL FORM (when already on index.html) ── */
function fillFormFromVoice(data) {
  try {
    // Customer
    const nameEl  = document.getElementById("customerName");
    const phoneEl = document.getElementById("phone");
    const pmEl    = document.getElementById("paymentMode");
    const dsEl    = document.getElementById("deliveryStatus");

    if (nameEl)  nameEl.value  = data.customer    || "";
    if (phoneEl) phoneEl.value = data.phone        || "";
    if (pmEl)    pmEl.value    = data.paymentMode  || "cash";
    if (dsEl)    dsEl.value    = data.deliveryStatus || "pending";

    // Items
    const container = document.getElementById("itemsContainer");
    if (container) {
      container.innerHTML = "";

      data.items.forEach((item, idx) => {
        // Use existing createItemRow if available
        if (typeof createItemRow === "function") {
          container.appendChild(createItemRow(idx === 0, {
            product:      item.product,
            qty:          item.qty,
            unit:         item.unit,
            sellingPrice: item.sellingPrice,
            price:        item.price
          }));
        } else {
          // Fallback manual row
          const row = document.createElement("div");
          row.className = "itemRow";
          row.innerHTML = `
            <input class="product" list="productsList" placeholder="Item" value="${item.product || ""}">
            <input type="number" class="qty" placeholder="Qty" value="${item.qty || ""}">
            <select class="unit">
              <option value="kg"    ${item.unit === "kg"    ? "selected" : ""}>kg</option>
              <option value="g"     ${item.unit === "g"     ? "selected" : ""}>gram</option>
              <option value="piece" ${item.unit === "piece" ? "selected" : ""}>piece</option>
            </select>
            <input type="number" class="sellingPrice" placeholder="Price/unit" value="${item.sellingPrice || ""}">
            <input type="number" class="price" placeholder="Total Amount" value="${item.price || ""}">
            ${idx > 0 ? `<button class="removeBtn" onclick="this.closest('.itemRow').remove()">X</button>` : ""}
          `;
          container.appendChild(row);
        }
      });
    }

    // Update live total
    const liveTotal = document.getElementById("liveTotal");
    if (liveTotal) liveTotal.innerText = Math.round(data.totalAmount);

    showVoiceToast("✓ Form filled from voice");
  } catch (e) {
    console.error("Fill form error:", e);
  }
}

/* ── ORDER NUMBER ── */
async function getNextOrderNumber() {
  const snap = await getDocs(userCol(userId, "sales"));
  const nums = [];
  snap.forEach(d => {
    const s = d.data();
    if (s.orderNumber) {
      const n = parseInt(s.orderNumber.replace("ORD-", ""));
      if (!isNaN(n)) nums.push(n);
    }
  });
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return "ORD-" + String(next).padStart(3, "0");
}

/* ── INVENTORY DEDUCTION ── */
async function deductInventory(items) {
  for (const item of items) {
    const key  = item.product.toLowerCase();
    const snap = await getDocs(userCol(userId, "inventory"));
    let found  = null;
    snap.forEach(d => {
      if (d.data().product.toLowerCase() === key) found = { id: d.id, ...d.data() };
    });
    if (!found) continue;

    let deductQty = Number(item.qty);
    if (item.unit === "g"  && found.unit === "kg") deductQty = deductQty / 1000;
    if (item.unit === "kg" && found.unit === "g")  deductQty = deductQty * 1000;

    const newQty = Math.max(0, Number(found.qty) - deductQty);
    await updateDoc(doc(db, "users", userId, "inventory", found.id), { qty: newQty });

    await addDoc(userCol(userId, "inventoryHistory"), {
      product: item.product,
      qty:     item.qty,
      unit:    item.unit,
      date:    new Date().toISOString().split("T")[0],
      type:    "out",
      note:    "Auto-deducted via voice order"
    });
  }
}

/* ── CLOSE MODAL ── */
function closeModal() {
  document.getElementById("zunoVoiceOverlay").classList.remove("open");
  document.getElementById("zunoConfirmBtn").classList.remove("loading");
  document.getElementById("zunoConfirmBtn").textContent = "✓ Confirm";
  transcript    = "";
  extractedData = null;
}

/* ── HELPERS ── */
function showTooltip(text) {
  const t = document.getElementById("zunoTooltip");
  if (t) { t.textContent = text; t.classList.add("show"); }
}

function hideTooltip() {
  const t = document.getElementById("zunoTooltip");
  if (t) t.classList.remove("show");
}

function showError(msg) {
  const el = document.getElementById("zunoErrorMsg");
  if (el) { el.textContent = msg; el.classList.add("show"); }
}

function showVoiceToast(msg, duration = 3000) {
  const t = document.getElementById("zunoVoiceToast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

/* ── CHECK FOR VOICE DATA ON INDEX PAGE ── */
function checkVoiceSessionData() {
  const stored = sessionStorage.getItem("zunoVoiceOrder");
  if (stored && window.location.search.includes("voice=1")) {
    try {
      const data = JSON.parse(stored);
      sessionStorage.removeItem("zunoVoiceOrder");
      // Small delay to let index.html init
      setTimeout(() => fillFormFromVoice(data), 800);
    } catch(e) {}
  }
}

/* ── INIT ── */
buildVoiceUI();
checkVoiceSessionData();
