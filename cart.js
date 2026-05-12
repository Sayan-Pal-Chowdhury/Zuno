import { clearCart, getCart, getCartTotal, getItemQty, updateQty } from "./shop-cart.js";
import { initShopNavbar } from "./shop-navbar.js";
import { initShopTopbar, updateCartBadge } from "./shop-topbar.js";
import { createCustomerOrder, getShopProfile, getStoreId } from "./shop-store.js";

let store = null;

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
  window.addEventListener("cartUpdated", () => {
    renderCart();
    updateCartBadge(store.storeId);
  });

  renderCart();
}

function renderCart() {
  const list = document.getElementById("cartList");
  const cart = getCart(store.storeId);
  document.getElementById("cartTotal").textContent = formatMoney(getCartTotal(store.storeId));

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
        <p class="muted">${formatMoney(item.price)} / ${item.unit}</p>
      </div>
      <div class="qty-control">
        <button onclick="changeCartQty('${item.id}', -1)">-</button>
        <span>${item.qty}</span>
        <button onclick="changeCartQty('${item.id}', 1)">+</button>
      </div>
    </article>
  `).join("");
}

window.changeCartQty = function(productId, delta) {
  const current = getItemQty(store.storeId, productId);
  updateQty(store.storeId, productId, current + delta);
};

window.placeOrder = async function() {
  const msg = document.getElementById("checkoutMsg");
  const button = document.getElementById("placeOrderBtn");
  const customer = {
    name: document.getElementById("customerName").value.trim(),
    phone: document.getElementById("customerPhone").value.trim(),
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
    await createCustomerOrder({ store, cart: getCart(store.storeId), customer });
    clearCart(store.storeId);
    window.location.href = `orders.html?store=${store.storeId}`;
  } catch (error) {
    console.error("Order failed:", error);
    msg.textContent = "Could not place order. Please try again.";
    button.disabled = false;
  }
};

function formatMoney(value) {
  return `Rs ${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}
