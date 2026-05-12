import { getStoreId } from "./shop-store.js";

export function initShopNavbar(activePage = "shop") {
  const container = document.getElementById("shop-navbar");
  if (!container) return;

  const storeId = getStoreId();
  const suffix = storeId ? `?store=${storeId}` : "";
  const pages = [
    { id: "shop", label: "Shop", icon: "Home", href: `shop.html${suffix}` },
    { id: "cart", label: "Cart", icon: "Bag", href: `cart.html${suffix}` },
    { id: "orders", label: "Orders", icon: "List", href: `orders.html${suffix}` }
  ];

  container.innerHTML = `
    <nav class="shop-navbar">
      ${pages.map(page => `
        <a class="shop-nav-item ${activePage === page.id ? "active" : ""}" href="${page.href}">
          <b>${page.icon}</b>
          <span>${page.label}</span>
        </a>
      `).join("")}
    </nav>
  `;
}
