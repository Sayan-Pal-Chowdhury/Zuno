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
  const itemRows = items.length
    ? items.map(item => `
        <span class="order-item">
          <span>${item.product || "Item"}</span>
          <b>x ${item.qty || 0}</b>
        </span>
      `).join("")
    : `<span class="order-item"><span>No items</span></span>`;

  document.getElementById("ordersList").innerHTML = `
    <article class="order-card">
      <span class="status-pill">${order.status || "new"}</span>
      <h3 style="margin-top:12px">${order.shopName || "Shop"} order</h3>
      <div class="order-items muted">${itemRows}</div>
      ${renderFees(order)}
      <p><strong>${formatMoney(order.totalAmount)}</strong></p>
      ${order.fulfillmentType === "pickup" ? `<p class="pickup-note">Pickup order: when it is packed, go to the shop and receive it manually.</p>` : ""}
      <p class="muted">${paymentStatusText(order)}</p>
      <p class="muted">${statusText(order)}</p>
    </article>
  `;
}

function renderFees(order) {
  if (!order.handlingFee && !order.deliveryFee) return "";
  return `
    <div class="fee-lines">
      <div><span>Items</span><span>${formatMoney(order.subtotal || 0)}</span></div>
      <div><span>Handling charge</span><span>${formatMoney(order.handlingFee || 0)}</span></div>
      <div><span>Delivery fee</span><span>${Number(order.deliveryFee || 0) === 0 ? "Free" : formatMoney(order.deliveryFee || 0)}</span></div>
    </div>
  `;
}

function paymentStatusText(order) {
  if (order.paymentMode !== "online") return "Payment: cash on delivery or pickup.";
  if (order.paymentStatus === "online_verified") return "Payment verified by Zuno.";
  if (order.paymentStatus === "online_rejected") return "Payment was not verified. The shop or Zuno may contact you.";
  return "Payment submitted. Zuno will verify it.";
}

function statusText(order) {
  const status = order?.status;
  const isPickup = order?.fulfillmentType === "pickup";
  if (status === "accepted") return "The shop accepted your order.";
  if (status === "packing") return "The shop is packing your order.";
  if (status === "ready" || status === "packed") return "Your order is packed. Please go to the shop and receive it.";
  if (status === "delivered") return isPickup ? "Order completed. You received it from the shop." : "Your order was delivered.";
  if (status === "rejected") return "The shop could not accept this order.";
  return "Waiting for the shop to confirm.";
}

function formatMoney(value) {
  return `Rs ${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}
