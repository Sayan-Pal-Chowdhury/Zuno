import { getCartCount, getItemQty, addToCart, updateQty, getQtyStep } from "./shop-cart.js";
import { initShopNavbar } from "./shop-navbar.js";
import { initShopTopbar, updateCartBadge } from "./shop-topbar.js";
import { getShopProfile, getStoreId, listenFoodMenu, listenInventory } from "./shop-store.js";
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
let foodMenuConfig = {};
let foodMenuItems = [];
let weeklyMenuOpen = false;
let selectedFoodVariants = {};

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

const foodCategoryOrder = ["Veg", "Chicken", "Fish", "Egg", "Rice", "Breads", "Snacks", "Sweets", "Drinks", "Other"];
const foodCategoryKeywords = {
  Chicken: ["chicken", "murgh"],
  Fish: ["fish", "ilish", "hilsa", "rohu", "katla"],
  Egg: ["egg", "anda"],
  Rice: ["rice", "biryani", "pulao", "fried rice"],
  Breads: ["roti", "naan", "paratha", "bread", "luchi", "puri"],
  Snacks: ["snack", "roll", "chop", "cutlet", "singara", "samosa", "pakora", "momo"],
  Sweets: ["sweet", "mithai", "rasgulla", "sandesh", "dessert"],
  Drinks: ["drink", "tea", "coffee", "lassi", "juice"]
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
  document.getElementById("heroSub").textContent = store.shopDescription || store.tagline || store.location || "Fresh products, fair prices";
  if (store.coverPhotoUrl) {
    heroImages = [store.coverPhotoUrl];
    renderHeroCarousel();
  }
  document.getElementById("shopStatusRow").innerHTML = `
    <span class="shop-type-badge">${store.businessTypeLabel || formatShopType(store.shopType)}</span>
    <span class="delivery-badge ${store.deliveryEnabled ? "on" : "off"}">
      ${store.deliveryEnabled ? "Delivery on" : "Pickup only"}
    </span>
  `;
  document.getElementById("fulfillmentTitle").textContent = store.deliveryEnabled ? "Delivery" : "Pickup";
  document.getElementById("fulfillmentSub").textContent = store.deliveryEnabled
    ? "Delivered by shop"
    : "Order packed, collect from shop";

  if (store.foodMenuEnabled === true) {
    initFoodShop();
  } else {
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
}

function initFoodShop() {
  document.querySelector(".shop-main")?.classList.add("food-shop");
  document.getElementById("searchInput").placeholder = "Search menu items...";
  setFoodQuickCards();
  document.getElementById("typeSectionHeading").querySelector("h2").textContent = "Browse menu";

  listenFoodMenu(store.uid, data => {
    foodMenuConfig = data.config || {};
    foodMenuItems = (data.items || []).filter(item => item.active !== false);
    allProducts = getActiveMenuProducts(foodMenuItems, foodMenuConfig);
    renderFoodTypeRow();
    renderWeeklyMenu();
    renderSearchSuggestions();
    updateHeroImages();
    renderProducts();
  }, error => {
    console.error("Food menu load failed:", error);
    showEmpty("Could not load today's menu.");
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
    if (store?.foodMenuEnabled === true && currentTypeFilter !== "all" && getFoodCategory(product) !== currentTypeFilter) return false;
    if (store?.foodMenuEnabled !== true && currentTypeFilter !== "all" && getProductType(product.name) !== currentTypeFilter) return false;
    if (search && !`${product.name} ${product.description || ""} ${product.category || ""}`.toLowerCase().includes(search)) return false;
    return true;
  });

  if (store?.foodMenuEnabled === true) {
    const specials = products.filter(product => product.featured);
    const menuItems = products.filter(product => !product.featured);
    const specialSection = document.getElementById("foodSpecialsSection");
    specialSection.hidden = specials.length === 0;
    document.getElementById("foodSpecialsGrid").innerHTML = specials.map(product => renderProduct(product)).join("");
    document.getElementById("productsHeading").textContent = getActiveMenuHeading();
    grid.innerHTML = menuItems.length
      ? menuItems.map(product => renderProduct(product)).join("")
      : `<div class="empty-state">No dishes scheduled for this meal.</div>`;
    return;
  }

  grid.innerHTML = products.length
    ? products.map(product => renderProduct(product)).join("")
    : `<div class="empty-state">No products found.</div>`;
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

function renderFoodTypeRow() {
  const row = document.getElementById("typeRow");
  if (!row) return;
  const usedCategories = new Set(allProducts.map(product => getFoodCategory(product)));
  const categories = foodCategoryOrder.filter(category => usedCategories.has(category));
  if (currentTypeFilter !== "all" && !usedCategories.has(currentTypeFilter)) currentTypeFilter = "all";
  const filters = [
    { id: "all", label: "All", imageUrl: firstProductImage(), initials: "All" },
    ...categories.map(category => {
      const item = allProducts.find(product => getFoodCategory(product) === category);
      return {
        id: category,
        label: category,
        imageUrl: item?.imageUrl || "",
        initials: category.slice(0, 2).toUpperCase()
      };
    })
  ];
  row.innerHTML = filters.map(filter => `
    <button class="category-chip ${currentTypeFilter === filter.id ? "active" : ""}" onclick="setTypeFilter('${filter.id}', this)">
      <span class="category-image ${filter.imageUrl ? "has-image" : ""}">
        ${filter.imageUrl ? `<img src="${escapeHtml(filter.imageUrl)}" alt="">` : escapeHtml(filter.initials)}
      </span>
      ${escapeHtml(filter.label)}
    </button>
  `).join("");
}

function renderProduct(product) {
  const foodItem = store.foodMenuEnabled === true;
  const qtyInCart = foodItem ? getSelectedFoodQty(product) : getItemQty(store.storeId, product.id);
  const out = !foodItem && product.qty <= 0 && store.forceInStock !== true;
  const low = !foodItem && product.alertThreshold > 0 && product.qty <= product.alertThreshold && product.qty > 0;
  const icon = getProductIcon(product.name);
  const hasImage = Boolean(product.imageUrl);

  return `
    <article class="product-card ${out ? "out" : ""} ${low ? "low" : ""} ${hasImage ? "has-image" : ""}">
      <div class="product-art">
        ${hasImage ? `<img class="product-image" src="${escapeHtml(product.imageUrl)}" alt="">` : `<span class="product-symbol">${icon}</span>`}
        ${out ? `<b class="pill out">Out</b>` : low ? `<b class="pill low">Low stock</b>` : product.featured ? `<b class="pill">Special</b>` : `<b class="pill">Fresh</b>`}
      </div>
      <div class="product-body">
        ${foodItem ? `<span class="food-category-label">${escapeHtml(getFoodCategory(product))}</span>` : ""}
        <p class="product-name">${escapeHtml(product.name)}</p>
        <div class="product-price">${foodItem ? `From ${formatMoney(product.price)}` : `${formatMoney(product.price)} / ${sellingUnitLabel(product.sellingUnit, product.unit)}`}</div>
        <div class="product-stock ${low ? "low" : ""}">${foodItem ? escapeHtml(product.description || product.category || "Prepared fresh") : out ? "Currently unavailable" : product.qty <= 0 ? "Available to order" : `${roundQty(product.qty)} ${product.unit} available`}</div>
        <div id="action-${product.id}">
          ${renderAction(product, qtyInCart)}
        </div>
      </div>
    </article>
  `;
}

function renderAction(product, qtyInCart) {
  if (store.foodMenuEnabled === true) {
    const selectedVariantId = getSelectedFoodVariant(product).id;
    return `
      <div class="food-add-controls">
        <select id="food-variant-${product.id}" class="food-variant-select" aria-label="Select portion for ${escapeHtml(product.name)}" onchange="setFoodVariant('${product.id}', this.value)">
          ${product.variants.map(variant => `
            <option value="${escapeHtml(variant.id)}" ${variant.id === selectedVariantId ? "selected" : ""}>${escapeHtml(variantLabel(variant))} - ${formatMoney(variant.price)}</option>
          `).join("")}
        </select>
        ${qtyInCart > 0 ? `
          <div class="qty-control">
            <button onclick="changeFoodQty('${product.id}', '${selectedVariantId}', -1)" aria-label="Reduce quantity">-</button>
            <span>${formatQty(qtyInCart)}</span>
            <button onclick="changeFoodQty('${product.id}', '${selectedVariantId}', 1)" aria-label="Increase quantity">+</button>
          </div>
        ` : `<button class="add-btn" onclick="handleAdd('${product.id}')">Add</button>`}
      </div>
    `;
  }
  if (store.foodMenuEnabled !== true && product.qty <= 0 && store.forceInStock !== true) return `<button class="add-btn" disabled>Out of stock</button>`;
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
  if (store.foodMenuEnabled === true) {
    const variantId = document.getElementById(`food-variant-${product.id}`)?.value;
    const variant = product.variants.find(option => option.id === variantId) || product.variants[0];
    if (!variant) return;
    selectedFoodVariants[product.id] = variant.id;
    addToCart(store.storeId, {
      id: `${product.id}::${variant.id}`,
      productId: product.id,
      source: "food-menu",
      name: product.name,
      variantLabel: variantLabel(variant),
      price: variant.price,
      unit: "piece",
      sellingUnit: "piece",
      maxQty: 99,
      step: 1
    });
    renderProducts();
    updateCartBadge(store.storeId);
    return;
  }
  addToCart(store.storeId, {
    id: product.id,
    name: product.name,
    price: product.price,
    unit: product.unit,
    sellingUnit: product.sellingUnit,
    maxQty: store.foodMenuEnabled === true ? 99 : product.qty,
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
  if (store.foodMenuEnabled !== true && store.forceInStock !== true && next > product.qty) return;
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

function getActiveMenuProducts(items, config) {
  const day = currentMenuDay();
  const period = currentMenuPeriod(config.mealTimes || {});
  const activeItems = new Map(items.filter(item => item.active !== false).map(item => [item.id, item]));
  if (config.mode !== "scheduled") {
    return [...activeItems.values()].map(item => toFoodProduct(item, false)).filter(Boolean);
  }
  const fixedIds = (Array.isArray(config.fixedItems) ? config.fixedItems : [])
    .filter(item => item.period === "both" || item.period === period)
    .map(item => item.itemId);
  const scheduledIds = Array.isArray(config.weekly?.[day]?.[period]) ? config.weekly[day][period] : [];
  const specialIds = [...new Set((Array.isArray(config.specials) ? config.specials : [])
    .filter(item => item.active !== false
      && (item.day === "all" || item.day === day)
      && (item.period === "both" || item.period === period))
    .map(item => item.itemId))];
  const featuredSet = new Set(specialIds);
  const regularIds = [...new Set([...fixedIds, ...scheduledIds])].filter(id => !featuredSet.has(id));
  return [
    ...specialIds.map(id => toFoodProduct(activeItems.get(id), true)).filter(Boolean),
    ...regularIds.map(id => toFoodProduct(activeItems.get(id), false)).filter(Boolean)
  ];
}

function toFoodProduct(item, featured) {
  if (!item) return null;
  const variants = Array.isArray(item.variants) && item.variants.length
    ? item.variants.filter(variant => Number(variant.price) > 0)
    : [{ id: "full", label: "Full Plate", pieces: 0, price: Number(item.price || 0) }];
  if (variants.length === 0) return null;
  return {
    id: item.id,
    name: item.name || "",
    price: Math.min(...variants.map(variant => Number(variant.price))),
    sellingPrice: Math.min(...variants.map(variant => Number(variant.price))),
    unit: "piece",
    sellingUnit: "piece",
    qty: 99,
    alertThreshold: 0,
    category: item.category || "Prepared fresh",
    description: item.description || "",
    variants,
    imageUrl: item.imageUrl || "",
    featured
  };
}

function currentMenuDay() {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[new Date().getDay()];
}

function currentMenuPeriod(times) {
  const defaults = { lunchStart: "10:30", dinnerStart: "18:00" };
  const settings = { ...defaults, ...times };
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return time >= settings.dinnerStart || time < settings.lunchStart ? "dinner" : "lunch";
}

function getActiveMenuHeading() {
  if (foodMenuConfig.mode !== "scheduled") return "Menu";
  const day = currentMenuDay();
  const period = currentMenuPeriod(foodMenuConfig.mealTimes || {});
  return `${day.charAt(0).toUpperCase() + day.slice(1)} ${period.charAt(0).toUpperCase() + period.slice(1)} Menu`;
}

function getFoodCategory(product) {
  const stored = String(product.category || "").trim();
  const mapped = {
    Bread: "Breads",
    Snack: "Snacks",
    Sweet: "Sweets",
    Drink: "Drinks"
  }[stored] || stored;
  if (foodCategoryOrder.includes(mapped)) return mapped;
  const name = String(product.name || "").toLowerCase();
  const matched = Object.entries(foodCategoryKeywords).find(([, words]) => words.some(word => name.includes(word)));
  if (matched) return matched[0];
  return stored === "Meal" || stored === "Curry" ? "Veg" : "Other";
}

function setFoodQuickCards() {
  document.getElementById("fulfillmentIcon").innerHTML = store.deliveryEnabled ? iconBike() : iconBag();
  document.getElementById("stockIcon").innerHTML = iconChef();
  document.getElementById("paymentIcon").innerHTML = iconPayment();
  document.getElementById("stockQuickCard").querySelector("strong").textContent = "Freshly made";
  document.getElementById("stockQuickCard").querySelector("div > span:not(.quick-icon)").textContent = "Cooked today";
}

window.toggleWeeklyMenu = function() {
  weeklyMenuOpen = !weeklyMenuOpen;
  document.getElementById("weeklyMenuContent").hidden = !weeklyMenuOpen;
  document.getElementById("weeklyMenuToggle").textContent = weeklyMenuOpen ? "Hide schedule" : "View schedule";
};

window.setFoodVariant = function(productId, variantId) {
  selectedFoodVariants[productId] = variantId;
  renderProducts();
};

window.changeFoodQty = function(productId, variantId, delta) {
  const lineId = `${productId}::${variantId}`;
  const current = getItemQty(store.storeId, lineId);
  updateQty(store.storeId, lineId, current + delta);
  renderProducts();
  updateCartBadge(store.storeId);
};

function renderWeeklyMenu() {
  const section = document.getElementById("weeklyMenuSection");
  const content = document.getElementById("weeklyMenuContent");
  const scheduled = foodMenuConfig.mode === "scheduled";
  section.hidden = !scheduled;
  if (!scheduled) return;

  const menuItemsById = new Map(foodMenuItems.map(item => [item.id, item]));
  const fixed = (Array.isArray(foodMenuConfig.fixedItems) ? foodMenuConfig.fixedItems : [])
    .map(assignment => ({ item: menuItemsById.get(assignment.itemId), note: schedulePeriodLabel(assignment.period) }))
    .filter(assignment => Boolean(assignment.item));
  const specials = (Array.isArray(foodMenuConfig.specials) ? foodMenuConfig.specials : [])
    .filter(special => special.active !== false)
    .map(special => ({
      item: menuItemsById.get(special.itemId),
      note: `${special.day === "all" ? "Every day" : capitalise(special.day)} - ${schedulePeriodLabel(special.period)}`
    }))
    .filter(special => Boolean(special.item));
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  content.innerHTML = `
    ${fixed.length ? `
      <div class="weekly-block">
        <strong>Available every day</strong>
        <div class="weekly-food-list">${fixed.map(assignment => renderWeeklyFood(assignment.item, assignment.note)).join("")}</div>
      </div>` : ""}
    ${days.map(day => `
      <article class="weekly-day ${day === currentMenuDay() ? "today" : ""}">
        <h3>${capitalise(day)}${day === currentMenuDay() ? " - Today" : ""}</h3>
        ${renderWeeklyMeal(day, "lunch", menuItemsById)}
        ${renderWeeklyMeal(day, "dinner", menuItemsById)}
      </article>
    `).join("")}
    ${specials.length ? `
      <div class="weekly-block">
        <strong>Specials</strong>
        <div class="weekly-food-list">${specials.map(special => renderWeeklyFood(special.item, special.note)).join("")}</div>
      </div>` : ""}
  `;
  content.hidden = !weeklyMenuOpen;
}

function renderWeeklyMeal(day, period, itemMap) {
  const ids = Array.isArray(foodMenuConfig.weekly?.[day]?.[period]) ? foodMenuConfig.weekly[day][period] : [];
  const items = ids.map(id => itemMap.get(id)).filter(Boolean);
  return `
    <div class="weekly-meal">
      <span>${capitalise(period)}</span>
      <div class="weekly-food-list">${items.length ? items.map(item => renderWeeklyFood(item)).join("") : `<em>Menu not set</em>`}</div>
    </div>
  `;
}

function renderWeeklyFood(item, note = "") {
  const product = toFoodProduct(item, false);
  if (!product) return "";
  return `
    <div class="weekly-food">
      ${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="">` : `<b>${escapeHtml(product.name.slice(0, 2).toUpperCase())}</b>`}
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        <small>${escapeHtml(product.description || getFoodCategory(product))}</small>
        <small>${escapeHtml(product.variants.map(variant => `${variantLabel(variant)} - ${formatMoney(variant.price)}`).join(" | "))}</small>
        ${note ? `<small class="weekly-food-note">${escapeHtml(note)}</small>` : ""}
      </div>
    </div>
  `;
}

function schedulePeriodLabel(period = "both") {
  return period === "both" ? "Lunch and dinner" : capitalise(period);
}

function capitalise(value = "") {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function iconBike() {
  return `<svg viewBox="0 0 24 24"><path d="M5 17a3 3 0 1 0 0-.01M19 17a3 3 0 1 0 0-.01M5 17h6l-3-7h5l3 7M10 7h3"/></svg>`;
}

function iconBag() {
  return `<svg viewBox="0 0 24 24"><path d="M7 9V7a5 5 0 0 1 10 0v2M5 9h14l-1 11H6L5 9Z"/></svg>`;
}

function iconChef() {
  return `<svg viewBox="0 0 24 24"><path d="M6 11a4 4 0 0 1 1-7 5 5 0 0 1 10 0 4 4 0 0 1 1 7v8H6v-8ZM8 15h8"/></svg>`;
}

function iconPayment() {
  return `<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 14h4"/></svg>`;
}

function variantLabel(variant) {
  const pieces = Number(variant.pieces || 0);
  return pieces > 0 ? `${variant.label} (${pieces} pc)` : variant.label;
}

function getSelectedFoodVariant(product) {
  const selectedId = selectedFoodVariants[product.id];
  const inCartVariant = product.variants.find(option => getItemQty(store.storeId, `${product.id}::${option.id}`) > 0);
  const variant = product.variants.find(option => option.id === selectedId) || inCartVariant || product.variants[0];
  selectedFoodVariants[product.id] = variant.id;
  return variant;
}

function getSelectedFoodQty(product) {
  const variant = getSelectedFoodVariant(product);
  return getItemQty(store.storeId, `${product.id}::${variant.id}`);
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
