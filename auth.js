import { auth } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { checkShopSetup } from "./shop-init.js";

const provider = new GoogleAuthProvider();

let mode = "login";

const loginTab  = document.getElementById("loginTab");
const signupTab = document.getElementById("signupTab");
const mainBtn   = document.getElementById("mainAuthBtn");
const msg       = document.getElementById("msg");
const formTitle = document.getElementById("formTitle");
const formSub   = document.getElementById("formSub");

function setMode(newMode) {
  mode = newMode;
  msg.textContent = "";

  if (mode === "login") {
    loginTab.classList.add("active");
    signupTab.classList.remove("active");
    mainBtn.textContent = "Login";
    formTitle.textContent = "Welcome back";
    formSub.textContent = "Login to continue managing your business.";
  } else {
    signupTab.classList.add("active");
    loginTab.classList.remove("active");
    mainBtn.textContent = "Create Account";
    formTitle.textContent = "Create your account";
    formSub.textContent = "Start using your AI business assistant.";
  }
}

loginTab.onclick  = () => setMode("login");
signupTab.onclick = () => setMode("signup");

mainBtn.onclick = async () => {
  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!email || !password) {
    msg.textContent = "Please enter email and password.";
    return;
  }

  try {
    if (mode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
    await checkShopSetup();
  } catch (error) {
    msg.textContent = cleanFirebaseError(error.message);
  }
};

document.getElementById("googleBtn").onclick = async () => {
  try {
    await signInWithPopup(auth, provider);
    await checkShopSetup();
  } catch (error) {
    msg.textContent = cleanFirebaseError(error.message);
  }
};

onAuthStateChanged(auth, (user) => {
  if (user) {
    checkShopSetup();
  }
});

function cleanFirebaseError(error) {
  if (error.includes("auth/invalid-credential"))   return "Wrong email or password.";
  if (error.includes("auth/email-already-in-use")) return "This email already has an account.";
  if (error.includes("auth/weak-password"))         return "Password should be at least 6 characters.";
  if (error.includes("auth/popup-closed-by-user"))  return "Google login was cancelled.";
  return "Something went wrong. Please try again.";
}
