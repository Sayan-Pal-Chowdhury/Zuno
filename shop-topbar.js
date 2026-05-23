import { getCartCount } from "./shop-cart.js";
import { getStoreId } from "./shop-store.js";
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function initShopTopbar(store, session = null) {
  const container = document.getElementById("shop-topbar");
  if (!container) return;

  const storeId = store?.storeId || getStoreId();
  const name = store?.name || "Zuno Shops";
  const location = store?.location ? `<span>${store.location}</span>` : "";

  container.innerHTML = `
    <header class="shop-topbar">
      <a class="shop-brand" href="${storeId ? `shop.html?store=${storeId}` : "shops.html"}">
        <img class="shop-brand-logo" src="zuno-logo.png" alt="">
        <span>
          <strong>${name}</strong>
          ${location}
        </span>
      </a>
      <div class="shop-topbar-actions">
        <div class="shop-login-menu" id="shopLoginMenu">
          <button class="shop-login-btn" id="shopLoginBtn" type="button">Login</button>
          <div class="shop-login-popover" id="shopLoginPopover" hidden>
            <a href="login.html">Vendor Login</a>
            <a href="customer-login.html">Customer Login</a>
          </div>
        </div>
        <div class="shop-session" id="shopSession" hidden></div>
        ${storeId ? `
          <a class="shop-cart-button" href="cart.html?store=${storeId}" aria-label="Cart">
            <span class="cart-mark">Cart</span>
            <b id="shopCartCount">${getCartCount(storeId)}</b>
          </a>
        ` : ""}
      </div>
    </header>
  `;

  bindLoginMenu();
  if (session) renderShopSession(session);
  watchAuthSession();
  updateCartBadge(storeId);
}

export function updateCartBadge(storeId = getStoreId()) {
  const badge = document.getElementById("shopCartCount");
  if (!badge) return;
  const count = getCartCount(storeId);
  badge.textContent = count;
  badge.classList.toggle("visible", count > 0);
}

let watchingAuthSession = false;

function watchAuthSession() {
  if (watchingAuthSession) return;
  watchingAuthSession = true;

  onAuthStateChanged(auth, async user => {
    if (!user) {
      renderShopSession(null);
      document.body.classList.remove("shop-user-logged-in");
      return;
    }

    const session = await loadSessionProfile(user);
    renderShopSession(session);
    document.body.classList.add("shop-user-logged-in");
  });
}

async function loadSessionProfile(user) {
  const cachedShop = readJson("zunoShopProfile_" + user.uid);
  if (cachedShop) {
    return normalizeSession(cachedShop, "vendor", user);
  }

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid, "settings", "profile"));
    if (profileSnap.exists()) {
      const profile = profileSnap.data();
      localStorage.setItem("zunoShopProfile_" + user.uid, JSON.stringify(profile));
      return normalizeSession(profile, "vendor", user);
    }

    const cachedCustomer = readJson("zunoCustomer");
    if (cachedCustomer?.uid === user.uid) {
      return normalizeSession(cachedCustomer, "customer", user);
    }

    const customerSnap = await getDoc(doc(db, "customers", user.uid));
    if (customerSnap.exists()) {
      const customer = { uid: user.uid, ...customerSnap.data() };
      localStorage.setItem("zunoCustomer", JSON.stringify(customer));
      return normalizeSession(customer, "customer", user);
    }
  } catch (error) {
    console.warn("Session profile load failed:", error);
  }

  return normalizeSession({}, "user", user);
}

function normalizeSession(profile, role, user) {
  return {
    uid: user.uid,
    role,
    name: profile.name || profile.ownerName || profile.shopName || user.displayName || user.email?.split("@")[0] || "User",
    detail: role === "customer"
      ? profile.phone || profile.email || "Customer"
      : profile.shopName || profile.businessTypeLabel || profile.shopType || "Vendor"
  };
}

function renderShopSession(session) {
  const el = document.getElementById("shopSession");
  const loginMenu = document.getElementById("shopLoginMenu");
  const loginPopover = document.getElementById("shopLoginPopover");
  if (!el) return;

  if (!session) {
    el.classList.remove("vendor-session", "customer-session");
    el.hidden = true;
    el.innerHTML = "";
    if (loginMenu) loginMenu.hidden = false;
    if (loginPopover) loginPopover.hidden = true;
    return;
  }

  if (loginMenu) loginMenu.hidden = true;
  if (loginPopover) loginPopover.hidden = true;
  el.classList.toggle("vendor-session", session.role === "vendor");
  el.classList.toggle("customer-session", session.role === "customer");
  el.hidden = false;
  el.innerHTML = `
    <div class="shop-session-copy">
      <strong>${escapeHtml(session.name)}</strong>
      <span>${escapeHtml(session.detail || "")}</span>
    </div>
    ${session.role === "vendor" ? `<a class="shop-dashboard-btn" href="home.html">Dashboard</a>` : ""}
    <button class="shop-logout-btn" id="shopLogoutBtn" type="button">Logout</button>
  `;

  document.getElementById("shopLogoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("zunoCustomer");
    localStorage.removeItem("zunoShopProfile_" + session.uid);
    window.location.href = "shops.html";
  });
}

function bindLoginMenu() {
  const button = document.getElementById("shopLoginBtn");
  const popover = document.getElementById("shopLoginPopover");
  if (!button || !popover) return;

  button.addEventListener("click", event => {
    event.stopPropagation();
    popover.hidden = !popover.hidden;
  });

  document.addEventListener("click", event => {
    if (!popover.hidden && !event.target.closest(".shop-login-menu")) {
      popover.hidden = true;
    }
  });
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
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
