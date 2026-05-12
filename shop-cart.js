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
  return getCart(storeId).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
}

export function getItemQty(storeId, productId) {
  const item = getCart(storeId).find(i => i.id === productId);
  return item ? Number(item.qty || 0) : 0;
}

export function addToCart(storeId, product) {
  const cart = getCart(storeId);
  const existing = cart.find(i => i.id === product.id);

  if (existing) {
    existing.qty = Math.min(Number(existing.qty || 0) + 1, Number(product.maxQty || 9999));
  } else {
    cart.push({ ...product, qty: 1 });
  }

  saveCart(storeId, cart);
}

export function updateQty(storeId, productId, qty) {
  let cart = getCart(storeId);
  if (qty <= 0) {
    cart = cart.filter(i => i.id !== productId);
  } else {
    const item = cart.find(i => i.id === productId);
    if (item) item.qty = qty;
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
