/* shop-init.js
   Called after every successful Zuno login.
   Checks if the shop profile exists; if not, redirects to shop-setup.html.
   If yes, proceeds normally to home.html.
*/

import { db, auth } from "./firebase.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function checkShopSetup() {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid, "settings", "profile"));

    if (!profileSnap.exists() || !profileSnap.data().storeId) {
      // First time: go to setup.
      window.location.href = "shop-setup.html";
    } else {
      // Already set up: go to dashboard.
      window.location.href = "home.html";
    }
  } catch (e) {
    console.error("Shop init check failed:", e);
    window.location.href = "home.html";
  }
}
