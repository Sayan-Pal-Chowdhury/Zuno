import { db, auth } from "./firebase.js";
import {
  collection, addDoc, onSnapshot, doc,
  updateDoc, deleteDoc, query, orderBy,
  getDocs, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ---------- STATE ---------- */
let currentUserId  = null;
let allSales       = [];
let allCredit      = [];
let allInventory   = [];
let allExpenses    = [];
let allVendors     = [];
let allCashAdjustments = [];
let openingBalance = 0;
let revenueChart   = null;
let paymentChart   = null;
let payingVendorId = null;

/* ---------- HELPERS ---------- */
function userCol(colName) { return collection(db, "users", currentUserId, colName); }
function userDoc(colName, docId) { return doc(db, "users", currentUserId, colName, docId); }
function today() { return new Date().toISOString().split("T")[0]; }
function fmt(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }

/* ---------- AUTH GATE ---------- */
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUserId = user.uid;
  document.getElementById("expDate").value       = today();
  document.getElementById("cashAdjustmentDate").value = today();
  document.getElementById("vendorPayDate").value = today();
  loadSettings();
  loadSales();
  loadCredit();
  loadInventory();
  loadExpenses();
  loadVendors();
  loadCashAdjustments();
});

/* ---------- LOAD SETTINGS ---------- */
async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, "users", currentUserId, "settings", "finance"));
    if (snap.exists()) {
      openingBalance = Number(snap.data().openingBalance || 0);
      document.getElementById("openingBalance").value = openingBalance;
    }
  } catch (e) { console.log("Settings not found"); }
}

/* ---------- SAVE OPENING BALANCE ---------- */
window.saveOpeningBalance = async () => {
  const val = Number(document.getElementById("openingBalance").value) || 0;
  await setDoc(doc(db, "users", currentUserId, "settings", "finance"), {
    openingBalance: val
  }, { merge: true });
  openingBalance = val;
  updateOverview();
  const msg = document.getElementById("openingBalanceMsg");
  msg.textContent = "✓ Saved";
  setTimeout(() => msg.textContent = "", 2000);
};

/* ---------- LOAD SALES ---------- */
function loadSales() {
  onSnapshot(userCol("sales"), snap => {
    allSales = [];
    snap.forEach(d => allSales.push({ id: d.id, ...d.data() }));
    populatePLFilters();
    updateOverview();
    updatePL();
    updateCharts();
    updateSmartSummary();
  });
}

/* ---------- LOAD CREDIT ---------- */
function loadCredit() {
  onSnapshot(userCol("credit"), snap => {
    allCredit = [];
    snap.forEach(d => allCredit.push({ id: d.id, ...d.data() }));
    updateOverview();
    updateSmartSummary();
  });
}

/* ---------- LOAD INVENTORY ---------- */
function loadInventory() {
  onSnapshot(userCol("inventory"), snap => {
    allInventory = [];
    snap.forEach(d => allInventory.push({ id: d.id, ...d.data() }));
    updateOverview();
  });
}

/* ---------- LOAD EXPENSES ---------- */
function loadExpenses() {
  onSnapshot(
    query(userCol("expenses"), orderBy("date", "desc")),
    snap => {
      allExpenses = [];
      snap.forEach(d => allExpenses.push({ id: d.id, ...d.data() }));
      renderExpenses();
      updateOverview();
      updatePL();
    }
  );
}

/* ---------- LOAD VENDORS ---------- */
function loadVendors() {
  onSnapshot(userCol("vendorPayments"), snap => {
    allVendors = [];
    snap.forEach(d => allVendors.push({ id: d.id, ...d.data() }));
    renderVendors();
    updateOverview();
  });
}

/* ---------- LOAD CASH ADJUSTMENTS ---------- */
function loadCashAdjustments() {
  onSnapshot(
    query(userCol("cashAdjustments"), orderBy("date", "desc")),
    snap => {
      allCashAdjustments = [];
      snap.forEach(d => allCashAdjustments.push({ id: d.id, ...d.data() }));
      renderCashAdjustments();
      updateOverview();
    }
  );
}

