import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ADMIN_EMAILS = ["sayan123401@gmail.com"];

/* ---------- DETECT ACTIVE PAGE ---------- */
const path = window.location.pathname.toLowerCase();
const localNavigationSuffix = ["127.0.0.1", "localhost"].includes(window.location.hostname) ? "?local=41" : "";

function appHref(route) {
  return `${route}${localNavigationSuffix}`;
}

function isActive(page) {
  if (page === "home"      && (path === "/" || path.includes("home")))       return true;
  if (page === "order"     && path.includes("index"))                        return true;
  if (page === "inventory" && path.includes("inventory"))                    return true;
  if (page === "menu"      && path.includes("menu"))                         return true;
  if (page === "credit"    && path.includes("credit"))                       return true;
  if (page === "sales"     && path.includes("sales"))                        return true;
  return false;
}

/* ---------- INJECT STYLES ---------- */
const style = document.createElement("style");
style.textContent = `
  /* ===== BODY PADDING ===== */
  body { padding-bottom: 108px !important; }

  @media (max-width: 600px) {
    input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),
    select,
    textarea {
      font-size: 16px !important;
    }
  }

  /* ===== BOTTOM BAR ===== */
  .zuno-nav {
    position: fixed;
    bottom: 10px;
    left: 50%;
    right: auto;
    width: min(92vw, 600px);
    height: 70px;
    transform: translateX(-50%) translateY(var(--zuno-nav-keyboard-offset, 0px));
    background: rgba(255,255,255,0.92);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid rgba(0,0,0,0.07);
    border-radius: 26px;
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding: 0 8px calc(env(safe-area-inset-bottom) / 2);
    z-index: 900;
    box-shadow: 0 12px 34px rgba(13, 38, 25, 0.12);
    transition: transform 0.18s ease, opacity 0.18s ease;
  }

  body.keyboard-open .zuno-nav {
    transform: translateX(-50%) translateY(120%);
    opacity: 0;
    pointer-events: none;
  }

  .zuno-nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    text-decoration: none;
    padding: 8px 8px;
    border-radius: 16px;
    transition: background 0.2s, transform 0.15s;
    cursor: pointer;
    border: none;
    background: none;
    min-width: 48px;
    position: relative;
  }

  .zuno-nav-item:hover { background: rgba(52,201,138,0.08); }
  .zuno-nav-item:active { transform: scale(0.92); }

  .zuno-nav-icon {
    font-size: 20px;
    line-height: 1;
    transition: transform 0.2s;
  }

  .zuno-nav-label {
    font-size: 9px;
    font-weight: 500;
    color: #aaa;
    letter-spacing: 0.02em;
    font-family: 'DM Sans', sans-serif;
    white-space: nowrap;
  }

  .zuno-nav-item.active .zuno-nav-label {
    color: #34c98a;
    font-weight: 700;
  }

  .zuno-nav-item.active .zuno-nav-icon {
    transform: translateY(-2px);
  }

  .zuno-nav-item.active::after {
    content: '';
    position: absolute;
    bottom: 4px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #34c98a;
  }

  /* ADD ORDER button — special */
  .zuno-nav-add {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    text-decoration: none;
    cursor: pointer;
    border: none;
    background: none;
    padding: 0;
    min-width: 52px;
  }

  .zuno-nav-add-circle {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: linear-gradient(135deg, #34c98a, #2aa572);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 28px rgba(52,201,138,0.38);
    transition: transform 0.2s, box-shadow 0.2s;
    margin-top: -18px;
  }

  .zuno-nav-add:hover .zuno-nav-add-circle {
    transform: scale(1.08) translateY(-2px);
    box-shadow: 0 8px 24px rgba(52,201,138,0.5);
  }

  .zuno-nav-add:active .zuno-nav-add-circle { transform: scale(0.94); }

  .zuno-nav-add-icon {
    font-size: 24px;
    color: white;
    line-height: 1;
  }

  .zuno-nav-add-label {
    font-size: 9px;
    font-weight: 600;
    color: #34c98a;
    letter-spacing: 0.02em;
    font-family: 'DM Sans', sans-serif;
  }

  /* MORE button */
  .zuno-nav-more-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #aaa;
    margin: 1px auto;
    transition: background 0.2s;
  }

  .zuno-nav-item.drawer-open .zuno-nav-more-dot { background: #34c98a; }

  /* ===== DRAWER OVERLAY ===== */
  .zuno-drawer-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0);
    z-index: 950;
    pointer-events: none;
    transition: background 0.3s ease;
  }

  .zuno-drawer-overlay.open {
    background: rgba(0,0,0,0.3);
    pointer-events: all;
  }

  /* ===== DRAWER ===== */
  .zuno-drawer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #ffffff;
    border-radius: 24px 24px 0 0;
    padding: 0 0 calc(env(safe-area-inset-bottom) + 16px);
    z-index: 1000;
    transform: translateY(100%);
    transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
    box-shadow: 0 -8px 40px rgba(0,0,0,0.12);
    max-width: 480px;
    margin: 0 auto;
  }

  .zuno-drawer.open { transform: translateY(0); }

  .zuno-drawer-handle {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: #e0e0e0;
    margin: 12px auto 8px;
  }

  .zuno-drawer-header {
    padding: 8px 20px 16px;
    border-bottom: 1px solid rgba(0,0,0,0.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .zuno-drawer-title {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #aaa;
    font-family: 'DM Sans', sans-serif;
  }

  .zuno-drawer-close {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #f5f5f3;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: #666;
    transition: background 0.15s;
  }

  .zuno-drawer-close:hover { background: #ebebeb; }

  .zuno-drawer-items {
    padding: 8px 12px;
  }

  .zuno-drawer-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 12px;
    border-radius: 16px;
    text-decoration: none;
    cursor: pointer;
    border: none;
    background: none;
    width: 100%;
    text-align: left;
    transition: background 0.15s, transform 0.1s;
    font-family: 'DM Sans', sans-serif;
  }

  .zuno-drawer-item:hover { background: #f7f7f4; }
  .zuno-drawer-item:active { transform: scale(0.98); }

  .zuno-drawer-item-icon {
    width: 42px;
    height: 42px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    flex-shrink: 0;
  }

  .zuno-drawer-item-text { flex: 1; }

  .zuno-drawer-item-title {
    font-size: 15px;
    font-weight: 600;
    color: #1a1a18;
    display: block;
    line-height: 1.3;
  }

  .zuno-drawer-item-sub {
    font-size: 12px;
    color: #aaa;
    display: block;
    margin-top: 1px;
  }

  .zuno-drawer-item-arrow {
    font-size: 16px;
    color: #ccc;
  }

  .zuno-drawer-item.logout .zuno-drawer-item-title { color: #c0392b; }
  .zuno-drawer-item.logout .zuno-drawer-item-icon  { background: #fdf0ee; }

  .zuno-drawer-divider {
    height: 1px;
    background: rgba(0,0,0,0.05);
    margin: 4px 12px;
  }

  /* ===== SOON BADGE ===== */
  .soon-badge {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: rgba(0,0,0,0.05);
    color: #aaa;
    padding: 2px 6px;
    border-radius: 10px;
    border: 1px solid rgba(0,0,0,0.07);
  }

  /* ===== LOGOUT CONFIRM ===== */
  .zuno-logout-confirm {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .zuno-logout-confirm.hidden { display: none; }

  .zuno-logout-box {
    background: white;
    border-radius: 20px;
    padding: 24px;
    width: 100%;
    max-width: 300px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  }

  .zuno-logout-box h3 {
    font-size: 17px;
    font-weight: 700;
    color: #1a1a18;
    margin-bottom: 8px;
    font-family: 'DM Sans', sans-serif;
  }

  .zuno-logout-box p {
    font-size: 13px;
    color: #888;
    margin-bottom: 20px;
    font-family: 'DM Sans', sans-serif;
  }

  .zuno-logout-btns {
    display: flex;
    gap: 10px;
  }

  .zuno-logout-btns button {
    flex: 1;
    height: 42px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: 'DM Sans', sans-serif;
    border: none;
    transition: transform 0.1s;
  }

  .zuno-logout-btns button:active { transform: scale(0.96); }

  .zuno-btn-cancel  { background: #f5f5f3; color: #555; }
  .zuno-btn-logout  { background: #c0392b; color: white; }

  @media (min-width: 600px) {
    .zuno-nav { width: min(600px, 72vw); }
    .zuno-drawer { max-width: 480px; }
  }
`;
document.head.appendChild(style);

