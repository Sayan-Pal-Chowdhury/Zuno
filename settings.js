import { db, auth } from "./firebase.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { BUSINESS_TYPES, getBusinessType } from "./marketplace-categories.js";

let currentUserId = null;
let coverPhotoUrl = "";

document.getElementById("shopType").innerHTML += BUSINESS_TYPES
  .map(type => `<option value="${type.id}">${type.label}</option>`)
  .join("");

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
      if (p.businessType || p.shopType) {
        document.getElementById("shopType").value = normalizeBusinessType(p.businessType || p.shopType);
      }
      document.getElementById("deliveryEnabled").checked = p.deliveryEnabled !== false;
      document.getElementById("publicOrdersEnabled").checked = p.publicOrdersEnabled !== false;
      coverPhotoUrl = p.coverPhotoUrl || "";
      renderCoverPreview();
      if (p.ownerName)   document.getElementById("ownerName").value   = p.ownerName;
      if (p.shopPhone)   document.getElementById("shopPhone").value   = p.shopPhone;
      if (p.settlementUpi) document.getElementById("settlementUpi").value = p.settlementUpi;
      if (p.settlementName) document.getElementById("settlementName").value = p.settlementName;
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

document.getElementById("coverPhoto")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  coverPhotoUrl = await resizeCoverPhoto(file);
  renderCoverPreview();
});

window.saveSettings = async () => {
  if (!currentUserId) return;

  const businessType = document.getElementById("shopType").value.trim() || "other";
  const typeInfo = getBusinessType(businessType);
  const profile = {
    name:        document.getElementById("shopName").value.trim(),
    shopName:    document.getElementById("shopName").value.trim(),
    shopType:    typeInfo.category,
    businessType,
    businessTypeLabel: typeInfo.label,
    customerCategory: typeInfo.category,
    serviceMode: typeInfo.mode,
    deliveryEnabled: document.getElementById("deliveryEnabled").checked,
    publicOrdersEnabled: document.getElementById("publicOrdersEnabled").checked,
    coverPhotoUrl,
    ownerName:   document.getElementById("ownerName").value.trim(),
    shopPhone:   document.getElementById("shopPhone").value.trim(),
    settlementUpi: document.getElementById("settlementUpi").value.trim(),
    settlementName: document.getElementById("settlementName").value.trim(),
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
      shopType: profile.shopType || "daily_needs",
      businessType: profile.businessType,
      businessTypeLabel: profile.businessTypeLabel,
      customerCategory: profile.customerCategory,
      serviceMode: profile.serviceMode,
      deliveryEnabled: profile.deliveryEnabled,
      publicOrdersEnabled: profile.publicOrdersEnabled,
      coverPhotoUrl: profile.coverPhotoUrl || "",
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
    label.textContent = "Inventory-only account. Enable a public shop when you are ready.";
    link.href = "shop-setup.html";
    link.textContent = "Enable public shop";
    return;
  }

  const href = `shop.html?store=${storeId}`;
  label.textContent = href;
  link.href = href;
  link.textContent = "Open shop";
}

function normalizeBusinessType(value = "") {
  if (BUSINESS_TYPES.some(type => type.id === value)) return value;
  const legacy = {
    food: "restaurant",
    grocery: "kirana",
    hardware: "hardware",
    pharmacy: "pharmacy",
    general: "general",
    other: "other"
  };
  return legacy[value] || "other";
}

function renderCoverPreview() {
  const preview = document.getElementById("coverPreview");
  if (!preview) return;
  preview.style.backgroundImage = coverPhotoUrl
    ? `url("${coverPhotoUrl}")`
    : "";
}

function resizeCoverPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const targetW = 900;
        const targetH = 375;
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");

        const srcRatio = img.width / img.height;
        const targetRatio = targetW / targetH;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (srcRatio > targetRatio) {
          sw = img.height * targetRatio;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / targetRatio;
          sy = (img.height - sh) / 2;
        }

        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
