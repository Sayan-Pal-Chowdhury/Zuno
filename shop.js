import { getCartCount, getItemQty, addToCart, updateQty } from "./shop-cart.js";
import { initShopNavbar } from "./shop-navbar.js";
import { initShopTopbar, updateCartBadge } from "./shop-topbar.js";
import { getShopProfile, getStoreId, listenInventory } from "./shop-store.js";

let store = null;
let allProducts = [];
let currentFilter = "all";

const productIcons = {
  potato: "PT",
  onion: "ON",
  tomato: "TM",
  rice: "RC",
  egg: "EG",
  milk: "MK",
  oil: "OL",
  dal: "DL",
  ginger: "GG",
  garlic: "GC",
  chicken: "CH",
  fish: "FS"
};

init();

async function init() {
  const storeId = getStoreId();
  if (!storeId) {
    showEmpty("Open a valid shop link.");
    return;
  }

  store = await getShopProfile(storeId);
  if (!store || !store.isLive) {
    showEmpty("This shop is not available right now.");
    return;
  }

  initShopTopbar(store);
  initShopNavbar("shop");
  window.addEventListener("cartUpdated", () => updateCartBadge(store.storeId));

  document.title = store.name;
  document.getElementById("heroTitle").textContent = store.name;
  document.getElementById("heroSub").textContent = store.tagline || store.location || "Fresh products, fair prices";

  listenInventory(store.uid, items => {
    allProducts = items;
    renderProducts();
  }, error => {
    console.error("Inventory load failed:", error);
    showEmpty("Could not load products.");
  });
}

window.setFilter = function(filter, button) {
  currentFilter = filter;
  document.querySelectorAll(".chip").forEach(chip => chip.classList.remove("active"));
  button.classList.add("active");
  renderProducts();
};

window.filterProducts = renderProducts;

window.setSearchTerm = function(term) {
  document.getElementById("searchInput").value = term;
  renderProducts();
};

function renderProducts() {
  const grid = document.getElementById("productsGrid");
  const search = document.getElementById("searchInput").value.toLowerCase().trim();
  const products = allProducts.filter(product => {
    if (currentFilter !== "all" && product.unit !== currentFilter) return false;
    if (search && !product.name.toLowerCase().includes(search)) return false;
    return true;
  });

  if (products.length === 0) {
    grid.innerHTML = `<div class="empty-state">No products found.</div>`;
    return;
  }

  grid.innerHTML = products.map(product => renderProduct(product)).join("");
}

function renderProduct(product) {
  const qtyInCart = getItemQty(store.storeId, product.id);
  const out = product.qty <= 0;
  const low = product.alertThreshold > 0 && product.qty <= product.alertThreshold && product.qty > 0;
  const icon = getProductIcon(product.name);

  return `
    <article class="product-card ${out ? "out" : ""} ${low ? "low" : ""}">
      <div class="product-art">
        <span class="product-symbol">${icon}</span>
        ${out ? `<b class="pill out">Out</b>` : low ? `<b class="pill low">Low stock</b>` : `<b class="pill">Fresh</b>`}
      </div>
      <div class="product-body">
        <p class="product-name">${product.name}</p>
        <div class="product-price">${formatMoney(product.price)} / ${product.unit}</div>
        <div class="product-stock ${low ? "low" : ""}">${out ? "Currently unavailable" : `${roundQty(product.qty)} ${product.unit} available`}</div>
        <div id="action-${product.id}">
          ${renderAction(product, qtyInCart)}
        </div>
      </div>
    </article>
  `;
}

function renderAction(product, qtyInCart) {
  if (product.qty <= 0) return `<button class="add-btn" disabled>Out of stock</button>`;
  if (qtyInCart > 0) {
    return `
      <div class="qty-control">
        <button onclick="changeQty('${product.id}', -1)">-</button>
        <span>${qtyInCart}</span>
        <button onclick="changeQty('${product.id}', 1)">+</button>
      </div>
    `;
  }
  return `<button class="add-btn" onclick="handleAdd('${product.id}')">Add to cart</button>`;
}

window.handleAdd = function(productId) {
  const product = allProducts.find(item => item.id === productId);
  if (!product) return;
  addToCart(store.storeId, {
    id: product.id,
    name: product.name,
    price: product.price,
    unit: product.unit,
    maxQty: Math.floor(product.qty)
  });
  renderProducts();
  updateCartBadge(store.storeId);
};

window.changeQty = function(productId, delta) {
  const product = allProducts.find(item => item.id === productId);
  if (!product) return;
  const next = getItemQty(store.storeId, productId) + delta;
  if (next > Math.floor(product.qty)) return;
  updateQty(store.storeId, productId, next);
  renderProducts();
  updateCartBadge(store.storeId);
};

function getProductIcon(name = "") {
  const lower = name.toLowerCase();
  const key = Object.keys(productIcons).find(item => lower.includes(item));
  return key ? productIcons[key] : (name.trim()[0] || "I").toUpperCase();
}

function roundQty(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatMoney(value) {
  return `Rs ${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function showEmpty(message) {
  initShopTopbar(null);
  document.getElementById("productsGrid").innerHTML = `<div class="empty-state">${message}</div>`;
}
