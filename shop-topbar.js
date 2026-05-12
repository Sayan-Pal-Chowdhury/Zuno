import { getCartCount } from "./shop-cart.js";
import { getStoreId } from "./shop-store.js";

export function initShopTopbar(store) {
  const container = document.getElementById("shop-topbar");
  if (!container) return;

  const storeId = store?.storeId || getStoreId();
  const name = store?.name || "Zuno Shops";
  const initials = name.trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2) || "ZS";
  const location = store?.location ? `<span>${store.location}</span>` : "";

  container.innerHTML = `
    <header class="shop-topbar">
      <a class="shop-brand" href="${storeId ? `shop.html?store=${storeId}` : "shops.html"}">
        <span class="shop-logo">${initials}</span>
        <span>
          <strong>${name}</strong>
          ${location}
        </span>
      </a>
      ${storeId ? `
        <a class="shop-cart-button" href="cart.html?store=${storeId}" aria-label="Cart">
          <span class="cart-mark">Cart</span>
          <b id="shopCartCount">${getCartCount(storeId)}</b>
        </a>
      ` : ""}
    </header>
  `;

  updateCartBadge(storeId);
}

export function updateCartBadge(storeId = getStoreId()) {
  const badge = document.getElementById("shopCartCount");
  if (!badge) return;
  const count = getCartCount(storeId);
  badge.textContent = count;
  badge.classList.toggle("visible", count > 0);
}
