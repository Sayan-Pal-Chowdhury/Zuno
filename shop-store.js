import { db } from "./firebase.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getBusinessType } from "./marketplace-categories.js";
import { getProductVisual, shouldReplaceAutoImage } from "./marketplace-visuals.js";
import { calculateSellingLineTotal, normalizeSellingUnit } from "./unit-pricing.js";

export function getStoreId() {
  return new URLSearchParams(window.location.search).get("store") || "";
}

export async function getShopProfile(storeId = getStoreId()) {
  if (!storeId) return null;

  const indexSnap = await getDoc(doc(db, "storeIndex", storeId));
  if (!indexSnap.exists()) return null;

  const indexData = indexSnap.data();
  const uid = indexData.uid;
  if (!uid) return null;

  let profileSnap;
  try {
    profileSnap = await getDoc(doc(db, "users", uid, "settings", "profile"));
  } catch (error) {
    console.warn("Shop profile is not public:", error);
    return null;
  }
  const profile = profileSnap.exists() ? profileSnap.data() : {};
  const visibility = getPublicVisibility(profile, indexData);

  return {
    uid,
    storeId,
    name: profile.name || indexData.name || "Shop",
    location: profile.location || indexData.location || "",
    tagline: profile.tagline || "Fresh products, fair prices",
    coverPhotoUrl: profile.coverPhotoUrl || indexData.coverPhotoUrl || "",
    shopType: profile.shopType || indexData.shopType || "daily_needs",
    businessType: profile.businessType || indexData.businessType || legacyBusinessType(profile.shopType || indexData.shopType),
    businessTypeLabel: profile.businessTypeLabel || indexData.businessTypeLabel || getBusinessType(legacyBusinessType(profile.shopType || indexData.shopType)).label,
    customerCategory: profile.customerCategory || indexData.customerCategory || profile.shopType || indexData.shopType || "daily_needs",
    serviceMode: profile.serviceMode || indexData.serviceMode || "delivery",
    deliveryEnabled: profile.deliveryEnabled !== false && indexData.deliveryEnabled !== false,
    publicOrdersEnabled: profile.publicOrdersEnabled !== false && indexData.publicOrdersEnabled !== false,
    publicShopEnabled: profile.publicShopEnabled !== false && indexData.publicShopEnabled !== false,
    settlementUpi: profile.settlementUpi || "",
    settlementName: profile.settlementName || profile.ownerName || profile.name || "",
    approvalStatus: visibility.approvalStatus,
    isLive: visibility.isLive
  };
}

export function listenInventory(uid, callback, onError) {
  return onSnapshot(
    collection(db, "users", uid, "inventory"),
    snap => {
      const items = [];
      snap.forEach(d => {
        const item = d.data();
        items.push({
          id: d.id,
          name: item.product || item.name || "",
          price: Number(item.sellingPrice || item.price || item.weightedAvgCost || 0),
          sellingPrice: Number(item.sellingPrice || item.price || item.weightedAvgCost || 0),
          unit: item.unit || "kg",
          sellingUnit: normalizeSellingUnit(item.sellingUnit || "", item.unit || "kg"),
          qty: Number(item.qty || 0),
          alertThreshold: Number(item.alertThreshold || 0),
          imageUrl: item.imageUrl && !shouldReplaceAutoImage(item.imageUrl)
            ? item.imageUrl
            : getProductVisual(item.product || item.name || "")
        });
      });
      callback(items.sort((a, b) => a.name.localeCompare(b.name)));
    },
    onError
  );
}

