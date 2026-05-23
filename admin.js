import { auth, db } from "./firebase.js";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  addDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { imageLibraryId } from "./product-images.js";

const ADMIN_EMAILS = ["sayan123401@gmail.com"];

let shops = [];
let profiles = [];
let orders = [];
let customers = [];
let imageCandidates = [];
let paymentSettings = {};
let settlements = [];
let queries = [];

const provider = new GoogleAuthProvider();
const gate = document.getElementById("adminGate");
const app = document.getElementById("adminApp");
const gateMsg = document.getElementById("gateMsg");

document.getElementById("adminLoginBtn").onclick = () => signInWithPopup(auth, provider);
document.getElementById("logoutBtn").onclick = () => signOut(auth);
document.getElementById("refreshBtn").onclick = loadAdminData;

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(panel => panel.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(`panel-${button.dataset.tab}`).classList.add("active");
  });
});

["vendorSearch", "shopSearchAdmin", "orderSearch", "customerSearch", "paymentSearch", "querySearch"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", renderAll);
});
document.getElementById("scanImagesBtn").onclick = scanMissingImages;
document.getElementById("adminImageSaveBtn").onclick = updateProductImageEverywhere;
document.getElementById("savePaymentSettingsBtn").onclick = savePaymentSettings;
document.getElementById("refreshSettlementsBtn").onclick = loadAdminData;

onAuthStateChanged(auth, async user => {
  if (!user) {
    gate.style.display = "grid";
    app.style.display = "none";
    gateMsg.textContent = "";
    return;
  }

  if (!ADMIN_EMAILS.includes(user.email || "")) {
    gate.style.display = "grid";
    app.style.display = "none";
    gateMsg.textContent = "This account is not allowed to open the admin dashboard.";
    return;
  }

  gate.style.display = "none";
  app.style.display = "grid";
  document.getElementById("adminSub").textContent = user.email;
  await loadAdminData();
});

async function loadAdminData() {
  await Promise.all([
    loadShops(),
    loadProfiles(),
    loadOrders(),
    loadCustomers(),
    loadQueries(),
    loadPaymentSettings(),
    loadSettlements()
  ]);
  renderAll();
}

async function loadShops() {
  const snap = await getDocs(collection(db, "storeIndex"));
  shops = [];
  snap.forEach(item => shops.push({ storeId: item.id, ...item.data() }));
}

async function loadProfiles() {
  const snap = await getDocs(collectionGroup(db, "settings"));
  profiles = [];
  snap.forEach(item => {
    if (item.id !== "profile") return;
    const uid = item.ref.parent.parent?.id || "";
    profiles.push({ uid, ...item.data() });
  });
}

async function loadOrders() {
  const snap = await getDocs(collectionGroup(db, "customerOrders"));
  orders = [];
  snap.forEach(item => {
    const uid = item.ref.parent.parent?.id || "";
    orders.push({ id: item.id, uid, ...item.data() });
  });
  orders.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
}

async function loadCustomers() {
  const [publicSnap, nestedSnap] = await Promise.all([
    getDocs(collection(db, "customers")),
    getDocs(collectionGroup(db, "customers"))
  ]);
  const customerMap = new Map();

  publicSnap.forEach(item => {
    customerMap.set(item.id, { id: item.id, uid: item.id, source: "customer-login", ...item.data() });
  });

  nestedSnap.forEach(item => {
    const uid = item.ref.parent.parent?.id || item.id;
    if (customerMap.has(item.id)) return;
    customerMap.set(item.id, { id: item.id, uid, source: "shop-record", ...item.data() });
  });

  customers = [...customerMap.values()].sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
}

async function loadQueries() {
  const snap = await getDocs(collection(db, "adminQueries"));
  queries = [];
  snap.forEach(item => queries.push({ id: item.id, ...item.data() }));
  queries.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
}

async function loadPaymentSettings() {
  const snap = await getDoc(doc(db, "platformSettings", "payment"));
  paymentSettings = snap.exists() ? snap.data() : {};
  document.getElementById("adminPaymentUpi").value = paymentSettings.upiId || paymentSettings.phonePeNumber || "";
  document.getElementById("adminPaymentName").value = paymentSettings.displayName || "Zuno";
  document.getElementById("adminPaymentNote").value = paymentSettings.note || "";
}

async function loadSettlements() {
  const snap = await getDocs(collection(db, "vendorSettlements"));
  settlements = [];
  snap.forEach(item => settlements.push({ id: item.id, ...item.data() }));
  settlements.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
}

