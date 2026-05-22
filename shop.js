import { getCartCount, getItemQty, addToCart, updateQty, getQtyStep } from "./shop-cart.js";
import { initShopNavbar } from "./shop-navbar.js";
import { initShopTopbar, updateCartBadge } from "./shop-topbar.js";
import { getShopProfile, getStoreId, listenInventory } from "./shop-store.js";
import { findProductImage } from "./product-images.js";
import { formatDisplayQtyForSellingUnit, getQtyStepForSellingUnit, sellingUnitLabel } from "./unit-pricing.js";
import { attachSuggestionDropdown, COMMON_ITEM_NAMES, mergeSuggestions, renderOptions } from "./item-suggestions.js";

let store = null;
let allProducts = [];
let currentTypeFilter = "all";
let imageLookupRunning = false;
let heroImages = [];
let heroSlide = 0;
let heroTimer = null;

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

const shopTypes = [
  { id: "veggies", label: "Veggies", keywords: ["potato", "onion", "tomato", "ginger", "garlic", "chilli", "chili", "coriander", "dhaniya", "mint", "pudina", "lemon", "nimbu", "vegetable"] },
  { id: "grains", label: "Grains", keywords: ["rice", "dal", "atta", "wheat", "flour", "maida", "suji", "poha", "grain"] },
  { id: "dairy", label: "Dairy", keywords: ["milk", "paneer", "curd", "butter", "cheese", "ghee", "dairy"] },
  { id: "fresh", label: "Fresh", keywords: ["egg", "chicken", "fish", "meat", "fresh"] },
  { id: "essentials", label: "Essentials", keywords: ["oil", "salt", "sugar", "soap", "tea", "coffee", "masala", "spice", "essential"] }
];

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
  if (store.coverPhotoUrl) {
    heroImages = [store.coverPhotoUrl];
    renderHeroCarousel();
  }
  document.getElementById("shopStatusRow").innerHTML = `
    <span class="shop-type-badge">${formatShopType(store.shopType)}</span>
    <span class="delivery-badge ${store.deliveryEnabled ? "on" : "off"}">
      ${store.deliveryEnabled ? "Delivery on" : "Pickup only"}
    </span>
  `;
  document.getElementById("fulfillmentTitle").textContent = store.deliveryEnabled ? "Delivery" : "Pickup";
  document.getElementById("fulfillmentSub").textContent = store.deliveryEnabled
    ? "Delivered by shop"
    : "Order packed, collect from shop";

  listenInventory(store.uid, items => {
    allProducts = items;
    renderSearchSuggestions();
    updateHeroImages();
    renderTypeRow();
    renderProducts();
    ensureProductImages();
  }, error => {
    console.error("Inventory load failed:", error);
    showEmpty("Could not load products.");
  });
}

function renderSearchSuggestions() {
  const list = document.getElementById("shopProductSuggestions");
  const suggestions = mergeSuggestions(allProducts.map(item => item.name), COMMON_ITEM_NAMES);
  if (!list) return;
  list.innerHTML = renderOptions(suggestions);
  attachSuggestionDropdown(document.getElementById("searchInput"), () => suggestions, value => {
    document.getElementById("searchInput").value = value;
    renderProducts();
  });
}

window.setTypeFilter = function(type, button) {
  currentTypeFilter = type;
  document.querySelectorAll("#typeRow .category-chip").forEach(chip => chip.classList.remove("active"));
  const activeButton = button?.closest("#typeRow")
    ? button
    : document.querySelector(`#typeRow .category-chip[onclick*="'${type}'"]`);
  activeButton?.classList.add("active");
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
    if (currentTypeFilter !== "all" && getProductType(product.name) !== currentTypeFilter) return false;
    if (search && !product.name.toLowerCase().includes(search)) return false;
    return true;
  });

  if (products.length === 0) {
    grid.innerHTML = `<div class="empty-state">No products found.</div>`;
    return;
  }

  grid.innerHTML = products.map(product => renderProduct(product)).join("");
}

function renderTypeRow() {
  const row = document.getElementById("typeRow");
  if (!row) return;

  row.innerHTML = [
    {
      id: "all",
      label: "All",
      imageUrl: firstProductImage(),
      initials: "All"
    },
    ...shopTypes.map(type => ({
      ...type,
      imageUrl: firstTypeImage(type),
      initials: type.label.slice(0, 2).toUpperCase()
    }))
  ].map(type => `
    <button class="category-chip ${currentTypeFilter === type.id ? "active" : ""}" onclick="setTypeFilter('${type.id}', this)">
      <span class="category-image ${type.imageUrl ? "has-image" : ""}">
        ${type.imageUrl ? `<img src="${escapeHtml(type.imageUrl)}" alt="">` : escapeHtml(type.initials)}
      </span>
      ${escapeHtml(type.label)}
    </button>
  `).join("");
}