/* ---------- UPDATE OVERVIEW ---------- */
function updateOverview() {
  let cashIn = openingBalance;
  let cashOut = 0;

  allSales.forEach(s => {
    if (s.deliveryStatus !== "delivered") return;
    if (s.paymentMode === "cash" || s.paymentMode === "upi") {
      cashIn += Number(s.totalAmount || 0);
    } else if (s.paymentMode === "credit") {
      cashIn += Number(s.amountPaid || 0);
    }
  });

  allCredit.forEach(c => { cashIn += Number(c.totalPaid || 0); });
  allVendors.forEach(v => { cashOut += Number(v.amountPaid || 0); });
  allExpenses.forEach(e => { cashOut += Number(e.amount || 0); });
  allCashAdjustments.forEach(entry => {
    const amount = Number(entry.amount || 0);
    if (entry.type === "add") cashIn += amount;
    else if (entry.type === "subtract" || entry.type === "inventory_purchase") cashOut += amount;
    else if (entry.type === "set") {
      cashIn += amount;
    }
  });

  const cashAtHand = cashIn - cashOut;

  let totalRevenue = 0, totalProfit = 0;
  allSales.forEach(s => {
    if (s.deliveryStatus !== "delivered") return;
    totalRevenue += Number(s.totalAmount || 0);
    totalProfit  += Number(s.totalProfit || 0);
  });

  const creditOutstanding = allCredit.reduce((sum, c) => sum + (c.balance || 0), 0);
  const vendorPayable     = allVendors.reduce((sum, v) => sum + (v.remaining || 0), 0);
  const stockValue        = allInventory.reduce((sum, i) => sum + (Number(i.qty || 0) * Number(i.weightedAvgCost || 0)), 0);

  document.getElementById("cashAtHand").textContent       = fmt(cashAtHand);
  document.getElementById("totalRevenue").textContent     = fmt(totalRevenue);
  document.getElementById("totalProfit").textContent      = fmt(totalProfit);
  document.getElementById("creditOutstanding").textContent = fmt(creditOutstanding);
  document.getElementById("vendorPayable").textContent    = fmt(vendorPayable);
  document.getElementById("stockValue").textContent       = fmt(stockValue);
}

/* ---------- POPULATE P&L FILTERS ---------- */
function populatePLFilters() {
  const months = new Set();
  const years  = new Set();
  allSales.forEach(s => {
    if (s.date) { months.add(s.date.substring(0, 7)); years.add(s.date.substring(0, 4)); }
  });

  document.getElementById("plMonth").innerHTML = `<option value="">All Months</option>` +
    [...months].sort().reverse().map(m => `<option value="${m}">${m}</option>`).join("");

  document.getElementById("plYear").innerHTML = `<option value="">All Years</option>` +
    [...years].sort().reverse().map(y => `<option value="${y}">${y}</option>`).join("");
}

/* ---------- GET FILTERED SALES ---------- */
function getFilteredSales() {
  const filter   = document.getElementById("plFilter").value;
  const month    = document.getElementById("plMonth").value;
  const year     = document.getElementById("plYear").value;
  const todayStr = today();
  const now      = new Date();

  return allSales.filter(s => {
    if (s.deliveryStatus !== "delivered" || !s.date) return false;
    if (month && !s.date.startsWith(month)) return false;
    if (year  && !s.date.startsWith(year))  return false;
    if (filter === "today") return s.date === todayStr;
    if (filter === "week")  return (now - new Date(s.date)) / 86400000 <= 7;
    if (filter === "month") return s.date.startsWith(todayStr.substring(0, 7));
    if (filter === "year")  return s.date.startsWith(todayStr.substring(0, 4));
    return true;
  });
}

