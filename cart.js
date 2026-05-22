import { clearCart, getCart, getCartTotal, getItemQty, updateQty, getQtyStep, calculateLineTotal } from "./shop-cart.js";
import { initShopNavbar } from "./shop-navbar.js";
import { initShopTopbar, updateCartBadge } from "./shop-topbar.js";
import { createCustomerOrder, getPlatformPaymentSettings, getShopProfile, getStoreId } from "./shop-store.js";
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatDisplayQtyForSellingUnit, sellingUnitLabel } from "./unit-pricing.js";

let store = null;
let customerProfile = null;
const HANDLING_FEE = 10;
const DELIVERY_FEE = 10;
const FREE_DELIVERY_ABOVE = 200;
let platformPayment = {};

init();

async function init() {
  const storeId = getStoreId();
  store = await getShopProfile(storeId);
  if (!store) {
    document.getElementById("cartList").innerHTML = `<div class="empty-state">Shop not found.</div>`;
    document.getElementById("checkoutPanel").style.display = "none";
    return;
  }

  initShopTopbar(store);
  initShopNavbar("cart");
  document.getElementById("continueShop").href = `shop.html?store=${store.storeId}`;
  document.getElementById("fulfillmentNote").textContent = store.deliveryEnabled === false
    ? "Pickup only: the shop will pack your order. Go to the shop and receive it when it is packed."
    : "Delivery on: the shop will contact you or deliver after accepting the order.";
  document.getElementById("customerAddress").placeholder = store.deliveryEnabled === false
    ? "Pickup note, optional"
    : "Address or delivery note";
  if (store.publicOrdersEnabled === false) {
    document.getElementById("checkoutPanel").style.display = "none";
    document.getElementById("cartList").innerHTML = `<div class="empty-state">This shop is not taking customer orders right now.</div>`;
    return;
  }
  window.addEventListener("cartUpdated", () => {
    renderCart();
    updateCartBadge(store.storeId);
  });

  initCustomerPrefill();
  initPaymentChoice();
  platformPayment = await getPlatformPaymentSettings().catch(() => ({}));
  renderOnlinePaymentInfo();
  renderCart();
}

function renderCart() {
  const list = document.getElementById("cartList");
  const cart = getCart(store.storeId);
  const subtotal = getCartTotal(store.storeId);
  const deliveryFee = subtotal > FREE_DELIVERY_ABOVE ? 0 : DELIVERY_FEE;
  document.getElementById("cartSubtotal").textContent = formatMoney(subtotal);
  document.getElementById("handlingFee").textContent = formatMoney(HANDLING_FEE);
  document.getElementById("deliveryFee").textContent = deliveryFee === 0 ? "Free" : formatMoney(deliveryFee);
  document.getElementById("cartTotal").textContent = formatMoney(subtotal + HANDLING_FEE + deliveryFee);

  if (cart.length === 0) {
    list.innerHTML = `<div class="empty-state">Your cart is empty.</div>`;
    document.getElementById("checkoutPanel").style.display = "none";
    return;
  }

  document.getElementById("checkoutPanel").style.display = "grid";
  list.innerHTML = cart.map(item => `
    <article class="cart-card">
      <div>
        <h3>${item.name}</h3>
        <p class="muted">${formatMoney(item.price)} / ${sellingUnitLabel(item.sellingUnit, item.unit)} · ${formatMoney(calculateLineTotal(item))}</p>
      </div>
      <div class="qty-control">
        <button onclick="changeCartQty('${item.id}', -1)">-</button>
        <span>${formatDisplayQty(item.qty, item)}</span>
        <button onclick="changeCartQty('${item.id}', 1)">+</button>
      </div>
    </article>
  `).join("");
}

window.changeCartQty = function(productId, delta) {
  const item = getCart(store.storeId).find(cartItem => cartItem.id === productId);
  const current = getItemQty(store.storeId, productId);
  const step = Number(item?.step || getQtyStep(item || {}));
  updateQty(store.storeId, productId, current + (delta * step));
};

