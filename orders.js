import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { initShopNavbar } from "./shop-navbar.js";
import { initShopTopbar } from "./shop-topbar.js";
import { getShopProfile, getStoreId } from "./shop-store.js";

let unsubscribe = null;

init();

async function init() {
  const storeId = getStoreId();
  const store = await getShopProfile(storeId);
  if (!store) {
    document.getElementById("ordersList").innerHTML = `<div class="empty-state">Shop not found.</div>`;
    return;
  }

  initShopTopbar(store);
  initShopNavbar("orders");
  document.getElementById("ordersShopLink").href = `shop.html?store=${store.storeId}`;

  const orderId = localStorage.getItem(`zunoLastCustomerOrder_${store.storeId}`);
  if (!orderId) {
    document.getElementById("ordersList").innerHTML = `<div class="empty-state">Place an order to track it here.</div>`;
    return;
  }

  unsubscribe?.();
  unsubscribe = onSnapshot(doc(db, "users", store.uid, "customerOrders", orderId), snap => {
    if (!snap.exists()) {
      document.getElementById("ordersList").innerHTML = `<div class="empty-state">Order not found.</div>`;
      return;
    }
    renderOrder({ id: snap.id, ...snap.data() });
  });
}

function renderOrder(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  document.getElementById("ordersList").innerHTML = `
    <article class="order-card">
      <span class="status-pill">${order.status || "new"}</span>
      <h3 style="margin-top:12px">${order.shopName || "Shop"} order</h3>
      <p class="muted">${items.map(item => `${item.product} x ${item.qty}`).join(", ")}</p>
      <p><strong>${formatMoney(order.totalAmount)}</strong></p>
      <p class="muted">${statusText(order.status)}</p>
    </article>
  `;
}

function statusText(status) {
  if (status === "accepted") return "The shop accepted your order.";
  if (status === "ready") return "Your order is ready.";
  if (status === "delivered") return "Your order was delivered.";
  if (status === "rejected") return "The shop could not accept this order.";
  return "Waiting for the shop to confirm.";
}

function formatMoney(value) {
  return `Rs ${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}
