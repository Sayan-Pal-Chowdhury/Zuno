import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithRedirect,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { checkShopSetup } from "./shop-init.js";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
const FIREBASE_AUTH_HOST = "sale-data-8d963.firebaseapp.com";
const PRIMARY_HOST = "sale-data-8d963.web.app";

let confirmationResult = null;
let recaptchaVerifier = null;
let routing = false;

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
roleLogoutBtn.onclick = logoutForVendor;

startHostedGoogleLogin();

onAuthStateChanged(auth, user => {
  if (user && !routing) {
    routeVendor();
    return;
  }
  document.body.classList.remove("auth-checking");
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
    if (mode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
    await routeVendor();
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
    await confirmationResult.confirm(otp);
    await routeVendor();
  } catch (error) {
    console.error(error);
    showMessage(cleanFirebaseError(error.message));
  } finally {
    setBusy(verifyOtpBtn, false, "Verify & Continue");
  }
}

async function signInWithGoogle() {
  if (window.location.hostname === PRIMARY_HOST) {
    window.location.href = `https://${FIREBASE_AUTH_HOST}/login.html?google=start`;
    return;
  }

  try {
    msg.textContent = "";
    await signInWithRedirect(auth, provider);
  } catch (error) {
    console.error(error);
    showMessage(cleanFirebaseError(error.message));
  }
}

function startHostedGoogleLogin() {
  if (window.location.hostname !== FIREBASE_AUTH_HOST) return;
  if (new URLSearchParams(window.location.search).get("google") !== "start") return;
  window.history.replaceState(null, "", window.location.pathname);
  signInWithGoogle();
}

async function routeVendor() {
  if (routing) return;
  const user = auth.currentUser;
  if (!user) return;
  if (await isCustomerOnly(user.uid)) {
    showCustomerGuard(user.uid);
    return;
  }
  routing = true;
  await checkShopSetup();
}

async function isCustomerOnly(uid) {
  try {
    const [profileSnap, customerSnap] = await Promise.all([
      getDoc(doc(db, "users", uid, "settings", "profile")),
      getDoc(doc(db, "customers", uid))
    ]);
    return customerSnap.exists() && !profileSnap.exists();
  } catch {
    return false;
  }
}

function showCustomerGuard(uid) {
  document.body.classList.remove("auth-checking");
  routing = false;
  localStorage.removeItem("zunoShopProfile_" + uid);
  roleGuard.classList.add("show");
  loginForm.hidden = true;
  msg.textContent = "";
}

async function logoutForVendor() {
  const uid = auth.currentUser?.uid;
  if (uid) localStorage.removeItem("zunoShopProfile_" + uid);
  localStorage.removeItem("zunoCustomer");
  await signOut(auth);
  roleGuard.classList.remove("show");
  loginForm.hidden = false;
  document.body.classList.remove("auth-checking");
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
