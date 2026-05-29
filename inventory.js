import { db, auth } from "./firebase.js";
import {
  collection, addDoc, onSnapshot,
  doc, updateDoc, deleteDoc,
  query, orderBy, getDocs, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { findProductImage } from "./product-images.js";
import { shouldReplaceAutoImage } from "./marketplace-visuals.js";
import { attachSuggestionDropdown, COMMON_ITEM_NAMES, mergeSuggestions, renderOptions } from "./item-suggestions.js";
import { formatDisplayQtyForSellingUnit, normalizeSellingUnit, sellingUnitLabel } from "./unit-pricing.js";

/* ---------- STATE ---------- */
let currentUserId  = null;
let inventoryMap   = {};
let salesData      = [];
let historyDocs    = [];
let editingHistoryId = null;
let hiddenProducts = [];
let productSuggestions = COMMON_ITEM_NAMES;

function normalizeProduct(value = "") {
  return String(value).trim().toLowerCase();
}

function isWeightUnit(unit) {
  return unit === "kg" || unit === "g";
}

function chooseStorageUnit(...units) {
  const usable = units.filter(Boolean);
  if (usable.some(unit => unit === "piece")) return "piece";
  return usable.includes("kg") ? "kg" : (usable[0] || "kg");
}

function convertQty(qty, fromUnit, toUnit) {
  const value = Number(qty || 0);
  if (fromUnit === toUnit || !fromUnit || !toUnit) return value;
  if (fromUnit === "g" && toUnit === "kg") return value / 1000;
  if (fromUnit === "kg" && toUnit === "g") return value * 1000;
  return value;
}

function isPurchaseEntry(entry = {}) {
  return entry.type === "in" && (entry.purchaseCost !== undefined || /stock added|inventory purchase/i.test(entry.note || ""));
}

function unitIsCompatible(existingUnit, incomingUnit) {
  return existingUnit === incomingUnit || (isWeightUnit(existingUnit) && isWeightUnit(incomingUnit));
}

/* ---------- USER COLLECTION HELPER ---------- */
function userCol(colName) {
  return collection(db, "users", currentUserId, colName);
}

function userDoc(colName, docId) {
  return doc(db, "users", currentUserId, colName, docId);
}

/* ---------- SET TODAY DATE ---------- */
document.getElementById("stockDate").value = new Date().toISOString().split("T")[0];

window.openAddStockModal = () => {
  document.getElementById("addStockModal").classList.remove("hidden");
};

window.closeAddStockModal = () => {
  document.getElementById("addStockModal").classList.add("hidden");
  document.getElementById("stockMsg").innerText = "";
};

/* ---------- AUTH GATE ---------- */
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUserId  = user.uid;
  hiddenProducts = JSON.parse(
    localStorage.getItem("hiddenFinished_" + currentUserId) || "[]"
  );

  loadProducts();
  loadSales();
  loadInventory();
  loadHistory();
});

/* ---------- LOAD PRODUCTS INTO DATALIST ---------- */
function loadProducts() {
  onSnapshot(userCol("products"), snap => {
    const dl = document.getElementById("productsList");
    const names = [];
    snap.forEach(d => {
      names.push(d.data().name);
    });
    productSuggestions = mergeSuggestions(names, COMMON_ITEM_NAMES);
    dl.innerHTML = renderOptions(productSuggestions);
    attachSuggestionDropdown(document.getElementById("stockProduct"), () => productSuggestions);
    attachSuggestionDropdown(document.getElementById("editProduct"), () => productSuggestions);
  });
}

/* ---------- LOAD SALES (for profit calculation) ---------- */
function loadSales() {
  onSnapshot(userCol("sales"), snap => {
    salesData = [];
    snap.forEach(d => {
      const s = d.data();
      if (s.deliveryStatus === "delivered" && Array.isArray(s.items)) {
        salesData.push(s);
      }
    });
    renderStockCards();
    renderAlerts();
  });
}

/* ---------- LOAD INVENTORY ---------- */
function loadInventory() {
  onSnapshot(userCol("inventory"), snap => {
    inventoryMap = {};
    snap.forEach(d => {
      const item = d.data();
      const key  = item.product.toLowerCase();
      inventoryMap[key] = {
        id:                d.id,
        product:           item.product,
        qty:               Number(item.qty),
        unit:              item.unit,
        alertThreshold:    Number(item.alertThreshold   || 0),
        weightedAvgCost:   Number(item.weightedAvgCost  || 0),
        sellingPrice:      Number(item.sellingPrice     || item.price || 0),
        sellingUnit:       normalizeSellingUnit(item.sellingUnit || "", item.unit || "kg"),
        totalInvested:     Number(item.totalInvested    || 0),
        totalQtyBought:    Number(item.totalQtyBought   || 0),
        lastPurchaseDate:  item.lastPurchaseDate  || "",
        firstPurchaseDate: item.firstPurchaseDate || "",
        imageUrl:          item.imageUrl || ""
      };
    });
    ensureInventoryImages();
    renderStockCards();
    renderAlerts();
  });
}