/* ---------- INJECT NAV HTML ---------- */
const nav = document.createElement("div");
nav.innerHTML = `
  <!-- LOGOUT CONFIRM -->
  <div class="zuno-logout-confirm hidden" id="zunoLogoutConfirm">
    <div class="zuno-logout-box">
      <h3>Logout?</h3>
      <p>You'll need to sign in again to access your business data.</p>
      <div class="zuno-logout-btns">
        <button class="zuno-btn-cancel" onclick="document.getElementById('zunoLogoutConfirm').classList.add('hidden')">Cancel</button>
        <button class="zuno-btn-logout" id="zunoConfirmLogoutBtn">Logout</button>
      </div>
    </div>
  </div>

  <!-- DRAWER OVERLAY -->
  <div class="zuno-drawer-overlay" id="zunoDrawerOverlay" onclick="closeDrawer()"></div>

  <!-- DRAWER -->
  <div class="zuno-drawer" id="zunoDrawer">
    <div class="zuno-drawer-handle"></div>
    <div class="zuno-drawer-header">
      <span class="zuno-drawer-title">More</span>
      <button class="zuno-drawer-close" onclick="closeDrawer()">✕</button>
    </div>
    <div class="zuno-drawer-items">

      <a href="${appHref("/customer.html")}" class="zuno-drawer-item">
        <div class="zuno-drawer-item-icon" style="background:#fff0f0;">👥</div>
        <div class="zuno-drawer-item-text">
          <span class="zuno-drawer-item-title">Customers</span>
          <span class="zuno-drawer-item-sub">Directory, history & CRM</span>
        </div>
        <span class="soon-badge">Soon</span>
      </a>

      <a href="${appHref("/finance.html")}" class="zuno-drawer-item">
        <div class="zuno-drawer-item-icon" style="background:#fff8e8;">💰</div>
        <div class="zuno-drawer-item-text">
          <span class="zuno-drawer-item-title">Finance</span>
          <span class="zuno-drawer-item-sub">P&L, cashflow & reports</span>
        </div>
        <span class="soon-badge">Soon</span>
      </a>

      <div class="zuno-drawer-divider"></div>

      <a href="${appHref("/settings.html")}" class="zuno-drawer-item">
        <div class="zuno-drawer-item-icon" style="background:#f5f5f3;">⚙️</div>
        <div class="zuno-drawer-item-text">
          <span class="zuno-drawer-item-title">Settings</span>
          <span class="zuno-drawer-item-sub">Products, profile & preferences</span>
        </div>
        <span class="zuno-drawer-item-arrow">›</span>
      </a>

      <a href="${appHref("/admin.html")}" class="zuno-drawer-item" id="zunoAdminDrawerItem" hidden>
        <div class="zuno-drawer-item-icon" style="background:#fff7cc;">A</div>
        <div class="zuno-drawer-item-text">
          <span class="zuno-drawer-item-title">Admin</span>
          <span class="zuno-drawer-item-sub">Personal approvals & operations</span>
        </div>
        <span class="zuno-drawer-item-arrow">›</span>
      </a>

      <div class="zuno-drawer-divider"></div>

      <button class="zuno-drawer-item logout" onclick="showLogoutConfirm()">
        <div class="zuno-drawer-item-icon">🚪</div>
        <div class="zuno-drawer-item-text">
          <span class="zuno-drawer-item-title">Logout</span>
          <span class="zuno-drawer-item-sub">Sign out of your account</span>
        </div>
      </button>

    </div>
  </div>

  <!-- BOTTOM NAV BAR -->
  <nav class="zuno-nav">

    <a href="${appHref("/home.html")}" class="zuno-nav-item ${isActive("home") ? "active" : ""}">
      <span class="zuno-nav-icon">🏠</span>
      <span class="zuno-nav-label">Home</span>
    </a>

    <a href="${appHref("/inventory.htm")}" id="zunoStockNavLink" class="zuno-nav-item ${isActive("inventory") || isActive("menu") ? "active" : ""}" data-feature-link="inventoryEnabled">
      <span class="zuno-nav-icon">📦</span>
      <span class="zuno-nav-label">Inventory</span>
    </a>

    <a href="${appHref("/index.html")}" class="zuno-nav-add">
      <div class="zuno-nav-add-circle">
        <span class="zuno-nav-add-icon">＋</span>
      </div>
      <span class="zuno-nav-add-label">Order</span>
    </a>

    <a href="${appHref("/credit.html")}" class="zuno-nav-item ${isActive("credit") ? "active" : ""}" data-feature-link="creditEnabled">
      <span class="zuno-nav-icon">💳</span>
      <span class="zuno-nav-label">Credit</span>
    </a>

    <a href="${appHref("/sales.html")}" class="zuno-nav-item ${isActive("sales") ? "active" : ""}">
      <span class="zuno-nav-icon">📊</span>
      <span class="zuno-nav-label">Sales</span>
    </a>

    <button class="zuno-nav-item" id="zunoMoreBtn" onclick="toggleDrawer()">
      <div style="display:flex;flex-direction:column;gap:3px;align-items:center;padding:4px 0;">
        <div class="zuno-nav-more-dot"></div>
        <div class="zuno-nav-more-dot"></div>
        <div class="zuno-nav-more-dot"></div>
      </div>
      <span class="zuno-nav-label">More</span>
    </button>

  </nav>
`;
document.body.appendChild(nav);
watchFeatureAccess();