function renderAll() {
  renderStats();
  renderVendors();
  renderShops();
  renderOrders();
  renderCustomers();
  renderQueries();
  renderPayments();
  renderSettlements();
  renderImages();
}

function renderStats() {
  document.getElementById("statShops").textContent = shops.length;
  document.getElementById("statPending").textContent =
    shops.filter(shop => getApproval(shop) === "pending").length;
  document.getElementById("statOrders").textContent =
    orders.filter(order => !["delivered", "rejected"].includes(order.status)).length;
  document.getElementById("statCustomers").textContent = customers.length;
}

function renderVendors() {
  const search = getSearch("vendorSearch");
  const vendorRows = shops
    .filter(shop => getApproval(shop) !== "approved")
    .filter(shop => matches(shop, search));

  renderList("vendorsList", vendorRows, shop => `
    <div class="row">
      <div>
        <div class="row-title">${escapeHtml(shop.name || "Shop")}</div>
        <div class="row-sub">${escapeHtml(shop.location || "")}</div>
      </div>
      <span class="badge ${getApproval(shop)}">${getApproval(shop)}</span>
      <div class="row-sub">${escapeHtml(formatShopType(shop.shopType))}<br>${escapeHtml(shop.uid || "")}</div>
      <div class="row-actions">
        <button class="good" onclick="approveVendor('${shop.storeId}')">Approve</button>
        <button class="bad" onclick="rejectVendor('${shop.storeId}')">Reject</button>
      </div>
    </div>
  `);
}

function renderShops() {
  const search = getSearch("shopSearchAdmin");
  const rows = shops.filter(shop => matches(shop, search));
  renderList("adminShopsList", rows, shop => `
    <div class="row">
      <div>
        <div class="row-title">${escapeHtml(shop.name || "Shop")}</div>
        <div class="row-sub">${escapeHtml(shop.location || "")}</div>
      </div>
      <div>
        <span class="badge ${getApproval(shop)}">${getApproval(shop)}</span>
        <span class="badge ${shop.deliveryEnabled === false ? "off" : "on"}">${shop.deliveryEnabled === false ? "Pickup only" : "Delivery on"}</span>
        ${shop.promotedAt ? `<span class="badge on">Promoted</span>` : ""}
      </div>
      <div class="row-sub">${escapeHtml(formatShopType(shop.shopType))}<br>${shop.isLive === false ? "Hidden from public" : "Visible publicly"}</div>
      <div class="row-actions">
        <button class="good" onclick="approveVendor('${shop.storeId}')">Approve</button>
        <button class="good" onclick="pushShop('${shop.storeId}')">Push top</button>
        <button class="blue" onclick="toggleShopLive('${shop.storeId}')">${shop.isLive === false ? "Show" : "Hide"}</button>
        <button onclick="toggleShopDelivery('${shop.storeId}')">${shop.deliveryEnabled === false ? "Delivery on" : "Pickup only"}</button>
      </div>
      <div class="feature-actions">
        <button class="${shop.inventoryEnabled === false ? "bad" : "good"}" onclick="toggleShopFeature('${shop.storeId}', 'inventoryEnabled')">Inventory ${shop.inventoryEnabled === false ? "off" : "on"}</button>
        <button class="${shop.creditEnabled === false ? "bad" : "good"}" onclick="toggleShopFeature('${shop.storeId}', 'creditEnabled')">Credit ${shop.creditEnabled === false ? "off" : "on"}</button>
        <button class="${shop.publicOrdersEnabled === false ? "bad" : "good"}" onclick="toggleShopFeature('${shop.storeId}', 'publicOrdersEnabled')">Orders ${shop.publicOrdersEnabled === false ? "off" : "on"}</button>
        <button class="${shop.publicShopEnabled === false ? "bad" : "good"}" onclick="toggleShopFeature('${shop.storeId}', 'publicShopEnabled')">Shop ${shop.publicShopEnabled === false ? "off" : "on"}</button>
        <button class="${shop.forceInStock === true ? "good" : ""}" onclick="toggleShopFeature('${shop.storeId}', 'forceInStock')">Force stock ${shop.forceInStock === true ? "on" : "off"}</button>
      </div>
    </div>
  `);
}