export async function listPublicShops() {
  const snap = await getDocs(query(collection(db, "storeIndex"), orderBy("name")));
  const shops = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (!data.uid) continue;

    let profile = {};
    try {
      const profileSnap = await getDoc(doc(db, "users", data.uid, "settings", "profile"));
      profile = profileSnap.exists() ? profileSnap.data() : {};
    } catch (error) {
      continue;
    }

    const visibility = getPublicVisibility(profile, data);
    if (!visibility.isLive) continue;

    shops.push({
      storeId: d.id,
      uid: data.uid,
      name: profile.name || data.name || "Shop",
      location: profile.location || data.location || "",
      tagline: profile.tagline || data.tagline || "Fresh products, fair prices",
      coverPhotoUrl: profile.coverPhotoUrl || data.coverPhotoUrl || "",
      shopType: profile.shopType || data.shopType || "daily_needs",
      businessType: profile.businessType || data.businessType || legacyBusinessType(profile.shopType || data.shopType),
      businessTypeLabel: profile.businessTypeLabel || data.businessTypeLabel || getBusinessType(legacyBusinessType(profile.shopType || data.shopType)).label,
      customerCategory: profile.customerCategory || data.customerCategory || profile.shopType || data.shopType || "daily_needs",
      serviceMode: profile.serviceMode || data.serviceMode || "delivery",
      deliveryEnabled: profile.deliveryEnabled !== false && data.deliveryEnabled !== false,
      publicOrdersEnabled: profile.publicOrdersEnabled !== false && data.publicOrdersEnabled !== false
    });
  }
  return shops;
}

function getPublicVisibility(profile = {}, indexData = {}) {
  const approvalStatus = profile.approvalStatus || indexData.approvalStatus || "";
  const approvedForPublic = !approvalStatus || approvalStatus === "approved";
  return {
    approvalStatus,
    isLive: profile.isLive !== false
      && indexData.isLive !== false
      && profile.publicShopEnabled !== false
      && indexData.publicShopEnabled !== false
      && approvedForPublic
  };
}

function legacyBusinessType(shopType = "") {
  const legacy = {
    food: "restaurant",
    grocery: "kirana",
    hardware: "hardware",
    pharmacy: "pharmacy",
    general: "general",
    other: "other"
  };
  return legacy[shopType] || shopType || "other";
}

export async function getPlatformPaymentSettings() {
  const snap = await getDoc(doc(db, "platformSettings", "payment"));
  return snap.exists() ? snap.data() : {};
}

export async function createCustomerOrder({ store, cart, customer, payment = {} }) {
  if (!store?.uid) throw new Error("Missing shop");
  if (!Array.isArray(cart) || cart.length === 0) throw new Error("Cart is empty");
  if (store.publicOrdersEnabled === false) throw new Error("This shop is not taking customer orders right now");

  const subtotal = cart.reduce((sum, item) => sum + calculateLineTotal(item), 0);
  const handlingFee = 10;
  const deliveryFee = subtotal > 200 ? 0 : 10;
  const totalAmount = subtotal + handlingFee + deliveryFee;
  const paymentMode = payment.mode === "online" ? "online" : "cod";
  const paymentStatus = paymentMode === "online" ? "online_submitted" : "cod";
  const order = {
    source: "customer-shop",
    storeId: store.storeId,
    shopName: store.name,
    customerName: customer.name,
    customerPhone: customer.phone,
    customerUid: customer.uid || "",
    customerAddress: customer.address || "",
    note: customer.note || "",
    status: "new",
    fulfillmentType: store.deliveryEnabled === false ? "pickup" : "delivery",
    paymentMode,
    paymentStatus,
    paidTo: paymentMode === "online" ? "admin" : "",
    adminPaymentUpi: paymentMode === "online" ? payment.adminUpi || "" : "",
    adminPaymentName: paymentMode === "online" ? payment.adminName || "" : "",
    vendorSettlementUpi: store.settlementUpi || "",
    vendorSettlementName: store.settlementName || "",
    settlementStatus: paymentMode === "online" ? "unsettled" : "",
    subtotal,
    handlingFee,
    deliveryFee,
    totalAmount,
    items: cart.map(item => ({
      productId: item.id,
      product: item.name,
      qty: Number(item.qty || 0),
      unit: item.unit || "kg",
      price: calculateLineTotal(item),
      sellingPrice: Number(item.price || 0),
      sellingUnit: normalizeSellingUnit(item.sellingUnit || "", item.unit || "kg")
    })),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const ref = await addDoc(collection(db, "users", store.uid, "customerOrders"), order);
  localStorage.setItem(`zunoLastCustomerOrder_${store.storeId}`, ref.id);
  return { id: ref.id, ...order };
}

function calculateLineTotal(item) {
  return calculateSellingLineTotal(item);
}