async function ensureInventoryImages() {
  const items = Object.values(inventoryMap)
    .filter(item => !item.imageUrl || shouldReplaceAutoImage(item.imageUrl))
    .slice(0, 8);
  for (const item of items) {
    try {
      const imageUrl = await findProductImage(item.product);
      if (!imageUrl) continue;
      await updateDoc(userDoc("inventory", item.id), { imageUrl });
    } catch (error) {
      console.warn("Product image lookup failed:", item.product, error);
    }
  }
}

/* ---------- LOAD HISTORY ---------- */
function loadHistory() {
  onSnapshot(
    query(userCol("inventoryHistory"), orderBy("date", "desc")),
    snap => {
      historyDocs = [];
      const table = document.getElementById("historyTable");
      table.innerHTML = "";

      if (snap.empty) {
        table.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted);text-align:center;padding:16px;">No history yet</td></tr>`;
        return;
      }

      snap.forEach(d => {
        const h = d.data();
        historyDocs.push({ id: d.id, ...h });

        const typeLabel = h.type === "in"
          ? `<span class="type-in">+ IN</span>`
          : h.type === "deleted"
            ? `<span class="type-deleted">✕ DEL</span>`
            : h.type === "edit"
              ? `<span class="type-edit">✎ EDIT</span>`
              : `<span class="type-out">- OUT</span>`;

        const costPerUnit = h.costPerUnit
          ? `₹${(Math.round(h.costPerUnit * 100) / 100).toLocaleString("en-IN")}`
          : "—";

        const actionBtn = h.type === "deleted"
          ? `<button class="restore-btn" onclick="restoreStock('${d.id}')">Restore</button>`
          : isPurchaseEntry(h)
            ? `<button class="card-edit-btn" onclick="openPurchaseEdit('${d.id}')">Edit</button>`
            : "—";

        table.innerHTML += `
          <tr>
            <td>${h.date || ""}</td>
            <td style="text-transform:capitalize">${h.product || ""}</td>
            <td>${typeLabel}</td>
            <td style="font-family:var(--font-mono)">${h.qty} ${h.unit || ""}</td>
            <td style="font-family:var(--font-mono)">${costPerUnit}</td>
            <td style="color:var(--text-secondary)">${h.note || "—"}</td>
            <td>${actionBtn}</td>
          </tr>
        `;
      });
    }
  );
}

