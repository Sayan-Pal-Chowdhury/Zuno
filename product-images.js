import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getProductVisual } from "./marketplace-visuals.js";

export async function findProductImage(productName = "", fallbackKind = "bag") {
  const name = String(productName || "").trim();
  if (name) {
    try {
      const snap = await getDoc(doc(db, "platformSettings", `itemImage_${imageLibraryId(name)}`));
      if (snap.exists() && snap.data().imageUrl) return snap.data().imageUrl;
    } catch (error) {
      console.warn("Default product image lookup failed:", error);
    }
  }
  return getProductVisual(name, fallbackKind);
}

export function imageLibraryId(productName = "") {
  return encodeURIComponent(String(productName).trim().toLowerCase().replace(/\s+/g, " "));
}
