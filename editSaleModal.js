import { db } from "./firebase.js";
import {
  collection, addDoc, doc, updateDoc,
  deleteDoc, getDocs, getDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { handleCreditFromSale, reverseCreditFromSale, reverseCreditForSale } from "./credit.js";

/* ---------- STATE ---------- */
let _userId       = null;
let _editId       = null;
let _editOriginal = null;
let _productCosts = {};
let _onSaved      = null; // callback after save

/* ---------- HELPERS ---------- */
function userCol(colName) {
  return collection(db, "users", _userId, colName);
}

function userDoc(colName, docId) {
  return doc(db, "users", _userId, colName, docId);
}

function getOriginalCreditAmount(sale) {
  if (sale?.originalCreditAmount !== undefined) return Number(sale.originalCreditAmount || 0);
  if (sale?.paymentMode !== "credit") return 0;
  return Math.max(0, Number(sale.totalAmount || 0) - Number(sale.amountPaid || 0));
}

/* ---------- INIT — called once per page ---------- */
export function initEditSaleModal(userId, productCosts, onSaved) {
  _userId       = userId;
  _productCosts = productCosts;
  _onSaved      = onSaved;
  injectModalHTML();
}

/* ---------- UPDATE PRODUCT COSTS (called when products change) ---------- */
export function updateProductCosts(productCosts) {
  _productCosts = productCosts;
}

/* ---------- INJECT MODAL HTML ---------- */
function injectModalHTML() {
  if (document.getElementById("editSaleModal")) return; // already injected

  const modal = document.createElement("div");
  modal.innerHTML = `
    <div id="editSaleModal" class="modal-overlay hidden" style="align-items:flex-start;padding:20px 0;overflow-y:auto;">
      <div class="modal-box" style="max-width:700px;width:100%;margin:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div style="font-size:16px;font-weight:600;color:var(--text-primary);" id="editSaleModalTitle">Edit Sale</div>
          <button onclick="closeEditSaleModal()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted);">×</button>
        </div>

        <!-- ORDER INFO ROW -->
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px;">
            <label style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--text-secondary);">Date</label>
            <input type="date" id="esd_date" style="height:38px;">
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex:2;min-width:160px;">
            <label style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--text-secondary);">Customer</label>
            <input type="text" id="esd_customer" placeholder="Customer name" style="height:38px;">
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px;">
            <label style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--text-secondary);">Phone</label>
            <input type="text" id="esd_phone" placeholder="Phone" style="height:38px;">
          </div>
        </div>

        <!-- ITEMS -->
        <div style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:8px;">Items</div>
        <div id="esd_itemsContainer" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px;"></div>
        <button onclick="esdAddItemRow()" style="font-size:13px;height:32px;padding:0 12px;background:var(--white);color:var(--accent);border:1.5px solid var(--accent);border-radius:var(--radius-sm);cursor:pointer;margin-bottom:12px;">+ Add Item</button>

        <!-- PAYMENT & STATUS ROW -->
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="display:flex;flex-direction:column;gap:4px;">
            <label style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--text-secondary);">Payment</label>
            <select id="esd_paymentMode" style="height:38px;width:110px;" onchange="esdToggleCreditBox()">
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="credit">Credit</option>
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <label style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--text-secondary);">Status</label>
            <select id="esd_deliveryStatus" style="height:38px;width:140px;">
              <option value="pending">🕐 Pending</option>
              <option value="delivered">✅ Delivered</option>
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px;">
            <label style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--text-secondary);">Order #</label>
            <input type="text" id="esd_orderNumber" style="height:38px;" readonly>
          </div>
        </div>

        <!-- CREDIT BOX -->
        <div id="esd_creditBox" style="display:none;flex-direction:column;gap:8px;background:var(--warning-light);border:1.5px solid #f4c07a;border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;">
          <div style="font-size:12px;font-weight:600;color:#a05c00;">Credit Options</div>
          <div style="display:flex;gap:10px;align-items:center;">
            <label style="font-size:13px;color:var(--text-secondary);display:flex;align-items:center;gap:6px;">
              <input type="radio" name="esd_creditType" value="full" checked onchange="document.getElementById('esd_creditType').value='full';document.getElementById('esd_amountPaidRow').style.display='none'"> Full Credit
            </label>
            <label style="font-size:13px;color:var(--text-secondary);display:flex;align-items:center;gap:6px;">
              <input type="radio" name="esd_creditType" value="partial" onchange="document.getElementById('esd_creditType').value='partial';document.getElementById('esd_amountPaidRow').style.display='flex'"> Partial Payment
            </label>
          </div>
          <input type="hidden" id="esd_creditType" value="full">
          <div id="esd_amountPaidRow" style="display:none;align-items:center;gap:8px;">
            <label style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">Amount Paid (₹)</label>
            <input type="number" id="esd_amountPaid" placeholder="e.g. 200" style="width:150px;height:38px;">
          </div>
        </div>

        <!-- TOTAL -->
        <div style="font-size:15px;font-weight:500;color:var(--text-secondary);margin-bottom:16px;">
          Total: ₹ <span id="esd_liveTotal" style="font-family:var(--font-mono);font-size:18px;color:var(--accent);font-weight:500;">0</span>
        </div>

        <!-- ACTIONS -->
        <div style="display:flex;gap:10px;">
          <button onclick="saveEditSale()" style="flex:1;height:40px;background:var(--accent);color:white;border:none;border-radius:var(--radius-sm);font-size:14px;font-weight:500;cursor:pointer;font-family:var(--font);">Save Changes</button>
          <button onclick="closeEditSaleModal()" style="flex:1;height:40px;background:var(--bg);color:var(--text-secondary);border:1.5px solid var(--border-dark);border-radius:var(--radius-sm);font-size:14px;cursor:pointer;font-family:var(--font);">Cancel</button>
        </div>
        <p id="esd_msg" style="font-size:13px;color:var(--danger);margin-top:8px;min-height:18px;"></p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

/* ---------- OPEN EDIT MODAL ---------- */
export function openEditSaleModal(id, saleData) {
  _editId       = id;
  _editOriginal = saleData;

  document.getElementById("editSaleModalTitle").textContent = `Edit Sale — ${saleData.orderNumber || ""}`;
  document.getElementById("esd_date").value            = saleData.date || "";
  document.getElementById("esd_customer").value        = saleData.customer || "";
  document.getElementById("esd_phone").value           = saleData.phone || "";
  document.getElementById("esd_orderNumber").value     = saleData.orderNumber || "";
  document.getElementById("esd_paymentMode").value     = saleData.paymentMode || "cash";
  document.getElementById("esd_deliveryStatus").value  = saleData.deliveryStatus || "pending";

  // credit fields
  if (saleData.paymentMode === "credit") {
    document.getElementById("esd_creditBox").style.display = "flex";
    document.getElementById("esd_creditType").value = saleData.creditType || "full";
    if (saleData.creditType === "partial") {
      document.getElementById("esd_amountPaidRow").style.display = "flex";
      document.getElementById("esd_amountPaid").value = saleData.amountPaid || "";
    }
  } else {
    document.getElementById("esd_creditBox").style.display = "none";
  }

  // items
  const container = document.getElementById("esd_itemsContainer");
  container.innerHTML = "";
  if (Array.isArray(saleData.items)) {
    saleData.items.forEach((item, i) => esdCreateItemRow(item));
  }

  esdUpdateTotal();
  document.getElementById("esd_msg").textContent = "";
  const modal = document.getElementById("editSaleModal");
modal.classList.remove("hidden");
modal.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- OPEN ADD SALE MODAL ---------- */
export function openAddSaleModal(nextOrderNumber) {
  _editId       = null;
  _editOriginal = null;

  document.getElementById("editSaleModalTitle").textContent = "New Sale";
  document.getElementById("esd_date").value           = new Date().toISOString().split("T")[0];
  document.getElementById("esd_customer").value       = "";
  document.getElementById("esd_phone").value          = "";
  document.getElementById("esd_orderNumber").value    = nextOrderNumber || "";
  document.getElementById("esd_paymentMode").value    = "cash";
  document.getElementById("esd_deliveryStatus").value = "pending";
  document.getElementById("esd_creditBox").style.display = "none";
  document.getElementById("esd_creditType").value     = "full";
  document.getElementById("esd_amountPaidRow").style.display = "none";
  document.getElementById("esd_amountPaid").value     = "";

  const container = document.getElementById("esd_itemsContainer");
  container.innerHTML = "";
  esdCreateItemRow();

  esdUpdateTotal();
  document.getElementById("esd_msg").textContent = "";
  const modal = document.getElementById("editSaleModal");
modal.classList.remove("hidden");
modal.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- CLOSE MODAL ---------- */
window.closeEditSaleModal = () => {
  _editId       = null;
  _editOriginal = null;
  document.getElementById("editSaleModal").classList.add("hidden");
};

/* ---------- TOGGLE CREDIT BOX ---------- */
window.esdToggleCreditBox = () => {
  const pm = document.getElementById("esd_paymentMode").value;
  document.getElementById("esd_creditBox").style.display = pm === "credit" ? "flex" : "none";
};

/* ---------- CREATE ITEM ROW ---------- */
function esdCreateItemRow(data = {}) {
  const container = document.getElementById("esd_itemsContainer");
  const row = document.createElement("div");
  row.className = "itemRow";
  row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--bg);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:10px;";

  row.innerHTML = `
    <input class="product" list="productsList" placeholder="Item" value="${data.product || ""}" style="flex:1;min-width:120px;height:38px;">
    <input type="number" class="qty" placeholder="Qty" value="${data.qty || ""}" style="width:70px;height:38px;">
    <select class="unit" style="width:80px;height:38px;">
      <option value="kg"    ${data.unit === "kg"    ? "selected" : ""}>kg</option>
      <option value="g"     ${data.unit === "g"     ? "selected" : ""}>gram</option>
      <option value="piece" ${data.unit === "piece" ? "selected" : ""}>piece</option>
    </select>
    <input type="number" class="sellingPrice" placeholder="₹/unit" value="${data.sellingPrice || ""}" style="width:90px;height:38px;">
    <input type="number" class="price" placeholder="Total" value="${data.price || ""}" style="width:100px;height:38px;">
    <button onclick="this.closest('.itemRow').remove();esdUpdateTotal();" style="width:28px;height:28px;background:var(--danger-light);color:var(--danger);border:1.5px solid #f5c6c2;border-radius:4px;cursor:pointer;font-size:12px;">×</button>
  `;

  const qtyInput   = row.querySelector(".qty");
  const sellInput  = row.querySelector(".sellingPrice");
  const totalInput = row.querySelector(".price");

  function updateFromSelling() {
    const qty  = Number(qtyInput.value)  || 0;
    const sp   = Number(sellInput.value) || 0;
    const unit = row.querySelector(".unit").value;
    if (qty && sp) {
      let total = qty * sp;
      if (unit === "g") total = (qty / 1000) * sp;
      totalInput.value = Math.round(total * 100) / 100;
      esdUpdateTotal();
    }
  }

  qtyInput.addEventListener("input", updateFromSelling);
  sellInput.addEventListener("input", updateFromSelling);
  totalInput.addEventListener("input", esdUpdateTotal);

  container.appendChild(row);
}

window.esdAddItemRow = () => esdCreateItemRow();

/* ---------- LIVE TOTAL ---------- */
function esdUpdateTotal() {
  const rows = document.querySelectorAll("#esd_itemsContainer .itemRow");
  let total  = 0;
  rows.forEach(r => { total += Number(r.querySelector(".price").value) || 0; });
  document.getElementById("esd_liveTotal").textContent = total.toLocaleString("en-IN");
}

/* ---------- SAVE ---------- */
window.saveEditSale = async () => {
  if (!_userId) return;

  const date           = document.getElementById("esd_date").value;
  const customer       = document.getElementById("esd_customer").value.trim();
  const phone          = document.getElementById("esd_phone").value.trim();
  const orderNumber    = document.getElementById("esd_orderNumber").value;
  const paymentMode    = document.getElementById("esd_paymentMode").value;
  const deliveryStatus = document.getElementById("esd_deliveryStatus").value;
  const creditType     = document.getElementById("esd_creditType").value;
  const amountPaid     = paymentMode === "credit" && creditType === "partial"
    ? Number(document.getElementById("esd_amountPaid").value) || 0
    : 0;

  if (!date || !customer) {
    document.getElementById("esd_msg").textContent = "Please fill date and customer name.";
    return;
  }

  const rows = document.querySelectorAll("#esd_itemsContainer .itemRow");
  let items = [], totalProfit = 0, totalAmount = 0;

  rows.forEach(r => {
    const product      = r.querySelector(".product").value.toLowerCase().trim();
    const qty          = Number(r.querySelector(".qty").value);
    const price        = Number(r.querySelector(".price").value);
    const unit         = r.querySelector(".unit").value;
    const sellingPrice = Number(r.querySelector(".sellingPrice").value) || 0;

    if (product && qty && price) {
      const productData = _productCosts[product];
      let cost = 0, baseUnit = "kg";
      if (productData) { cost = productData.cost; baseUnit = productData.unit; }

      let finalQty = qty;
      if (unit === "g"  && baseUnit === "kg") finalQty = qty / 1000;
      if (unit === "kg" && baseUnit === "g")  finalQty = qty * 1000;

      const hasCost = !!productData;
      const profit  = hasCost ? price - (cost * finalQty) : null;
      items.push({ product, qty, unit, price, sellingPrice, profit, hasCost });
      totalAmount += price;
      if (hasCost) totalProfit += profit;
    }
  });

  if (items.length === 0) {
    document.getElementById("esd_msg").textContent = "Please add at least one item.";
    return;
  }

  const creditAmount = paymentMode === "credit" && deliveryStatus === "delivered"
    ? (creditType === "full" ? totalAmount : Math.max(0, totalAmount - amountPaid))
    : 0;

  const paidAlreadyApplied = _editId && _editOriginal?.paymentMode === "credit"
    ? Math.max(0, getOriginalCreditAmount(_editOriginal) - Number(_editOriginal.creditAmount || 0))
    : 0;
  const originalCreditAmount = paymentMode === "credit" ? creditAmount : 0;
  const remainingCreditAmount = paymentMode === "credit"
    ? Math.max(0, originalCreditAmount - paidAlreadyApplied)
    : 0;

  const data = {
    orderNumber, date, customer, phone,
    items, totalProfit, totalAmount,
    paymentMode, deliveryStatus,
    creditType:   paymentMode === "credit" ? creditType : null,
    amountPaid:   paymentMode === "credit" ? amountPaid : 0,
    creditAmount: remainingCreditAmount,
    originalCreditAmount
  };

  if (_editId) {
    // --- EDIT existing sale ---
    const wasDelivered   = _editOriginal?.deliveryStatus === "delivered";
    const isNowDelivered = deliveryStatus === "delivered";

    // reverse old credit if needed
    if (_editOriginal?.paymentMode === "credit") {
      await reverseCreditForSale({
        userId: _userId,
        sale: _editOriginal,
        preservePaid: true
      });
    }

    await updateDoc(userDoc("sales", _editId), data);

    if (!wasDelivered && isNowDelivered) {
      await deductInventory(items);
    } else if (wasDelivered && !isNowDelivered) {
      await revertInventory(_editOriginal.items);
    } else if (wasDelivered && isNowDelivered) {
      await revertInventory(_editOriginal.items);
      await deductInventory(items);
    }

    if (paymentMode === "credit" && data.originalCreditAmount > 0) {
      await handleCreditFromSale({
        userId: _userId, customer, phone,
        creditAmount: data.creditAmount,
        originalCreditAmount: data.originalCreditAmount,
        orderNumber, date, isEdit: true, oldCreditAmount: 0
      });
    }

  } else {
    // --- NEW sale ---
    await addDoc(userCol("sales"), data);

    if (deliveryStatus === "delivered") {
      await deductInventory(items);
    }

    if (paymentMode === "credit" && data.originalCreditAmount > 0) {
      await handleCreditFromSale({
        userId: _userId, customer, phone,
        creditAmount: data.creditAmount,
        originalCreditAmount: data.originalCreditAmount,
        orderNumber, date
      });
    }
  }

  document.getElementById("editSaleModal").classList.add("hidden");
  _editId = null;
  _editOriginal = null;

  if (_onSaved) _onSaved();
};

/* ---------- DELETE SALE ---------- */
export async function deleteSaleById(id) {
  if (!_userId) return;

  const saleRef  = userDoc("sales", id);
  const saleSnap = await getDoc(saleRef);

  if (saleSnap.exists()) {
    const s = saleSnap.data();
    if (s.deliveryStatus === "delivered" && Array.isArray(s.items)) {
      await revertInventory(s.items);
    }
    if (s.paymentMode === "credit") {
      await reverseCreditForSale({
        userId: _userId,
        sale: s
      });
    }
  }

  await deleteDoc(saleRef);
}

/* ---------- DEDUCT INVENTORY ---------- */
async function deductInventory(items) {
  for (const item of items) {
    const key  = item.product.toLowerCase();
    const snap = await getDocs(userCol("inventory"));
    let found  = null;
    snap.forEach(d => {
      if (d.data().product.toLowerCase() === key) found = { id: d.id, ...d.data() };
    });
    if (!found) continue;

    let qty = Number(item.qty);
    if (item.unit === "g"  && found.unit === "kg") qty = qty / 1000;
    if (item.unit === "kg" && found.unit === "g")  qty = qty * 1000;

    await updateDoc(userDoc("inventory", found.id), { qty: Math.max(0, Number(found.qty) - qty) });
    await addDoc(userCol("inventoryHistory"), {
      product: item.product, qty: item.qty, unit: item.unit,
      date: new Date().toISOString().split("T")[0],
      type: "out", note: "Auto-deducted from sale"
    });
  }
}

/* ---------- REVERT INVENTORY ---------- */
async function revertInventory(items) {
  for (const item of items) {
    const key  = item.product.toLowerCase();
    const snap = await getDocs(userCol("inventory"));
    let found  = null;
    snap.forEach(d => {
      if (d.data().product.toLowerCase() === key) found = { id: d.id, ...d.data() };
    });
    if (!found) continue;

    let qty = Number(item.qty);
    if (item.unit === "g"  && found.unit === "kg") qty = qty / 1000;
    if (item.unit === "kg" && found.unit === "g")  qty = qty * 1000;

    await updateDoc(userDoc("inventory", found.id), { qty: Number(found.qty) + qty });
    await addDoc(userCol("inventoryHistory"), {
      product: item.product, qty, unit: found.unit,
      date: new Date().toISOString().split("T")[0],
      type: "in", note: "Restored — sale deleted"
    });
  }
}
