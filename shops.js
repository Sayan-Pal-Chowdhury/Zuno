import { initShopTopbar } from "./shop-topbar.js";
import { listPublicShops } from "./shop-store.js";
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { BUSINESS_TYPES, CUSTOMER_CATEGORIES, getBusinessType, getCustomerCategory } from "./marketplace-categories.js";
import { getCategoryVisual } from "./marketplace-visuals.js";

let allShops = [];
let currentCategoryFilter = "all";
let currentBusinessFilter = "all";
let carouselTimer = null;
let activeSlide = 0;

initShopTopbar(null);
initCustomerStrip();
renderMarketplaceCategories();
renderBusinessTypes();
loadShops();

async function loadShops() {
  const grid = document.getElementById("shopsGrid");
  try {
    allShops = await listPublicShops();
    renderMarketplaceCategories();
    renderBusinessTypes();
    renderFeaturedCarousel();
    renderShops(allShops);
  } catch (error) {
    console.error("Shop list failed:", error);
    grid.innerHTML = `<div class="empty-state">Could not load shops.</div>`;
  }
}

function renderShops(shops) {
  const grid = document.getElementById("shopsGrid");
  document.getElementById("shopCount").textContent = `${shops.length} shops`;

  if (shops.length === 0) {
    grid.innerHTML = `<div class="empty-state">No shops are live yet.</div>`;
    return;
  }

  grid.innerHTML = shops.map(shop => {
    const initials = (shop.name || "Shop").trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
    const category = getCustomerCategory(shop.customerCategory || shop.shopType || "daily_needs");
    const colors = category.colors || ["#ffda00", "#fff2a8"];
    return `
      <a class="shop-card" href="shop.html?store=${shop.storeId}" ${coverStyle(shop.coverPhotoUrl, colors, category.id)}>
        <span class="shop-logo" style="margin-bottom:12px">${initials || "S"}</span>
        <div class="shop-card-badges">
          <span class="shop-type-badge">${escapeHtml(shop.businessTypeLabel || formatShopType(shop.shopType))}</span>
          <span class="delivery-badge ${shop.deliveryEnabled ? "on" : "off"}">
            ${shop.deliveryEnabled ? "Delivery on" : "Pickup only"}
          </span>
        </div>
        <h3>${shop.name}</h3>
        <p class="muted">${shop.location || "Open now"}</p>
        <p class="muted">${shop.tagline || "Fresh products, fair prices"}</p>
      </a>
    `;
  }).join("");
}

window.filterShops = function() {
  const search = document.getElementById("shopSearch").value.toLowerCase().trim();
  renderShops(allShops.filter(shop => {
    if (currentCategoryFilter !== "all" && (shop.customerCategory || shop.shopType || "daily_needs") !== currentCategoryFilter) return false;
    if (currentBusinessFilter !== "all" && (shop.businessType || "other") !== currentBusinessFilter) return false;
    return !search || `${shop.name} ${shop.location} ${shop.businessTypeLabel || ""} ${formatShopType(shop.shopType)}`.toLowerCase().includes(search);
  }));
};

window.setMarketplaceCategory = function(category, button) {
  currentCategoryFilter = category;
  currentBusinessFilter = "all";
  document.querySelectorAll("#marketplaceCategoryRow .category-chip").forEach(chip => chip.classList.remove("active"));
  const activeButton = button?.closest("#marketplaceCategoryRow")
    ? button
    : document.querySelector(`#marketplaceCategoryRow .category-chip[data-category="${category}"]`);
  activeButton?.classList.add("active");
  renderBusinessTypes();
  renderFeaturedCarousel();
  window.filterShops();
};

window.setBusinessFilter = function(type, button) {
  currentBusinessFilter = type;
  document.querySelectorAll("#businessTypeRow .business-chip").forEach(chip => chip.classList.remove("active"));
  button?.classList.add("active");
  renderFeaturedCarousel();
  window.filterShops();
};

function renderMarketplaceCategories() {
  const row = document.getElementById("marketplaceCategoryRow");
  if (!row) return;

  row.innerHTML = CUSTOMER_CATEGORIES.map(category => {
    const shop = pickShopForCategory(category.id);
    const imageUrl = shop?.coverPhotoUrl || getCategoryVisual(category.id);
    const colors = category.colors || ["#ffda00", "#fff2a8"];
    return `
      <button class="category-chip ${currentCategoryFilter === category.id ? "active" : ""}" data-category="${category.id}" onclick="setMarketplaceCategory('${category.id}', this)">
        <span class="category-image has-image" style="--cat-a:${colors[0]};--cat-b:${colors[1]}">
          <img src="${escapeHtml(imageUrl)}" alt="">
        </span>
        ${escapeHtml(category.shortLabel)}
      </button>
    `;
  }).join("");
}