function renderOrders() {
  const search = getSearch("orderSearch");
  const rows = orders.filter(order => matches(order, search));
  renderList("ordersAdminList", rows, order => `
    <div class="row">
      <div>
        <div class="row-title">${escapeHtml(order.customerName || "Customer")} · ${formatMoney(order.totalAmount)}</div>
        <div class="row-sub">${escapeHtml(order.shopName || order.storeId || "Shop")} · ${escapeHtml(order.customerPhone || "")}<br>${formatPayment(order)}</div>
      </div>
      <span class="badge ${order.status || "pending"}">${escapeHtml(order.status || "new")}</span>
      <div class="row-sub">${escapeHtml(order.fulfillmentType || "delivery")}<br>${escapeHtml(order.assignedTo || "Unassigned")}</div>
      <div class="assign-box">
        <input id="assign-${order.uid}-${order.id}" placeholder="Assign to">
        <button class="blue" onclick="assignOrder('${order.uid}', '${order.id}')">Assign</button>
        <button onclick="setOrderStatus('${order.uid}', '${order.id}', 'packed')">Packed</button>
        <button class="good" onclick="setOrderStatus('${order.uid}', '${order.id}', 'delivered')">Complete</button>
      </div>
    </div>
  `);
}

function renderCustomers() {
  const search = getSearch("customerSearch");
  const rows = customers.filter(customer => matches(customer, search));
  renderList("customersAdminList", rows, customer => `
    <div class="row">
      <div>
        <div class="row-title">${escapeHtml(customer.name || customer.customer || "Customer")}</div>
        <div class="row-sub">${escapeHtml(customer.phone || customer.email || "")}</div>
      </div>
      <span class="badge">${escapeHtml(customer.source || customer.type || "customer")}</span>
      <div class="row-sub">${escapeHtml(customer.uid || "")}</div>
      <div class="row-actions">
        <button onclick="alert('Customer detail view can be added next.')">View</button>
      </div>
    </div>
  `);
}

function renderQueries() {
  const search = getSearch("querySearch");
  const rows = queries.filter(item => matches(item, search));
  renderList("queriesAdminList", rows, item => `
    <div class="row">
      <div>
        <div class="row-title">${escapeHtml(item.shopName || item.ownerName || "User")}</div>
        <div class="row-sub">${escapeHtml(item.email || item.uid || "")}</div>
      </div>
      <span class="badge ${item.status === "done" ? "approved" : "pending"}">${escapeHtml(item.status || "new")}</span>
      <div class="row-sub">${escapeHtml(item.text || "")}</div>
      <div class="row-actions">
        <button class="good" onclick="markQueryDone('${item.id}')">Done</button>
      </div>
    </div>
  `);
}

window.markQueryDone = async id => {
  await updateDoc(doc(db, "adminQueries", id), {
    status: "done",
    updatedAt: serverTimestamp()
  });
  await loadQueries();
  renderAll();
};

function renderPayments() {
  const search = getSearch("paymentSearch");
  const rows = orders
    .filter(order => order.paymentMode === "online")
    .filter(order => matches(order, search));

  renderList("paymentsAdminList", rows, order => `
    <div class="row">
      <div>
        <div class="row-title">${escapeHtml(order.customerName || "Customer")} · ${formatMoney(order.totalAmount)}</div>
        <div class="row-sub">${escapeHtml(order.shopName || order.storeId || "Shop")} · ${escapeHtml(order.customerPhone || "")}</div>
      </div>
      <span class="badge ${paymentBadgeClass(order.paymentStatus)}">${paymentLabel(order.paymentStatus)}</span>
      <div class="row-sub">Admin UPI: ${escapeHtml(order.adminPaymentUpi || paymentSettings.upiId || "")}<br>Settlement: ${escapeHtml(order.settlementStatus || "unsettled")}</div>
      <div class="row-actions">
        <button class="good" onclick="verifyPayment('${order.uid}', '${order.id}')">Verify</button>
        <button class="bad" onclick="rejectPayment('${order.uid}', '${order.id}')">Reject</button>
      </div>
    </div>
  `);
}

