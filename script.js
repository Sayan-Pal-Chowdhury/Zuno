import { initEditSaleModal, openEditSaleModal, updateProductCosts } from "./editSaleModal.js";
import { db, auth } from "./firebase.js";
import {
  collection, addDoc, onSnapshot,
  deleteDoc, doc, updateDoc, query,
  orderBy, where, getDocs, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { handleCreditFromSale, reverseCreditFromSale, reverseCreditForSale, updateSaleCreditBalance } from "./credit.js";
import { attachSuggestionDropdown, COMMON_ITEM_NAMES, mergeSuggestions, renderOptions } from "./item-suggestions.js";
import { calculateSellingLineTotal, normalizeSellingUnit, sellingUnitLabel } from "./unit-pricing.js";

/* ---------- STATE ---------- */
let currentUserId = null;
let productCosts  = {};
let productList   = [];
let editId        = null;
let editOriginalData = null;
let productEditId = null;
let allSales      = [];
let chart         = null;
let editingCreditSaleId = null;
let shopProfile   = null;
let productSuggestions = COMMON_ITEM_NAMES;

/* ---------- USER COLLECTION HELPER ---------- */
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

function getOriginalCreditAmount(sale) {
  if (sale?.originalCreditAmount !== undefined) return Number(sale.originalCreditAmount || 0);
  if (sale?.paymentMode !== "credit") return 0;
  return Math.max(0, Number(sale.totalAmount || 0) - Number(sale.amountPaid || 0));
}

/* ---------- AUTH GATE — everything starts here ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUserId = user.uid;
// apply form config from settings
const cachedConfig = localStorage.getItem("zunoFormConfig_" + user.uid);
if (cachedConfig) applyFormConfig(JSON.parse(cachedConfig));

// fetch fresh from Firestore
getDoc(doc(db, "users", user.uid, "settings", "formConfig")).then(configSnap => {
  if (configSnap.exists()) applyFormConfig(configSnap.data());
});
    // date persistence
const savedDate = localStorage.getItem("zunoOrderDate");
const todayDate = new Date().toISOString().split("T")[0];
const dateEl = document.getElementById("date");
if (dateEl) {
  dateEl.value = (savedDate && savedDate >= todayDate) ? savedDate : todayDate;
  dateEl.addEventListener("change", (e) => {
    localStorage.setItem("zunoOrderDate", e.target.value);
  });
}
  initEditSaleModal(currentUserId, productCosts, () => {});

  await loadShopProfile();
  refreshOrderDisplay();
  loadProducts();
  loadSales();
  loadCustomerOrders();
  initCreditUI();
});

async function loadShopProfile() {
  if (!currentUserId) return;
  const snap = await getDoc(doc(db, "users", currentUserId, "settings", "profile"));
  shopProfile = snap.exists() ? snap.data() : {};
  renderDeliveryControl();
  renderFeatureControls();
}

function renderDeliveryControl() {
  const btn = document.getElementById("deliveryToggleBtn");
  const text = document.getElementById("deliveryModeText");
  if (!btn || !text) return;

  const deliveryEnabled = shopProfile?.deliveryEnabled !== false;
  const ordersEnabled = shopProfile?.publicOrdersEnabled !== false;
  const shopBtn = document.getElementById("shopOpenToggleBtn");
  if (shopBtn) {
    shopBtn.classList.toggle("off", !ordersEnabled);
    shopBtn.querySelector("b").textContent = ordersEnabled ? "Shop" : "Closed";
  }
  btn.classList.toggle("off", !deliveryEnabled);
  btn.querySelector("b").textContent = deliveryEnabled ? "Delivery" : "Pickup";
  text.textContent = !ordersEnabled
    ? "Shop is closed for customer orders."
    : deliveryEnabled
    ? "Customers can place delivery orders."
    : "Customers can order, but they must collect packed orders from your shop.";
}

window.toggleShopOpen = async () => {
  if (!currentUserId) return;
  const next = shopProfile?.publicOrdersEnabled === false;
  const profileRef = doc(db, "users", currentUserId, "settings", "profile");
  await setDoc(profileRef, { publicOrdersEnabled: next, updatedAt: serverTimestamp() }, { merge: true });

  const profileSnap = await getDoc(profileRef);
  shopProfile = profileSnap.exists() ? profileSnap.data() : { publicOrdersEnabled: next };
  if (shopProfile.storeId) {
    await setDoc(doc(db, "storeIndex", shopProfile.storeId), {
      publicOrdersEnabled: next,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  localStorage.setItem("zunoShopProfile_" + currentUserId, JSON.stringify(shopProfile));
  renderDeliveryControl();
};

function renderFeatureControls() {
  const creditEnabled = shopProfile?.creditEnabled !== false;
  const creditOption = document.querySelector("#paymentMode option[value='credit']");
  if (creditOption) creditOption.hidden = !creditEnabled;
  if (!creditEnabled && document.getElementById("paymentMode").value === "credit") {
    document.getElementById("paymentMode").value = "cash";
    document.getElementById("creditBox").style.display = "none";
  }

  const liveOrdersSection = document.getElementById("liveOrdersSection");
  if (liveOrdersSection && shopProfile?.publicOrdersEnabled === false) {
    liveOrdersSection.innerHTML = `<div style="background:white;border:1px solid var(--border);border-radius:10px;padding:14px;color:var(--text-muted);font-size:13px;">Customer orders are disabled for this shop.</div>`;
  }
}

window.toggleDeliveryMode = async () => {
  if (!currentUserId) return;
  const next = !(shopProfile?.deliveryEnabled !== false);
  const profileRef = doc(db, "users", currentUserId, "settings", "profile");
  await setDoc(profileRef, { deliveryEnabled: next, updatedAt: serverTimestamp() }, { merge: true });

  const profileSnap = await getDoc(profileRef);
  shopProfile = profileSnap.exists() ? profileSnap.data() : { deliveryEnabled: next };
  if (shopProfile.storeId) {
    await setDoc(doc(db, "storeIndex", shopProfile.storeId), {
      deliveryEnabled: next,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  localStorage.setItem("zunoShopProfile_" + currentUserId, JSON.stringify(shopProfile));
  renderDeliveryControl();
};

/* ---------- CREDIT UI — show/hide partial payment ---------- */
function initCreditUI() {
  const paymentMode = document.getElementById("paymentMode");
  const creditBox   = document.getElementById("creditBox");

  paymentMode.addEventListener("change", () => {
    if (paymentMode.value === "credit") {
      creditBox.style.display = "flex";
    } else {
      creditBox.style.display = "none";
      document.getElementById("creditType").value    = "full";
      document.getElementById("amountPaidRow").style.display = "none";
      document.getElementById("amountPaid").value    = "";
    }
  });

  document.getElementById("creditType").addEventListener("change", (e) => {
    document.getElementById("amountPaidRow").style.display =
      e.target.value === "partial" ? "flex" : "none";
  });
}

/* ---------- ORDER NUMBER ---------- */
async function getNextOrderNumber() {
  const snap = await getDocs(userCol("sales"));
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

async function refreshOrderDisplay() {
  const next = await getNextOrderNumber();
  document.getElementById("orderDisplay").innerText = next;
}

/* ---------- MONTH FILTER ---------- */
function populateMonthFilter(data) {
  const select = document.getElementById("monthFilter");
  if (!select) return;
  const months = new Set();

  data.forEach(s => {
    if (s.date) months.add(s.date.substring(0, 7));
  });

  select.innerHTML = `<option value="all">All</option>` +
    [...months].sort().reverse().map(m => `<option value="${m}">${m}</option>`).join("");
}

/* ---------- ITEM ROW ---------- */
function createItemRow(isFirst = false, data = {}) {
  const row = document.createElement("div");
  row.className = "itemRow";

  row.innerHTML = `
    <input class="product" list="productsList" placeholder="Item" value="${data.product || ""}">
    <input type="number" class="qty" placeholder="Qty" value="${data.qty || ""}">
    <select class="unit">
      <option value="kg"    ${data.unit === "kg"    ? "selected" : ""}>kg</option>
      <option value="g"     ${data.unit === "g"     ? "selected" : ""}>gram</option>
      <option value="piece" ${data.unit === "piece" ? "selected" : ""}>piece</option>
    </select>
    <input type="number" class="sellingPrice" placeholder="Price/unit" value="${data.sellingPrice || ""}" style="${window._zunoFormConfig?.sellingPrice === false ? 'display:none' : ''}">
    <input type="number" class="price" placeholder="Total Amount" value="${data.price || ""}">
    ${!isFirst ? `<button class="removeBtn">X</button>` : ""}
  `;

  const qtyInput   = row.querySelector(".qty");
  const productInput = row.querySelector(".product");
  const sellInput  = row.querySelector(".sellingPrice");
  const unitInput = row.querySelector(".unit");
  const totalInput = row.querySelector(".price");
  const priceInput = row.querySelector(".price");
  attachSuggestionDropdown(productInput, () => productSuggestions);

  if (priceInput) priceInput.addEventListener("input", calculateLiveTotal);

  function updateFromSelling() {
    const qty  = Number(qtyInput.value)  || 0;
    const sp   = Number(sellInput.value) || 0;
    const unit = unitInput.value;

    if (qty && sp) {
      const productData = productCosts[productInput.value.trim().toLowerCase()];
      let total = calculateSellingLineTotal({
        qty,
        price: sp,
        unit,
        sellingUnit: productData?.sellingUnit || unit
      });
      totalInput.value = Math.round(total * 100) / 100;
      calculateLiveTotal();
    }
  }

  qtyInput.addEventListener("input", updateFromSelling);
  sellInput.addEventListener("input", updateFromSelling);
  unitInput.addEventListener("change", updateFromSelling);
  productInput.addEventListener("change", () => {
    const productData = productCosts[productInput.value.trim().toLowerCase()];
    if (productData?.sellingPrice && !sellInput.value) {
      sellInput.value = productData.sellingPrice;
      row.querySelector(".unit").value = productData.unit || "kg";
      updateFromSelling();
    }
  });

  if (!isFirst) {
    row.querySelector(".removeBtn").onclick = () => {
      row.remove();
      calculateLiveTotal();
    };
  }

  return row;
}

/* ---------- INIT ITEMS ---------- */
const container = document.getElementById("itemsContainer");
container.appendChild(createItemRow(true));

document.getElementById("addItemBtn").onclick = () => {
  container.appendChild(createItemRow(false));
};

/* ---------- SAVE SALE ---------- */
document.getElementById("mainBtn").onclick = async () => {
  if (!currentUserId) { alert("Please login first"); return; }

  const date           = document.getElementById("date").value;
  const customer       = document.getElementById("customerName").value;
  const phone          = document.getElementById("phone").value;
  const deliveryStatus = document.getElementById("deliveryStatus").value;
  const orderNumber    = document.getElementById("orderDisplay").innerText;
  const paymentMode    = document.getElementById("paymentMode").value;

  // credit fields
  const creditType  = document.getElementById("creditType").value;
  const amountPaid  = paymentMode === "credit" && creditType === "partial"
    ? Number(document.getElementById("amountPaid").value) || 0
    : 0;

  const rows = document.querySelectorAll(".itemRow");
  let items = [], totalProfit = 0, totalAmount = 0;

  rows.forEach(r => {
    const product      = r.querySelector(".product").value.toLowerCase();
    const qty          = Number(r.querySelector(".qty").value);
    const price        = Number(r.querySelector(".price").value);
    const unit         = r.querySelector(".unit").value;
    const sellingPrice = Number(r.querySelector(".sellingPrice").value) || 0;

    if (product && qty && price) {
      const productData = productCosts[product];
      let cost = 0, baseUnit = "kg";

      if (productData) { cost = productData.cost; baseUnit = productData.unit; }

      let finalQty = qty;
      if (unit === "g"  && baseUnit === "kg") finalQty = qty / 1000;
      if (unit === "kg" && baseUnit === "g")  finalQty = qty * 1000;

      const hasCost = !!productData;
      const profit  = hasCost ? price - (cost * finalQty) : null;
      items.push({ product, qty, unit, price, sellingPrice, sellingUnit: normalizeSellingUnit(productData?.sellingUnit || "", unit), profit, hasCost });
      totalAmount += price;
      if (hasCost) totalProfit += profit;
    }
  });

  if (!date || items.length === 0) return alert("Fill data");

  // credit amount = full amount or (total - amount paid)
  const creditAmount = paymentMode === "credit"
    ? (creditType === "full" ? totalAmount : Math.max(0, totalAmount - amountPaid))
    : 0;

  const paidAlreadyApplied = editId && editOriginalData?.paymentMode === "credit"
    ? Math.max(0, getOriginalCreditAmount(editOriginalData) - Number(editOriginalData.creditAmount || 0))
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

  if (editId) {
    const wasDelivered   = editOriginalData?.deliveryStatus === "delivered";
    const isNowDelivered = data.deliveryStatus === "delivered";

    // reverse old credit if was credit sale
    if (editOriginalData?.paymentMode === "credit") {
      await reverseCreditForSale({
        userId: currentUserId,
        sale: editOriginalData,
        preservePaid: true
      });
    }

    await updateDoc(userDoc("sales", editId), data);

    if (!wasDelivered && isNowDelivered) {
      await deductInventory(items);
    } else if (wasDelivered && !isNowDelivered) {
      await revertInventory(editOriginalData.items);
    } else if (wasDelivered && isNowDelivered) {
      await revertInventory(editOriginalData.items);
      await deductInventory(items);
    }

    // apply new credit if credit sale
    if (paymentMode === "credit" && data.originalCreditAmount > 0 && data.deliveryStatus === "delivered") {
      await handleCreditFromSale({
        userId: currentUserId,
        customer, phone, creditAmount: data.creditAmount,
        originalCreditAmount: data.originalCreditAmount,
        orderNumber, date,
        isEdit: true,
        oldCreditAmount: 0 // already reversed above
      });
      showToast(`✓ Credit updated for ${customer} — ₹${creditAmount.toLocaleString("en-IN")}`);
    }

    editId = null;
    editOriginalData = null;

  } else {
    await addDoc(userCol("sales"), data);

    if (data.deliveryStatus === "delivered") {
      await deductInventory(items);
    }

    // auto-create credit entry
    if (paymentMode === "credit" && data.originalCreditAmount > 0 && deliveryStatus === "delivered") {
      await handleCreditFromSale({
        userId: currentUserId,
        customer, phone, creditAmount: data.creditAmount,
        originalCreditAmount: data.originalCreditAmount,
        orderNumber, date
      });
      showToast(`✓ Credit added for ${customer} — ₹${creditAmount.toLocaleString("en-IN")}`);
    }
  }

  resetForm();
};

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

    let deductQty = Number(item.qty);
    if (item.unit === "g"  && found.unit === "kg") deductQty = deductQty / 1000;
    if (item.unit === "kg" && found.unit === "g")  deductQty = deductQty * 1000;

    const newQty = Math.max(0, Number(found.qty) - deductQty);
    await updateDoc(userDoc("inventory", found.id), { qty: newQty });

    await addDoc(userCol("inventoryHistory"), {
      product: item.product,
      qty:     item.qty,
      unit:    item.unit,
      date:    new Date().toISOString().split("T")[0],
      type:    "out",
      note:    "Auto-deducted from sale"
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

    let revertQty = Number(item.qty);
    if (item.unit === "g"  && found.unit === "kg") revertQty = revertQty / 1000;
    if (item.unit === "kg" && found.unit === "g")  revertQty = revertQty * 1000;

    await updateDoc(userDoc("inventory", found.id), {
      qty: Number(found.qty) + revertQty
    });

    await addDoc(userCol("inventoryHistory"), {
      product: item.product,
      qty:     revertQty,
      unit:    found.unit,
      date:    new Date().toISOString().split("T")[0],
      type:    "in",
      note:    "Restored — sale deleted"
    });
  }
}

/* ---------- RESET FORM ---------- */
function resetForm() {
  document.getElementById("customerName").value   = "";
  document.getElementById("phone").value          = "";
  document.getElementById("paymentMode").value    = "cash";
  document.getElementById("deliveryStatus").value = "pending";
  document.getElementById("creditBox").style.display = "none";
  document.getElementById("creditType").value     = "full";
  document.getElementById("amountPaidRow").style.display = "none";
  document.getElementById("amountPaid").value     = "";
  container.innerHTML = "";
  container.appendChild(createItemRow(true));
  document.getElementById("liveTotal").innerText  = 0;
  refreshOrderDisplay();
}

/* ---------- LOAD PRODUCTS ---------- */
function loadProducts() {
  onSnapshot(userCol("products"), snap => {
    const table = document.getElementById("productTable");
    table.innerHTML = "";
    productCosts = {};
    productList  = [];

    snap.forEach(d => {
      const p = d.data();
      productCosts[p.name.toLowerCase()] = {
        cost: Number(p.cost),
        sellingPrice: Number(p.sellingPrice || 0),
        unit: p.unit || "kg",
        sellingUnit: normalizeSellingUnit(p.sellingUnit || "", p.unit || "kg")
      };
      productList.push(p.name);
      updateProductCosts(productCosts);

      table.innerHTML += `
        <tr>
          <td>${p.name}</td>
          <td>${p.cost} / ${p.unit || "kg"}</td>
          <td>${p.sellingPrice ? `${p.sellingPrice} / ${sellingUnitLabel(p.sellingUnit, p.unit || "kg")}` : "Not set"}</td>
          <td>
            <button onclick='editProduct(${JSON.stringify(d.id)}, ${JSON.stringify(p.name)}, ${JSON.stringify(p.cost)}, ${JSON.stringify(p.unit || "kg")}, ${JSON.stringify(p.sellingPrice || "")}, ${JSON.stringify(p.sellingUnit || "")})'>Edit</button>
            <button onclick="deleteProduct('${d.id}')">Delete</button>
          </td>
        </tr>
      `;
    });

    document.getElementById("productsList")?.remove();
    const dl = document.createElement("datalist");
    dl.id = "productsList";
    productSuggestions = mergeSuggestions(productList, COMMON_ITEM_NAMES);
    dl.innerHTML = renderOptions(productSuggestions);
    attachSuggestionDropdown(document.getElementById("prodName"), () => productSuggestions);
  document.body.appendChild(dl);
  });
}

/* ---------- PRODUCT ADD / UPDATE ---------- */
window.addOrUpdateProduct = async () => {
  if (!currentUserId) return;

  const name = document.getElementById("prodName").value;
  const cost = document.getElementById("prodCost").value;
  const sellingPrice = Number(document.getElementById("prodSellingPrice").value) || 0;
  const unit = document.getElementById("prodUnit").value;
  const sellingUnit = document.getElementById("prodSellingUnit").value;

  if (!name) return;

  if (productEditId) {
    await updateDoc(userDoc("products", productEditId), { name, cost: Number(cost) || 0, sellingPrice, unit, sellingUnit: normalizeSellingUnit(sellingUnit, unit) });
    await updateInventorySellingPrice(name, sellingPrice, unit, sellingUnit);
    productEditId = null;
    document.getElementById("prodBtn").innerText = "Add";
  } else {
    await addDoc(userCol("products"), { name, cost: Number(cost) || 0, sellingPrice, unit, sellingUnit: normalizeSellingUnit(sellingUnit, unit) });
    await updateInventorySellingPrice(name, sellingPrice, unit, sellingUnit);
  }

  document.getElementById("prodName").value = "";
  document.getElementById("prodCost").value = "";
  document.getElementById("prodSellingPrice").value = "";
  document.getElementById("prodUnit").value = "kg";
  document.getElementById("prodSellingUnit").value = "kg";
};

/* ---------- EDIT PRODUCT ---------- */
window.editProduct = (id, name, cost, unit, sellingPrice = "", sellingUnit = "") => {
  document.getElementById("prodName").value = name;
  document.getElementById("prodCost").value = cost;
  document.getElementById("prodSellingPrice").value = sellingPrice;
  document.getElementById("prodUnit").value = unit || "kg";
  document.getElementById("prodSellingUnit").value = normalizeSellingUnit(sellingUnit, unit || "kg");
  productEditId = id;
  document.getElementById("prodBtn").innerText = "Update";
};

async function updateInventorySellingPrice(name, sellingPrice, unit, sellingUnit = "") {
  if (!sellingPrice) return;
  const snap = await getDocs(userCol("inventory"));
  for (const item of snap.docs) {
    const data = item.data();
    if ((data.product || "").toLowerCase() === name.toLowerCase()) {
      await updateDoc(userDoc("inventory", item.id), { sellingPrice, sellingUnit: normalizeSellingUnit(sellingUnit, unit) });
    }
  }
}

/* ---------- DELETE PRODUCT ---------- */
window.deleteProduct = async (id) => {
  await deleteDoc(userDoc("products", id));
};

/* ---------- LOAD SALES ---------- */
function loadSales() {
  onSnapshot(
    query(userCol("sales"), orderBy("date", "desc")),
    snap => {
      const table = document.getElementById("salesTable");
      table.innerHTML = "";
      allSales = [];

      snap.forEach(d => {
        const s = d.data();
        if (!s) return;

        allSales.push({ ...s, _id: d.id });

        const itemsText = Array.isArray(s.items)
          ? s.items.map(i => `${i.product}(${i.qty})`).join(", ")
          : s.product ? `${s.product}(${s.quantity || 1})` : "No items";

        // profit cell
        const missingProducts = Array.isArray(s.items)
          ? s.items.filter(i => i.hasCost === false || i.profit === null).map(i => i.product)
          : [];

        let profitCell = "";
        if (missingProducts.length > 0) {
          const totalKnown = Array.isArray(s.items)
            ? s.items.reduce((sum, i) => sum + (i.profit !== null ? Number(i.profit || 0) : 0), 0)
            : 0;
          const missingText = missingProducts.map(p => `${p}: price not found`).join(", ");
          profitCell = `
            <div>₹${Math.round(totalKnown)}</div>
            <div style="font-size:11px;color:var(--text-muted)">(${missingText})</div>
            <button onclick="recalcSale('${d.id}')" style="font-size:11px;margin-top:4px;padding:2px 8px;background:var(--accent-light);color:var(--accent);border:1px solid #a8d5bc;border-radius:4px;cursor:pointer;">↻ Recalculate</button>
          `;
        } else {
          profitCell = `₹${Math.round(s.totalProfit || 0)}`;
        }

        // payment mode — show credit amount if credit sale
        let paymentDisplay = s.paymentMode || "cash";
        if (s.paymentMode === "credit") {
          const creditLeft = Number(s.creditAmount || 0);
          paymentDisplay += `<br><span style="font-size:11px;color:var(--danger)">Credit: ₹${Math.round(s.creditAmount)}</span>`;
          if (s.amountPaid > 0) {
            paymentDisplay += `<br><span style="font-size:11px;color:var(--accent)">Paid: ₹${Math.round(s.amountPaid)}</span>`;
          }
          paymentDisplay += `
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;">
              <button class="credit-mini-btn" onclick="openOrderCreditHistory('${d.id}')">History</button>
              <button class="credit-mini-btn credit-edit-btn" onclick="openOrderCreditEdit('${d.id}')">Edit Credit</button>
            </div>
          `;
        }

        // status dropdown
        const statusSelect = `
          <select onchange="updateStatus('${d.id}', this.value)"
            style="font-size:13px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg);cursor:pointer;">
            <option value="pending"   ${s.deliveryStatus === "pending"   ? "selected" : ""}>🕐 Pending</option>
            <option value="delivered" ${s.deliveryStatus === "delivered" ? "selected" : ""}>✅ Delivered</option>
          </select>
        `;

        table.innerHTML += `
          <tr>
            <td>${s.orderNumber || "—"}</td>
            <td>${s.date || ""}</td>
            <td>${s.customer || "Retail"}</td>
            <td>${s.phone || "—"}</td>
            <td>${itemsText}</td>
            <td>₹${Math.round(s.totalAmount || 0)}</td>
            <td>${profitCell}</td>
            <td>${paymentDisplay}</td>
            <td>${statusSelect}</td>
            <td>
              <button onclick='editSale("${d.id}", ${JSON.stringify(s).replace(/'/g, "&#39;")})'>Edit</button>
              <button onclick="deleteSale('${d.id}')">Delete</button>
            </td>
          </tr>
        `;
      });

      while (table.rows.length > 10) table.deleteRow(10);

      populateMonthFilter(allSales);
      updateDashboard(allSales);
    }
  );
}

/* ---------- LIVE CUSTOMER ORDERS ---------- */
function loadCustomerOrders() {
  const list = document.getElementById("liveOrdersList");
  if (!list) return;
  if (shopProfile?.publicOrdersEnabled === false) {
    list.innerHTML = `<div style="background:white;border:1px solid var(--border);border-radius:10px;padding:14px;color:var(--text-muted);font-size:13px;">Customer orders are disabled for this shop.</div>`;
    return;
  }

  onSnapshot(
    query(userCol("customerOrders"), orderBy("createdAt", "desc")),
    snap => {
      const orders = [];
      snap.forEach(d => orders.push({ id: d.id, ...d.data() }));
      renderCustomerOrders(orders.slice(0, 20));
    },
    error => {
      console.error("Customer orders failed:", error);
      list.innerHTML = `<div style="background:white;border:1px solid var(--border);border-radius:10px;padding:14px;color:var(--danger);font-size:13px;">Could not load customer orders.</div>`;
    }
  );
}

function renderCustomerOrders(orders) {
  const list = document.getElementById("liveOrdersList");
  if (!list) return;

  const activeOrders = orders.filter(order => order.status !== "delivered" && order.status !== "rejected");
  if (activeOrders.length === 0) {
    list.innerHTML = `<div style="background:white;border:1px solid var(--border);border-radius:10px;padding:14px;color:var(--text-muted);font-size:13px;">No live customer orders yet.</div>`;
    return;
  }

  list.innerHTML = activeOrders.map(order => {
    const items = Array.isArray(order.items) ? order.items : [];
    const itemsText = items.map(item => `${item.product} (${item.qty} ${item.unit || ""})`).join(", ");
    const status = order.status || "new";
    const statusColor = status === "new" ? "var(--danger)" : status === "packing" ? "#a05c00" : "var(--accent)";
    const fulfillment = order.fulfillmentType === "pickup" ? "Pickup" : "Delivery";
    const paymentText = order.paymentMode === "online"
      ? `Online - ${paymentStatusLabel(order.paymentStatus)}`
      : "COD";
    const feeText = order.handlingFee || order.deliveryFee
      ? `Items ₹${Math.round(order.subtotal || 0).toLocaleString("en-IN")} · Handling ₹${Math.round(order.handlingFee || 0)} · Delivery ₹${Math.round(order.deliveryFee || 0)}`
      : "";

    return `
      <div style="background:white;border:1px solid var(--border);border-radius:12px;padding:14px;display:grid;gap:10px;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div>
            <div style="font-size:12px;font-weight:700;color:${statusColor};text-transform:uppercase;">${statusLabel(status)}</div>
            <div style="font-size:16px;font-weight:700;">${order.customerName || "Customer"}</div>
            <div style="font-size:12px;color:var(--text-muted);">${order.customerPhone || ""} · ${fulfillment} · ${paymentText}</div>
          </div>
          <div style="font-size:18px;font-weight:700;color:var(--accent);white-space:nowrap;">₹${Math.round(order.totalAmount || 0).toLocaleString("en-IN")}</div>
        </div>
        <div style="font-size:13px;color:var(--text-secondary);line-height:1.4;">${itemsText || "No items"}</div>
        ${feeText ? `<div style="font-size:12px;color:var(--text-muted);">${feeText}</div>` : ""}
        ${order.customerAddress ? `<div style="font-size:12px;color:var(--text-muted);">Address: ${order.customerAddress}</div>` : ""}
        ${order.note ? `<div style="font-size:12px;color:var(--text-muted);">Note: ${order.note}</div>` : ""}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${status === "new" ? `<button onclick="updateCustomerOrderStatus('${order.id}', 'packing')" style="padding:7px 12px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:white;font-weight:600;cursor:pointer;">Start packing</button>` : ""}
          ${status !== "new" && status !== "packed" ? `<button onclick="updateCustomerOrderStatus('${order.id}', 'packed')" style="padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);cursor:pointer;">Mark packed</button>` : ""}
          <button onclick="completeCustomerOrder('${order.id}')" style="padding:7px 12px;border-radius:8px;border:1px solid var(--accent);background:var(--accent-light);color:var(--accent);font-weight:600;cursor:pointer;">${order.fulfillmentType === "pickup" ? "Received" : "Delivered"}</button>
          <button onclick="updateCustomerOrderStatus('${order.id}', 'rejected')" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(249,112,102,.35);background:#fff1f1;color:var(--danger);cursor:pointer;">Reject</button>
        </div>
      </div>
    `;
  }).join("");
}

function paymentStatusLabel(status = "") {
  const labels = {
    online_submitted: "payment submitted",
    online_verified: "payment verified",
    online_rejected: "payment rejected",
    cod: "cash"
  };
  return labels[status] || status || "cash";
}

function statusLabel(status) {
  const labels = {
    new: "New order",
    accepted: "Accepted",
    packing: "Packing",
    ready: "Packed",
    packed: "Packed",
    delivered: "Completed",
    rejected: "Rejected"
  };
  return labels[status] || status;
}

window.updateCustomerOrderStatus = async (orderId, status) => {
  if (!currentUserId) return;
  await updateDoc(userDoc("customerOrders", orderId), {
    status,
    updatedAt: serverTimestamp()
  });
};

window.completeCustomerOrder = async (orderId) => {
  if (!currentUserId) return;

  const orderRef = userDoc("customerOrders", orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) return;

  const order = orderSnap.data();
  if (order.saleId) {
    const linkedSale = await getDoc(userDoc("sales", order.saleId));
    if (linkedSale.exists() && linkedSale.data().deliveryStatus !== "delivered") {
      await updateStatus(order.saleId, "delivered");
      return;
    }
    if (linkedSale.exists()) {
      await updateDoc(orderRef, { status: "delivered", updatedAt: serverTimestamp() });
      return;
    }
  }

  const items = normalizeCustomerOrderItems(order.items || []);
  const orderNumber = await getNextOrderNumber();
  const date = new Date().toISOString().split("T")[0];
  const itemSubtotal = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const serviceFees = Number(order.handlingFee || 0) + Number(order.deliveryFee || 0);
  const paymentMode = order.paymentMode === "online" && order.paymentStatus === "online_verified" ? "upi" : "cash";
  const totalAmount = Number(order.totalAmount || 0) || itemSubtotal + serviceFees;
  const totalProfit = items.reduce((sum, item) => sum + (item.profit === null ? 0 : Number(item.profit || 0)), 0) + serviceFees;

  const saleRef = await addDoc(userCol("sales"), {
    orderNumber,
    date,
    customer: order.customerName || "Online customer",
    phone: order.customerPhone || "",
    items,
    totalProfit,
    totalAmount,
    subtotal: Number(order.subtotal || itemSubtotal),
    handlingFee: Number(order.handlingFee || 0),
    deliveryFee: Number(order.deliveryFee || 0),
    paymentMode,
    paymentStatus: order.paymentStatus || "cod",
    deliveryStatus: "delivered",
    source: "customer-shop",
    customerOrderId: orderId
  });

  await deductInventory(items);
  await updateDoc(orderRef, {
    status: "delivered",
    paymentStatus: paymentMode === "cash" ? "cod_collected" : order.paymentStatus,
    saleId: saleRef.id,
    orderNumber,
    updatedAt: serverTimestamp()
  });

  showToast(`Customer order delivered as ${orderNumber}`);
};

function normalizeCustomerOrderItems(orderItems) {
  return orderItems.map(item => {
    const product = (item.product || "").toLowerCase();
    const qty = Number(item.qty || 0);
    const unit = item.unit || "kg";
    const price = Number(item.price || 0);
    const sellingPrice = Number(item.sellingPrice || (qty ? price / qty : 0));
    const sellingUnit = normalizeSellingUnit(item.sellingUnit || "", unit);
    const productData = productCosts[product];
    let finalQty = qty;

    if (productData) {
      if (unit === "g" && productData.unit === "kg") finalQty = qty / 1000;
      if (unit === "kg" && productData.unit === "g") finalQty = qty * 1000;
    }

    return {
      product,
      qty,
      unit,
      price,
      sellingPrice,
      sellingUnit,
      profit: productData ? price - (Number(productData.cost || 0) * finalQty) : null,
      hasCost: !!productData
    };
  });
}

/* ---------- UPDATE STATUS FROM TABLE ---------- */
window.updateStatus = async (id, newStatus) => {
  if (!currentUserId) return;

  const saleRef  = userDoc("sales", id);
  const saleSnap = await getDoc(saleRef);
  if (!saleSnap.exists()) return;

  const saleData = saleSnap.data();
  


  const wasDelivered   = saleData.deliveryStatus === "delivered";
  const isNowDelivered = newStatus === "delivered";

  await updateDoc(saleRef, { deliveryStatus: newStatus });

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

/* ---------- RECALCULATE PROFIT FOR ONE SALE ---------- */
window.recalcSale = async (id) => {
  if (!currentUserId) return;

  const saleRef  = userDoc("sales", id);
  const saleSnap = await getDoc(saleRef);
  if (!saleSnap.exists()) return;

  const s = saleSnap.data();
  if (!Array.isArray(s.items)) return;

  const missing = [];
  let totalProfit = 0;

  const updatedItems = s.items.map(item => {
    const key         = item.product.toLowerCase();
    const productData = productCosts[key];

    if (!productData) {
      missing.push(item.product);
      return { ...item, profit: null, hasCost: false };
    }

    let finalQty   = Number(item.qty);
    const baseUnit = productData.unit || "kg";
    if (item.unit === "g"  && baseUnit === "kg") finalQty = finalQty / 1000;
    if (item.unit === "kg" && baseUnit === "g")  finalQty = finalQty * 1000;

    const profit = Number(item.price) - (productData.cost * finalQty);
    totalProfit += profit;
    return { ...item, profit, hasCost: true };
  });

  await updateDoc(saleRef, { items: updatedItems, totalProfit });

  if (missing.length > 0) {
    alert(`Updated what was possible. Still missing: ${missing.join(", ")}. Please add their prices in Products or Inventory.`);
  }
};

/* ---------- RECALCULATE ALL SALES WITH MISSING PROFIT ---------- */
window.recalcAllSales = async () => {
  if (!currentUserId) return;

  const snap       = await getDocs(userCol("sales"));
  const allMissing = new Set();
  let updated      = 0;

  for (const d of snap.docs) {
    const s = d.data();
    if (!Array.isArray(s.items)) continue;

    const hasMissing = s.items.some(i => i.hasCost === false || i.profit === null);
    if (!hasMissing) continue;

    let totalProfit = 0;
    const updatedItems = s.items.map(item => {
      const key         = item.product.toLowerCase();
      const productData = productCosts[key];

      if (!productData) {
        allMissing.add(item.product);
        return { ...item, profit: null, hasCost: false };
      }

      let finalQty   = Number(item.qty);
      const baseUnit = productData.unit || "kg";
      if (item.unit === "g"  && baseUnit === "kg") finalQty = finalQty / 1000;
      if (item.unit === "kg" && baseUnit === "g")  finalQty = finalQty * 1000;

      const profit = Number(item.price) - (productData.cost * finalQty);
      totalProfit += profit;
      return { ...item, profit, hasCost: true };
    });

    await updateDoc(userDoc("sales", d.id), { items: updatedItems, totalProfit });
    updated++;
  }

  if (allMissing.size > 0) {
    alert(`Updated ${updated} sales. Still missing prices for: ${[...allMissing].join(", ")}. Add them in Products or Inventory.`);
  } else {
    alert(`Done! Updated ${updated} sales successfully.`);
  }
};

/* ---------- EDIT SALE ---------- */
window.editSale = (id, data) => {
  openEditSaleModal(id, data);
};

/* ---------- DELETE SALE ---------- */
window.deleteSale = async (id) => {
  if (!currentUserId) return;

  const saleRef  = userDoc("sales", id);
  const saleSnap = await getDoc(saleRef);

  if (saleSnap.exists()) {
    const saleData = saleSnap.data();

    if (saleData.deliveryStatus === "delivered" && Array.isArray(saleData.items)) {
      await revertInventory(saleData.items);
    }

    // reverse credit if was credit sale
    if (saleData.paymentMode === "credit") {
      await reverseCreditForSale({
        userId: currentUserId,
        sale: saleData
      });
    }

    if (saleData.customerOrderId) {
      const customerOrderUpdate = {
        status: "packed",
        saleId: null,
        updatedAt: serverTimestamp()
      };
      if (saleData.paymentMode === "cash") customerOrderUpdate.paymentStatus = "cod";
      await updateDoc(userDoc("customerOrders", saleData.customerOrderId), customerOrderUpdate);
    }
  }

  await deleteDoc(saleRef);
};

/* ---------- CREDIT HISTORY / EDIT FROM ORDERS ---------- */
window.openOrderCreditHistory = async (saleId) => {
  const sale = allSales.find(s => s._id === saleId);
  if (!sale) return;

  const modal = document.getElementById("orderCreditHistoryModal");
  const title = document.getElementById("orderCreditHistoryTitle");
  const body = document.getElementById("orderCreditHistoryBody");

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

window.closeOrderCreditHistory = () => {
  document.getElementById("orderCreditHistoryModal").classList.add("hidden");
};

window.openOrderCreditEdit = (saleId) => {
  const sale = allSales.find(s => s._id === saleId);
  if (!sale) return;

  editingCreditSaleId = saleId;
  document.getElementById("orderCreditEditTitle").textContent = `${sale.orderNumber || "Order"} credit`;
  document.getElementById("orderCreditEditMeta").textContent =
    `${sale.customer || "Customer"} · Current credit: ₹${Math.round(sale.creditAmount || 0).toLocaleString("en-IN")}`;
  document.getElementById("orderCreditAmount").value = Math.round(sale.creditAmount || 0);
  document.getElementById("orderCreditDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("orderCreditNote").value = "";
  document.getElementById("orderCreditMsg").textContent = "";
  document.getElementById("orderCreditEditModal").classList.remove("hidden");
};

window.closeOrderCreditEdit = () => {
  editingCreditSaleId = null;
  document.getElementById("orderCreditEditModal").classList.add("hidden");
};

window.saveOrderCreditEdit = async () => {
  if (!editingCreditSaleId || !currentUserId) return;

  const amount = Number(document.getElementById("orderCreditAmount").value);
  const date = document.getElementById("orderCreditDate").value;
  const note = document.getElementById("orderCreditNote").value.trim();
  const msg = document.getElementById("orderCreditMsg");

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
    note: note || "Credit edited from orders"
  });

  closeOrderCreditEdit();
  showToast("✓ Credit updated");
};

/* ---------- DASHBOARD ---------- */
function updateDashboard(data) {
  if (!document.getElementById("totalSales")) return;

  let totalSales = 0, totalProfit = 0;
  const customers = new Set();

  data.forEach(s => {
    totalSales  += Number(s.totalAmount || 0);
    totalProfit += Number(s.totalProfit || 0);
    if (s.customer) customers.add(s.customer);
  });

  document.getElementById("totalSales").innerText     = "₹" + Math.round(totalSales).toLocaleString("en-IN");
  document.getElementById("totalProfit").innerText    = "₹" + Math.round(totalProfit).toLocaleString("en-IN");
  document.getElementById("totalCustomers").innerText = customers.size;

  drawChart(data);
}

/* ---------- CHART ---------- */
function drawChart(data) {
  const canvas = document.getElementById("chart");
  if (!canvas) return;

  const ctx     = canvas.getContext("2d");
  const dateMap = {};

  data.forEach(s => {
    if (!s?.date) return;
    if (!dateMap[s.date]) dateMap[s.date] = { sales: 0, profit: 0 };
    dateMap[s.date].sales  += Number(s.totalAmount || 0);
    dateMap[s.date].profit += Number(s.totalProfit || 0);
  });

  let labels     = Object.keys(dateMap).sort();
  let salesData  = labels.map(d => dateMap[d].sales);
  let profitData = labels.map(d => dateMap[d].profit);

  if (labels.length === 0) { labels = ["No Data"]; salesData = [0]; profitData = [0]; }

  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Sales",  data: salesData  },
        { label: "Profit", data: profitData }
      ]
    }
  });
}