/* ---------- ADD STOCK ---------- */
window.addStock = async () => {
  if (!currentUserId) return;

  const product        = document.getElementById("stockProduct").value.trim();
  const qty            = Number(document.getElementById("stockQty").value);
  const unit           = document.getElementById("stockUnit").value;
  const date           = document.getElementById("stockDate").value;
  const alertThreshold = Number(document.getElementById("stockAlert").value) || 0;
  const note           = document.getElementById("stockNote").value.trim();
  const purchaseCost   = Number(document.getElementById("stockPurchaseCost").value) || 0;
  const sellingPrice   = Number(document.getElementById("stockSellingPrice").value) || 0;
  const sellingUnit    = document.getElementById("stockSellingUnit").value;
  const vendorName     = document.getElementById("vendorName").value.trim();
  const vendorPhone    = document.getElementById("vendorPhone").value.trim();
  const vendorAmountPaid = Number(document.getElementById("vendorAmountPaid").value) || 0;

  if (!product || !qty || !date) {
    showMsg("Please fill product, quantity and date.", "error");
    return;
  }
  if (vendorAmountPaid > purchaseCost) {
    showMsg("Vendor amount paid cannot be more than the purchase cost.", "error");
    return;
  }

  const costPerUnit = purchaseCost > 0 ? purchaseCost / qty : 0;
  const key         = normalizeProduct(product);
  const existing    = inventoryMap[key];
  if (existing && !unitIsCompatible(existing.unit, unit)) {
    showMsg("This product already uses a different unit type.", "error");
    return;
  }
  const storageUnit = existing ? chooseStorageUnit(existing.unit, unit) : unit;
  const entryQtyForStock = convertQty(qty, unit, storageUnit);
  const alertForStock = convertQty(alertThreshold, unit, storageUnit);
  const costPerStorageUnit = entryQtyForStock > 0 ? purchaseCost / entryQtyForStock : 0;

  if (existing) {
    const unitChanged = existing.unit !== storageUnit;
    const existingQty    = convertQty(existing.qty, existing.unit, storageUnit);
    const prevTotalQty   = convertQty(existing.totalQtyBought || 0, existing.unit, storageUnit);
    const prevTotalCost  = existing.totalInvested  || 0;
    const newTotalQty    = prevTotalQty + entryQtyForStock;
    const newTotalCost   = prevTotalCost + purchaseCost;
    const newWeightedAvg = newTotalQty > 0 ? newTotalCost / newTotalQty : 0;
    const isNewer        = date > (existing.lastPurchaseDate || "");

    await updateDoc(userDoc("inventory", existing.id), {
      qty:             existingQty + entryQtyForStock,
      unit:            storageUnit,
      alertThreshold:  alertForStock,
      weightedAvgCost: newWeightedAvg,
      totalInvested:   newTotalCost,
      totalQtyBought:  newTotalQty,
      ...(sellingPrice > 0 && { sellingPrice }),
      sellingUnit:     normalizeSellingUnit(sellingUnit, storageUnit),
      ...(isNewer && { lastPurchaseDate: date })
    });

    if ((costPerStorageUnit > 0 && (isNewer || unitChanged)) || sellingPrice > 0) {
      await updateProductCost(product, costPerStorageUnit > 0 && (isNewer || unitChanged) ? costPerStorageUnit : null, storageUnit, sellingPrice, sellingUnit);
    }

  } else {
    await addDoc(userCol("inventory"), {
      product, qty: entryQtyForStock, unit: storageUnit, alertThreshold: alertForStock,
      weightedAvgCost:   costPerStorageUnit,
      totalInvested:     purchaseCost,
      totalQtyBought:    entryQtyForStock,
      sellingPrice,
      sellingUnit:       normalizeSellingUnit(sellingUnit, storageUnit),
      firstPurchaseDate: date,
      lastPurchaseDate:  date
    });

    if (costPerStorageUnit > 0 || sellingPrice > 0) {
      await updateProductCost(product, costPerStorageUnit > 0 ? costPerStorageUnit : null, storageUnit, sellingPrice, sellingUnit);
    }
  }

  let cashAdjustmentId = "";
  let vendorPaymentId = "";
  if (!vendorName && purchaseCost > 0) {
    const cashRef = await addDoc(userCol("cashAdjustments"), {
      type: "inventory_purchase",
      amount: purchaseCost,
      date,
      product,
      note: `Inventory purchase: ${product} ${qty} ${unit}`
    });
    cashAdjustmentId = cashRef.id;
  }
  if (vendorName && purchaseCost > 0) {
    const vendorRef = await addDoc(userCol("vendorPayments"), {
      vendorName,
      vendorPhone: vendorPhone || "",
      product,
      totalCost: purchaseCost,
      amountPaid: vendorAmountPaid,
      remaining: Math.max(0, purchaseCost - vendorAmountPaid),
      date,
      status: vendorAmountPaid >= purchaseCost ? "paid" : vendorAmountPaid > 0 ? "partial" : "unpaid"
    });
    vendorPaymentId = vendorRef.id;
  }
  await addDoc(userCol("inventoryHistory"), {
    product, qty, unit, date,
    type: "in",
    costPerUnit,
    purchaseCost,
    sellingPrice,
    sellingUnit,
    alertThreshold,
    vendorName,
    vendorPhone,
    vendorAmountPaid,
    cashAdjustmentId,
    vendorPaymentId,
    note: note || "Stock added",
    createdAt: serverTimestamp()
  });

  document.getElementById("stockProduct").value      = "";
  document.getElementById("stockQty").value          = "";
  document.getElementById("stockAlert").value        = "";
  document.getElementById("stockNote").value         = "";
  document.getElementById("stockPurchaseCost").value = "";
  document.getElementById("stockSellingPrice").value = "";
  document.getElementById("stockSellingUnit").value  = "kg";
  document.getElementById("vendorName").value        = "";
  document.getElementById("vendorPhone").value       = "";
  document.getElementById("vendorAmountPaid").value  = "";

  showMsg("Stock added successfully!");
};