function renderBusinessTypes() {
  const row = document.getElementById("businessTypeRow");
  if (!row) return;

  const types = BUSINESS_TYPES.filter(type => currentCategoryFilter === "all" || type.category === currentCategoryFilter);
  document.getElementById("typeCount").textContent = currentCategoryFilter === "all"
    ? "All"
    : getCustomerCategory(currentCategoryFilter).label;

  row.innerHTML = [
    { id: "all", label: "All types" },
    ...types
  ].map(type => `
    <button class="business-chip ${currentBusinessFilter === type.id ? "active" : ""}" onclick="setBusinessFilter('${type.id}', this)">
      ${escapeHtml(type.label)}
    </button>
  `).join("");
}

function renderFeaturedCarousel() {
  const carousel = document.getElementById("featuredCarousel");
  const track = document.getElementById("featuredTrack");
  const dots = document.getElementById("featuredDots");
  if (!carousel || !track || !dots) return;

  const featured = getFilteredShops().filter(shop => shop.coverPhotoUrl).slice(0, 8);
  if (featured.length === 0) {
    carousel.hidden = true;
    stopCarousel();
    return;
  }

  activeSlide = Math.min(activeSlide, featured.length - 1);
  carousel.hidden = false;
  track.innerHTML = featured.map(shop => `
    <a class="featured-slide" href="shop.html?store=${shop.storeId}" style="--featured-cover:url('${escapeAttr(shop.coverPhotoUrl)}')">
      <div>
        <span>${escapeHtml(shop.businessTypeLabel || formatShopType(shop.shopType))}</span>
        <strong>${escapeHtml(shop.name)}</strong>
        <em>${escapeHtml(shop.location || "Open near you")}</em>
      </div>
    </a>
  `).join("");
  dots.innerHTML = featured.map((_, index) => `
    <button class="${index === activeSlide ? "active" : ""}" type="button" aria-label="Show feature ${index + 1}" onclick="setFeaturedSlide(${index})"></button>
  `).join("");
  setFeaturedSlide(activeSlide);
  startCarousel(featured.length);
}

window.setFeaturedSlide = function(index) {
  const track = document.getElementById("featuredTrack");
  if (!track) return;
  activeSlide = index;
  track.style.transform = `translateX(${-100 * activeSlide}%)`;
  document.querySelectorAll("#featuredDots button").forEach((dot, dotIndex) => {
    dot.classList.toggle("active", dotIndex === activeSlide);
  });
};

function startCarousel(count) {
  stopCarousel();
  if (count <= 1) return;
  carouselTimer = setInterval(() => {
    window.setFeaturedSlide((activeSlide + 1) % count);
  }, 3500);
}

function stopCarousel() {
  if (!carouselTimer) return;
  clearInterval(carouselTimer);
  carouselTimer = null;
}

function getFilteredShops() {
  return allShops.filter(shop => {
    if (currentCategoryFilter !== "all" && (shop.customerCategory || shop.shopType || "daily_needs") !== currentCategoryFilter) return false;
    if (currentBusinessFilter !== "all" && (shop.businessType || "other") !== currentBusinessFilter) return false;
    return true;
  });
}

function pickShopForCategory(categoryId) {
  if (categoryId === "all") return allShops.find(shop => shop.coverPhotoUrl);
  return allShops.find(shop => (shop.customerCategory || shop.shopType) === categoryId && shop.coverPhotoUrl);
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

function coverStyle(url = "", colors = ["#ffda00", "#fff2a8"], categoryId = "daily_needs") {
  const cover = url || getCategoryVisual(categoryId);
  return `style="--shop-cover:url('${cover}');--shop-card-a:${colors[0]};--shop-card-b:${colors[1]}"`;
}

function escapeAttr(value = "") {
  return String(value).replace(/['"\\]/g, "");
}

function initCustomerStrip() {
  const cached = readCachedCustomer();
  if (cached) renderCustomerStrip(cached);

  onAuthStateChanged(auth, async user => {
    if (!user) {
      localStorage.removeItem("zunoCustomer");
      hideCustomerStrip();
      return;
    }
    try {
      const snap = await getDoc(doc(db, "customers", user.uid));
      if (!snap.exists()) return;
      const customer = { uid: user.uid, ...snap.data() };
      localStorage.setItem("zunoCustomer", JSON.stringify(customer));
      renderCustomerStrip(customer);
    } catch (error) {
      console.warn("Customer profile load failed:", error);
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

function renderCustomerStrip(customer) {
  const strip = document.getElementById("customerStrip");
  if (!strip) return;
  strip.hidden = false;
  strip.innerHTML = `
    <div>
      <strong>${escapeHtml(customer.name || "Customer")}</strong>
      <span>${escapeHtml(customer.phone || customer.email || "Ready to shop")}</span>
    </div>
    <div class="customer-strip-actions">
      <a href="customer-login.html">Update</a>
      <button type="button" id="customerLogoutBtn">Logout</button>
    </div>
  `;

  document.getElementById("customerLogoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("zunoCustomer");
    hideCustomerStrip();
  });
}

function hideCustomerStrip() {
  const strip = document.getElementById("customerStrip");
  if (!strip) return;
  strip.hidden = true;
  strip.innerHTML = "";
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
