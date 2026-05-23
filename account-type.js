import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentUser = null;
const msg = document.getElementById("msg");

onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  currentUser = user;
});

document.getElementById("inventoryBtn").onclick = async () => {
  if (!currentUser) return;
  await saveMode({
    accountMode: "inventory",
    isLive: false,
    approvalStatus: "not_required"
  });
  window.location.href = "home.html";
};

document.getElementById("shopBtn").onclick = async () => {
  if (!currentUser) return;
  await saveMode({
    accountMode: "public_shop"
  });
  window.location.href = "shop-setup.html";
};

document.getElementById("foodBtn").onclick = async () => {
  if (!currentUser) return;
  await saveMode({
    accountMode: "public_shop",
    setupPreset: "food",
    businessType: "home_food",
    shopType: "food",
    customerCategory: "food",
    inventoryEnabled: false,
    foodMenuEnabled: true
  });
  window.location.href = "shop-setup.html?preset=food";
};

async function saveMode(data) {
  try {
    msg.textContent = "Saving...";
    await setDoc(doc(db, "users", currentUser.uid, "settings", "profile"), {
      ...data,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error(error);
    msg.textContent = "Could not save. Please try again.";
    throw error;
  }
}