/* ---------- UPDATE PRODUCT COST IN MAIN PAGE ---------- */
async function updateProductCost(productName, costPerUnit, unit, sellingPrice = 0, sellingUnit = "") {
  const snap = await getDocs(userCol("products"));
  let found  = null;

  snap.forEach(d => {
    if (d.data().name.toLowerCase() === productName.toLowerCase()) {
      found = { id: d.id, ...d.data() };
    }
  });

  if (found) {
    const update = { unit };
    if (costPerUnit !== null && costPerUnit > 0) {
      update.cost = Math.round(costPerUnit * 100) / 100;
      update.costConfigured = true;
    }
    if (sellingPrice > 0) update.sellingPrice = Math.round(sellingPrice * 100) / 100;
    update.sellingUnit = normalizeSellingUnit(sellingUnit, unit);
    await updateDoc(userDoc("products", found.id), update);
  } else {
    await addDoc(userCol("products"), {
      name: productName,
      cost: costPerUnit !== null && costPerUnit > 0 ? Math.round(costPerUnit * 100) / 100 : 0,
      costConfigured: costPerUnit !== null && costPerUnit > 0,
      sellingPrice: sellingPrice > 0 ? Math.round(sellingPrice * 100) / 100 : 0,
      unit,
      sellingUnit: normalizeSellingUnit(sellingUnit, unit)
    });
  }
}

/* ---------- CALCULATE PROFIT ---------- */
function calculateProfit(key, item) {
  if (!item.weightedAvgCost || item.weightedAvgCost === 0) return null;

  const firstDate  = item.firstPurchaseDate || "";
  let totalRevenue = 0;
  let totalQtySold = 0;

  salesData.forEach(sale => {
    if (firstDate && sale.date < firstDate) return;

    sale.items.forEach(si => {
      if (si.product.toLowerCase() !== key) return;
      totalRevenue += Number(si.price || 0);

      let qty = Number(si.qty || 0);
      if (si.unit === "g"  && item.unit === "kg") qty = qty / 1000;
      if (si.unit === "kg" && item.unit === "g")  qty = qty * 1000;
      totalQtySold += qty;
    });
  });

  const cogs   = totalQtySold * item.weightedAvgCost;
  const profit = totalRevenue - cogs;

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalQtySold: Math.round(totalQtySold * 100) / 100,
    cogs:         Math.round(cogs         * 100) / 100,
    profit:       Math.round(profit       * 100) / 100
  };
}