/* ---------- UPDATE P&L ---------- */
window.applyPLFilter = () => updatePL();

function updatePL() {
  const filtered  = getFilteredSales();
  const filter    = document.getElementById("plFilter").value;
  const month     = document.getElementById("plMonth").value;
  const year      = document.getElementById("plYear").value;
  const todayStr  = today();

  let revenue = 0, grossProfit = 0;
  filtered.forEach(s => {
    revenue      += Number(s.totalAmount || 0);
    grossProfit  += Number(s.totalProfit || 0);
  });
  const cogs = revenue - grossProfit;

  let expenses = 0;
  allExpenses.forEach(e => {
    if (!e.date) return;
    if (month  && !e.date.startsWith(month))                     return;
    if (year   && !e.date.startsWith(year))                      return;
    if (filter === "today" && e.date !== todayStr)               return;
    if (filter === "month" && !e.date.startsWith(todayStr.substring(0, 7))) return;
    if (filter === "year"  && !e.date.startsWith(todayStr.substring(0, 4))) return;
    expenses += Number(e.amount || 0);
  });

  const netProfit = grossProfit - expenses;

  document.getElementById("plRevenue").textContent     = fmt(revenue);
  document.getElementById("plCOGS").textContent        = fmt(cogs);
  document.getElementById("plGrossProfit").textContent = fmt(grossProfit);
  document.getElementById("plExpenses").textContent    = fmt(expenses);
  document.getElementById("plNetProfit").textContent   = fmt(netProfit);
  document.getElementById("plNetProfit").style.color   = netProfit >= 0 ? "var(--accent)" : "var(--danger)";
}

/* ---------- UPDATE CHARTS ---------- */
function updateCharts() {
  const monthMap = {};
  allSales.forEach(s => {
    if (s.deliveryStatus !== "delivered" || !s.date) return;
    const m = s.date.substring(0, 7);
    if (!monthMap[m]) monthMap[m] = { revenue: 0, profit: 0 };
    monthMap[m].revenue += Number(s.totalAmount || 0);
    monthMap[m].profit  += Number(s.totalProfit || 0);
  });

  const months  = Object.keys(monthMap).sort().slice(-6);
  const rCtx    = document.getElementById("revenueChart").getContext("2d");
  if (revenueChart) revenueChart.destroy();
  revenueChart = new Chart(rCtx, {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        { label: "Revenue", data: months.map(m => monthMap[m].revenue), backgroundColor: "rgba(91,142,240,0.7)", borderRadius: 4 },
        { label: "Profit",  data: months.map(m => monthMap[m].profit),  backgroundColor: "rgba(52,201,138,0.7)", borderRadius: 4 }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } }
  });

  let cash = 0, upi = 0, credit = 0;
  allSales.forEach(s => {
    if (s.deliveryStatus !== "delivered") return;
    if (s.paymentMode === "cash")   cash   += Number(s.totalAmount || 0);
    if (s.paymentMode === "upi")    upi    += Number(s.totalAmount || 0);
    if (s.paymentMode === "credit") credit += Number(s.totalAmount || 0);
  });

  const pCtx = document.getElementById("paymentChart").getContext("2d");
  if (paymentChart) paymentChart.destroy();
  paymentChart = new Chart(pCtx, {
    type: "doughnut",
    data: {
      labels: ["Cash", "UPI", "Credit"],
      datasets: [{ data: [cash, upi, credit], backgroundColor: ["#34c98a", "#5b8ef0", "#f97066"], borderWidth: 0 }]
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } }
  });
}

