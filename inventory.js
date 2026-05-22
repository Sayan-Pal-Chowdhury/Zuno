import { db, auth } from "./firebase.js";
import {
  collection, addDoc, onSnapshot,
  doc, updateDoc, deleteDoc,
  query, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { findProductImage } from "./product-images.js";
import { shouldReplaceAutoImage } from "./marketplace-visuals.js";
import { attachSuggestionDropdown, COMMON_ITEM_NAMES, mergeSuggestions, renderOptions } from "./item-suggestions.js";
import { normalizeSellingUnit, sellingUnitLabel } from "./unit-pricing.js";

/* ---------- STATE ---------- */
let currentUserId  = null;
let inventoryMap   = {};
let salesData      = [];
let historyDocs    = [];
let editingId      = null;
let hiddenProducts = [];
let productSuggestions = COMMON_ITEM_NAMES;

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

  if (!product || !qty || !date) {
    showMsg("Please fill product, quantity and date.", "error");
    return;
  }

  const costPerUnit = purchaseCost > 0 ? purchaseCost / qty : 0;
  const key         = product.toLowerCase();
  const existing    = inventoryMap[key];

  if (existing) {
    const prevTotalQty   = existing.totalQtyBought || 0;
    const prevTotalCost  = existing.totalInvested  || 0;
    const newTotalQty    = prevTotalQty + qty;
    const newTotalCost   = prevTotalCost + purchaseCost;
    const newWeightedAvg = newTotalQty > 0 ? newTotalCost / newTotalQty : 0;
    const isNewer        = date > (existing.lastPurchaseDate || "");

    await updateDoc(userDoc("inventory", existing.id), {
      qty:             existing.qty + qty,
      unit,
      alertThreshold,
      weightedAvgCost: newWeightedAvg,
      totalInvested:   newTotalCost,
      totalQtyBought:  newTotalQty,
      ...(sellingPrice > 0 && { sellingPrice }),
      sellingUnit:     normalizeSellingUnit(sellingUnit, unit),
      ...(isNewer && { lastPurchaseDate: date })
    });

    if ((costPerUnit > 0 && isNewer) || sellingPrice > 0) {
      await updateProductCost(product, costPerUnit > 0 && isNewer ? costPerUnit : null, unit, sellingPrice, sellingUnit);
    }

  } else {
    await addDoc(userCol("inventory"), {
      product, qty, unit, alertThreshold,
      weightedAvgCost:   costPerUnit,
      totalInvested:     purchaseCost,
      totalQtyBought:    qty,
      sellingPrice,
      sellingUnit:       normalizeSellingUnit(sellingUnit, unit),
      firstPurchaseDate: date,
      lastPurchaseDate:  date
    });

    if (costPerUnit > 0 || sellingPrice > 0) {
      await updateProductCost(product, costPerUnit > 0 ? costPerUnit : null, unit, sellingPrice, sellingUnit);
    }
  }

  await addDoc(userCol("inventoryHistory"), {
    product, qty, unit, date,
    type: "in",
    costPerUnit,
    purchaseCost,
    note: note || "Stock added"
  });

  const vendorName       = document.getElementById("vendorName").value.trim();
const vendorPhone      = document.getElementById("vendorPhone").value.trim();
const vendorAmountPaid = Number(document.getElementById("vendorAmountPaid").value) || 0;

const cashPurchaseAmount = vendorName ? 0 : purchaseCost;
if (cashPurchaseAmount > 0) {
  await addDoc(userCol("cashAdjustments"), {
    type: "inventory_purchase",
    amount: cashPurchaseAmount,
    date,
    product,
    note: `Inventory purchase: ${product} ${qty} ${unit}`
  });
}

if (vendorName && purchaseCost > 0) {
  await addDoc(userCol("vendorPayments"), {
    vendorName,
    vendorPhone: vendorPhone || "",
    product,
    totalCost:   purchaseCost,
    amountPaid:  vendorAmountPaid,
    remaining:   Math.max(0, purchaseCost - vendorAmountPaid),
    date,
    status:      vendorAmountPaid >= purchaseCost ? "paid" : vendorAmountPaid > 0 ? "partial" : "unpaid"
  });
}

  document.getElementById("stockProduct").value      = "";
  document.getElementById("stockQty").value          = "";
  document.getElementById("stockAlert").value        = "";
  document.getElementById("stockNote").value         = "";
  document.getElementById("stockPurchaseCost").value = "";
  document.getElementById("stockSellingPrice").value = "";
  document.getElementById("stockSellingUnit").value  = "kg";
  document.getElementById("vendorName").value       = "";
document.getElementById("vendorPhone").value      = "";
document.getElementById("vendorAmountPaid").value = "";

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
    if (costPerUnit !== null && costPerUnit > 0) update.cost = Math.round(costPerUnit * 100) / 100;
    if (sellingPrice > 0) update.sellingPrice = Math.round(sellingPrice * 100) / 100;
    update.sellingUnit = normalizeSellingUnit(sellingUnit, unit);
    await updateDoc(userDoc("products", found.id), update);
  } else {
    await addDoc(userCol("products"), {
      name: productName,
      cost: costPerUnit !== null && costPerUnit > 0 ? Math.round(costPerUnit * 100) / 100 : 0,
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
              <button class="card-edit-btn" onclick="openEditModal('${key}')">Edit</button>
              <button class="card-del-btn"  onclick="deleteStock('${key}')">Delete</button>
            </div>
          </div>
          <div style="margin-top:6px;">
            <span class="stock-qty">${Math.round(item.qty * 100) / 100}</span>
            <span class="stock-unit">${item.unit}</span>
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

/* ---------- OPEN EDIT MODAL ---------- */
window.openEditModal = (key) => {
  const item = inventoryMap[key];
  if (!item) return;
  editingId = item.id;
  document.getElementById("editProduct").value      = item.product;
  document.getElementById("editQty").value          = item.qty;
  document.getElementById("editPurchaseCost").value = item.totalInvested || "";
  document.getElementById("editSellingPrice").value = item.sellingPrice || "";
  document.getElementById("editSellingUnit").value  = item.sellingUnit || item.unit || "kg";
  document.getElementById("editDate").value         = item.lastPurchaseDate || "";
  document.getElementById("editModal").classList.remove("hidden");
};

window.closeEditModal = () => {
  editingId = null;
  document.getElementById("editModal").classList.add("hidden");
  document.getElementById("editMsg").innerText = "";
};

/* ---------- SAVE EDIT ---------- */
window.saveEdit = async () => {
  const newProduct      = document.getElementById("editProduct").value.trim();
  const newQty          = Number(document.getElementById("editQty").value);
  const newPurchaseCost = Number(document.getElementById("editPurchaseCost").value) || 0;
  const newSellingPrice = Number(document.getElementById("editSellingPrice").value) || 0;
  const newSellingUnit  = document.getElementById("editSellingUnit").value;
  const newDate         = document.getElementById("editDate").value;

  if (!newProduct || isNaN(newQty)) {
    document.getElementById("editMsg").innerText = "Please fill all fields.";
    return;
  }

  const item = Object.values(inventoryMap).find(i => i.id === editingId);
  if (!item) return;

  const oldQty  = item.qty;
  const qtyDiff = newQty - oldQty;

  if (qtyDiff !== 0) {
    await addDoc(userCol("inventoryHistory"), {
      product: newProduct,
      qty:     Math.abs(qtyDiff),
      unit:    item.unit,
      date:    new Date().toISOString().split("T")[0],
      type:    qtyDiff > 0 ? "in" : "out",
      note:    `Edit adjustment — qty changed from ${oldQty} to ${newQty}`
    });
  }

  const newCostPerUnit = newPurchaseCost > 0 && item.totalQtyBought > 0
    ? newPurchaseCost / item.totalQtyBought
    : item.weightedAvgCost;

  const isNewer = newDate && newDate > (item.lastPurchaseDate || "");

  await updateDoc(userDoc("inventory", editingId), {
    product:         newProduct,
    qty:             newQty,
    totalInvested:   newPurchaseCost || item.totalInvested,
    weightedAvgCost: newCostPerUnit,
    sellingPrice:    newSellingPrice,
    sellingUnit:     normalizeSellingUnit(newSellingUnit, item.unit),
    ...(isNewer && { lastPurchaseDate: newDate })
  });

  if ((newCostPerUnit > 0 && isNewer) || newSellingPrice > 0) {
    await updateProductCost(newProduct, newCostPerUnit > 0 && isNewer ? newCostPerUnit : null, item.unit, newSellingPrice, newSellingUnit);
  }

  await addDoc(userCol("inventoryHistory"), {
    product:      newProduct,
    qty:          newQty,
    unit:         item.unit,
    date:         new Date().toISOString().split("T")[0],
    type:         "edit",
    costPerUnit:  newCostPerUnit,
    purchaseCost: newPurchaseCost,
    note:         `Edited — was: ${item.product} ${item.qty}${item.unit} @ ₹${Math.round(item.weightedAvgCost * 100) / 100}/unit`
  });

  closeEditModal();
  showMsg("Stock updated successfully!");
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