/* ---------- MONTH FILTER ---------- */
const monthFilterEl = document.getElementById("monthFilter");
if (monthFilterEl) {
  monthFilterEl.addEventListener("change", (e) => {
    const value    = e.target.value;
    const filtered = value === "all"
      ? allSales
      : allSales.filter(s => s.date?.startsWith(value));
    updateDashboard(filtered);
  });
}

function applyFormConfig(config) {
  const fields = {
    customerName:   document.getElementById("customerName"),
    phone:          document.getElementById("phone"),
    deliveryStatus: document.getElementById("deliveryStatus"),
    paymentMode:    document.getElementById("paymentMode"),
    sellingPrice:   null // handled per row in createItemRow
  };

  if (fields.customerName) fields.customerName.style.display = config.customerName === false ? "none" : "";
  if (fields.phone)          fields.phone.style.display          = config.phone          === false ? "none" : "";
  if (fields.deliveryStatus) fields.deliveryStatus.style.display = config.deliveryStatus === false ? "none" : "";
  if (fields.paymentMode)    fields.paymentMode.style.display    = config.paymentMode    === false ? "none" : "";

  // store for createItemRow to use
  window._zunoFormConfig = config;
}

/* ---------- AI SUMMARY ---------- */
window.generateSummary = async function () {
  try {
    const snapshot = await getDocs(userCol("sales"));
    const salesData = [];
    snapshot.forEach(d => salesData.push(d.data()));

    if (salesData.length === 0) {
      document.getElementById("summary").innerText = "No data available.";
      return;
    }

    const response = await fetch("https://zuno-production.up.railway.app/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sales: salesData }),
    });

    const data = await response.json();
    document.getElementById("summary").innerText = data.summary;
  } catch (error) {
    console.error("AI Error:", error);
    document.getElementById("summary").innerText = "Error generating summary";
  }
};

/* ---------- AI WARMUP ---------- */
window.addEventListener("load", async () => {
  try {
    await fetch("https://zuno-production.up.railway.app/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sales: [] }),
    });
  } catch (e) {
    console.log("AI warmup failed (ok)");
  }
});

/* ---------- LIVE TOTAL ---------- */
function calculateLiveTotal() {
  const rows = document.querySelectorAll(".itemRow");
  let total  = 0;
  rows.forEach(r => { total += Number(r.querySelector(".price").value) || 0; });
  document.getElementById("liveTotal").innerText = total;
}

/* ---------- TOGGLE ---------- */
window.toggleSection = (id) => {
  document.getElementById(id).classList.toggle("hidden");
};

/* ---------- TOAST ---------- */
function showToast(msg) {
  let toast = document.getElementById("scriptToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "scriptToast";
    toast.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(20px);background:#1a1a18;color:white;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:500;opacity:0;transition:all 0.3s ease;z-index:2000;white-space:nowrap;";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  toast.style.transform = "translateX(-50%) translateY(0)";
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(20px)";
  }, 3000);
}