/* ---------- SMART SUMMARY ---------- */
function updateSmartSummary() {
  // Top customers
  const custMap = {};
  allSales.forEach(s => {
    if (s.deliveryStatus !== "delivered" || !s.customer) return;
    custMap[s.customer] = (custMap[s.customer] || 0) + Number(s.totalAmount || 0);
  });
  const topCust = Object.entries(custMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
  document.getElementById("topCustomers").innerHTML = topCust.length === 0
    ? `<p style="font-size:13px;color:var(--text-muted);">No data yet</p>`
    : topCust.map(([n, a], i) => `<div class="top-item"><span class="top-item-name">${i+1}. ${n}</span><span class="top-item-value">${fmt(a)}</span></div>`).join("");

  // Top products
  const prodMap = {};
  allSales.forEach(s => {
    if (s.deliveryStatus !== "delivered" || !Array.isArray(s.items)) return;
    s.items.forEach(item => {
      prodMap[item.product] = (prodMap[item.product] || 0) + Number(item.price || 0);
    });
  });
  const topProd = Object.entries(prodMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
  document.getElementById("topProducts").innerHTML = topProd.length === 0
    ? `<p style="font-size:13px;color:var(--text-muted);">No data yet</p>`
    : topProd.map(([n, a], i) => `<div class="top-item"><span class="top-item-name">${i+1}. ${n}</span><span class="top-item-value">${fmt(a)}</span></div>`).join("");

  // Best month
  const monthMap = {};
  allSales.forEach(s => {
    if (s.deliveryStatus !== "delivered" || !s.date) return;
    const m = s.date.substring(0, 7);
    monthMap[m] = (monthMap[m] || 0) + Number(s.totalAmount || 0);
  });
  const best = Object.entries(monthMap).sort((a, b) => b[1] - a[1])[0];
  document.getElementById("bestMonth").innerHTML = best
    ? `<div class="top-item"><span class="top-item-name">${best[0]}</span><span class="top-item-value">${fmt(best[1])}</span></div>`
    : `<p style="font-size:13px;color:var(--text-muted);">No data yet</p>`;

  // Credit risk
  const overdue = allCredit.filter(c => {
    if (!c.balance || c.balance <= 0) return false;
    if (!c.lastActivityDate) return true;
    return Math.floor((new Date() - new Date(c.lastActivityDate)) / 86400000) >= 30;
  });
  document.getElementById("creditRisk").innerHTML = overdue.length === 0
    ? `<p style="font-size:13px;color:var(--accent);">✓ No overdue credit</p>`
    : overdue.map(c => `<div class="top-item"><span class="top-item-name">${c.name}</span><span class="top-item-value" style="color:var(--danger)">${fmt(c.balance)}</span></div>`).join("");
}

/* ---------- ADD EXPENSE ---------- */
window.addExpense = async () => {
  const amount   = Number(document.getElementById("expAmount").value);
  const category = document.getElementById("expCategory").value;
  const date     = document.getElementById("expDate").value;
  const note     = document.getElementById("expNote").value.trim();

  if (!amount || amount <= 0 || !date) { showExpMsg("Please fill amount and date.", "error"); return; }

  await addDoc(userCol("expenses"), { amount, category, date, note: note || category });
  document.getElementById("expAmount").value = "";
  document.getElementById("expNote").value   = "";
  showExpMsg("✓ Expense added");
};

/* ---------- CASH ADJUSTMENTS ---------- */
window.saveCashAdjustment = async () => {
  const type = document.getElementById("cashAdjustmentType").value;
  const amount = Number(document.getElementById("cashAdjustmentAmount").value);
  const date = document.getElementById("cashAdjustmentDate").value || today();
  const note = document.getElementById("cashAdjustmentNote").value.trim();
  const msg = document.getElementById("cashAdjustmentMsg");

  if (!amount && type !== "set") {
    msg.textContent = "Enter a valid amount.";
    msg.style.color = "var(--danger)";
    return;
  }
  if (amount < 0) {
    msg.textContent = "Amount cannot be negative.";
    msg.style.color = "var(--danger)";
    return;
  }

  if (type === "set") {
    const currentCash = calculateCashAtHand();
    const diff = amount - currentCash;
    await addDoc(userCol("cashAdjustments"), {
      type: diff >= 0 ? "add" : "subtract",
      amount: Math.abs(diff),
      date,
      note: note || `Cash set to ${fmt(amount)}`,
      targetCash: amount
    });
  } else {
    await addDoc(userCol("cashAdjustments"), {
      type,
      amount,
      date,
      note: note || (type === "add" ? "Cash added" : "Cash subtracted")
    });
  }

  document.getElementById("cashAdjustmentAmount").value = "";
  document.getElementById("cashAdjustmentNote").value = "";
  msg.textContent = "✓ Cash updated";
  msg.style.color = "var(--accent)";
  setTimeout(() => msg.textContent = "", 2500);
};

function calculateCashAtHand() {
  let cashIn = openingBalance;
  let cashOut = 0;

  allSales.forEach(s => {
    if (s.deliveryStatus !== "delivered") return;
    if (s.paymentMode === "cash" || s.paymentMode === "upi") cashIn += Number(s.totalAmount || 0);
    else if (s.paymentMode === "credit") cashIn += Number(s.amountPaid || 0);
  });
  allCredit.forEach(c => { cashIn += Number(c.totalPaid || 0); });
  allVendors.forEach(v => { cashOut += Number(v.amountPaid || 0); });
  allExpenses.forEach(e => { cashOut += Number(e.amount || 0); });
  allCashAdjustments.forEach(entry => {
    const amount = Number(entry.amount || 0);
    if (entry.type === "add") cashIn += amount;
    else if (entry.type === "subtract" || entry.type === "inventory_purchase") cashOut += amount;
  });
  return cashIn - cashOut;
}

function renderCashAdjustments() {
  const tbody = document.getElementById("cashAdjustmentTable");
  if (!tbody) return;
  const rows = allCashAdjustments.slice(0, 10);
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px;">No cash adjustments yet</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(entry => {
    const outgoing = entry.type === "subtract" || entry.type === "inventory_purchase";
    const label = entry.type === "inventory_purchase" ? "Inventory purchase" : entry.type;
    return `
      <tr>
        <td>${entry.date || ""}</td>
        <td style="text-transform:capitalize">${label}</td>
        <td style="color:var(--text-secondary)">${entry.note || "—"}</td>
        <td style="font-family:var(--font-mono);color:${outgoing ? "var(--danger)" : "var(--accent)"};">${outgoing ? "-" : "+"}${fmt(entry.amount || 0)}</td>
      </tr>
    `;
  }).join("");
}