window.placeOrder = async function() {
  const msg = document.getElementById("checkoutMsg");
  const button = document.getElementById("placeOrderBtn");
  const paymentChoice = document.querySelector("input[name='paymentChoice']:checked")?.value || "cod";
  const paidConfirm = document.getElementById("paidConfirm")?.checked;
  if (paymentChoice === "online" && !platformPayment.upiId && !platformPayment.phonePeNumber) {
    msg.textContent = "Online payment is not available right now. Choose cash.";
    return;
  }
  if (paymentChoice === "online" && !paidConfirm) {
    msg.textContent = "Tap Pay, complete payment, then tick I paid.";
    return;
  }

  const customer = {
    name: document.getElementById("customerName").value.trim(),
    phone: document.getElementById("customerPhone").value.trim(),
    uid: customerProfile?.uid || auth.currentUser?.uid || "",
    address: document.getElementById("customerAddress").value.trim(),
    note: document.getElementById("orderNote").value.trim()
  };

  if (!customer.name || !customer.phone) {
    msg.textContent = "Enter your name and phone number.";
    return;
  }

  try {
    button.disabled = true;
    msg.textContent = "Placing your order...";
    await createCustomerOrder({
      store,
      cart: getCart(store.storeId),
      customer,
      payment: paymentChoice === "online"
        ? { mode: "online", adminUpi: platformPayment.upiId || platformPayment.phonePeNumber || "", adminName: platformPayment.displayName || "Zuno" }
        : { mode: "cod" }
    });
    clearCart(store.storeId);
    window.location.href = `orders.html?store=${store.storeId}`;
  } catch (error) {
    console.error("Order failed:", error);
    msg.textContent = "Could not place order. Please try again.";
    button.disabled = false;
  }
};

function initPaymentChoice() {
  document.querySelectorAll("input[name='paymentChoice']").forEach(input => {
    input.addEventListener("change", renderOnlinePaymentInfo);
  });
  document.getElementById("payOnlineBtn")?.addEventListener("click", openUpiPayment);
}

function renderOnlinePaymentInfo() {
  const choice = document.querySelector("input[name='paymentChoice']:checked")?.value || "cod";
  const box = document.getElementById("onlinePayBox");
  const info = document.getElementById("onlinePayInfo");
  if (!box || !info) return;
  box.hidden = choice !== "online";
  const upi = platformPayment.upiId || platformPayment.phonePeNumber || "";
  info.textContent = upi
    ? "Pay online, then tick I paid."
    : "Online payment is not available yet. Please choose cash.";
}

function openUpiPayment() {
  const upi = platformPayment.upiId || platformPayment.phonePeNumber || "";
  if (!upi) return;
  const subtotal = getCartTotal(store.storeId);
  const total = subtotal + HANDLING_FEE + (subtotal > FREE_DELIVERY_ABOVE ? 0 : DELIVERY_FEE);
  const params = new URLSearchParams({
    pa: upi,
    pn: platformPayment.displayName || "Zuno",
    am: String(Math.round(total * 100) / 100),
    cu: "INR",
    tn: `${store.name || "Zuno"} order`
  });
  window.location.href = `upi://pay?${params.toString()}`;
}

function formatMoney(value) {
  return `Rs ${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function initCustomerPrefill() {
  const cached = readCachedCustomer();
  if (cached) applyCustomer(cached);

  onAuthStateChanged(auth, async user => {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, "customers", user.uid));
      if (!snap.exists()) return;
      const customer = { uid: user.uid, ...snap.data() };
      localStorage.setItem("zunoCustomer", JSON.stringify(customer));
      applyCustomer(customer);
    } catch (error) {
      console.warn("Customer prefill failed:", error);
    }
  });
}

function readCachedCustomer() {
  try {
    return JSON.parse(localStorage.getItem("zunoCustomer") || "null");
  } catch {
    return null;
  }
}

function applyCustomer(customer) {
  customerProfile = customer;
  if (customer.name) document.getElementById("customerName").value = customer.name;
  if (customer.phone) document.getElementById("customerPhone").value = customer.phone;
}

function formatQty(value) {
  return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function formatDisplayQty(value, item) {
  return formatDisplayQtyForSellingUnit(value, item);
}

function usesSmallWeightStep(productName = "") {
  const name = productName.toLowerCase();
  return ["garlic", "ginger", "green chilli", "chilli", "chili", "coriander", "dhaniya", "mint", "pudina", "lemon", "nimbu"]
    .some(product => name.includes(product));
}

function priceUnitLabel(unit = "") {
  return unit === "g" ? "kg" : unit;
}