/* ---------- DRAWER LOGIC ---------- */
function toggleDrawer() {
  const drawer  = document.getElementById("zunoDrawer");
  const overlay = document.getElementById("zunoDrawerOverlay");
  const moreBtn = document.getElementById("zunoMoreBtn");
  const isOpen  = drawer.classList.contains("open");

  if (isOpen) {
    closeDrawer();
  } else {
    drawer.classList.add("open");
    overlay.classList.add("open");
    moreBtn.classList.add("drawer-open");
  }
}

function closeDrawer() {
  document.getElementById("zunoDrawer").classList.remove("open");
  document.getElementById("zunoDrawerOverlay").classList.remove("open");
  document.getElementById("zunoMoreBtn")?.classList.remove("drawer-open");
}

/* ---------- LOGOUT ---------- */
function showLogoutConfirm() {
  closeDrawer();
  document.getElementById("zunoLogoutConfirm").classList.remove("hidden");
}

document.getElementById("zunoConfirmLogoutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "/shops.html";
  } catch (e) {
    console.error("Logout error:", e);
  }
});

/* ---------- SWIPE TO CLOSE DRAWER ---------- */
let touchStartY = 0;
const drawer = document.getElementById("zunoDrawer");

drawer.addEventListener("touchstart", e => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });

drawer.addEventListener("touchmove", e => {
  const delta = e.touches[0].clientY - touchStartY;
  if (delta > 60) closeDrawer();
}, { passive: true });