/* ---------- RENDER EXPENSES ---------- */
function renderExpenses() {
  const tbody = document.getElementById("expenseTable");
  if (allExpenses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">No expenses yet</td></tr>`;
    return;
  }
  tbody.innerHTML = allExpenses.map(e => `
    <tr>
      <td>${e.date || ""}</td>
      <td>${e.category || ""}</td>
      <td style="color:var(--text-secondary)">${e.note || "—"}</td>
      <td style="font-family:var(--font-mono);color:var(--danger);">${fmt(e.amount || 0)}</td>
      <td><button onclick="deleteExpense('${e.id}')" style="font-size:12px;height:26px;padding:0 8px;background:var(--danger-light);color:var(--danger);border:1.5px solid #f5c6c2;border-radius:4px;cursor:pointer;">Delete</button></td>
    </tr>`).join("");
}

/* ---------- DELETE EXPENSE ---------- */
window.deleteExpense = async (id) => {
  if (!confirm("Delete this expense?")) return;
  await deleteDoc(userDoc("expenses", id));
};

/* ---------- RENDER VENDORS ---------- */
function renderVendors() {
  const grid = document.getElementById("vendorGrid");
  if (allVendors.length === 0) {
    grid.innerHTML = `<p style="font-size:13px;color:var(--text-muted);grid-column:1/-1;">No vendor records yet. Add stock with vendor details in Inventory.</p>`;
    return;
  }

  const vendorMap = {};
  allVendors.forEach(v => {
    const key = (v.vendorPhone || v.vendorName || "unknown").toLowerCase();
    if (!vendorMap[key]) vendorMap[key] = { name: v.vendorName || "Unknown", phone: v.vendorPhone || "", totalCost: 0, amountPaid: 0, remaining: 0, ids: [] };
    vendorMap[key].totalCost  += Number(v.totalCost  || 0);
    vendorMap[key].amountPaid += Number(v.amountPaid || 0);
    vendorMap[key].remaining  += Number(v.remaining  || 0);
    vendorMap[key].ids.push(v.id);
  });

  grid.innerHTML = "";
  Object.values(vendorMap).sort((a, b) => b.remaining - a.remaining).forEach(v => {
    const isPaid = v.remaining <= 0;
    const card   = document.createElement("div");
    card.className = `vendor-card ${isPaid ? "paid" : "has-due"}`;
    card.innerHTML = `
      <div class="vendor-name">${v.name}</div>
      <div class="vendor-phone">${v.phone ? "📞 " + v.phone : "—"}</div>
      <div class="vendor-row"><span>Total Cost</span><span>${fmt(v.totalCost)}</span></div>
      <div class="vendor-row"><span>Amount Paid</span><span>${fmt(v.amountPaid)}</span></div>
      <div class="vendor-due ${isPaid ? "green" : "red"}">
        <span class="vendor-due-label">${isPaid ? "✓ Paid" : "Due"}</span>
        <span class="vendor-due-amount">${fmt(v.remaining)}</span>
      </div>
      ${!isPaid ? `<div class="vendor-actions"><button class="btn-pay-vendor" onclick="openVendorPayModal('${v.ids.join(",")}', '${v.name}', ${v.remaining})">💰 Pay</button></div>` : ""}
    `;
    grid.appendChild(card);
  });
}