function renderProduct(product) {
  const qtyInCart = getItemQty(store.storeId, product.id);
  const out = product.qty <= 0;
  const low = product.alertThreshold > 0 && product.qty <= product.alertThreshold && product.qty > 0;
  const icon = getProductIcon(product.name);
  const hasImage = Boolean(product.imageUrl);

  return `
    <article class="product-card ${out ? "out" : ""} ${low ? "low" : ""} ${hasImage ? "has-image" : ""}">
      <div class="product-art">
        ${hasImage ? `<img class="product-image" src="${escapeHtml(product.imageUrl)}" alt="">` : `<span class="product-symbol">${icon}</span>`}
        ${out ? `<b class="pill out">Out</b>` : low ? `<b class="pill low">Low stock</b>` : `<b class="pill">Fresh</b>`}
      </div>
      <div class="product-body">
        <p class="product-name">${product.name}</p>
        <div class="product-price">${formatMoney(product.price)} / ${sellingUnitLabel(product.sellingUnit, product.unit)}</div>
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
        <span>${formatDisplayQty(qtyInCart, product)}</span>
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
    sellingUnit: product.sellingUnit,
    maxQty: product.qty,
    step: getQtyStepForSellingUnit(product)
  });
  renderProducts();
  updateCartBadge(store.storeId);
};

window.changeQty = function(productId, delta) {
  const product = allProducts.find(item => item.id === productId);
  if (!product) return;
  const step = getQtyStepForSellingUnit(product);
  const next = getItemQty(store.storeId, productId) + (delta * step);
  if (next > product.qty) return;
  updateQty(store.storeId, productId, next);
  renderProducts();
  updateCartBadge(store.storeId);
};

function getProductIcon(name = "") {
  const lower = name.toLowerCase();
  const key = Object.keys(productIcons).find(item => lower.includes(item));
  return key ? productIcons[key] : (name.trim()[0] || "I").toUpperCase();
}

async function ensureProductImages() {
  if (imageLookupRunning) return;
  const missing = allProducts.filter(product => !product.imageUrl).slice(0, 8);
  if (missing.length === 0) return;

  imageLookupRunning = true;
  let changed = false;

  for (const product of missing) {
    try {
      const imageUrl = await findProductImage(product.name);
      if (!imageUrl) continue;
      const current = allProducts.find(item => item.id === product.id);
      if (current && !current.imageUrl) {
        current.imageUrl = imageUrl;
        changed = true;
      }
    } catch (error) {
      console.warn("Product image lookup failed:", product.name, error);
    }
  }

  imageLookupRunning = false;
  if (changed) {
    updateHeroImages();
    renderTypeRow();
    renderProducts();
  }
}

function updateHeroImages() {
  const images = [
    store?.coverPhotoUrl || "",
    ...allProducts.map(product => product.imageUrl).filter(Boolean)
  ].filter((url, index, list) => url && list.indexOf(url) === index).slice(0, 8);

  if (images.length === 0) return;
  heroImages = images;
  heroSlide = Math.min(heroSlide, heroImages.length - 1);
  renderHeroCarousel();
}

function renderHeroCarousel() {
  const hero = document.querySelector(".hero-card");
  if (!hero || heroImages.length === 0) return;

  hero.classList.add("has-cover");
  setHeroSlide(heroSlide);

  let dots = document.getElementById("heroCarouselDots");
  if (!dots) {
    dots = document.createElement("div");
    dots.id = "heroCarouselDots";
    dots.className = "hero-carousel-dots";
    hero.appendChild(dots);
  }

  dots.innerHTML = heroImages.map((_, index) => `
    <button class="${index === heroSlide ? "active" : ""}" type="button" aria-label="Show cover ${index + 1}" onclick="setHeroSlide(${index})"></button>
  `).join("");

  stopHeroCarousel();
  if (heroImages.length > 1) {
    heroTimer = setInterval(() => {
      window.setHeroSlide((heroSlide + 1) % heroImages.length);
    }, 3200);
  }
}

window.setHeroSlide = function(index) {
  heroSlide = index;
  setHeroSlide(index);
};

function setHeroSlide(index) {
  const hero = document.querySelector(".hero-card");
  if (!hero || !heroImages[index]) return;
  hero.style.setProperty("--shop-cover", `url("${heroImages[index]}")`);
  document.querySelectorAll("#heroCarouselDots button").forEach((dot, dotIndex) => {
    dot.classList.toggle("active", dotIndex === index);
  });
}

function stopHeroCarousel() {
  if (!heroTimer) return;
  clearInterval(heroTimer);
  heroTimer = null;
}

function firstProductImage() {
  return allProducts.find(product => product.imageUrl)?.imageUrl || "";
}

function firstTypeImage(type) {
  return allProducts.find(product => getProductType(product.name) === type.id && product.imageUrl)?.imageUrl || "";
}

function getProductType(productName = "") {
  const name = productName.toLowerCase();
  const type = shopTypes.find(item => item.keywords.some(keyword => name.includes(keyword)));
  return type?.id || "essentials";
}

function roundQty(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatQty(value) {
  return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function formatDisplayQty(value, product) {
  return formatDisplayQtyForSellingUnit(value, product);
}

function usesSmallWeightStep(productName = "") {
  const name = productName.toLowerCase();
  return ["garlic", "ginger", "green chilli", "chilli", "chili", "coriander", "dhaniya", "mint", "pudina", "lemon", "nimbu"]
    .some(item => name.includes(item));
}

function formatMoney(value) {
  return `Rs ${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function priceUnitLabel(unit = "") {
  return unit === "g" ? "kg" : unit;
}

function formatShopType(type = "other") {
  const labels = {
    food: "Food",
    grocery: "Kirana / Grocery",
    hardware: "Hardware",
    pharmacy: "Pharmacy",
    general: "General Store",
    street_food: "Street Food",
    daily_needs: "Daily Needs",
    home_services: "Home Services",
    health: "Health",
    beauty: "Beauty",
    repairs: "Repairs",
    other: "Other"
  };
  return labels[type] || labels.other;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function showEmpty(message) {
  initShopTopbar(null);
  document.getElementById("productsGrid").innerHTML = `<div class="empty-state">${message}</div>`;
}
