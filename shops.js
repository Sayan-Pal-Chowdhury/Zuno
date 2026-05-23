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
let shopCardTimer = null;
let shopCardSlide = 0;

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
    renderMarketplaceHero();
    window.filterShops();
  } catch (error) {
    console.error("Shop list failed:", error);
    grid.innerHTML = `<div class="empty-state">Could not load shops.</div>`;
  }
}

function renderShops(shops, emptyMessage = "No shops are live yet.") {
  const grid = document.getElementById("shopsGrid");
  document.getElementById("shopCount").textContent = `${shops.length} ${shops.length === 1 ? "shop" : "shops"}`;

  if (shops.length === 0) {
    startShopCardCarousel([]);
    grid.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  grid.innerHTML = shops.map(shop => {
    const initials = (shop.name || "Shop").trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
    const category = getCustomerCategory(shop.customerCategory || shop.shopType || "daily_needs");
    const colors = category.colors || ["#ffda00", "#fff2a8"];
    const cardImages = getShopCardImages(shop);
    return `
      <a class="shop-card ${cardImages.length ? "has-card-media" : ""}" data-store-id="${escapeHtml(shop.storeId)}" href="shop.html?store=${shop.storeId}" ${coverStyle(cardImages[0] || shop.coverPhotoUrl, colors, category.id)}>
        ${cardImages.length ? `
          <span class="shop-card-media" aria-hidden="true">
            ${cardImages.map(imageUrl => `<span style="--shop-card-photo:url('${escapeAttr(imageUrl)}')"></span>`).join("")}
          </span>
        ` : ""}
        <span class="shop-logo" style="margin-bottom:12px">${initials || "S"}</span>
        <div class="shop-card-badges">
          <span class="shop-type-badge">${escapeHtml(shop.businessTypeLabel || formatShopType(shop.shopType))}</span>
          <span class="delivery-badge ${shop.deliveryEnabled ? "on" : "off"}">
            ${shop.deliveryEnabled ? "Delivery on" : "Pickup only"}
          </span>
        </div>
        <h3>${shop.name}</h3>
        <p class="muted">${shop.location || "Open now"}</p>
        <p class="muted">${escapeHtml(shop.shopDescription || shop.tagline || "Fresh products, fair prices")}</p>
        ${cardImages.length > 1 ? `
          <span class="shop-card-slide-dots" aria-hidden="true">
            ${cardImages.map((_, index) => `<i class="${index === 0 ? "active" : ""}"></i>`).join("")}
          </span>
        ` : ""}
      </a>
    `;
  }).join("");
  startShopCardCarousel(shops);
}

window.filterShops = function() {
  const search = document.getElementById("shopSearch").value.toLowerCase().trim();
  const searching = Boolean(search);
  document.getElementById("browseFilters").hidden = searching;
  document.getElementById("shopsHeading").textContent = searching ? "Search Results" : "Open Shops";

  const matches = allShops.filter(shop => {
    if (!searching && currentCategoryFilter !== "all" && (shop.customerCategory || shop.shopType || "daily_needs") !== currentCategoryFilter) return false;
    if (!searching && currentBusinessFilter !== "all" && (shop.businessType || "other") !== currentBusinessFilter) return false;
    return !search || `${shop.name} ${shop.location} ${shop.shopDescription || ""} ${shop.businessTypeLabel || ""} ${formatShopType(shop.shopType)}`.toLowerCase().includes(search);
  });
  renderShops(matches, searching ? `No shops match "${search}".` : "No shops are live yet.");
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
  renderMarketplaceHero();
  window.filterShops();
};

window.setBusinessFilter = function(type, button) {
  currentBusinessFilter = type;
  document.querySelectorAll("#businessTypeRow .business-chip").forEach(chip => chip.classList.remove("active"));
  button?.classList.add("active");
  renderMarketplaceHero();
  window.filterShops();
};

function renderMarketplaceCategories() {
  const row = document.getElementById("marketplaceCategoryRow");
  if (!row) return;

  row.innerHTML = getPriorityCategories().map(category => {
    const shop = pickShopForCategory(category.id);
    const imageUrl = getShopPreviewImage(shop) || getCategoryVisual(category.id);
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

function renderMarketplaceHero() {
  const track = document.getElementById("marketplaceHeroTrack");
  const dots = document.getElementById("marketplaceHeroDots");
  if (!track || !dots) return;

  const filtered = getFilteredShops();
  const foodShop = filtered.find(shop => isFoodBusiness(shop));
  const leadCover = getShopPreviewImage(filtered[0]) || "";
  const slides = [
    {
      kind: "welcome",
      imageUrl: leadCover,
      eyebrow: "Available near you",
      title: "Shop from local stores",
      copy: "Fresh stock, live availability, simple ordering."
    }
  ];
  if (foodShop) {
    slides.push({
      kind: "link",
      imageUrl: getShopPreviewImage(foodShop) || getCategoryVisual("food"),
      eyebrow: "Home food",
      title: "Order your favourite home food",
      copy: "Freshly prepared meals from kitchens near you.",
      action: "Order now",
      href: `shop.html?store=${foodShop.storeId}`
    });
  }
  filtered.forEach(shop => {
    if (shop.coverPhotoUrl) slides.push({
      kind: "link",
      imageUrl: shop.coverPhotoUrl,
      eyebrow: shop.businessTypeLabel || formatShopType(shop.shopType),
      title: shop.name,
      copy: shop.shopDescription || shop.location || "Open near you",
      action: "Visit shop",
      href: `shop.html?store=${shop.storeId}`
    });
    (shop.featuredItems || []).forEach(item => {
      slides.push({
        kind: "link",
        imageUrl: item.imageUrl,
        eyebrow: shop.name,
        title: item.name,
        copy: `${shop.businessTypeLabel || formatShopType(shop.shopType)} - available now`,
        action: "View shop",
        href: `shop.html?store=${shop.storeId}`
      });
    });
  });

  slides.splice(10);
  activeSlide = Math.min(activeSlide, slides.length - 1);
  track.innerHTML = slides.map(slide => renderMarketplaceSlide(slide)).join("");
  dots.innerHTML = slides.length > 1 ? slides.map((_, index) => `
    <button class="${index === activeSlide ? "active" : ""}" type="button" aria-label="Show slide ${index + 1}" onclick="showMarketplaceSlide(${index})"></button>
  `).join("") : "";
  setFeaturedSlide(activeSlide);
  startCarousel(slides.length);
}

function isFoodBusiness(shop = {}) {
  const category = shop.customerCategory || shop.shopType || "";
  const type = shop.businessType || "";
  return ["food", "street_food"].includes(category)
    || ["restaurant", "home_food", "bakery", "sweets_snacks", "street_food", "rolls_fast_food"].includes(type);
}

function renderMarketplaceSlide(slide) {
  const style = slide.imageUrl ? ` style="--marketplace-hero-cover:url('${escapeAttr(slide.imageUrl)}')"` : "";
  const copy = `
    <div class="marketplace-hero-copy">
      <small>${escapeHtml(slide.eyebrow)}</small>
      <h1>${escapeHtml(slide.title)}</h1>
      <p>${escapeHtml(slide.copy)}</p>
      ${slide.kind === "welcome" ? `
        <div class="public-login-actions">
          <a class="public-login-btn primary" href="login.html">Vendor Login</a>
          <a class="public-login-btn" href="customer-login.html">Customer Login</a>
        </div>
      ` : `<span class="marketplace-hero-action">${escapeHtml(slide.action)}</span>`}
    </div>
  `;
  return slide.kind === "link"
    ? `<a class="marketplace-hero-slide has-cover" href="${escapeHtml(slide.href)}"${style}>${copy}</a>`
    : `<article class="marketplace-hero-slide ${slide.imageUrl ? "has-cover" : ""}"${style}>${copy}</article>`;
}

window.setFeaturedSlide = function(index) {
  const track = document.getElementById("marketplaceHeroTrack");
  if (!track) return;
  activeSlide = index;
  track.style.transform = `translateX(${-100 * activeSlide}%)`;
  document.querySelectorAll("#marketplaceHeroDots button").forEach((dot, dotIndex) => {
    dot.classList.toggle("active", dotIndex === activeSlide);
  });
};

window.showMarketplaceSlide = function(index) {
  window.setFeaturedSlide(index);
  startCarousel(document.querySelectorAll("#marketplaceHeroDots button").length);
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

function startShopCardCarousel(shops) {
  if (shopCardTimer) clearInterval(shopCardTimer);
  shopCardTimer = null;
  shopCardSlide = 0;
  if (!shops.some(shop => getShopCardImages(shop).length > 1)) return;
  shopCardTimer = setInterval(() => {
    shopCardSlide += 1;
    shops.forEach(shop => {
      const images = getShopCardImages(shop);
      if (images.length <= 1) return;
      const card = document.querySelector(`.shop-card[data-store-id="${shop.storeId}"]`);
      if (!card) return;
      const nextIndex = shopCardSlide % images.length;
      card.querySelector(".shop-card-media").style.transform = `translateX(${-100 * nextIndex}%)`;
      card.querySelectorAll(".shop-card-slide-dots i").forEach((dot, index) => {
        dot.classList.toggle("active", index === nextIndex);
      });
    });
  }, 3600);
}

function getFilteredShops() {
  return allShops.filter(shop => {
    if (currentCategoryFilter !== "all" && (shop.customerCategory || shop.shopType || "daily_needs") !== currentCategoryFilter) return false;
    if (currentBusinessFilter !== "all" && (shop.businessType || "other") !== currentBusinessFilter) return false;
    return true;
  });
}

function pickShopForCategory(categoryId) {
  if (categoryId === "all") return allShops.find(shop => getShopPreviewImage(shop));
  return allShops.find(shop => (shop.customerCategory || shop.shopType) === categoryId && getShopPreviewImage(shop));
}

function getPriorityCategories() {
  const fixedAll = CUSTOMER_CATEGORIES.find(category => category.id === "all");
  const categories = CUSTOMER_CATEGORIES.filter(category => category.id !== "all");
  const newestByCategory = new Map();
  allShops.forEach(shop => {
    const category = shop.customerCategory || shop.shopType || "daily_needs";
    newestByCategory.set(category, Math.max(newestByCategory.get(category) || 0, shop.recentAt || 0));
  });
  categories.sort((a, b) =>
    (newestByCategory.has(b.id) ? 1 : 0) - (newestByCategory.has(a.id) ? 1 : 0)
    || (newestByCategory.get(b.id) || 0) - (newestByCategory.get(a.id) || 0)
  );
  return [fixedAll, ...categories];
}

function getShopPreviewImage(shop) {
  return shop?.featuredItems?.[0]?.imageUrl || shop?.coverPhotoUrl || "";
}

function getShopCardImages(shop) {
  return [...new Set([
    shop?.coverPhotoUrl || "",
    ...(shop?.featuredItems || []).map(item => item.imageUrl || "")
  ].filter(Boolean))].slice(0, 4);
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