/* ---------- RENDER STOCK CARDS ---------- */
function renderStockCards() {
  const grid    = document.getElementById("stockCards");
  const finGrid = document.getElementById("finishedCards");

  if (Object.keys(inventoryMap).length === 0) {
    grid.innerHTML    = `<p class="empty-msg">No inventory yet</p>`;
    finGrid.innerHTML = `<p class="empty-msg">No finished products</p>`;
    return;
  }

  grid.innerHTML    = "";
  finGrid.innerHTML = "";
  let hasFinished   = false;

  Object.values(inventoryMap)
    .sort((a, b) => a.product.localeCompare(b.product))
    .forEach(item => {
      const key    = item.product.toLowerCase();
      const isLow  = item.alertThreshold > 0 && item.qty <= item.alertThreshold && item.qty > 0;
      const isDone = item.qty === 0;
      const pData  = calculateProfit(key, item);
      const displayQtyParts = formatDisplayQtyForSellingUnit(item.qty, item).split(" ");
      const displayUnit = displayQtyParts.pop() || item.unit;
      const displayQty = displayQtyParts.join(" ");

      const avgCostDisplay = item.weightedAvgCost > 0
        ? `₹${(Math.round(item.weightedAvgCost * 100) / 100).toLocaleString("en-IN")} / ${item.unit}`
        : "—";
      const sellingPriceDisplay = item.sellingPrice > 0
        ? `₹${(Math.round(item.sellingPrice * 100) / 100).toLocaleString("en-IN")} / ${sellingUnitLabel(item.sellingUnit, item.unit)}`
        : "Not set";

      function profitHTML(label) {
        if (!pData) return `
          <div class="profit-block">
            <div class="profit-label">${label}</div>
            <div class="profit-value" style="color:var(--text-muted);font-size:13px;">No cost data</div>
          </div>`;

        const color = pData.profit >= 0 ? "var(--accent)" : "var(--danger)";
        const sign  = pData.profit >= 0 ? "+" : "-";
        return `
          <div class="profit-block">
            <div class="profit-label">${label}</div>
            <div class="profit-value" style="color:${color}">${sign}₹${Math.abs(pData.profit).toLocaleString("en-IN")}</div>
            <div class="profit-sub">Revenue: ₹${pData.totalRevenue.toLocaleString("en-IN")}</div>
            <div class="profit-sub">COGS: ₹${pData.cogs.toLocaleString("en-IN")}</div>
          </div>`;
      }

      if (isDone) {
        if (hiddenProducts.includes(key)) return;
        hasFinished = true;

        const card = document.createElement("div");
        card.className = "stock-card finished";
        card.innerHTML = `
          <div class="product-name">${item.product}</div>
          <div style="margin-bottom:6px;">
            <span class="stock-qty" style="opacity:0.4">0</span>
            <span class="stock-unit">${item.unit}</span>
          </div>
          <div class="finished-badge">✓ Finished</div>
          <div class="card-divider"></div>
          <div class="cost-block">
            <div class="cost-label">Avg Cost / unit</div>
            <div class="cost-value">${avgCostDisplay}</div>
          </div>
          <div class="cost-block">
            <div class="cost-label">Selling Price / unit</div>
            <div class="cost-value">${sellingPriceDisplay}</div>
          </div>
          ${profitHTML("Total Profit")}
          <button class="hide-btn" onclick="hideProduct('${key}')">Archive</button>
        `;
        finGrid.appendChild(card);

      } else {
        const card = document.createElement("div");
        card.className = `stock-card${isLow ? " low" : ""}`;
        card.innerHTML = `
          <div class="card-top-actions">
            <div class="product-name" style="margin-bottom:0">${item.product}</div>
            <div class="card-actions">
              <button class="card-edit-btn" onclick="openLatestPurchaseEdit('${key}')">Edit Latest Stock</button>
              <button class="card-del-btn"  onclick="deleteStock('${key}')">Delete</button>
            </div>
          </div>
          <div style="margin-top:6px;">
            <span class="stock-qty">${displayQty}</span>
            <span class="stock-unit">${displayUnit}</span>
          </div>
          ${item.alertThreshold > 0
            ? `<div class="alert-threshold">Alert at ${item.alertThreshold} ${item.unit}</div>`
            : ""}
          ${isLow ? `<span class="low-badge">⚠ LOW STOCK</span>` : ""}
          <div class="card-divider"></div>
          <div class="cost-block">
            <div class="cost-label">Avg Cost / unit</div>
            <div class="cost-value">${avgCostDisplay}</div>
          </div>
          <div class="cost-block">
            <div class="cost-label">Selling Price / unit</div>
            <div class="cost-value">${sellingPriceDisplay}</div>
          </div>
          ${profitHTML("Profit so far")}
        `;
        grid.appendChild(card);
      }
    });

  if (!hasFinished) {
    finGrid.innerHTML = `<p class="empty-msg">No finished products</p>`;
  }
}

/* ---------- EDIT INDIVIDUAL STOCK PURCHASE ---------- */
window.openLatestPurchaseEdit = (key) => {
  const latest = historyDocs.find(entry => isPurchaseEntry(entry) && normalizeProduct(entry.product) === key);
  if (!latest) {
    showMsg("No editable purchase entry was found for this product.", "error");
    return;
  }
  window.openPurchaseEdit(latest.id);
};

window.openPurchaseEdit = async (historyId) => {
  const entry = historyDocs.find(item => item.id === historyId && isPurchaseEntry(item));
  if (!entry) return;
  let linkedVendor = null;
  if (!entry.vendorName && Number(entry.purchaseCost || 0) > 0) {
    linkedVendor = await findPurchaseFinanceDoc(entry, "vendorPayments");
  }
  editingHistoryId = historyId;
  document.getElementById("editProduct").value = entry.product || "";
  document.getElementById("editQty").value = entry.qty || "";
  document.getElementById("editUnit").value = entry.unit || "kg";
  document.getElementById("editPurchaseCost").value = entry.purchaseCost || "";
  document.getElementById("editSellingPrice").value = entry.sellingPrice || "";
  document.getElementById("editSellingUnit").value = entry.sellingUnit || entry.unit || "kg";
  document.getElementById("editDate").value = entry.date || "";
  document.getElementById("editAlert").value = entry.alertThreshold || "";
  document.getElementById("editVendorName").value = entry.vendorName || linkedVendor?.vendorName || "";
  document.getElementById("editVendorPhone").value = entry.vendorPhone || linkedVendor?.vendorPhone || "";
  document.getElementById("editVendorAmountPaid").value = entry.vendorAmountPaid || linkedVendor?.amountPaid || "";
  document.getElementById("editNote").value = entry.note || "";
  document.getElementById("editModal").classList.remove("hidden");
};

