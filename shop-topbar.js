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
  const eyebrow = store?.name ? "Zuno shop" : "Zuno in";
  const promise = store?.name ? store.name : "8 minutes";
  const address = store?.location ? `HOME - ${store.location}` : getSavedLocationLabel();

  container.innerHTML = `
    <header class="shop-topbar">
      <div class="shop-brand blinkit-style-brand" aria-label="${escapeAttr(name)}">
        <span class="shop-brand-copy">
          <span class="shop-brand-eyebrow">${escapeHtml(eyebrow)}</span>
          <strong>${escapeHtml(promise)}</strong>
          <button class="shop-brand-address" id="shopLocationBtn" type="button">${escapeHtml(address)}</button>
        </span>
      </div>
      <div class="shop-topbar-center" aria-hidden="true">
        <span class="topbar-route-shop">Z</span>
        <span class="topbar-route-line">
          <span class="topbar-route-rider"></span>
        </span>
        <span class="topbar-route-copy">Near you</span>
      </div>
      <div class="shop-topbar-actions">
        ${storeId ? `
          <a class="shop-cart-button" href="cart.html?store=${storeId}" aria-label="Cart">
            <span class="cart-mark">Cart</span>
            <b id="shopCartCount">${getCartCount(storeId)}</b>
          </a>
        ` : ""}
        <div class="shop-profile-menu" id="shopProfileMenu">
          <button class="shop-profile-btn" id="shopProfileBtn" type="button" aria-label="Profile menu" aria-expanded="false">
            <span id="shopProfileInitial">👤</span>
          </button>
          <div class="shop-profile-popover" id="shopProfilePopover" hidden></div>
        </div>
      </div>
    </header>
  `;

  bindProfileMenu();
  bindLocationButton(Boolean(store?.location));
  bindTopbarAutoHide();
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
let topbarAutoHideBound = false;

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
  const button = document.getElementById("shopProfileBtn");
  const initial = document.getElementById("shopProfileInitial");
  const popover = document.getElementById("shopProfilePopover");
  if (!button || !initial || !popover) return;

  popover.hidden = true;
  button.setAttribute("aria-expanded", "false");

  if (!session) {
    initial.textContent = "👤";
    popover.innerHTML = `
      <div class="shop-profile-card">
        <strong>Welcome</strong>
        <span>Login to shop or manage a store</span>
      </div>
      <a href="customer-login.html">Customer Login</a>
      <a href="login.html">Vendor Login</a>
    `;
    return;
  }

  initial.textContent = getInitial(session.name);
  popover.innerHTML = `
    <div class="shop-profile-card">
      <strong>${escapeHtml(session.name)}</strong>
      <span>${escapeHtml(session.detail || "")}</span>
    </div>
    ${session.role === "vendor" ? `<a href="home.html">Dashboard</a>` : ""}
    <a href="${session.role === "vendor" ? "settings.html" : "customer-login.html"}">Update profile</a>
    <button class="shop-profile-logout" id="shopLogoutBtn" type="button">Logout</button>
  `;

  document.getElementById("shopLogoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("zunoCustomer");
    localStorage.removeItem("zunoShopProfile_" + session.uid);
    window.location.href = "shops.html";
  });
}

function bindProfileMenu() {
  const button = document.getElementById("shopProfileBtn");
  const popover = document.getElementById("shopProfilePopover");
  if (!button || !popover) return;

  button.addEventListener("click", event => {
    event.stopPropagation();
    popover.hidden = !popover.hidden;
    button.setAttribute("aria-expanded", String(!popover.hidden));
  });

  document.addEventListener("click", event => {
    if (!popover.hidden && !event.target.closest(".shop-profile-menu")) {
      popover.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  });
}

function bindLocationButton(isStoreLocation = false) {
  const button = document.getElementById("shopLocationBtn");
  if (!button) return;

  button.addEventListener("click", () => {
    if (isStoreLocation) {
      const manual = prompt("Set your approximate delivery/local area", readJson("zunoApproxLocation")?.label || "");
      if (manual?.trim()) {
        saveApproxLocation(manual.trim());
        button.textContent = getSavedLocationLabel();
      }
      return;
    }

    button.textContent = "Finding location...";
    if (!navigator.geolocation) {
      askManualLocation(button);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async position => {
        const { latitude, longitude, accuracy } = position.coords;
        const label = await getReadableAddress(latitude, longitude) || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
        saveApproxLocation(label, accuracy);
        button.textContent = getSavedLocationLabel();
      },
      () => askManualLocation(button),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 1000 * 60 * 20 }
    );
  });
}

function bindTopbarAutoHide() {
  if (topbarAutoHideBound) return;
  topbarAutoHideBound = true;

  let ticking = false;
  const update = () => {
    ticking = false;
    const topbar = document.querySelector(".shop-topbar");
    if (!topbar) return;
    const shouldHide = window.scrollY > 80;
    topbar.classList.toggle("is-hidden", shouldHide);
    document.body.classList.toggle("shop-topbar-hidden", shouldHide);
  };

  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
}

function askManualLocation(button) {
  const manual = prompt("Enter your area or address approximately", readJson("zunoApproxLocation")?.label || "");
  if (manual?.trim()) {
    saveApproxLocation(manual.trim());
  }
  button.textContent = getSavedLocationLabel();
}

async function getReadableAddress(latitude, longitude) {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("zoom", "17");
    url.searchParams.set("addressdetails", "1");
    const response = await fetch(url.toString(), {
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) return "";
    const data = await response.json();
    return formatReadableAddress(data);
  } catch (error) {
    console.warn("Address lookup failed:", error);
    return "";
  }
}

function formatReadableAddress(data = {}) {
  const address = data.address || {};
  const parts = [
    address.house_number && address.road ? `${address.house_number} ${address.road}` : address.road,
    address.neighbourhood || address.suburb || address.village || address.town || address.city_district,
    address.city || address.state_district || address.state
  ].filter(Boolean);
  const label = parts.join(", ");
  return label || data.display_name || "";
}

function saveApproxLocation(label, accuracy = null) {
  localStorage.setItem("zunoApproxLocation", JSON.stringify({
    label,
    accuracy,
    updatedAt: Date.now()
  }));
}

function getSavedLocationLabel() {
  const saved = readJson("zunoApproxLocation");
  return saved?.label ? `HOME - ${saved.label}` : "Select location";
}

function getInitial(name = "") {
  return String(name).trim().charAt(0).toUpperCase() || "👤";
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

function escapeAttr(value = "") {
  return escapeHtml(value).replace(/`/g, "");
}
