import { auth, db } from "./firebase.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { findProductImage } from "./product-images.js";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
let userId = "";
let foodItems = [];
let menuConfig = defaultMenuConfig();
let activeDay = DAYS[(new Date().getDay() + 6) % 7];
let editingItemId = "";
let editingImageUrl = "";

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const profileSnap = await getDoc(doc(db, "users", user.uid, "settings", "profile"));
  const profile = profileSnap.exists() ? profileSnap.data() : {};
  if (profile.foodMenuEnabled !== true) {
    window.location.href = "inventory.htm";
    return;
  }

  userId = user.uid;
  setupForms();
  renderVariantRows([{ id: "full", label: "Full Plate", pieces: "", price: "" }]);
  renderDayTabs();
  listenForMenu();
});

function setupForms() {
  document.getElementById("foodItemForm").addEventListener("submit", saveFoodItem);
  document.getElementById("fixedForm").addEventListener("submit", event => {
    event.preventDefault();
    const itemId = document.getElementById("fixedItemSelect").value;
    const period = document.getElementById("fixedPeriod").value;
    if (!itemId || menuConfig.fixedItems.some(item => item.itemId === itemId && item.period === period)) return;
    menuConfig.fixedItems.push({ itemId, period });
    saveConfig();
  });
  document.getElementById("lunchForm").addEventListener("submit", event => {
    event.preventDefault();
    addWeeklyItem("lunch", document.getElementById("lunchItemSelect").value);
  });
  document.getElementById("dinnerForm").addEventListener("submit", event => {
    event.preventDefault();
    addWeeklyItem("dinner", document.getElementById("dinnerItemSelect").value);
  });
  document.getElementById("specialForm").addEventListener("submit", event => {
    event.preventDefault();
    const itemId = document.getElementById("specialItemSelect").value;
    if (!itemId) return;
    menuConfig.specials.push({
      id: `special-${Date.now()}`,
      itemId,
      day: document.getElementById("specialDay").value,
      period: document.getElementById("specialPeriod").value,
      active: true
    });
    saveConfig();
  });
  document.getElementById("timeForm").addEventListener("submit", event => {
    event.preventDefault();
    menuConfig.mealTimes = {
      lunchStart: document.getElementById("lunchStart").value,
      dinnerStart: document.getElementById("dinnerStart").value
    };
    saveConfig("timeMessage", "Meal times saved.");
  });

  document.getElementById("specialDay").innerHTML = [
    `<option value="all">Every day</option>`,
    ...DAYS.map(day => `<option value="${day}">${capitalise(day)}</option>`)
  ].join("");
}

