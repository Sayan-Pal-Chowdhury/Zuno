import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const provider = new GoogleAuthProvider();

let confirmationResult = null;
let recaptchaVerifier = null;
let routing = false;

const nameInput = document.getElementById("customerName");
const phoneInput = document.getElementById("phone");
const passwordInput = document.getElementById("password");
const phonePasswordLoginBtn = document.getElementById("phonePasswordLoginBtn");
const phonePasswordSignupBtn = document.getElementById("phonePasswordSignupBtn");
const otpInput = document.getElementById("otp");
const sendOtpBtn = document.getElementById("sendOtpBtn");
const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const googleBtn = document.getElementById("googleBtn");
const msg = document.getElementById("msg");
const roleGuard = document.getElementById("roleGuard");
const loginForm = document.getElementById("loginForm");
const roleLogoutBtn = document.getElementById("roleLogoutBtn");

phonePasswordLoginBtn.onclick = () => signInWithPhonePassword("login");
phonePasswordSignupBtn.onclick = () => signInWithPhonePassword("signup");
sendOtpBtn.onclick = sendOtp;
verifyOtpBtn.onclick = verifyOtp;
googleBtn.onclick = signInWithGoogle;
roleLogoutBtn.onclick = logoutForCustomer;

onAuthStateChanged(auth, async user => {
  if (!user || routing) return;
  if (await isVendor(user.uid)) {
    showVendorGuard(user.uid);
    return;
  }
  prefillExistingCustomer(user);
});

async function sendOtp() {
  const phone = normalizePhone(phoneInput.value);
  if (!phone) {
    showMessage("Enter a valid phone number.");
    return;
  }

  try {
    setBusy(sendOtpBtn, true, "Sending...");
    msg.textContent = "";
    confirmationResult = await signInWithPhoneNumber(auth, phone, getRecaptcha());
    otpInput.hidden = false;
    verifyOtpBtn.hidden = false;
    otpInput.focus();
    showMessage("OTP sent. Enter the code to continue.", "ok");
  } catch (error) {
    console.error(error);
    resetRecaptcha();
    showMessage(cleanFirebaseError(error.message));
  } finally {
    setBusy(sendOtpBtn, false, "Send OTP");
  }
}

async function signInWithPhonePassword(mode) {
  const phone = normalizePhone(phoneInput.value);
  const password = passwordInput.value.trim();
  if (!phone || password.length < 6) {
    showMessage("Enter phone number and a password with at least 6 characters.");
    return;
  }

  const email = phoneToEmail(phone);
  const button = mode === "login" ? phonePasswordLoginBtn : phonePasswordSignupBtn;
  try {
    setBusy(button, true, mode === "login" ? "Logging in..." : "Creating...");
    msg.textContent = "";
    const credential = mode === "login"
      ? await signInWithEmailAndPassword(auth, email, password)
      : await createUserWithEmailAndPassword(auth, email, password);
    await finishCustomerLogin(credential.user);
  } catch (error) {
    console.error(error);
    showMessage(cleanFirebaseError(error.message));
  } finally {
    setBusy(button, false, mode === "login" ? "Login" : "Create Account");
  }
}

async function verifyOtp() {
  const otp = otpInput.value.trim();
  if (!confirmationResult || otp.length < 4) {
    showMessage("Enter the OTP sent to your phone.");
    return;
  }

  try {
    setBusy(verifyOtpBtn, true, "Verifying...");
    const credential = await confirmationResult.confirm(otp);
    await finishCustomerLogin(credential.user);
  } catch (error) {
    console.error(error);
    showMessage(cleanFirebaseError(error.message));
  } finally {
    setBusy(verifyOtpBtn, false, "Verify & Continue");
  }
}

async function signInWithGoogle() {
  try {
    msg.textContent = "";
    const credential = await signInWithPopup(auth, provider);
    await finishCustomerLogin(credential.user);
  } catch (error) {
    console.error(error);
    showMessage(cleanFirebaseError(error.message));
  }
}

