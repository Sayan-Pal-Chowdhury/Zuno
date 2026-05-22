/* shop-init.js
   Called after every successful Zuno login.
   Routes new users through account mode first.
   Inventory users go straight to the private app.
   Public shop users go through shop setup and admin approval.
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

    if (!profileSnap.exists()) {
      window.location.href = "account-type.html";
      return;
    }

    const profile = profileSnap.data();

    if (profile.accountMode === "inventory") {
      window.location.href = "home.html";
      return;
    }

    if (profile.storeId) {
      window.location.href = "home.html";
      return;
    }

    if (profile.accountMode === "public_shop") {
      window.location.href = "shop-setup.html";
      return;
    }

    window.location.href = "account-type.html";
  } catch (e) {
    console.error("Shop init check failed:", e);
    window.location.href = "home.html";
  }
}
