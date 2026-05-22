import { getStoreId } from "./shop-store.js";

export function initShopNavbar(activePage = "shop") {
  const container = document.getElementById("shop-navbar");
  if (!container) return;

  const storeId = getStoreId();
  const suffix = storeId ? `?store=${storeId}` : "";
  const pages = [
    { id: "shop", label: "Shop", icon: homeIcon(), href: `shop.html${suffix}` },
    { id: "cart", label: "Cart", icon: bagIcon(), href: `cart.html${suffix}` },
    { id: "orders", label: "Orders", icon: listIcon(), href: `orders.html${suffix}` }
  ];

  container.innerHTML = `
    <nav class="shop-navbar">
      ${pages.map(page => `
        <a class="shop-nav-item ${activePage === page.id ? "active" : ""}" href="${page.href}">
          <b aria-hidden="true">${page.icon}</b>
          <span>${page.label}</span>
        </a>
      `).join("")}
    </nav>
  `;
}

function homeIcon() {
  return `
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M3 10.8 12 3l9 7.8v9.7a.5.5 0 0 1-.5.5H15v-6h-6v6H3.5a.5.5 0 0 1-.5-.5v-9.7Z"/>
    </svg>
  `;
}

function bagIcon() {
  return `
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M6.5 8h11l1 12.5a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5L6.5 8Z"/>
      <path d="M9 8V6a3 3 0 0 1 6 0v2"/>
    </svg>
  `;
}

function listIcon() {
  return `
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M8 6h12M8 12h12M8 18h12"/>
      <path d="M4 6h.01M4 12h.01M4 18h.01"/>
    </svg>
  `;
}