async function finishCustomerLogin(user) {
  if (!user || routing) return;
  if (await isVendor(user.uid)) {
    showVendorGuard(user.uid);
    return;
  }
  routing = true;

  const existingSnap = await getDoc(doc(db, "customers", user.uid));
  const existing = existingSnap.exists() ? existingSnap.data() : {};
  const name = nameInput.value.trim() || user.displayName || existing.name || "Customer";
  const phone = normalizePhone(phoneInput.value) || user.phoneNumber || existing.phone || "";

  await setDoc(doc(db, "customers", user.uid), {
    name,
    phone,
    email: user.email || existing.email || "",
    photoURL: user.photoURL || existing.photoURL || "",
    updatedAt: serverTimestamp(),
    ...(existingSnap.exists() ? {} : { createdAt: serverTimestamp() })
  }, { merge: true });

  localStorage.setItem("zunoCustomer", JSON.stringify({ uid: user.uid, name, phone }));
  window.location.href = "shops.html";
}

async function isVendor(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid, "settings", "profile"));
    return snap.exists();
  } catch {
    return false;
  }
}

function showVendorGuard(uid) {
  routing = false;
  localStorage.removeItem("zunoCustomer");
  roleGuard.classList.add("show");
  loginForm.hidden = true;
  msg.textContent = "";
  localStorage.removeItem("zunoShopProfile_" + uid);
}

async function logoutForCustomer() {
  const uid = auth.currentUser?.uid;
  if (uid) localStorage.removeItem("zunoShopProfile_" + uid);
  localStorage.removeItem("zunoCustomer");
  await signOut(auth);
  roleGuard.classList.remove("show");
  loginForm.hidden = false;
}

async function prefillExistingCustomer(user) {
  try {
    const snap = await getDoc(doc(db, "customers", user.uid));
    if (!snap.exists()) return;
    const customer = snap.data();
    if (customer.name && !nameInput.value.trim()) nameInput.value = customer.name;
    if (customer.phone && !phoneInput.value.trim()) phoneInput.value = customer.phone;
    localStorage.setItem("zunoCustomer", JSON.stringify({ uid: user.uid, ...customer }));
  } catch (error) {
    console.warn("Customer prefill failed:", error);
  }
}

function getRecaptcha() {
  if (recaptchaVerifier) return recaptchaVerifier;
  recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
    size: "invisible"
  });
  return recaptchaVerifier;
}

function resetRecaptcha() {
  try {
    recaptchaVerifier?.clear();
  } catch {
    // Firebase may already have cleared the verifier after a failed attempt.
  }
  recaptchaVerifier = null;
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (raw.startsWith("+")) return raw.replace(/[^\d+]/g, "");
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return "";
}

function phoneToEmail(phone) {
  return `${phone.replace(/\D/g, "")}@phone.zuno.local`;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function showMessage(text, type = "error") {
  msg.textContent = text;
  msg.classList.toggle("ok", type === "ok");
}

function cleanFirebaseError(error = "") {
  if (error.includes("auth/invalid-verification-code")) return "Wrong OTP. Please check and try again.";
  if (error.includes("auth/too-many-requests")) return "Too many attempts. Please wait and try again.";
  if (error.includes("auth/popup-closed-by-user")) return "Google login was cancelled.";
  if (error.includes("auth/operation-not-allowed")) return "Phone login is not enabled in Firebase yet.";
  if (error.includes("auth/billing-not-enabled")) return "OTP needs Firebase billing. Use phone + password for now.";
  if (error.includes("auth/invalid-credential")) return "Wrong phone number or password.";
  if (error.includes("auth/email-already-in-use")) return "This phone already has an account. Use Login.";
  if (error.includes("auth/weak-password")) return "Password should be at least 6 characters.";
  return "Something went wrong. Please try again.";
}