function renderSettlements() {
  const onlineVerified = orders.filter(order => order.paymentMode === "online" && order.paymentStatus === "online_verified");
  const settledOrderIds = new Set(settlements.flatMap(item => item.orderIds || []));
  const gross = onlineVerified.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
  const settled = onlineVerified
    .filter(order => settledOrderIds.has(order.id))
    .reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
  const dueOrders = onlineVerified.filter(order => !settledOrderIds.has(order.id) && order.settlementStatus !== "settled");
  const due = dueOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
  const vendorMap = new Map();

  dueOrders.forEach(order => {
    const key = order.uid || order.storeId || "unknown";
    const current = vendorMap.get(key) || {
      uid: order.uid,
      shopName: order.shopName || order.storeId || "Shop",
      amount: 0,
      count: 0,
      orderIds: [],
      settlementUpi: order.vendorSettlementUpi || "",
      settlementName: order.vendorSettlementName || ""
    };
    current.amount += Number(order.totalAmount || 0);
    current.count++;
    current.orderIds.push(order.id);
    vendorMap.set(key, current);
  });

  document.getElementById("settleGross").textContent = formatMoney(gross);
  document.getElementById("settlePaid").textContent = formatMoney(settled);
  document.getElementById("settleDue").textContent = formatMoney(due);
  document.getElementById("settleVendors").textContent = vendorMap.size;

  const vendors = [...vendorMap.values()].sort((a, b) => b.amount - a.amount);
  renderList("settlementsAdminList", vendors, vendor => `
    <div class="row">
      <div>
        <div class="row-title">${escapeHtml(vendor.shopName)} · ${formatMoney(vendor.amount)}</div>
        <div class="row-sub">${vendor.count} verified online orders</div>
      </div>
      <span class="badge pending">to settle</span>
      <div class="row-sub">${escapeHtml(vendor.settlementName || "No settlement name")}<br>${escapeHtml(vendor.settlementUpi || "No settlement UPI")}</div>
      <div class="row-actions">
        <button class="good" onclick='markVendorSettled(${JSON.stringify(vendor.uid)}, ${JSON.stringify(vendor.shopName)}, ${JSON.stringify(vendor.orderIds)}, ${vendor.amount})'>Mark settled</button>
      </div>
    </div>
  `);

  renderList("settlementHistoryList", settlements, item => `
    <div class="row">
      <div>
        <div class="row-title">${escapeHtml(item.shopName || "Shop")} · ${formatMoney(item.amount)}</div>
        <div class="row-sub">${(item.orderIds || []).length} orders · ${item.date || ""}</div>
      </div>
      <span class="badge approved">settled</span>
      <div class="row-sub">${escapeHtml(item.settlementMethod || "")}<br>${escapeHtml(item.note || "")}</div>
      <div class="row-sub">${escapeHtml(item.markedBy || "")}</div>
    </div>
  `);
}

function renderImages() {
  const list = document.getElementById("adminImagesList");
  if (!list) return;
  if (imageCandidates.length === 0) {
    list.innerHTML = `<div class="empty">No missing/default product or menu images found yet.</div>`;
    return;
  }
  renderList("adminImagesList", imageCandidates, item => `
    <div class="row">
      <div>
        <div class="row-title">${escapeHtml(item.product)}</div>
        <div class="row-sub">${item.count} matching records need image review</div>
      </div>
      <span class="badge pending">image needed</span>
      <div class="row-sub">${escapeHtml(item.shops.slice(0, 3).join(", "))}</div>
      <div class="row-actions">
        <button class="blue" onclick='prepareImageProduct(${JSON.stringify(item.product)})'>Use name</button>
      </div>
    </div>
  `);
}

function renderList(id, rows, template) {
  const el = document.getElementById(id);
  el.innerHTML = rows.length ? rows.map(template).join("") : `<div class="empty">Nothing to show.</div>`;
}

window.approveVendor = async storeId => {
  await updateShopApproval(storeId, "approved", true);
};

window.rejectVendor = async storeId => {
  await updateShopApproval(storeId, "rejected", false);
};

window.toggleShopLive = async storeId => {
  const shop = shops.find(item => item.storeId === storeId);
  if (!shop) return;
  await updateShopFields(shop, { isLive: shop.isLive === false, updatedAt: serverTimestamp() });
};

window.toggleShopDelivery = async storeId => {
  const shop = shops.find(item => item.storeId === storeId);
  if (!shop) return;
  await updateShopFields(shop, { deliveryEnabled: shop.deliveryEnabled === false, updatedAt: serverTimestamp() });
};

window.pushShop = async storeId => {
  const shop = shops.find(item => item.storeId === storeId);
  if (!shop) return;
  await updateShopFields(shop, { promotedAt: serverTimestamp(), updatedAt: serverTimestamp() });
};