/* ---------- EXPOSE TO GLOBAL ---------- */
window.toggleDrawer    = toggleDrawer;
window.closeDrawer     = closeDrawer;
window.showLogoutConfirm = showLogoutConfirm;

function watchFeatureAccess() {
  onAuthStateChanged(auth, async user => {
    document.getElementById("zunoAdminDrawerItem")?.toggleAttribute("hidden", !ADMIN_EMAILS.includes(user?.email || ""));
    if (!user) return;

    try {
      const snap = await getDoc(doc(db, "users", user.uid, "settings", "profile"));
      const profile = snap.exists() ? snap.data() : {};
      applyFeatureVisibility(profile);
    } catch (error) {
      console.warn("Feature visibility failed:", error);
    }
  });
}

function applyFeatureVisibility(profile) {
  const stockLink = document.getElementById("zunoStockNavLink");
  const usesFoodMenu = profile.foodMenuEnabled === true;
  if (stockLink) {
    stockLink.href = appHref(usesFoodMenu ? "/menu.html" : "/inventory.htm");
    stockLink.dataset.featureLink = usesFoodMenu ? "menuEnabled" : "inventoryEnabled";
    stockLink.querySelector(".zuno-nav-label").textContent = usesFoodMenu ? "Menu" : "Inventory";
    stockLink.querySelector(".zuno-nav-icon").textContent = usesFoodMenu ? "🍽️" : "📦";
    stockLink.classList.toggle("active", usesFoodMenu ? path.includes("menu") : path.includes("inventory"));
  }

  document.querySelectorAll("[data-feature-link]").forEach(link => {
    const key = link.dataset.featureLink;
    link.hidden = profile[key] === false;
  });

  const disabledPages = {
    inventoryEnabled: path.includes("inventory") && !usesFoodMenu,
    creditEnabled: path.includes("credit")
  };

  Object.entries(disabledPages).forEach(([key, isCurrentPage]) => {
    if (isCurrentPage && profile[key] === false) {
      window.location.href = appHref("/home.html");
    }
  });

  if (usesFoodMenu && path.includes("inventory")) {
    window.location.href = appHref("/menu.html");
  }
}
