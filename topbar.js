import { db, auth } from "./firebase.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ---------- INJECT STYLES ---------- */
const style = document.createElement("style");
style.textContent = `
  .zuno-topbar {
    position: sticky;
    top: 0;
    z-index: 800;
    background: rgba(255,255,255,0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(0,0,0,0.07);
    padding: 10px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 100%;
    box-shadow: 0 1px 8px rgba(0,0,0,0.04);
  }

  .zuno-topbar-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .zuno-topbar-mark {
    width: 34px;
    height: 34px;
    border-radius: 11px;
    box-shadow: 0 8px 18px rgba(8,22,42,0.14);
    flex: 0 0 auto;
  }

  .zuno-topbar-copy {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .zuno-topbar-brand {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #aaa;
    font-family: 'DM Sans', sans-serif;
  }

  .zuno-topbar-app {
    font-size: 13px;
    font-weight: 600;
    color: #34c98a;
    font-family: 'DM Sans', sans-serif;
    letter-spacing: 0.02em;
  }

  .zuno-topbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .zuno-topbar-shop {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
  }

  .zuno-topbar-shop-name {
    font-size: 13px;
    font-weight: 600;
    color: #1a1a18;
    font-family: 'DM Sans', sans-serif;
    max-width: 160px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .zuno-topbar-shop-sub {
    font-size: 10px;
    color: #aaa;
    font-family: 'DM Sans', sans-serif;
  }

  .zuno-topbar-date {
    font-size: 11px;
    color: #8a8a8a;
    font-family: 'DM Sans', sans-serif;
    white-space: nowrap;
  }

  .zuno-topbar-settings {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: #f5f5f3;
    border: 1px solid rgba(0,0,0,0.07);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    cursor: pointer;
    text-decoration: none;
    transition: background 0.15s, transform 0.1s;
    flex-shrink: 0;
  }

  .zuno-topbar-settings:hover { background: #ebebeb; }
  .zuno-topbar-settings:active { transform: scale(0.94); }

  /* push content below topbar */
  body { padding-top: 0 !important; }
`;
document.head.appendChild(style);

/* ---------- INJECT TOPBAR HTML ---------- */
const topbar = document.createElement("div");
topbar.className = "zuno-topbar";
topbar.innerHTML = `
  <div class="zuno-topbar-left">
    <img class="zuno-topbar-mark" src="/zuno-logo.png" alt="">
    <div class="zuno-topbar-copy">
      <span class="zuno-topbar-brand">Zuno</span>
      <span class="zuno-topbar-app">AI Business Assistant</span>
    </div>
  </div>
  <div class="zuno-topbar-right">
    <div class="zuno-topbar-shop">
      <span class="zuno-topbar-shop-name" id="topbarShopName">Your Shop</span>
      <span class="zuno-topbar-shop-sub" id="topbarShopSub">Loading...</span>
    </div>
    <span class="zuno-topbar-date" id="topbarDate"></span>
    <a href="/settings.html" class="zuno-topbar-settings" title="Settings">⚙️</a>
  </div>
`;

/* insert as first child of body */
document.body.insertBefore(topbar, document.body.firstChild);
document.getElementById("topbarDate").textContent =
  new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

/* ---------- LOAD SHOP PROFILE ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  // try localStorage first for instant load
  const cached = localStorage.getItem("zunoShopProfile_" + user.uid);
  if (cached) {
    const p = JSON.parse(cached);
    applyProfile(p);
  }

  // then fetch fresh from Firestore
  try {
    const snap = await getDoc(doc(db, "users", user.uid, "settings", "profile"));
    if (snap.exists()) {
      const p = snap.data();
      localStorage.setItem("zunoShopProfile_" + user.uid, JSON.stringify(p));
      applyProfile(p);
    } else {
      document.getElementById("topbarShopName").textContent = "Your Shop";
      document.getElementById("topbarShopSub").textContent  = "Set up in Settings";
    }
  } catch (e) {
    document.getElementById("topbarShopSub").textContent = "";
  }
});

function applyProfile(p) {
  if (p.shopName) document.getElementById("topbarShopName").textContent = p.shopName;
  if (p.shopType) document.getElementById("topbarShopSub").textContent  = p.shopType;
  else            document.getElementById("topbarShopSub").textContent  = "";
}
