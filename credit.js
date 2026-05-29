import { db, auth } from "./firebase.js";
import {
  collection, addDoc, onSnapshot,
  doc, updateDoc, deleteDoc, getDoc,
  query, orderBy, getDocs, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { attachSuggestionDropdown } from "./item-suggestions.js";

/* ---------- STATE ---------- */
let currentUserId  = null;
let creditMap      = {};   // creditId → credit doc
let knownCustomers = [];
let currentFilter  = "all";
let currentView    = "card";
let payingCreditId = null;
let editingCreditId = null;

/* ---------- HELPERS ---------- */
function userCol(colName) {
  return collection(db, "users", currentUserId, colName);
}

function userDoc(colName, docId) {
  return doc(db, "users", currentUserId, colName, docId);
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function normalizeName(name = "") {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePhone(phone = "") {
  return phone.trim();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function sameCustomer(record, customer, phone) {
  const recordPhone = normalizePhone(record.phone);
  const wantedPhone = normalizePhone(phone);
  if (recordPhone && wantedPhone && recordPhone === wantedPhone) return true;
  return normalizeName(record.name || record.customer) === normalizeName(customer);
}

async function findCreditByCustomer(userId, customer, phone) {
  const snap = await getDocs(collection(db, "users", userId, "credit"));
  let existing = null;

  snap.forEach(d => {
    const c = d.data();
    if (!existing && sameCustomer(c, customer, phone)) existing = { id: d.id, ...c };
  });

  return existing;
}

function getOriginalCreditAmount(sale) {
  if (sale.originalCreditAmount !== undefined) return Number(sale.originalCreditAmount || 0);
  if (sale.paymentMode !== "credit") return 0;
  return Math.max(0, Number(sale.totalAmount || 0) - Number(sale.amountPaid || 0));
}

async function hasRecordedCreditFromSale(userId, sale) {
  if (sale.creditApplied === true) return true;
  if (!sale.orderNumber) return false;

  const credit = await findCreditByCustomer(userId, sale.customer, sale.phone);
  if (!credit) return false;

  const snap = await getDocs(
    query(
      collection(db, "users", userId, "creditHistory"),
      where("creditId", "==", credit.id)
    )
  );
  let recorded = false;
  snap.forEach(d => {
    const history = d.data();
    if (history.type === "credit" && history.orderNumber === sale.orderNumber) recorded = true;
  });
  return recorded;
}

export async function applyCreditPaymentToSales({ userId, customer, phone, amount }) {
  if (!userId || !amount || amount <= 0) return [];

  const salesCol = collection(db, "users", userId, "sales");
  const snap = await getDocs(salesCol);
  const creditSales = [];

  snap.forEach(d => {
    const s = d.data();
    if (
      s.paymentMode === "credit" &&
      s.deliveryStatus === "delivered" &&
      Number(s.creditAmount || 0) > 0 &&
      sameCustomer(s, customer, phone)
    ) {
      creditSales.push({ id: d.id, ...s });
    }
  });

  creditSales.sort((a, b) =>
    (a.date || "").localeCompare(b.date || "") ||
    (a.orderNumber || "").localeCompare(b.orderNumber || "")
  );

  let remaining = amount;
  const allocations = [];

  for (const sale of creditSales) {
    if (remaining <= 0) break;

    const oldCredit = Number(sale.creditAmount || 0);
    const paidHere = Math.min(oldCredit, remaining);
    const newCredit = Math.max(0, oldCredit - paidHere);

    await updateDoc(doc(db, "users", userId, "sales", sale.id), {
      creditAmount: newCredit
    });

    allocations.push({
      saleId: sale.id,
      orderNumber: sale.orderNumber || "",
      paid: paidHere,
      creditAfter: newCredit
    });

    remaining -= paidHere;
  }

  return allocations;
}

export async function updateSaleCreditBalance({ userId, saleId, newCreditAmount, date = today(), note = "Credit adjusted from order" }) {
  if (!userId || !saleId) return null;

  const saleRef = doc(db, "users", userId, "sales", saleId);
  const saleSnap = await getDoc(saleRef);
  if (!saleSnap.exists()) return null;

  const sale = saleSnap.data();
  const oldCreditAmount = Number(sale.creditAmount || 0);
  const nextCreditAmount = Math.max(0, Number(newCreditAmount || 0));
  const delta = oldCreditAmount - nextCreditAmount;

  await updateDoc(saleRef, { creditAmount: nextCreditAmount });

  const credit = await findCreditByCustomer(userId, sale.customer, sale.phone);
  if (credit) {
    const nextBalance = Math.max(0, Number(credit.balance || 0) - delta);
    const nextPaid = Math.max(0, Number(credit.totalPaid || 0) + delta);
    await updateDoc(doc(db, "users", userId, "credit", credit.id), {
      balance: nextBalance,
      totalPaid: nextPaid,
      lastActivityDate: date,
      status: nextBalance <= 0 ? "cleared" : "active"
    });

    await addDoc(collection(db, "users", userId, "creditHistory"), {
      creditId: credit.id,
      customerName: credit.name || sale.customer,
      type: delta >= 0 ? "payment" : "credit",
      amount: Math.abs(delta),
      date,
      orderNumber: sale.orderNumber || "",
      note,
      balanceAfter: nextBalance
    });
  }

  return { oldCreditAmount, newCreditAmount: nextCreditAmount, delta };
}

export async function reverseCreditForSale({ userId, sale, preservePaid = false }) {
  if (!userId || !sale || sale.paymentMode !== "credit") return;
  if (!(await hasRecordedCreditFromSale(userId, sale))) return;

  const currentCreditAmount = Number(sale.creditAmount || 0);
  const originalCreditAmount = getOriginalCreditAmount(sale);
  const paidCreditAmount = Math.max(0, originalCreditAmount - currentCreditAmount);
  const initialPaymentAmount = Number(sale.initialCreditPayment || 0);

  await reverseCreditFromSale({
    userId,
    customer: sale.customer,
    phone: sale.phone,
    creditAmount: currentCreditAmount,
    originalCreditAmount,
    paidCreditAmount: preservePaid ? initialPaymentAmount : paidCreditAmount,
    orderNumber: sale.orderNumber
  });
}

function loadCredit() {
  onSnapshot(
    query(userCol("credit"), orderBy("name")),
    snap => {
      creditMap = {};
      snap.forEach(d => {
        creditMap[d.id] = { id: d.id, ...d.data() };
      });
      renderCredit();
      renderCreditSuggestions();
      updateSummary();
    },
    error => {
      console.error("Firestore error:", error.code, error.message);
    }
  );
}

/* ---------- AUTH GATE ---------- */
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUserId = user.uid;
  const payDateEl = document.getElementById("payDate");
if (payDateEl) payDateEl.value = today();
  bindCreditAutofill();
  loadCredit();
  loadKnownCustomers();
});

async function loadKnownCustomers() {
  try {
    const [salesSnap, nestedCustomersSnap, publicCustomersSnap] = await Promise.all([
      getDocs(userCol("sales")),
      getDocs(userCol("customers")),
      getDocs(collection(db, "customers"))
    ]);
    const map = new Map();
    const addCustomer = (data = {}) => {
      const name = data.customer || data.customerName || data.name || "";
      const phone = data.phone || data.customerPhone || "";
      const address = data.address || data.customerAddress || "";
      const key = normalizePhone(phone) || normalizeName(name);
      if (!key || map.has(key)) return;
      map.set(key, { name, phone, address });
    };
    salesSnap.forEach(d => {
      const sale = d.data();
      addCustomer(sale);
    });
    nestedCustomersSnap.forEach(d => addCustomer(d.data()));
    publicCustomersSnap.forEach(d => addCustomer(d.data()));
    knownCustomers = [...map.values()];
    renderCreditSuggestions();
  } catch (error) {
    console.warn("Customer suggestions failed:", error);
  }
}



/* ---------- RENDER CREDIT CARDS ---------- */
function renderCredit() {
  const grid = document.getElementById("creditGrid");
  if (!grid) return;
  const entries = Object.values(creditMap);

  // filter
  const filtered = entries.filter(c => {
    if (currentFilter === "all")     return true;
    if (currentFilter === "cleared") return c.balance <= 0;
    if (currentFilter === "overdue") return getStatus(c) === "overdue";
    if (currentFilter === "active")  return c.balance > 0 && getStatus(c) !== "overdue";
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-credit" style="grid-column:1/-1;">
        <div style="font-size:32px;">💳</div>
        <p>${currentFilter === "all" ? "No credit entries yet." : "No " + currentFilter + " entries."}</p>
        ${currentFilter === "all" ? '<p style="font-size:12px;margin-top:4px;">Credit sales from Orders will appear here automatically.</p>' : ""}
      </div>`;
    renderCreditList(filtered);
    applyCreditView();
    return;
  }

  grid.innerHTML = "";

  const sorted = filtered.sort((a, b) => (b.balance || 0) - (a.balance || 0));

  sorted
    .forEach(c => {
      const status    = getStatus(c);
      const balClass  = c.balance <= 0 ? "green" : status === "overdue" ? "red" : "amber";
      const badgeClass = status === "cleared" ? "badge-cleared" : status === "overdue" ? "badge-overdue" : "badge-active";
      const badgeText  = status === "cleared" ? "✓ Cleared" : status === "overdue" ? "⚠ Overdue" : "● Active";
      const cardClass  = status === "cleared" ? "status-cleared" : status === "overdue" ? "status-overdue" : "status-active";

      const card = document.createElement("div");
      card.className = `credit-card ${cardClass}`;
      card.innerHTML = `
        <div class="credit-card-name">${c.name || "—"}</div>
        <div class="credit-card-phone">${c.phone ? "📞 " + c.phone : "📵 No phone"}</div>

        <div class="credit-card-row">
          <span>Total Credit</span>
          <span>₹${Math.round(c.totalCredit || 0).toLocaleString("en-IN")}</span>
        </div>
        <div class="credit-card-row">
          <span>Total Paid</span>
          <span>₹${Math.round(c.totalPaid || 0).toLocaleString("en-IN")}</span>
        </div>

        <div class="credit-balance ${balClass}">
          <span class="credit-balance-label">Balance Due</span>
          <span class="credit-balance-amount">₹${Math.round(c.balance || 0).toLocaleString("en-IN")}</span>
        </div>

        <span class="credit-status-badge ${badgeClass}">${badgeText}</span>

        ${c.lastOrderNumber ? `<div class="last-order">Last order: ${c.lastOrderNumber} on ${c.lastOrderDate || ""}</div>` : ""}

        <div class="reminder-row">
          <span>Auto reminder:</span>
          <select onchange="updateReminder('${c.id}', this.value)">
            <option value="off"  ${(c.autoReminder || "off") === "off"  ? "selected" : ""}>Off</option>
            <option value="7"    ${(c.autoReminder || "off") === "7"    ? "selected" : ""}>7 days</option>
            <option value="15"   ${(c.autoReminder || "off") === "15"   ? "selected" : ""}>15 days</option>
            <option value="30"   ${(c.autoReminder || "off") === "30"   ? "selected" : ""}>30 days</option>
          </select>
        </div>

        <div class="credit-card-actions">
          ${c.balance > 0 ? `<button class="btn-pay" onclick="openPayModal('${c.id}')">💰 Pay</button>` : ""}
          <button class="btn-history" onclick="openHistoryModal('${c.id}')">📋 History</button>
          <button class="btn-edit-c" onclick="openEditCustomerModal('${c.id}')">Edit</button>
          <button class="btn-delete-c" onclick="deleteCredit('${c.id}')">Delete</button>
        </div>
      `;
      grid.appendChild(card);
    });

  renderCreditList(sorted);
  applyCreditView();
}

function renderCreditList(entries) {
  const list = document.getElementById("creditList");
  if (!list) return;

  if (entries.length === 0) {
    list.innerHTML = `
      <div class="empty-credit">
        <div style="font-size:32px;">Credit</div>
        <p>${currentFilter === "all" ? "No credit entries yet." : "No " + currentFilter + " entries."}</p>
      </div>`;
    return;
  }

  list.innerHTML = `
    <div class="credit-list-header">
      <div>Customer</div>
      <div>Phone</div>
      <div>Total</div>
      <div>Paid</div>
      <div>Balance</div>
      <div>Actions</div>
    </div>
    ${entries.map(c => {
      const status = getStatus(c);
      const balClass = c.balance <= 0 ? "green" : status === "overdue" ? "red" : "amber";
      return `
        <div class="credit-list-row">
          <div><strong>${c.name || "-"}</strong></div>
          <div style="font-family:var(--font-mono);color:var(--text-muted);">${c.phone || "No phone"}</div>
          <div style="font-family:var(--font-mono)">&#8377;${Math.round(c.totalCredit || 0).toLocaleString("en-IN")}</div>
          <div style="font-family:var(--font-mono)">&#8377;${Math.round(c.totalPaid || 0).toLocaleString("en-IN")}</div>
          <div class="${balClass}" style="font-family:var(--font-mono);font-weight:600;">&#8377;${Math.round(c.balance || 0).toLocaleString("en-IN")}</div>
          <div class="credit-list-actions">
            ${c.balance > 0 ? `<button class="btn-pay" onclick="openPayModal('${c.id}')">Pay</button>` : ""}
            <button class="btn-history" onclick="openHistoryModal('${c.id}')">History</button>
            <button class="btn-edit-c" onclick="openEditCustomerModal('${c.id}')">Edit</button>
            <button class="btn-delete-c" onclick="deleteCredit('${c.id}')">Delete</button>
          </div>
        </div>`;
    }).join("")}
  `;
}

function applyCreditView() {
  const grid = document.getElementById("creditGrid");
  const list = document.getElementById("creditList");
  if (grid) grid.style.display = currentView === "card" ? "grid" : "none";
  if (list) list.classList.toggle("active", currentView === "list");
  document.getElementById("creditCardViewBtn")?.classList.toggle("active", currentView === "card");
  document.getElementById("creditListViewBtn")?.classList.toggle("active", currentView === "list");
}

/* ---------- GET STATUS ---------- */
function getStatus(c) {
  if (!c.balance || c.balance <= 0) return "cleared";

  if (c.lastActivityDate) {
    const daysSince = Math.floor(
      (new Date() - new Date(c.lastActivityDate)) / (1000 * 60 * 60 * 24)
    );
    if (daysSince >= 30) return "overdue";
  }

  return "active";
}

/* ---------- UPDATE SUMMARY ---------- */
function updateSummary() {
  if (!document.getElementById("summaryOutstanding")) return;
  
  const entries = Object.values(creditMap);
  const totalOutstanding = entries.reduce((s, c) => s + (c.balance || 0), 0);
  const totalCollected   = entries.reduce((s, c) => s + (c.totalPaid || 0), 0);

  document.getElementById("summaryOutstanding").textContent = "₹" + Math.round(totalOutstanding).toLocaleString("en-IN");
  document.getElementById("summaryCollected").textContent   = "₹" + Math.round(totalCollected).toLocaleString("en-IN");
  document.getElementById("summaryCustomers").textContent   = entries.length;
}

/* ---------- ADD CREDIT MANUALLY ---------- */
window.openAddCreditModal = () => {
  document.getElementById("addCreditName").value   = "";
  document.getElementById("addCreditPhone").value  = "";
  document.getElementById("addCreditAmount").value = "";
  document.getElementById("addCreditDate").value   = today();
  document.getElementById("addCreditNote").value   = "";
  document.getElementById("addCreditMsg").textContent = "";
  document.getElementById("addCreditModal").classList.remove("hidden");
  renderCreditSuggestions();
};

function renderCreditSuggestions() {
  const nameList = document.getElementById("creditCustomerNames");
  const phoneList = document.getElementById("creditCustomerPhones");
  if (!nameList || !phoneList) return;
  const entries = [...Object.values(creditMap), ...knownCustomers];
  nameList.innerHTML = entries
    .map(c => c.name || c.customer || "")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map(name => `<option value="${escapeHtml(name)}"></option>`)
    .join("");
  phoneList.innerHTML = entries
    .map(c => c.phone || "")
    .filter(Boolean)
    .sort()
    .map(phone => `<option value="${escapeHtml(phone)}"></option>`)
    .join("");
  attachSuggestionDropdown(document.getElementById("addCreditName"), () => entries.map(c => c.name || c.customer || "").filter(Boolean), applyCreditMatch);
  attachSuggestionDropdown(document.getElementById("addCreditPhone"), () => entries.map(c => c.phone || "").filter(Boolean), applyCreditMatch);
}

function applyCreditMatch() {
  const nameInput = document.getElementById("addCreditName");
  const phoneInput = document.getElementById("addCreditPhone");
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const match = [...Object.values(creditMap), ...knownCustomers].find(c =>
    (phone && normalizePhone(c.phone) === normalizePhone(phone)) ||
    (name && normalizeName(c.name || c.customer) === normalizeName(name))
  );
  if (!match) return;
  nameInput.value = match.name || match.customer || nameInput.value;
  phoneInput.value = match.phone || phoneInput.value;
}

function bindCreditAutofill() {
  const nameInput = document.getElementById("addCreditName");
  const phoneInput = document.getElementById("addCreditPhone");
  if (!nameInput || !phoneInput || nameInput.dataset.autofillBound) return;
  nameInput.dataset.autofillBound = "1";

  const applyMatch = () => {
    applyCreditMatch();
  };

  nameInput.addEventListener("change", applyMatch);
  nameInput.addEventListener("blur", applyMatch);
  phoneInput.addEventListener("change", applyMatch);
  phoneInput.addEventListener("blur", applyMatch);
}

window.closeAddCreditModal = () => {
  document.getElementById("addCreditModal").classList.add("hidden");
};

window.saveManualCredit = async () => {
  const name   = document.getElementById("addCreditName").value.trim();
  const phone  = document.getElementById("addCreditPhone").value.trim();
  const amount = Number(document.getElementById("addCreditAmount").value);
  const date   = document.getElementById("addCreditDate").value;
  const note   = document.getElementById("addCreditNote").value.trim();

  if (!name) { document.getElementById("addCreditMsg").textContent = "Customer name is required."; return; }
  if (!amount || amount <= 0) { document.getElementById("addCreditMsg").textContent = "Please enter a valid amount."; return; }
  if (!date) { document.getElementById("addCreditMsg").textContent = "Please select a date."; return; }

  const snap = await getDocs(userCol("credit"));
  let existing = null;

  snap.forEach(d => {
    const c = d.data();
    if (phone && c.phone === phone) existing = { id: d.id, ...c };
    else if (c.name?.toLowerCase() === name.toLowerCase()) existing = { id: d.id, ...c };
  });

  if (existing) {
    const newTotal   = (existing.totalCredit || 0) + amount;
    const newBalance = (existing.balance     || 0) + amount;
    await updateDoc(userDoc("credit", existing.id), {
      totalCredit: newTotal, balance: newBalance,
      lastActivityDate: date, status: "active",
      name: existing.name || name,
      phone: existing.phone || phone || ""
    });
    await addDoc(userCol("creditHistory"), {
      creditId: existing.id, customerName: existing.name,
      type: "credit", amount, date,
      note: note || "Manual credit entry", balanceAfter: newBalance
    });
    closeAddCreditModal();
    showToast(`✓ ₹${amount.toLocaleString("en-IN")} credit added to ${existing.name}`);
  } else {
    const newDoc = await addDoc(userCol("credit"), {
      name, phone: phone || "", totalCredit: amount,
      totalPaid: 0, balance: amount,
      lastActivityDate: date, autoReminder: "off",
      status: "active", createdAt: date
    });
    await addDoc(userCol("creditHistory"), {
      creditId: newDoc.id, customerName: name,
      type: "credit", amount, date,
      note: note || "Manual credit entry", balanceAfter: amount
    });
    closeAddCreditModal();
    showToast(`✓ Credit entry created for ${name} — ₹${amount.toLocaleString("en-IN")}`);
  }
};


/* ---------- FILTER ---------- */
window.setFilter = (filter, btn) => {
  currentFilter = filter;
  document.querySelectorAll(".status-filter").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderCredit();
};

window.setCreditView = (view) => {
  currentView = view;
  applyCreditView();
};

/* ---------- PAY MODAL ---------- */
window.openPayModal = (creditId) => {
  payingCreditId = creditId;
  const c = creditMap[creditId];
  document.getElementById("payModalCustomer").textContent =
    `${c.name} — Balance: ₹${Math.round(c.balance).toLocaleString("en-IN")}`;
  document.getElementById("payAmount").value = "";
  document.getElementById("payNote").value   = "";
  document.getElementById("payDate").value   = today();
  document.getElementById("payMsg").textContent = "";
  document.getElementById("payModal").classList.remove("hidden");
};

window.closePayModal = () => {
  payingCreditId = null;
  document.getElementById("payModal").classList.add("hidden");
};

window.savePayment = async () => {
  const amount = Number(document.getElementById("payAmount").value);
  const date   = document.getElementById("payDate").value;
  const note   = document.getElementById("payNote").value.trim();

  if (!amount || amount <= 0) {
    document.getElementById("payMsg").textContent = "Please enter a valid amount.";
    return;
  }

  const c = creditMap[payingCreditId];

  if (amount > c.balance) {
    const confirm = window.confirm(
      `Payment ₹${amount} exceeds balance ₹${Math.round(c.balance)}. Proceed anyway?`
    );
    if (!confirm) return;
  }

  const newBalance  = Math.max(0, c.balance - amount);
  const newTotalPaid = (c.totalPaid || 0) + amount;
  const allocations = await applyCreditPaymentToSales({
    userId: currentUserId,
    customer: c.name,
    phone: c.phone,
    amount
  });

  await updateDoc(userDoc("credit", payingCreditId), {
    balance:          newBalance,
    totalPaid:        newTotalPaid,
    lastActivityDate: date,
    status:           newBalance <= 0 ? "cleared" : "active"
  });

  await addDoc(userCol("creditHistory"), {
    creditId:     payingCreditId,
    customerName: c.name,
    type:         "payment",
    amount,
    date,
    note:         note || (allocations.length
      ? `Payment received (${allocations.map(a => a.orderNumber).filter(Boolean).join(", ")})`
      : "Payment received"),
    allocations,
    balanceAfter: newBalance
  });

  closePayModal();
  showToast(`✓ ₹${amount.toLocaleString("en-IN")} received from ${c.name}`);
};

/* ---------- HISTORY MODAL ---------- */
window.openHistoryModal = async (creditId) => {
  const c = creditMap[creditId];
  document.getElementById("historyModalTitle").textContent = `${c.name} — History`;

  const snap = await getDocs(
    query(
      userCol("creditHistory"),
      where("creditId", "==", creditId),
      orderBy("date", "desc")
    )
  );

  if (snap.empty) {
    document.getElementById("historyModalContent").innerHTML =
      `<p style="font-size:13px;color:var(--text-muted);padding:16px 0;">No transactions yet.</p>`;
  } else {
    let rows = "";
    snap.forEach(d => {
      const h = d.data();
      const typeClass = h.type === "credit" ? "type-credit" : "type-payment";
      const typeLabel = h.type === "credit" ? "− Credit" : "+ Payment";
      rows += `
        <tr>
          <td>${h.date || ""}</td>
          <td class="${typeClass}">${typeLabel}</td>
          <td style="font-family:var(--font-mono)">₹${Math.round(h.amount || 0).toLocaleString("en-IN")}</td>
          <td style="font-family:var(--font-mono);color:var(--text-muted)">₹${Math.round(h.balanceAfter || 0).toLocaleString("en-IN")}</td>
          <td style="color:var(--text-muted);font-size:11px">${h.note || "—"}</td>
        </tr>
      `;
    });

    document.getElementById("historyModalContent").innerHTML = `
      <table class="history-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Balance</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  document.getElementById("historyModal").classList.remove("hidden");
};

window.closeHistoryModal = () => {
  document.getElementById("historyModal").classList.add("hidden");
};

/* ---------- EDIT CUSTOMER MODAL ---------- */
window.openEditCustomerModal = (creditId) => {
  editingCreditId = creditId;
  const c = creditMap[creditId];
  document.getElementById("editCustName").value  = c.name  || "";
  document.getElementById("editCustPhone").value = c.phone || "";
  document.getElementById("editCustMsg").textContent = "";
  document.getElementById("editCustomerModal").classList.remove("hidden");
};

window.closeEditCustomerModal = () => {
  editingCreditId = null;
  document.getElementById("editCustomerModal").classList.add("hidden");
};

window.saveEditCustomer = async () => {
  const name  = document.getElementById("editCustName").value.trim();
  const phone = document.getElementById("editCustPhone").value.trim();

  if (!name) {
    document.getElementById("editCustMsg").textContent = "Name is required.";
    return;
  }

  await updateDoc(userDoc("credit", editingCreditId), { name, phone });
  closeEditCustomerModal();
  showToast("✓ Customer updated");
};

/* ---------- DELETE CREDIT ---------- */
window.deleteCredit = async (creditId) => {
  const c = creditMap[creditId];
  if (!confirm(`Delete credit entry for ${c.name}? This cannot be undone.`)) return;
  await deleteDoc(userDoc("credit", creditId));
  showToast(`${c.name} removed from credit`);
};

/* ---------- UPDATE REMINDER ---------- */
window.updateReminder = async (creditId, value) => {
  await updateDoc(userDoc("credit", creditId), { autoReminder: value });
};

/* ---------- TOAST ---------- */
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

/* ---------- EXPORTED: create or update credit from sale ---------- */
export async function handleCreditFromSale({ userId, customer, phone, creditAmount, originalCreditAmount = null, initialPaymentAmount = 0, orderNumber, date, saleId, isEdit = false, oldCreditAmount = 0 }) {
  const creditForTotal = originalCreditAmount === null ? creditAmount : Number(originalCreditAmount || 0);
  const paidAtSale = Math.max(0, Number(initialPaymentAmount || 0));
  if (!userId || (creditAmount <= 0 && creditForTotal <= 0)) return;

  const creditCol     = collection(db, "users", userId, "credit");
  const creditHistCol = collection(db, "users", userId, "creditHistory");

  const existing = await findCreditByCustomer(userId, customer, phone);
  
  if (existing) {
    // if edit — reverse old credit first
    const prevCredit = isEdit ? oldCreditAmount : 0;
    const newTotal   = (existing.totalCredit || 0) - prevCredit + creditForTotal;
    const newBalance = (existing.balance     || 0) - prevCredit + creditAmount;
    const newTotalPaid = Number(existing.totalPaid || 0) + paidAtSale;

    await updateDoc(doc(db, "users", userId, "credit", existing.id), {
      totalCredit:      Math.max(0, newTotal),
      totalPaid:        newTotalPaid,
      balance:          Math.max(0, newBalance),
      lastOrderNumber:  orderNumber,
      lastOrderDate:    date,
      lastActivityDate: date,
      status:           newBalance <= 0 ? "cleared" : "active"
    });

    await addDoc(creditHistCol, {
      creditId:     existing.id,
      customerName: customer,
      type:         "credit",
      amount:       creditForTotal,
      date,
      orderNumber,
      note:         isEdit ? "Credit updated from edited sale" : "Credit from sale",
      balanceAfter: Math.max(0, newBalance)
    });

    if (paidAtSale > 0) {
      await addDoc(creditHistCol, {
        creditId:     existing.id,
        customerName: customer,
        type:         "payment",
        amount:       paidAtSale,
        date,
        orderNumber,
        note:         "Paid during credit sale",
        balanceAfter: Math.max(0, newBalance)
      });
    }

  } else {
    // create new
    const newDoc = await addDoc(creditCol, {
      name:             customer,
      phone:            phone || "",
      totalCredit:      creditForTotal,
      totalPaid:        paidAtSale,
      balance:          creditAmount,
      lastOrderNumber:  orderNumber,
      lastOrderDate:    date,
      lastActivityDate: date,
      autoReminder:     "off",
      status:           "active",
      createdAt:        date
    });

    await addDoc(creditHistCol, {
      creditId:     newDoc.id,
      customerName: customer,
      type:         "credit",
      amount:       creditForTotal,
      date,
      orderNumber,
      note:         "Credit from sale",
      balanceAfter: creditAmount
    });

    if (paidAtSale > 0) {
      await addDoc(creditHistCol, {
        creditId:     newDoc.id,
        customerName: customer,
        type:         "payment",
        amount:       paidAtSale,
        date,
        orderNumber,
        note:         "Paid during credit sale",
        balanceAfter: creditAmount
      });
    }
  }
}

/* ---------- EXPORTED: reverse credit when sale deleted ---------- */
export async function reverseCreditFromSale({ userId, customer, phone, creditAmount, originalCreditAmount = null, paidCreditAmount = null, orderNumber }) {
  if (!userId) return;

  const existing = await findCreditByCustomer(userId, customer, phone);

  if (!existing) return;

  const currentCredit = Number(creditAmount || 0);
  const originalCredit = originalCreditAmount === null
    ? currentCredit
    : Number(originalCreditAmount || 0);
  const paidCredit = paidCreditAmount === null
    ? Math.max(0, originalCredit - currentCredit)
    : Number(paidCreditAmount || 0);

  if (originalCredit <= 0 && currentCredit <= 0 && paidCredit <= 0) return;

  const newTotal   = Math.max(0, Number(existing.totalCredit || 0) - originalCredit);
  const newBalance = Math.max(0, Number(existing.balance     || 0) - currentCredit);
  const newPaid    = Math.max(0, Number(existing.totalPaid   || 0) - paidCredit);

  await updateDoc(doc(db, "users", userId, "credit", existing.id), {
    totalCredit: newTotal,
    totalPaid:   newPaid,
    balance:     newBalance,
    status:      newBalance <= 0 ? "cleared" : "active"
  });

  await addDoc(collection(db, "users", userId, "creditHistory"), {
    creditId:     existing.id,
    customerName: customer,
    type:         "payment",
    amount:       originalCredit,
    date:         new Date().toISOString().split("T")[0],
    orderNumber,
    note:         paidCredit > 0 ? "Reversed - sale deleted after payment" : "Reversed - sale deleted",
    balanceAfter: newBalance
  });
}