window.closeEditModal = () => {
  editingHistoryId = null;
  document.getElementById("editModal").classList.add("hidden");
  document.getElementById("editMsg").innerText = "";
};

async function findPurchaseFinanceDoc(entry, collectionName) {
  const storedId = collectionName === "cashAdjustments" ? entry.cashAdjustmentId : entry.vendorPaymentId;
  if (storedId) {
    const existing = await getDoc(userDoc(collectionName, storedId));
    if (existing.exists()) return { id: existing.id, ...existing.data() };
  }
  const snap = await getDocs(userCol(collectionName));
  const matches = snap.docs.filter(item => {
    const data = item.data();
    if (normalizeProduct(data.product) !== normalizeProduct(entry.product) || data.date !== entry.date) return false;
    if (collectionName === "cashAdjustments") {
      return data.type === "inventory_purchase" && Number(data.amount || 0) === Number(entry.purchaseCost || 0);
    }
    return Number(data.totalCost || 0) === Number(entry.purchaseCost || 0)
      && (!entry.vendorName || normalizeProduct(data.vendorName) === normalizeProduct(entry.vendorName));
  });
  return matches.length === 1 ? { id: matches[0].id, ...matches[0].data() } : null;
}

async function reconcilePurchaseFinance(oldEntry, newEntry) {
  const oldCash = await findPurchaseFinanceDoc(oldEntry, "cashAdjustments");
  const oldVendor = await findPurchaseFinanceDoc(oldEntry, "vendorPayments");
  let cashAdjustmentId = "";
  let vendorPaymentId = "";
  if (newEntry.vendorName && newEntry.purchaseCost > 0) {
    if (oldCash) await deleteDoc(userDoc("cashAdjustments", oldCash.id));
    const vendorData = {
      vendorName: newEntry.vendorName,
      vendorPhone: newEntry.vendorPhone || "",
      product: newEntry.product,
      totalCost: newEntry.purchaseCost,
      amountPaid: newEntry.vendorAmountPaid,
      remaining: Math.max(0, newEntry.purchaseCost - newEntry.vendorAmountPaid),
      date: newEntry.date,
      status: newEntry.vendorAmountPaid >= newEntry.purchaseCost ? "paid" : newEntry.vendorAmountPaid > 0 ? "partial" : "unpaid"
    };
    if (oldVendor) {
      await updateDoc(userDoc("vendorPayments", oldVendor.id), vendorData);
      vendorPaymentId = oldVendor.id;
    } else {
      vendorPaymentId = (await addDoc(userCol("vendorPayments"), vendorData)).id;
    }
  } else if (newEntry.purchaseCost > 0) {
    if (oldVendor) await deleteDoc(userDoc("vendorPayments", oldVendor.id));
    const cashData = {
      type: "inventory_purchase",
      amount: newEntry.purchaseCost,
      date: newEntry.date,
      product: newEntry.product,
      note: `Inventory purchase: ${newEntry.product} ${newEntry.qty} ${newEntry.unit}`
    };
    if (oldCash) {
      await updateDoc(userDoc("cashAdjustments", oldCash.id), cashData);
      cashAdjustmentId = oldCash.id;
    } else {
      cashAdjustmentId = (await addDoc(userCol("cashAdjustments"), cashData)).id;
    }
  } else {
    if (oldCash) await deleteDoc(userDoc("cashAdjustments", oldCash.id));
    if (oldVendor) await deleteDoc(userDoc("vendorPayments", oldVendor.id));
  }
  return { cashAdjustmentId, vendorPaymentId };
}