/* ---------- VENDOR PAY MODAL ---------- */
window.openVendorPayModal = (ids, name, remaining) => {
  payingVendorId = ids;
  document.getElementById("vendorPayInfo").textContent  = `${name} — Due: ${fmt(remaining)}`;
  document.getElementById("vendorPayAmount").value      = "";
  document.getElementById("vendorPayNote").value        = "";
  document.getElementById("vendorPayDate").value        = today();
  document.getElementById("vendorPayMsg").textContent   = "";
  document.getElementById("vendorPayModal").classList.remove("hidden");
};

window.closeVendorPayModal = () => {
  payingVendorId = null;
  document.getElementById("vendorPayModal").classList.add("hidden");
};

window.saveVendorPayment = async () => {
  const amount = Number(document.getElementById("vendorPayAmount").value);
  const date   = document.getElementById("vendorPayDate").value;
  if (!amount || amount <= 0) { document.getElementById("vendorPayMsg").textContent = "Please enter a valid amount."; return; }

  const ids = payingVendorId.split(",");
  let remaining = amount;

  for (const id of ids) {
    if (remaining <= 0) break;
    const vSnap = await getDoc(userDoc("vendorPayments", id));
    if (!vSnap.exists()) continue;
    const v      = vSnap.data();
    const due    = Number(v.remaining || 0);
    const paying = Math.min(due, remaining);
    remaining   -= paying;
    await updateDoc(userDoc("vendorPayments", id), {
      amountPaid: (Number(v.amountPaid || 0)) + paying,
      remaining:  Math.max(0, due - paying),
      status:     due - paying <= 0 ? "paid" : "partial"
    });
  }

  closeVendorPayModal();
  showExpMsg("✓ Vendor payment saved");
};

/* ---------- MSG ---------- */
function showExpMsg(text, type = "success") {
  const el = document.getElementById("expMsg");
  el.style.color = type === "error" ? "var(--danger)" : "var(--accent)";
  el.textContent = text;
  setTimeout(() => el.textContent = "", 3000);
}