function listenForMenu() {
  onSnapshot(collection(db, "users", userId, "foodItems"), snapshot => {
    foodItems = snapshot.docs.map(itemDoc => ({ id: itemDoc.id, ...itemDoc.data() }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    renderAll();
  });
  onSnapshot(doc(db, "users", userId, "foodMenu", "config"), snapshot => {
    menuConfig = mergeMenuConfig(snapshot.exists() ? snapshot.data() : {});
    renderAll();
  });
}

async function saveFoodItem(event) {
  event.preventDefault();
  const name = document.getElementById("foodItemName").value.trim();
  const variants = readVariants();
  if (!name || variants.length === 0) {
    showMessage("foodItemMessage", "Add at least one portion with a price.");
    return;
  }

  const imageFile = document.getElementById("foodItemImage").files[0];
  const imageUrl = imageFile ? await resizeImage(imageFile) : (editingImageUrl || await findProductImage(name, "plate"));
  const item = {
    name,
    description: document.getElementById("foodItemDescription").value.trim(),
    variants,
    price: Math.min(...variants.map(variant => variant.price)),
    category: document.getElementById("foodItemCategory").value,
    imageUrl: imageUrl || "",
    active: document.getElementById("foodItemActive").checked,
    updatedAt: serverTimestamp()
  };

  if (editingItemId) {
    await updateDoc(doc(db, "users", userId, "foodItems", editingItemId), item);
    showMessage("foodItemMessage", "Item updated.");
  } else {
    await addDoc(collection(db, "users", userId, "foodItems"), { ...item, createdAt: serverTimestamp() });
    showMessage("foodItemMessage", "Item added.");
  }
  cancelFoodItemEdit();
}

window.editFoodItem = itemId => {
  const item = foodItems.find(entry => entry.id === itemId);
  if (!item) return;
  editingItemId = itemId;
  editingImageUrl = item.imageUrl || "";
  document.getElementById("foodItemName").value = item.name || "";
  document.getElementById("foodItemDescription").value = item.description || "";
  document.getElementById("foodItemCategory").value = menuCategoryValue(item.category);
  document.getElementById("foodItemActive").checked = item.active !== false;
  renderVariantRows(normalizeVariants(item));
  document.getElementById("saveFoodItemBtn").textContent = "Save item";
  document.getElementById("cancelFoodItemEdit").hidden = false;
};

window.cancelFoodItemEdit = () => {
  editingItemId = "";
  editingImageUrl = "";
  document.getElementById("foodItemForm").reset();
  document.getElementById("foodItemActive").checked = true;
  renderVariantRows([{ id: "full", label: "Full Plate", pieces: "", price: "" }]);
  document.getElementById("saveFoodItemBtn").textContent = "Add item";
  document.getElementById("cancelFoodItemEdit").hidden = true;
};

window.toggleFoodItem = async itemId => {
  const item = foodItems.find(entry => entry.id === itemId);
  if (!item) return;
  await updateDoc(doc(db, "users", userId, "foodItems", itemId), {
    active: item.active === false,
    updatedAt: serverTimestamp()
  });
};

window.deleteFoodItem = async itemId => {
  if (!window.confirm("Delete this menu item and remove it from schedules?")) return;
  menuConfig.fixedItems = menuConfig.fixedItems.filter(item => item.itemId !== itemId);
  DAYS.forEach(day => {
    menuConfig.weekly[day].lunch = menuConfig.weekly[day].lunch.filter(id => id !== itemId);
    menuConfig.weekly[day].dinner = menuConfig.weekly[day].dinner.filter(id => id !== itemId);
  });
  menuConfig.specials = menuConfig.specials.filter(item => item.itemId !== itemId);
  await saveConfig();
  await deleteDoc(doc(db, "users", userId, "foodItems", itemId));
};

function addWeeklyItem(period, itemId) {
  const assignments = menuConfig.weekly[activeDay][period];
  if (!itemId || assignments.includes(itemId)) return;
  assignments.push(itemId);
  saveConfig();
}

window.removeFixedItem = index => {
  menuConfig.fixedItems.splice(index, 1);
  saveConfig();
};

window.removeWeeklyItem = (period, index) => {
  menuConfig.weekly[activeDay][period].splice(index, 1);
  saveConfig();
};

window.removeSpecial = id => {
  menuConfig.specials = menuConfig.specials.filter(item => item.id !== id);
  saveConfig();
};

window.toggleSpecial = id => {
  const special = menuConfig.specials.find(item => item.id === id);
  if (!special) return;
  special.active = special.active === false;
  saveConfig();
};

window.setMenuMode = mode => {
  menuConfig.mode = mode === "scheduled" ? "scheduled" : "simple";
  if (menuConfig.mode === "simple") {
    const itemsButton = document.querySelector(".menu-tabs button[data-tab='items']");
    window.setMenuTab("items", itemsButton);
  }
  renderMode();
  saveConfig();
};

async function saveConfig(messageId = "", message = "") {
  await setDoc(doc(db, "users", userId, "foodMenu", "config"), {
    ...menuConfig,
    updatedAt: serverTimestamp()
  }, { merge: true });
  if (messageId) showMessage(messageId, message);
}

window.setMenuTab = (tab, button) => {
  document.querySelectorAll(".menu-tabs button").forEach(item => item.classList.toggle("active", item === button));
  document.querySelectorAll(".menu-panel").forEach(panel => panel.classList.toggle("active", panel.id === `panel-${tab}`));
};

window.selectMenuDay = day => {
  activeDay = day;
  renderDayTabs();
  renderWeeklyLists();
};

function renderAll() {
  renderMode();
  renderItems();
  renderSelects();
  renderFixed();
  renderWeeklyLists();
  renderSpecials();
  renderTimes();
  renderServiceLabel();
}

function renderItems() {
  const list = document.getElementById("foodItemList");
  if (foodItems.length === 0) {
    list.innerHTML = `<div class="empty-line">Add a dish first, then schedule it for customers.</div>`;
    return;
  }
  list.innerHTML = foodItems.map(item => `
    <div class="food-row">
      ${item.imageUrl
        ? `<img class="food-photo" src="${escapeHtml(item.imageUrl)}" alt="">`
        : `<div class="food-photo">${escapeHtml(String(item.name || "?").slice(0, 2).toUpperCase())}</div>`}
      <div class="food-detail">
        <strong>${escapeHtml(item.name)}</strong>
        <small>${variantSummary(item)} | ${escapeHtml(item.category || "Meal")} | ${item.active === false ? "Off menu" : "Available"}</small>
        ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
      </div>
      <div class="row-actions">
        <button type="button" onclick="toggleFoodItem('${item.id}')">${item.active === false ? "Turn on" : "Turn off"}</button>
        <button type="button" onclick="editFoodItem('${item.id}')">Edit</button>
        <button class="danger" type="button" onclick="deleteFoodItem('${item.id}')">Delete</button>
      </div>
    </div>
  `).join("");
}

function renderSelects() {
  const options = foodItems.filter(item => item.active !== false)
    .map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  ["fixedItemSelect", "lunchItemSelect", "dinnerItemSelect", "specialItemSelect"].forEach(id => {
    const select = document.getElementById(id);
    select.innerHTML = options || `<option value="">Add an available item first</option>`;
    select.disabled = !options;
  });
}

function renderFixed() {
  const list = document.getElementById("fixedList");
  if (menuConfig.fixedItems.length === 0) {
    list.innerHTML = `<div class="empty-line">No always-available items selected.</div>`;
    return;
  }
  list.innerHTML = menuConfig.fixedItems.map((assignment, index) => `
    <div class="assignment-row">
      <strong>${escapeHtml(itemName(assignment.itemId))}</strong>
      <small>${periodLabel(assignment.period)}</small>
      <div class="row-actions"><button class="danger" type="button" onclick="removeFixedItem(${index})">Remove</button></div>
    </div>
  `).join("");
}

function renderDayTabs() {
  document.getElementById("dayTabs").innerHTML = DAYS.map(day => `
    <button class="${day === activeDay ? "active" : ""}" type="button" onclick="selectMenuDay('${day}')">${capitalise(day).slice(0, 3)}</button>
  `).join("");
}

function renderWeeklyLists() {
  ["lunch", "dinner"].forEach(period => {
    const list = document.getElementById(`${period}List`);
    const assignments = menuConfig.weekly[activeDay][period];
    list.innerHTML = assignments.length ? assignments.map((itemId, index) => `
      <div class="assignment-row">
        <strong>${escapeHtml(itemName(itemId))}</strong>
        <div class="row-actions"><button class="danger" type="button" onclick="removeWeeklyItem('${period}', ${index})">Remove</button></div>
      </div>
    `).join("") : `<div class="empty-line">No ${period} dishes for ${capitalise(activeDay)}.</div>`;
  });
}

function renderSpecials() {
  const list = document.getElementById("specialList");
  list.innerHTML = menuConfig.specials.length ? menuConfig.specials.map(special => `
    <div class="assignment-row">
      <strong>${escapeHtml(itemName(special.itemId))}</strong>
      <small>${special.day === "all" ? "Every day" : capitalise(special.day)} | ${periodLabel(special.period)}</small>
      <div class="row-actions">
        <button type="button" onclick="toggleSpecial('${special.id}')">${special.active === false ? "Turn on" : "Turn off"}</button>
        <button class="danger" type="button" onclick="removeSpecial('${special.id}')">Remove</button>
      </div>
    </div>
  `).join("") : `<div class="empty-line">No specials configured.</div>`;
}

function renderTimes() {
  Object.entries(menuConfig.mealTimes).forEach(([key, value]) => {
    document.getElementById(key).value = value;
  });
}

function renderServiceLabel() {
  if (menuConfig.mode === "simple") {
    document.getElementById("activeServiceLabel").textContent = "All active items";
    return;
  }
  const activePeriod = currentPeriod(menuConfig.mealTimes);
  document.getElementById("activeServiceLabel").textContent = `${capitalise(activeDay)} ${capitalise(activePeriod)}`;
}

function defaultMenuConfig() {
  const weekly = {};
  DAYS.forEach(day => {
    weekly[day] = { lunch: [], dinner: [] };
  });
  return {
    mode: "simple",
    fixedItems: [],
    weekly,
    specials: [],
    mealTimes: {
      lunchStart: "10:30",
      dinnerStart: "18:00"
    }
  };
}

function mergeMenuConfig(config) {
  const defaults = defaultMenuConfig();
  DAYS.forEach(day => {
    defaults.weekly[day] = {
      lunch: Array.isArray(config.weekly?.[day]?.lunch) ? config.weekly[day].lunch : [],
      dinner: Array.isArray(config.weekly?.[day]?.dinner) ? config.weekly[day].dinner : []
    };
  });
  return {
    mode: config.mode === "scheduled" ? "scheduled" : "simple",
    fixedItems: Array.isArray(config.fixedItems) ? config.fixedItems : [],
    weekly: defaults.weekly,
    specials: Array.isArray(config.specials) ? config.specials : [],
    mealTimes: { ...defaults.mealTimes, ...(config.mealTimes || {}) }
  };
}

function renderMode() {
  const isScheduled = menuConfig.mode === "scheduled";
  document.getElementById("simpleModeBtn").classList.toggle("active", !isScheduled);
  document.getElementById("scheduledModeBtn").classList.toggle("active", isScheduled);
  document.getElementById("menuModeNote").textContent = isScheduled
    ? "Scheduled Menu lets you assign fixed, weekday and special dishes."
    : "Simple Menu shows every available item to customers.";
  document.querySelectorAll(".scheduled-tab").forEach(button => {
    button.hidden = !isScheduled;
  });
}

window.addVariantRow = () => {
  const rows = readVariantInputs();
  rows.push({ id: `variant-${Date.now()}`, label: "", pieces: "", price: "" });
  renderVariantRows(rows);
};

window.removeVariantRow = index => {
  const rows = readVariantInputs();
  rows.splice(index, 1);
  renderVariantRows(rows.length ? rows : [{ id: "full", label: "Full Plate", pieces: "", price: "" }]);
};

function renderVariantRows(variants) {
  document.getElementById("variantRows").innerHTML = variants.map((variant, index) => `
    <div class="variant-row" data-id="${escapeHtml(variant.id || `variant-${index}`)}">
      <input class="variant-label" value="${escapeHtml(variant.label || "")}" placeholder="Full Plate or 2 Pieces" aria-label="Portion name">
      <input class="variant-pieces" value="${escapeHtml(variant.pieces || "")}" type="number" min="1" step="1" placeholder="Pieces" aria-label="Pieces included">
      <input class="variant-price" value="${escapeHtml(variant.price || "")}" type="number" min="1" step="1" placeholder="Price Rs" aria-label="Portion price">
      <button type="button" aria-label="Remove portion" onclick="removeVariantRow(${index})">x</button>
    </div>
  `).join("");
}

function readVariantInputs() {
  return [...document.querySelectorAll(".variant-row")].map((row, index) => ({
    id: row.dataset.id || `variant-${index}`,
    label: row.querySelector(".variant-label").value.trim(),
    pieces: row.querySelector(".variant-pieces").value.trim(),
    price: row.querySelector(".variant-price").value.trim()
  }));
}

function readVariants() {
  return readVariantInputs().filter(variant => variant.label && Number(variant.price) > 0).map((variant, index) => ({
    id: variant.id || `variant-${index}`,
    label: variant.label,
    pieces: Number(variant.pieces) || 0,
    price: Number(variant.price)
  }));
}

function normalizeVariants(item) {
  if (Array.isArray(item.variants) && item.variants.length) return item.variants;
  return [{ id: "full", label: "Full Plate", pieces: 0, price: Number(item.price || 0) || "" }];
}

function variantSummary(item) {
  const variants = normalizeVariants(item);
  if (variants.length === 1) return `${escapeHtml(variants[0].label)} - Rs ${formatNumber(variants[0].price)}`;
  return `${variants.length} portions | From Rs ${formatNumber(Math.min(...variants.map(variant => Number(variant.price || 0))))}`;
}

function menuCategoryValue(category = "") {
  const replacements = {
    Meal: "Veg",
    Bread: "Breads",
    Curry: "Veg",
    Snack: "Snacks",
    Sweet: "Sweets",
    Drink: "Drinks"
  };
  return replacements[category] || category || "Veg";
}

function itemName(itemId) {
  return foodItems.find(item => item.id === itemId)?.name || "Deleted item";
}

function currentPeriod(times) {
  const now = new Date();
  const value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return value >= times.dinnerStart || value < times.lunchStart ? "dinner" : "lunch";
}

function periodLabel(period) {
  return period === "both" ? "Lunch and dinner" : capitalise(period);
}

function capitalise(value = "") {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function showMessage(id, message) {
  const element = document.getElementById(id);
  element.textContent = message;
  window.setTimeout(() => {
    if (element.textContent === message) element.textContent = "";
  }, 2500);
}

async function resizeImage(file) {
  const dataUrl = await fileDataUrl(file);
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, 760 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function fileDataUrl(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.src = src;
  });
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