window.toggleShopFeature = async (storeId, field) => {
  const shop = shops.find(item => item.storeId === storeId);
  if (!shop) return;
  const next = field === "forceInStock" ? shop[field] !== true : shop[field] === false;
  const fields = { [field]: next, updatedAt: serverTimestamp() };
  if (field === "publicShopEnabled") fields.isLive = next && getApproval(shop) === "approved";
  await updateShopFields(shop, fields);
};

window.assignOrder = async (uid, orderId) => {
  const input = document.getElementById(`assign-${uid}-${orderId}`);
  const assignedTo = input.value.trim();
  if (!assignedTo) return;
  await updateDoc(doc(db, "users", uid, "customerOrders", orderId), {
    assignedTo,
    updatedAt: serverTimestamp()
  });
  await loadOrders();
  renderAll();
};

window.setOrderStatus = async (uid, orderId, status) => {
  await updateDoc(doc(db, "users", uid, "customerOrders", orderId), {
    status,
    updatedAt: serverTimestamp()
  });
  await loadOrders();
  renderAll();
};

window.verifyPayment = async (uid, orderId) => {
  await updateDoc(doc(db, "users", uid, "customerOrders", orderId), {
    paymentStatus: "online_verified",
    paymentVerifiedAt: serverTimestamp(),
    paymentVerifiedBy: auth.currentUser?.email || "admin",
    settlementStatus: "unsettled",
    updatedAt: serverTimestamp()
  });
  await loadOrders();
  renderAll();
};

window.rejectPayment = async (uid, orderId) => {
  await updateDoc(doc(db, "users", uid, "customerOrders", orderId), {
    paymentStatus: "online_rejected",
    paymentRejectedAt: serverTimestamp(),
    paymentRejectedBy: auth.currentUser?.email || "admin",
    updatedAt: serverTimestamp()
  });
  await loadOrders();
  renderAll();
};

window.markVendorSettled = async (uid, shopName, orderIds, amount) => {
  if (!Array.isArray(orderIds) || orderIds.length === 0) return;
  if (!confirm(`Mark ${formatMoney(amount)} settled for ${shopName}?`)) return;
  const related = orders.filter(order => order.uid === uid && orderIds.includes(order.id));
  const settlementMethod = related[0]?.vendorSettlementUpi || "";
  await addDoc(collection(db, "vendorSettlements"), {
    uid,
    shopName,
    amount,
    orderIds,
    settlementMethod,
    date: new Date().toISOString().split("T")[0],
    status: "settled",
    markedBy: auth.currentUser?.email || "admin",
    createdAt: serverTimestamp()
  });
  await Promise.all(orderIds.map(orderId => updateDoc(doc(db, "users", uid, "customerOrders", orderId), {
    settlementStatus: "settled",
    settledAt: serverTimestamp()
  })));
  await loadAdminData();
};

async function savePaymentSettings() {
  const upi = document.getElementById("adminPaymentUpi").value.trim();
  const name = document.getElementById("adminPaymentName").value.trim() || "Zuno";
  const note = document.getElementById("adminPaymentNote").value.trim();
  await setDoc(doc(db, "platformSettings", "payment"), {
    upiId: upi,
    phonePeNumber: upi,
    displayName: name,
    note,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.email || "admin"
  }, { merge: true });
  document.getElementById("paymentSettingsMsg").textContent = "Payment settings saved.";
  await loadPaymentSettings();
}

window.prepareImageProduct = product => {
  document.getElementById("adminImageProduct").value = product;
  document.getElementById("adminImageProduct").focus();
};

async function scanMissingImages() {
  const [inventorySnap, productsSnap, foodItemsSnap] = await Promise.all([
    getDocs(collectionGroup(db, "inventory")),
    getDocs(collectionGroup(db, "products")),
    getDocs(collectionGroup(db, "foodItems"))
  ]);
  const map = new Map();
  const addCandidate = (name, shopName = "Shop") => {
    const product = String(name || "").trim();
    if (!product) return;
    const key = product.toLowerCase();
    const current = map.get(key) || { product, count: 0, shops: [] };
    current.count++;
    if (shopName && !current.shops.includes(shopName)) current.shops.push(shopName);
    map.set(key, current);
  };

  inventorySnap.forEach(item => {
    const data = item.data();
    if (!data.imageUrl || isDefaultImage(data.imageUrl)) addCandidate(data.product || data.name, data.shopName || "");
  });
  productsSnap.forEach(item => {
    const data = item.data();
    if (!data.imageUrl || isDefaultImage(data.imageUrl)) addCandidate(data.name || data.product, data.shopName || "");
  });
  foodItemsSnap.forEach(item => {
    const data = item.data();
    if (!data.imageUrl || isDefaultImage(data.imageUrl)) addCandidate(data.name || data.product, "Food menu");
  });

  imageCandidates = [...map.values()].sort((a, b) => b.count - a.count || a.product.localeCompare(b.product));
  renderImages();
}