async function rebuildProductFromHistory(productName) {
  const key = normalizeProduct(productName);
  if (!key) return;
  const purchases = historyDocs.filter(entry => isPurchaseEntry(entry) && normalizeProduct(entry.product) === key);
  const existing = inventoryMap[key];
  if (!purchases.length) {
    if (existing) await updateDoc(userDoc("inventory", existing.id), { qty: 0, totalInvested: 0, totalQtyBought: 0, weightedAvgCost: 0 });
    return;
  }
  const storageUnit = chooseStorageUnit(...purchases.map(entry => entry.unit), existing?.unit);
  const totalQtyBought = purchases.reduce((sum, entry) => sum + convertQty(entry.qty, entry.unit, storageUnit), 0);
  const totalInvested = purchases.reduce((sum, entry) => sum + Number(entry.purchaseCost || 0), 0);
  const soldQty = historyDocs
    .filter(entry => entry.type === "out" && normalizeProduct(entry.product) === key)
    .reduce((sum, entry) => sum + convertQty(entry.qty, entry.unit, storageUnit), 0);
  const sorted = [...purchases].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const latest = sorted[sorted.length - 1];
  const update = {
    product: latest.product,
    qty: Math.max(0, totalQtyBought - soldQty),
    unit: storageUnit,
    alertThreshold: convertQty(Number(latest.alertThreshold || existing?.alertThreshold || 0), latest.unit || storageUnit, storageUnit),
    weightedAvgCost: totalQtyBought > 0 ? totalInvested / totalQtyBought : 0,
    totalInvested,
    totalQtyBought,
    sellingPrice: Number(latest.sellingPrice || existing?.sellingPrice || 0),
    sellingUnit: normalizeSellingUnit(latest.sellingUnit || existing?.sellingUnit || "", storageUnit),
    firstPurchaseDate: sorted[0].date || "",
    lastPurchaseDate: latest.date || ""
  };
  if (existing) {
    await updateDoc(userDoc("inventory", existing.id), update);
  } else {
    await addDoc(userCol("inventory"), update);
  }
  if (update.weightedAvgCost > 0 || update.sellingPrice > 0) {
    await updateProductCost(latest.product, update.weightedAvgCost > 0 ? update.weightedAvgCost : null, storageUnit, update.sellingPrice, update.sellingUnit);
  }
}

window.saveEdit = async () => {
  const original = historyDocs.find(entry => entry.id === editingHistoryId);
  if (!original) return;
  const updated = {
    ...original,
    product: document.getElementById("editProduct").value.trim(),
    qty: Number(document.getElementById("editQty").value),
    unit: document.getElementById("editUnit").value,
    purchaseCost: Number(document.getElementById("editPurchaseCost").value) || 0,
    sellingPrice: Number(document.getElementById("editSellingPrice").value) || 0,
    sellingUnit: document.getElementById("editSellingUnit").value,
    date: document.getElementById("editDate").value,
    alertThreshold: Number(document.getElementById("editAlert").value) || 0,
    vendorName: document.getElementById("editVendorName").value.trim(),
    vendorPhone: document.getElementById("editVendorPhone").value.trim(),
    vendorAmountPaid: Number(document.getElementById("editVendorAmountPaid").value) || 0,
    note: document.getElementById("editNote").value.trim() || "Stock added"
  };
  if (!updated.product || !updated.qty || !updated.date) {
    document.getElementById("editMsg").innerText = "Please fill product, quantity and date.";
    return;
  }
  if (updated.vendorAmountPaid > updated.purchaseCost) {
    document.getElementById("editMsg").innerText = "Vendor amount paid cannot be more than the purchase cost.";
    return;
  }
  updated.costPerUnit = updated.purchaseCost > 0 ? updated.purchaseCost / updated.qty : 0;
  const financeIds = await reconcilePurchaseFinance(original, updated);
  Object.assign(updated, financeIds);
  await updateDoc(userDoc("inventoryHistory", editingHistoryId), {
    product: updated.product,
    qty: updated.qty,
    unit: updated.unit,
    date: updated.date,
    costPerUnit: updated.costPerUnit,
    purchaseCost: updated.purchaseCost,
    sellingPrice: updated.sellingPrice,
    sellingUnit: updated.sellingUnit,
    alertThreshold: updated.alertThreshold,
    vendorName: updated.vendorName,
    vendorPhone: updated.vendorPhone,
    vendorAmountPaid: updated.vendorAmountPaid,
    cashAdjustmentId: updated.cashAdjustmentId,
    vendorPaymentId: updated.vendorPaymentId,
    note: updated.note,
    editedAt: serverTimestamp()
  });
  historyDocs = historyDocs.map(entry => entry.id === editingHistoryId ? updated : entry);
  await rebuildProductFromHistory(original.product);
  if (normalizeProduct(updated.product) !== normalizeProduct(original.product)) {
    await rebuildProductFromHistory(updated.product);
  }
  closeEditModal();
  showMsg("Stock entry corrected and inventory recalculated.");
};

