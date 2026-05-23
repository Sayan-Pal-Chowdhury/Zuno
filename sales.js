import { handleCreditFromSale, reverseCreditFromSale, reverseCreditForSale, updateSaleCreditBalance } from "./credit.js";
import { db, auth } from "./firebase.js";
import {
  collection, onSnapshot, query,
  orderBy, getDocs, getDoc, updateDoc, doc, addDoc, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initEditSaleModal, openEditSaleModal,
  openAddSaleModal, deleteSaleById, updateProductCosts
} from "./editSaleModal.js";

/* ---------- STATE ---------- */
let currentUserId = null;
let allSales      = [];
let productCosts  = {};
let editingCreditSaleId = null;
let foodBusiness = false;

/* ---------- HELPERS ---------- */
function userCol(colName) {
  return collection(db, "users", currentUserId, colName);
}

function userDoc(colName, docId) {
  return doc(db, "users", currentUserId, colName, docId);
}

function normalizeName(name = "") {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePhone(phone = "") {
  return phone.trim();
}

function sameCustomer(record, customer, phone) {
  const recordPhone = normalizePhone(record.phone);
  const wantedPhone = normalizePhone(phone);
  if (recordPhone && wantedPhone && recordPhone === wantedPhone) return true;
  return normalizeName(record.name || record.customer) === normalizeName(customer);
}

async function findCreditCustomer(customer, phone) {
  const snap = await getDocs(userCol("credit"));
  let found = null;
  snap.forEach(d => {
    const c = d.data();
    if (!found && sameCustomer(c, customer, phone)) found = { id: d.id, ...c };
  });
  return found;
}

/* ---------- AUTH GATE ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUserId = user.uid;
  const profileSnap = await getDoc(userDoc("settings", "profile"));
  foodBusiness = profileSnap.exists() && profileSnap.data().foodMenuEnabled === true;

  initEditSaleModal(currentUserId, productCosts, () => {
  document.getElementById("salesTableWrapper")?.scrollIntoView({ behavior: "smooth", block: "start" });
});
  if (foodBusiness) loadFoodCosts();
  else loadProducts();
  loadSales();
});

/* ---------- LOAD PRODUCTS ---------- */
function loadProducts() {
  onSnapshot(userCol("products"), snap => {
    productCosts = {};
    snap.forEach(d => {
      const p = d.data();
      productCosts[p.name.toLowerCase()] = { cost: Number(p.cost), unit: p.unit || "kg" };
    });
    updateProductCosts(productCosts);
  });
}

function loadFoodCosts() {
  onSnapshot(userCol("foodCosts"), snap => {
    productCosts = {};
    snap.forEach(d => {
      const item = d.data();
      if (!item.name || item.cost === undefined || item.cost === "") return;
      productCosts[item.name.toLowerCase()] = {
        cost: Number(item.cost),
        unit: "piece",
        source: "food-menu",
        foodCostKey: item.key || ""
      };
    });
    updateProductCosts(productCosts);
  });
}

function itemPricingName(item = {}) {
  const product = String(item.product || "").trim();
  const variant = String(item.variantLabel || "").trim();
  if (!variant || product.toLowerCase().endsWith(` - ${variant}`.toLowerCase())) return product;
  return `${product} - ${variant}`;
}

function getProductCost(item) {
  return productCosts[itemPricingName(item).toLowerCase()];
}

function calculateItemProfit(item, productData) {
  let finalQty = Number(item.qty || 0);
  const baseUnit = productData.unit || "kg";
  if (item.unit === "g" && baseUnit === "kg") finalQty /= 1000;
  if (item.unit === "kg" && baseUnit === "g") finalQty *= 1000;
  return Number(item.price || 0) - (Number(productData.cost || 0) * finalQty);
}

/* ---------- LOAD SALES ---------- */
function loadSales() {
  onSnapshot(
    query(userCol("sales"), orderBy("date", "desc")),
    snap => {
      allSales = [];
      snap.forEach(d => {
        allSales.push({ ...d.data(), _id: d.id });
      });
      populateFilterOptions();
      applyFilters();
    }
  );
}

/* ---------- POPULATE FILTER OPTIONS ---------- */
function populateFilterOptions() {
  const months = new Set();
  const years  = new Set();

  allSales.forEach(s => {
    if (s.date) {
      months.add(s.date.substring(0, 7));
      years.add(s.date.substring(0, 4));
    }
  });

  const monthSel = document.getElementById("filterMonth");
  const yearSel  = document.getElementById("filterYear");
  const curMonth = monthSel.value;
  const curYear  = yearSel.value;

  monthSel.innerHTML = `<option value="">All Months</option>` +
    [...months].sort().reverse().map(m => `<option value="${m}" ${m === curMonth ? "selected" : ""}>${m}</option>`).join("");

  yearSel.innerHTML = `<option value="">All Years</option>` +
    [...years].sort().reverse().map(y => `<option value="${y}" ${y === curYear ? "selected" : ""}>${y}</option>`).join("");
}

/* ---------- APPLY FILTERS ---------- */
window.applyFilters = () => {
  const search      = document.getElementById("searchInput").value.toLowerCase();
  const dateFrom    = document.getElementById("filterDateFrom").value;
  const dateTo      = document.getElementById("filterDateTo").value;
  const month       = document.getElementById("filterMonth").value;
  const year        = document.getElementById("filterYear").value;
  const payment     = document.getElementById("filterPayment").value;
  const status      = document.getElementById("filterStatus").value;

  const filtered = allSales.filter(s => {
    if (search && !`${s.customer || ""} ${s.orderNumber || ""} ${s.phone || ""}`.toLowerCase().includes(search)) return false;
    if (dateFrom && s.date < dateFrom) return false;
    if (dateTo   && s.date > dateTo)   return false;
    if (month    && !s.date?.startsWith(month))   return false;
    if (year     && !s.date?.startsWith(year))    return false;
    if (payment  && s.paymentMode !== payment)    return false;
    if (status   && s.deliveryStatus !== status)  return false;
    return true;
  });

  renderTable(filtered);
  updateSummary(filtered);
};

window.clearFilters = () => {
  document.getElementById("searchInput").value    = "";
  document.getElementById("filterDateFrom").value = "";
  document.getElementById("filterDateTo").value   = "";
  document.getElementById("filterMonth").value    = "";
  document.getElementById("filterYear").value     = "";
  document.getElementById("filterPayment").value  = "";
  document.getElementById("filterStatus").value   = "";
  applyFilters();
};

/* ---------- RENDER TABLE ---------- */
function renderTable(sales) {
  const tbody = document.getElementById("salesTableBody");

  if (sales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-sales">No sales found.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";

  sales.forEach(s => {
    const itemsText = Array.isArray(s.items)
      ? s.items.map(i => `${i.product}(${i.qty})`).join(", ")
      : "—";

    // profit cell
    const missingProducts = Array.isArray(s.items)
      ? s.items.filter(i => i.hasCost === false || i.profit === null).map(i => i.product)
      : [];

    let profitCell = "";
    if (missingProducts.length > 0) {
      const totalKnown  = Array.isArray(s.items)
        ? s.items.reduce((sum, i) => sum + (i.profit !== null ? Number(i.profit || 0) : 0), 0)
        : 0;
      const missingText = missingProducts.map(p => `${p}: price not found`).join(", ");
      profitCell = `
        <div>₹${Math.round(totalKnown)}</div>
        <div style="font-size:11px;color:var(--text-muted)">(${missingText})</div>
        <button onclick="recalcSale('${s._id}')" style="font-size:11px;margin-top:4px;padding:2px 8px;background:var(--accent-light);color:var(--accent);border:1px solid #a8d5bc;border-radius:4px;cursor:pointer;">↻ Recalculate</button>
      `;
    } else {
      profitCell = `₹${Math.round(s.totalProfit || 0)}`;
    }

    // payment display
    let paymentDisplay = s.paymentMode || "cash";
    if (s.paymentMode === "credit") {
      const creditLeft = Number(s.creditAmount || 0);
      paymentDisplay += `<br><span style="font-size:11px;color:var(--danger)">Credit: ₹${Math.round(s.creditAmount)}</span>`;
      if (s.amountPaid > 0) {
        paymentDisplay += `<br><span style="font-size:11px;color:var(--accent)">Paid: ₹${Math.round(s.amountPaid)}</span>`;
      }
      paymentDisplay += `
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;">
          <button class="credit-mini-btn" onclick="openSaleCreditHistory('${s._id}')">History</button>
          <button class="credit-mini-btn credit-edit-btn" onclick="openSaleCreditEdit('${s._id}')">Edit Credit</button>
        </div>
      `;
    }

    // status dropdown
    const statusSelect = `
      <select onchange="updateStatus('${s._id}', this.value)"
        style="font-size:13px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg);cursor:pointer;">
        <option value="pending"   ${s.deliveryStatus === "pending"   ? "selected" : ""}>🕐 Pending</option>
        <option value="delivered" ${s.deliveryStatus === "delivered" ? "selected" : ""}>✅ Delivered</option>
      </select>
    `;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${s.orderNumber || "—"}</td>
      <td>${s.date || ""}</td>
      <td>${s.customer || "Retail"}</td>
      <td style="font-family:var(--font-mono);font-size:13px;">${s.phone || "—"}</td>
      <td>${itemsText}</td>
      <td>₹${Math.round(s.totalAmount || 0)}</td>
      <td>${profitCell}</td>
      <td>${paymentDisplay}</td>
      <td>${statusSelect}</td>
      <td>
        <button onclick='editSale("${s._id}", ${JSON.stringify(s).replace(/'/g, "&#39;")})' style="font-size:12px;height:28px;padding:0 10px;background:#eef2ff;color:#3730a3;border:1.5px solid #c7d2fe;border-radius:var(--radius-sm);cursor:pointer;margin-right:4px;">Edit</button>
        <button onclick="deleteSale('${s._id}')" style="font-size:12px;height:28px;padding:0 10px;background:var(--danger-light);color:var(--danger);border:1.5px solid #f5c6c2;border-radius:var(--radius-sm);cursor:pointer;">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/* ---------- UPDATE SUMMARY ---------- */
function updateSummary(sales) {
  let totalSales = 0, totalProfit = 0, pending = 0;

  sales.forEach(s => {
    totalSales  += Number(s.totalAmount || 0);
    totalProfit += Number(s.totalProfit || 0);
    if (s.deliveryStatus === "pending") pending++;
  });

  document.getElementById("ss_totalSales").textContent  = "₹" + Math.round(totalSales).toLocaleString("en-IN");
  document.getElementById("ss_totalProfit").textContent = "₹" + Math.round(totalProfit).toLocaleString("en-IN");
  document.getElementById("ss_totalOrders").textContent = sales.length;
  document.getElementById("ss_pending").textContent     = pending;
}

/* ---------- EDIT SALE ---------- */
window.editSale = (id, data) => {
  openEditSaleModal(id, data);
};

/* ---------- DELETE SALE ---------- */
window.deleteSale = async (id) => {
  if (!confirm("Delete this sale? Inventory and credit will be reversed.")) return;
  await deleteSaleById(id);
};

/* ---------- NEW SALE ---------- */
window.openNewSaleModal = async () => {
  const snap = await getDocs(userCol("sales"));
  const nums = [];
  snap.forEach(d => {
    const s = d.data();
    if (s.orderNumber) {
      const n = parseInt(s.orderNumber.replace("ORD-", ""));
      if (!isNaN(n)) nums.push(n);
    }
  });
  const next = "ORD-" + String((nums.length > 0 ? Math.max(...nums) + 1 : 1)).padStart(3, "0");
  openAddSaleModal(next);
};

/* ---------- UPDATE STATUS ---------- */
window.updateStatus = async (id, newStatus) => {
  if (!currentUserId) return;

  const saleRef  = userDoc("sales", id);
  const saleSnap = await getDoc(saleRef);
  if (!saleSnap.exists()) return;

  const saleData       = saleSnap.data();
  const wasDelivered   = saleData.deliveryStatus === "delivered";
  const isNowDelivered = newStatus === "delivered";

  await updateDoc(saleRef, { deliveryStatus: newStatus });

  // import deduct/revert from editSaleModal indirectly via re-save isn't needed
  // status change inventory handled by editSaleModal pattern
if (!wasDelivered && isNowDelivered) {
    await deductInventory(saleData.items);
    if (saleData.customerOrderId) await markCustomerOrderDelivered(saleData.customerOrderId, saleData);
    if (saleData.paymentMode === "credit" && (saleData.creditAmount || 0) > 0) {
      await handleCreditFromSale({
        userId: currentUserId,
        customer: saleData.customer,
        phone: saleData.phone,
        creditAmount: saleData.creditAmount,
        orderNumber: saleData.orderNumber,
        date: saleData.date
      });
    }
  } else if (wasDelivered && !isNowDelivered) {
    await revertInventory(saleData.items);
    if (saleData.customerOrderId) await markCustomerOrderReopened(saleData.customerOrderId, saleData);
    if (saleData.paymentMode === "credit") {
      await reverseCreditForSale({
        userId: currentUserId,
        sale: saleData
      });
    }
  }
};

async function markCustomerOrderDelivered(orderId, saleData) {
  const update = {
    status: "delivered",
    updatedAt: serverTimestamp()
  };
  if (saleData.paymentMode === "cash") update.paymentStatus = "cod_collected";
  await updateDoc(userDoc("customerOrders", orderId), update);
}

async function markCustomerOrderReopened(orderId, saleData) {
  const update = {
    status: "packed",
    updatedAt: serverTimestamp()
  };
  if (saleData.paymentMode === "cash") update.paymentStatus = "cod";
  await updateDoc(userDoc("customerOrders", orderId), update);
}

/* ---------- CREDIT HISTORY / EDIT FROM SALES ---------- */
window.openSaleCreditHistory = async (saleId) => {
  const sale = allSales.find(s => s._id === saleId);
  if (!sale) return;

  const modal = document.getElementById("saleCreditHistoryModal");
  const title = document.getElementById("saleCreditHistoryTitle");
  const body = document.getElementById("saleCreditHistoryBody");

  title.textContent = `${sale.customer || "Customer"} credit history`;
  body.innerHTML = `<p style="font-size:13px;color:var(--text-muted);padding:12px 0;">Loading...</p>`;
  modal.classList.remove("hidden");

  const credit = await findCreditCustomer(sale.customer, sale.phone);
  if (!credit) {
    body.innerHTML = `<p style="font-size:13px;color:var(--text-muted);padding:12px 0;">No credit history found.</p>`;
    return;
  }

  const snap = await getDocs(
    query(
      userCol("creditHistory"),
      where("creditId", "==", credit.id),
      orderBy("date", "desc")
    )
  );

  if (snap.empty) {
    body.innerHTML = `<p style="font-size:13px;color:var(--text-muted);padding:12px 0;">No credit history found.</p>`;
    return;
  }

  let rows = "";
  snap.forEach(d => {
    const h = d.data();
    const typeLabel = h.type === "credit" ? "Credit" : "Payment";
    const order = h.orderNumber || (Array.isArray(h.allocations)
      ? h.allocations.map(a => a.orderNumber).filter(Boolean).join(", ")
      : "");
    rows += `
      <tr>
        <td>${h.date || ""}</td>
        <td>${typeLabel}</td>
        <td>${order || "—"}</td>
        <td>₹${Math.round(h.amount || 0).toLocaleString("en-IN")}</td>
        <td>₹${Math.round(h.balanceAfter || 0).toLocaleString("en-IN")}</td>
      </tr>
    `;
  });

  body.innerHTML = `
    <table class="credit-history-table">
      <thead>
        <tr><th>Date</th><th>Type</th><th>Order</th><th>Amount</th><th>Balance</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
};

window.closeSaleCreditHistory = () => {
  document.getElementById("saleCreditHistoryModal").classList.add("hidden");
};

window.openSaleCreditEdit = (saleId) => {
  const sale = allSales.find(s => s._id === saleId);
  if (!sale) return;

  editingCreditSaleId = saleId;
  document.getElementById("saleCreditEditTitle").textContent = `${sale.orderNumber || "Order"} credit`;
  document.getElementById("saleCreditEditMeta").textContent =
    `${sale.customer || "Customer"} · Current credit: ₹${Math.round(sale.creditAmount || 0).toLocaleString("en-IN")}`;
  document.getElementById("saleCreditAmount").value = Math.round(sale.creditAmount || 0);
  document.getElementById("saleCreditDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("saleCreditNote").value = "";
  document.getElementById("saleCreditMsg").textContent = "";
  document.getElementById("saleCreditEditModal").classList.remove("hidden");
};

window.closeSaleCreditEdit = () => {
  editingCreditSaleId = null;
  document.getElementById("saleCreditEditModal").classList.add("hidden");
};

window.saveSaleCreditEdit = async () => {
  if (!editingCreditSaleId || !currentUserId) return;

  const amount = Number(document.getElementById("saleCreditAmount").value);
  const date = document.getElementById("saleCreditDate").value;
  const note = document.getElementById("saleCreditNote").value.trim();
  const msg = document.getElementById("saleCreditMsg");

  if (Number.isNaN(amount) || amount < 0) {
    msg.textContent = "Enter a valid credit balance.";
    return;
  }

  const sale = allSales.find(s => s._id === editingCreditSaleId);
  if (sale && amount > Number(sale.totalAmount || 0)) {
    msg.textContent = "Credit cannot be more than the order total.";
    return;
  }

  await updateSaleCreditBalance({
    userId: currentUserId,
    saleId: editingCreditSaleId,
    newCreditAmount: amount,
    date,
    note: note || "Credit edited from sales"
  });

  closeSaleCreditEdit();
};

/* ---------- DEDUCT INVENTORY ---------- */
async function deductInventory(items) {
  for (const item of items) {
    if (item.source === "food-menu") continue;
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
      date: new Date().toISOString().split("T")[0], type: "out", note: "Auto-deducted from sale"
    });
  }
}

/* ---------- REVERT INVENTORY ---------- */
async function revertInventory(items) {
  for (const item of items) {
    if (item.source === "food-menu") continue;
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
      date: new Date().toISOString().split("T")[0], type: "in", note: "Restored — sale deleted"
    });
  }
}

/* ---------- RECALC ONE SALE ---------- */
window.recalcSale = async (id) => {
  const saleRef  = userDoc("sales", id);
  const { getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const saleSnap = await getDoc(saleRef);
  if (!saleSnap.exists()) return;

  const s = saleSnap.data();
  if (!Array.isArray(s.items)) return;

  const missing = [];
  let totalProfit = 0;

  const updatedItems = s.items.map(item => {
    const productData = getProductCost(item);
    if (!productData) { missing.push(item.product); return { ...item, profit: null, hasCost: false }; }

    const profit = calculateItemProfit(item, productData);
    totalProfit += profit;
    return { ...item, profit, hasCost: true, costPrice: productData.cost };
  });

  await updateDoc(saleRef, { items: updatedItems, totalProfit });
  if (missing.length > 0) alert(`Still missing: ${missing.join(", ")}. Add their cost prices first.`);
};

/* ---------- RECALC ALL ---------- */
window.recalcAllSales = async () => {
  const snap       = await getDocs(userCol("sales"));
  const allMissing = new Set();
  let updated      = 0;

  for (const d of snap.docs) {
    const s = d.data();
    if (!Array.isArray(s.items)) continue;
    if (!s.items.some(i => i.hasCost === false || i.profit === null)) continue;

    let totalProfit = 0;
    const updatedItems = s.items.map(item => {
      const productData = getProductCost(item);
      if (!productData) { allMissing.add(item.product); return { ...item, profit: null, hasCost: false }; }

      const profit = calculateItemProfit(item, productData);
      totalProfit += profit;
      return { ...item, profit, hasCost: true, costPrice: productData.cost };
    });

    await updateDoc(userDoc("sales", d.id), { items: updatedItems, totalProfit });
    updated++;
  }

  alert(allMissing.size > 0
    ? `Updated ${updated} sales. Still missing: ${[...allMissing].join(", ")}.`
    : `Done! Updated ${updated} sales.`
  );
};
