import { db, auth } from "./firebase.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let currentUserId = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUserId = user.uid;
  await loadSettings();
});

async function loadSettings() {
  try {
    // load profile
    const profileSnap = await getDoc(doc(db, "users", currentUserId, "settings", "profile"));
    if (profileSnap.exists()) {
      const p = profileSnap.data();
      if (p.name || p.shopName) document.getElementById("shopName").value = p.name || p.shopName;
      if (p.shopType)    document.getElementById("shopType").value    = p.shopType;
      if (p.ownerName)   document.getElementById("ownerName").value   = p.ownerName;
      if (p.shopPhone)   document.getElementById("shopPhone").value   = p.shopPhone;
      if (p.location || p.shopAddress) document.getElementById("shopAddress").value = p.location || p.shopAddress;
      renderDigitalShopLink(p.storeId);
    }

    // load form config
    const formSnap = await getDoc(doc(db, "users", currentUserId, "settings", "formConfig"));
    if (formSnap.exists()) {
      const f = formSnap.data();
      const toggles = ["customerName", "phone", "deliveryStatus", "paymentMode", "creditOptions", "sellingPrice"];
      toggles.forEach(key => {
        const el = document.getElementById("toggle_" + key);
        if (el && f[key] !== undefined) el.checked = f[key];
      });
    }
  } catch (e) {
    console.log("Settings load error:", e);
  }
}

window.saveSettings = async () => {
  if (!currentUserId) return;

  const profile = {
    name:        document.getElementById("shopName").value.trim(),
    shopName:    document.getElementById("shopName").value.trim(),
    shopType:    document.getElementById("shopType").value.trim(),
    ownerName:   document.getElementById("ownerName").value.trim(),
    shopPhone:   document.getElementById("shopPhone").value.trim(),
    shopAddress: document.getElementById("shopAddress").value.trim(),
    location:    document.getElementById("shopAddress").value.trim()
  };

  const formConfig = {
    customerName:   document.getElementById("toggle_customerName").checked,
    phone:          document.getElementById("toggle_phone").checked,
    deliveryStatus: document.getElementById("toggle_deliveryStatus").checked,
    paymentMode:    document.getElementById("toggle_paymentMode").checked,
    creditOptions:  document.getElementById("toggle_creditOptions").checked,
    sellingPrice:   document.getElementById("toggle_sellingPrice").checked
  };

  const profileRef = doc(db, "users", currentUserId, "settings", "profile");
  const existingProfile = await getDoc(profileRef);
  const existingData = existingProfile.exists() ? existingProfile.data() : {};
  const fullProfile = {
    ...profile,
    tagline: existingData.tagline || (profile.location ? `Fresh daily in ${profile.location}` : "Fresh products, fair prices"),
    updatedAt: serverTimestamp()
  };

  await setDoc(profileRef, fullProfile, { merge: true });
  if (existingData.storeId) {
    await setDoc(doc(db, "storeIndex", existingData.storeId), {
      uid: currentUserId,
      name: profile.name,
      location: profile.location,
      tagline: fullProfile.tagline,
      isLive: existingData.isLive !== false,
      updatedAt: serverTimestamp()
    }, { merge: true });
    renderDigitalShopLink(existingData.storeId);
  }
  await setDoc(doc(db, "users", currentUserId, "settings", "formConfig"), formConfig, { merge: true });

  // cache profile for topbar instant load
  localStorage.setItem("zunoShopProfile_" + currentUserId, JSON.stringify(fullProfile));
  // cache formConfig for index.html instant load
  localStorage.setItem("zunoFormConfig_" + currentUserId, JSON.stringify(formConfig));

  const msg = document.getElementById("saveMsg");
  msg.textContent = "✓ Settings saved successfully";
  setTimeout(() => msg.textContent = "", 3000);
};

function renderDigitalShopLink(storeId) {
  const label = document.getElementById("digitalShopLink");
  const link = document.getElementById("openDigitalShop");
  if (!label || !link) return;

  if (!storeId) {
    label.textContent = "Finish one-time shop setup to create your public shop";
    link.href = "shop-setup.html";
    link.textContent = "Set up";
    return;
  }

  const href = `shop.html?store=${storeId}`;
  label.textContent = href;
  link.href = href;
  link.textContent = "Open shop";
}
