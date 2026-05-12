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

  const profileSnap = await getDoc(doc(db, "users", uid, "settings", "profile"));
  const profile = profileSnap.exists() ? profileSnap.data() : {};

  return {
    uid,
    storeId,
    name: profile.name || indexData.name || "Shop",
    location: profile.location || indexData.location || "",
    tagline: profile.tagline || "Fresh products, fair prices",
    isLive: profile.isLive !== false && indexData.isLive !== false
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
          unit: item.unit || "kg",
          qty: Number(item.qty || 0),
          alertThreshold: Number(item.alertThreshold || 0)
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
  snap.forEach(d => {
    const data = d.data();
    if (data.isLive === false) return;
    shops.push({
      storeId: d.id,
      uid: data.uid,
      name: data.name || "Shop",
      location: data.location || "",
      tagline: data.tagline || "Fresh products, fair prices"
    });
  });
  return shops;
}

export async function createCustomerOrder({ store, cart, customer }) {
  if (!store?.uid) throw new Error("Missing shop");
  if (!Array.isArray(cart) || cart.length === 0) throw new Error("Cart is empty");

  const totalAmount = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const order = {
    source: "customer-shop",
    storeId: store.storeId,
    shopName: store.name,
    customerName: customer.name,
    customerPhone: customer.phone,
    customerAddress: customer.address || "",
    note: customer.note || "",
    status: "new",
    paymentMode: "cod",
    totalAmount,
    items: cart.map(item => ({
      productId: item.id,
      product: item.name,
      qty: Number(item.qty || 0),
      unit: item.unit || "kg",
      price: Number(item.price || 0) * Number(item.qty || 0),
      sellingPrice: Number(item.price || 0)
    })),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const ref = await addDoc(collection(db, "users", store.uid, "customerOrders"), order);
  localStorage.setItem(`zunoLastCustomerOrder_${store.storeId}`, ref.id);
  return { id: ref.id, ...order };
}
