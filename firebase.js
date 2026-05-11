import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyB8EWVdmJQcxoURS-lVrHy5eA-IjPRBSSg",
  authDomain: "sale-data-8d963.firebaseapp.com",
  projectId: "sale-data-8d963",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);

/* ---------- HELPER: get user's nested collection ---------- */
export function userCol(userId, colName) {
  return collection(db, "users", userId, colName);
}

export { app, db, auth };