async function updateProductImageEverywhere() {
  const product = document.getElementById("adminImageProduct").value.trim();
  const file = document.getElementById("adminImageFile").files[0];
  const msg = document.getElementById("adminImageMsg");
  if (!product || !file) {
    msg.textContent = "Choose product name and image file.";
    return;
  }

  msg.textContent = "Preparing image...";
  const imageUrl = await fileToDataUrl(file);
  const [inventorySnap, productsSnap, foodItemsSnap] = await Promise.all([
    getDocs(collectionGroup(db, "inventory")),
    getDocs(collectionGroup(db, "products")),
    getDocs(collectionGroup(db, "foodItems"))
  ]);

  const updates = [];
  inventorySnap.forEach(item => {
    const data = item.data();
    if (sameProduct(data.product || data.name, product)) updates.push(updateDoc(item.ref, { imageUrl, imageUpdatedAt: serverTimestamp() }));
  });
  productsSnap.forEach(item => {
    const data = item.data();
    if (sameProduct(data.name || data.product, product)) updates.push(updateDoc(item.ref, { imageUrl, imageUpdatedAt: serverTimestamp() }));
  });
  foodItemsSnap.forEach(item => {
    const data = item.data();
    if (sameProduct(data.name || data.product, product)) updates.push(updateDoc(item.ref, { imageUrl, imageUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });

  await Promise.all([
    ...updates,
    setDoc(doc(db, "platformSettings", `itemImage_${imageLibraryId(product)}`), {
      name: product,
      imageUrl,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.email || "admin"
    }, { merge: true })
  ]);
  msg.textContent = `Saved default image and updated ${updates.length} matching records for ${product}.`;
  document.getElementById("adminImageFile").value = "";
  await scanMissingImages();
}

async function updateShopApproval(storeId, approvalStatus, isLive) {
  const shop = shops.find(item => item.storeId === storeId);
  if (!shop) return;
  await updateShopFields(shop, { approvalStatus, isLive, updatedAt: serverTimestamp() });
}

async function updateShopFields(shop, fields) {
  await setDoc(doc(db, "storeIndex", shop.storeId), fields, { merge: true });
  if (shop.uid) {
    await setDoc(doc(db, "users", shop.uid, "settings", "profile"), fields, { merge: true });
  }
  await loadAdminData();
}

function getApproval(shop) {
  return shop.approvalStatus || "approved";
}

function getSearch(id) {
  return document.getElementById(id).value.toLowerCase().trim();
}

function matches(item, search) {
  if (!search) return true;
  return JSON.stringify(item).toLowerCase().includes(search);
}

function formatShopType(type = "other") {
  const labels = {
    food: "Food",
    grocery: "Kirana / Grocery",
    hardware: "Hardware",
    pharmacy: "Pharmacy",
    general: "General Store",
    other: "Other"
  };
  return labels[type] || labels.other;
}

function formatMoney(value) {
  return `Rs ${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function formatPayment(order = {}) {
  if (order.paymentMode === "online") return `Online: ${paymentLabel(order.paymentStatus)}`;
  return order.paymentStatus === "cod_collected" ? "COD collected" : "COD";
}

function paymentLabel(status = "") {
  const labels = {
    online_submitted: "payment submitted",
    online_verified: "payment verified",
    online_rejected: "payment rejected",
    cod: "COD",
    cod_collected: "COD collected"
  };
  return labels[status] || status || "COD";
}

function paymentBadgeClass(status = "") {
  if (status === "online_verified" || status === "cod_collected") return "approved";
  if (status === "online_rejected") return "rejected";
  return "pending";
}

function getTime(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return 0;
}

function sameProduct(a = "", b = "") {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function isDefaultImage(url = "") {
  return !url || String(url).startsWith("data:image/svg+xml") || /wikimedia|wikipedia|commons\.|thumbnail/i.test(String(url));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const max = 720;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.76));
      };
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