/* ---------- DELETE STOCK ---------- */
window.deleteStock = async (key) => {
  const item = inventoryMap[key];
  if (!item) return;
  if (!confirm(`Delete ${item.product} from inventory?`)) return;

  await addDoc(userCol("inventoryHistory"), {
    product:           item.product,
    qty:               item.qty,
    unit:              item.unit,
    date:              new Date().toISOString().split("T")[0],
    type:              "deleted",
    costPerUnit:       item.weightedAvgCost,
    purchaseCost:      item.totalInvested,
    totalQtyBought:    item.totalQtyBought,
    alertThreshold:    item.alertThreshold,
    sellingPrice:      item.sellingPrice,
    sellingUnit:       item.sellingUnit,
    weightedAvgCost:   item.weightedAvgCost,
    totalInvested:     item.totalInvested,
    firstPurchaseDate: item.firstPurchaseDate,
    lastPurchaseDate:  item.lastPurchaseDate,
    note:              "Stock deleted"
  });

  await deleteDoc(userDoc("inventory", item.id));
  showMsg(`${item.product} deleted.`);
};

/* ---------- RESTORE STOCK ---------- */
window.restoreStock = async (historyId) => {
  const entry = historyDocs.find(h => h.id === historyId);
  if (!entry) return;
  if (!confirm(`Restore ${entry.product} (${entry.qty} ${entry.unit}) back to inventory?`)) return;

  const key      = entry.product.toLowerCase();
  const existing = inventoryMap[key];

  if (existing) {
    const newTotalQty  = (existing.totalQtyBought || 0) + (entry.totalQtyBought || entry.qty);
    const newTotalCost = (existing.totalInvested  || 0) + (entry.totalInvested  || 0);
    const newAvg       = newTotalQty > 0 ? newTotalCost / newTotalQty : 0;

    await updateDoc(userDoc("inventory", existing.id), {
      qty:             existing.qty + entry.qty,
      weightedAvgCost: newAvg,
      sellingPrice:    entry.sellingPrice || existing.sellingPrice || 0,
      sellingUnit:     normalizeSellingUnit(entry.sellingUnit || existing.sellingUnit || "", existing.unit),
      totalInvested:   newTotalCost,
      totalQtyBought:  newTotalQty
    });
  } else {
    await addDoc(userCol("inventory"), {
      product:           entry.product,
      qty:               entry.qty,
      unit:              entry.unit,
      alertThreshold:    entry.alertThreshold    || 0,
      weightedAvgCost:   entry.weightedAvgCost   || 0,
      sellingPrice:      entry.sellingPrice      || 0,
      sellingUnit:       normalizeSellingUnit(entry.sellingUnit || "", entry.unit),
      totalInvested:     entry.totalInvested     || 0,
      totalQtyBought:    entry.totalQtyBought    || entry.qty,
      firstPurchaseDate: entry.firstPurchaseDate || entry.date,
      lastPurchaseDate:  entry.lastPurchaseDate  || entry.date
    });
  }

  await addDoc(userCol("inventoryHistory"), {
    product:     entry.product,
    qty:         entry.qty,
    unit:        entry.unit,
    date:        new Date().toISOString().split("T")[0],
    type:        "in",
    costPerUnit: entry.weightedAvgCost || 0,
    note:        "Restored from deletion"
  });

  showMsg(`${entry.product} restored!`);
};

/* ---------- HIDE / ARCHIVE FINISHED PRODUCT ---------- */
window.hideProduct = (key) => {
  if (!hiddenProducts.includes(key)) {
    hiddenProducts.push(key);
    localStorage.setItem("hiddenFinished_" + currentUserId, JSON.stringify(hiddenProducts));
    renderStockCards();
  }
};

/* ---------- RENDER ALERTS ---------- */
function renderAlerts() {
  const box      = document.getElementById("alertBox");
  const lowItems = Object.values(inventoryMap).filter(
    item => item.alertThreshold > 0 && item.qty <= item.alertThreshold && item.qty > 0
  );

  if (lowItems.length === 0) { box.classList.add("hidden"); return; }

  box.classList.remove("hidden");
  box.innerHTML = `<strong style="font-size:14px;color:#a05c00;">⚠ Low Stock Alert</strong>` +
    lowItems.map(item =>
      `<p>⚠ <strong>${item.product}</strong> — only ${Math.round(item.qty * 100) / 100} ${item.unit} remaining (alert at ${item.alertThreshold} ${item.unit})</p>`
    ).join("");
}

/* ---------- TOGGLE SECTION ---------- */
window.toggleSection = (id) => {
  document.getElementById(id).classList.toggle("hidden");
};

/* ---------- MSG ---------- */
function showMsg(text, type = "success") {
  const el = document.getElementById("stockMsg");
  el.style.color = type === "error" ? "var(--danger)" : "var(--accent)";
  el.innerText   = text;
  setTimeout(() => el.innerText = "", 3000);
}
