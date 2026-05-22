import { calculateSellingLineTotal, getQtyStepForSellingUnit } from "./unit-pricing.js";

const CART_PREFIX = "zunoShopCart_";

function storeKey(storeId = "") {
  return CART_PREFIX + (storeId || "default");
}

export function getCart(storeId) {
  try {
    return JSON.parse(localStorage.getItem(storeKey(storeId)) || "[]");
  } catch {
    return [];
  }
}

export function getCartCount(storeId) {
  return getCart(storeId).reduce((sum, item) => sum + Number(item.qty || 0), 0);
}

export function getCartTotal(storeId) {
  return getCart(storeId).reduce((sum, item) => sum + calculateLineTotal(item), 0);
}

export function getItemQty(storeId, productId) {
  const item = getCart(storeId).find(i => i.id === productId);
  return item ? Number(item.qty || 0) : 0;
}

export function addToCart(storeId, product) {
  const cart = getCart(storeId);
  const existing = cart.find(i => i.id === product.id);
  const step = Number(product.step || getQtyStep(product.unit));

  if (existing) {
    existing.qty = clampQty(Number(existing.qty || 0) + step, product.maxQty, step);
  } else {
    cart.push({ ...product, step, qty: clampQty(step, product.maxQty, step) });
  }

  saveCart(storeId, cart);
}

export function updateQty(storeId, productId, qty) {
  let cart = getCart(storeId);
  if (qty <= 0) {
    cart = cart.filter(i => i.id !== productId);
  } else {
    const item = cart.find(i => i.id === productId);
    if (item) item.qty = clampQty(qty, item.maxQty, item.step || getQtyStep(item));
  }
  saveCart(storeId, cart);
}

export function clearCart(storeId) {
  localStorage.removeItem(storeKey(storeId));
  window.dispatchEvent(new Event("cartUpdated"));
}

function saveCart(storeId, cart) {
  localStorage.setItem(storeKey(storeId), JSON.stringify(cart));
  window.dispatchEvent(new Event("cartUpdated"));
}

export function getQtyStep(unit = "", productName = "") {
  if (typeof unit === "object") return getQtyStepForSellingUnit(unit);
  if (unit === "g") return 100;
  if (unit === "kg") return usesSmallWeightStep(productName) ? 0.1 : 0.25;
  return 1;
}

export function calculateLineTotal(item) {
  return calculateSellingLineTotal(item);
}

function clampQty(qty, maxQty = 9999, step = 1) {
  const max = Number(maxQty || 9999);
  const rounded = Math.round(Number(qty || 0) / step) * step;
  return Math.round(Math.min(Math.max(rounded, step), max) * 1000) / 1000;
}

function usesSmallWeightStep(productName = "") {
  const name = productName.toLowerCase();
  return [
    "garlic",
    "ginger",
    "green chilli",
    "chilli",
    "chili",
    "coriander",
    "dhaniya",
    "mint",
    "pudina",
    "lemon",
    "nimbu"
  ].some(item => name.includes(item));
}
