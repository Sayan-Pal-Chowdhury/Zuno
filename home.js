import { db, auth } from "./firebase.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { handleCreditFromSale, reverseCreditForSale } from "./credit.js?v=40";
import { calculateSellingLineTotal, normalizeSellingUnit } from "./unit-pricing.js";

const DEFAULT_FORM_CONFIG = {
  customerName: true,
  phone: true,
  deliveryStatus: true,
  paymentMode: true,
  creditOptions: true,
  sellingPrice: true,
  quantity: true,
  weightUnit: true
};

const CHAT_SALE_MODES = {
  ask: { label: "Ask", shortLabel: "Ask", paymentMode: null, deliveryStatus: null },
  "cash-delivered": { label: "Cash + Delivered", shortLabel: "Cash/Del", paymentMode: "cash", deliveryStatus: "delivered" },
  "cash-pending": { label: "Cash + Pending", shortLabel: "Cash/Pend", paymentMode: "cash", deliveryStatus: "pending" },
  "upi-delivered": { label: "UPI + Delivered", shortLabel: "UPI/Del", paymentMode: "upi", deliveryStatus: "delivered" },
  "credit-pending": { label: "Credit + Pending", shortLabel: "Credit/Pend", paymentMode: "credit", deliveryStatus: "pending" }
};

const BUILTIN_PRODUCT_ALIASES = {
  alu: "potato",
  aloo: "potato",
  aalu: "potato",
  batata: "potato",
  pyaj: "onion",
  piyaj: "onion",
  piaz: "onion",
  peyaj: "onion",
  pyaaz: "onion",
  ada: "ginger",
  adrak: "ginger",
  aada: "ginger",
  roshun: "garlic",
  rosun: "garlic",
  rasun: "garlic",
  lehsun: "garlic",
  roshun: "garlic",
  lahsun: "garlic",
  begun: "brinjal",
  baingan: "brinjal",
  tamatar: "tomato",
  lonka: "chilli",
  mirchi: "chilli",
  dim: "egg",
  anda: "egg"
};

const BUILTIN_PAYMENT_ALIASES = {
  cash: "cash",
  cast: "cash",
  cas: "cash",
  csh: "cash",
  nogod: "cash",
  nagad: "cash",
  upi: "upi",
  phonepe: "upi",
  gpay: "upi",
  googlepay: "upi",
  online: "upi",
  credit: "credit",
  baki: "credit",
  udhar: "credit",
  due: "credit"
};

const BUILTIN_STATUS_ALIASES = {
  delivered: "delivered",
  deliver: "delivered",
  done: "delivered",
  complete: "delivered",
  completed: "delivered",
  diyechi: "delivered",
  diya: "delivered",
  given: "delivered",
  pending: "pending",
  later: "pending"
};

const NUMBER_WORDS = {
  ek: 1,
  one: 1,
  dui: 2,
  do: 2,
  two: 2,
  tin: 3,
  teen: 3,
  three: 3,
  char: 4,
  four: 4,
  panch: 5,
  five: 5,
  choy: 6,
  che: 6,
  six: 6,
  sat: 7,
  saat: 7,
  seven: 7,
  aat: 8,
  eight: 8,
  noy: 9,
  nau: 9,
  nine: 9,
  dosh: 10,
  dus: 10,
  ten: 10,
  egaro: 11,
  baro: 12,
  tero: 13,
  chauddo: 14,
  ponero: 15,
  punero: 15,
  pandrah: 15,
  solo: 16,
  satro: 17,
  atharo: 18,
  unish: 19,
  kuri: 20
};

const AI_HELPER_ENDPOINT = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "/chat-helper"
  : "https://zuno-production.up.railway.app/chat-helper";
const AI_LEGACY_EXTRACT_ENDPOINT = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "/extract-order"
  : "https://zuno-production.up.railway.app/extract-order";

let currentUserId = null;
let shopProfile = {};
let formConfig = { ...DEFAULT_FORM_CONFIG };
let allSales = [];
let creditCustomers = [];
let savedCustomers = [];
let customerOrders = [];
let allCustomerOrders = [];
let productCosts = {};
let foodMenuPrices = {};
let foodMenuChoices = [];
let foodCostRecords = {};
let inventoryMap = {};
let learnedAliases = {};
let learnedPaymentAliases = {};
let learnedStatusAliases = {};
let pendingFollowup = null;
let toastTimer = null;
let chatHistory = [];
let visibleHistoryCount = 30;
let speechRecognition = null;
let voiceTranscript = "";
let voiceHadError = false;
let chatSaleMode = "ask";
let collapseTimer = null;
let baseViewportHeight = window.visualViewport?.height || window.innerHeight;

const chatThread = document.getElementById("chatThread");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const overviewDate = document.getElementById("overviewDate");
const loadOlderBtn = document.getElementById("loadOlderBtn");
const resetChatBtn = document.getElementById("resetChatBtn");
const voiceChatBtn = document.getElementById("voiceChatBtn");
const composerMenuBtn = document.getElementById("composerMenuBtn");
const composerMenu = document.getElementById("composerMenu");
const fastModeBtn = document.getElementById("fastModeBtn");
const fastModeMenu = document.getElementById("fastModeMenu");
const fastModeLabel = document.getElementById("fastModeLabel");
const pendingSummaryBtn = document.getElementById("pendingSummaryBtn");
const heroToggleBtn = document.getElementById("heroToggleBtn");
const chatHome = document.querySelector(".chat-home");
const heroDayPart = document.getElementById("heroDayPart");
const heroGreeting = document.getElementById("heroGreeting");
const heroName = document.getElementById("heroName");
const heroSubline = document.getElementById("heroSubline");
const pendingModal = document.getElementById("pendingModal");
const pendingBackdrop = document.getElementById("pendingBackdrop");
const pendingCloseBtn = document.getElementById("pendingCloseBtn");
const pendingOrderList = document.getElementById("pendingOrderList");
const pendingModalCount = document.getElementById("pendingModalCount");
const pendingOpenOrdersBtn = document.getElementById("pendingOpenOrdersBtn");

overviewDate.value = today();
chatForm.addEventListener("submit", onChatSubmit);
overviewDate.addEventListener("change", renderOverview);
document.getElementById("previousDateBtn").addEventListener("click", () => changeSummaryDate(-1));
document.getElementById("nextDateBtn").addEventListener("click", () => changeSummaryDate(1));
loadOlderBtn?.addEventListener("click", loadOlderChats);
resetChatBtn?.addEventListener("click", resetChatFlow);
voiceChatBtn?.addEventListener("click", event => {
  event.preventDefault();
  if (speechRecognition) {
    stopVoiceInput();
    return;
  }
  startVoiceInput();
});
composerMenuBtn?.addEventListener("click", event => {
  event.preventDefault();
  toggleComposerMenu();
});
fastModeBtn?.addEventListener("click", event => {
  event.preventDefault();
  toggleFastModeMenu();
});
fastModeMenu?.querySelectorAll("[data-fast-mode]").forEach(button => {
  button.addEventListener("click", () => setChatSaleMode(button.dataset.fastMode));
});
document.addEventListener("click", event => {
  if (!event.target.closest(".composer-shell")) closeComposerPopovers();
});
pendingSummaryBtn?.addEventListener("click", openPendingOrders);
heroToggleBtn?.addEventListener("click", expandHero);
pendingBackdrop?.addEventListener("click", closePendingModal);
pendingCloseBtn?.addEventListener("click", closePendingModal);
pendingOpenOrdersBtn?.addEventListener("click", () => {
  window.location.href = "index.html#liveOrdersSection";
});
chatInput.addEventListener("focus", handleChatFocus);
chatInput.addEventListener("click", handleChatFocus);
chatInput.addEventListener("input", () => {
  if (chatInput.value.trim()) collapseHero();
});
chatForm.addEventListener("pointerdown", event => {
  if (event.target === chatInput) {
    scheduleCollapseHero();
    return;
  }
  if (event.target !== resetChatBtn && event.target !== voiceChatBtn) collapseHero();
});
chatThread.addEventListener("scroll", () => {
  collapseHero();
  if (chatThread.scrollTop < 20 && chatHistory.length > visibleHistoryCount) {
    loadOlderChats(false);
  }
});
document.querySelectorAll("[data-prompt]").forEach(button => {
  button.addEventListener("click", () => {
    collapseHero();
    chatInput.value = button.dataset.prompt;
    chatInput.focus();
  });
});

window.visualViewport?.addEventListener("resize", syncKeyboardOffset);
window.visualViewport?.addEventListener("scroll", syncKeyboardOffset);
window.addEventListener("resize", syncKeyboardOffset);
chatInput.addEventListener("blur", () => setTimeout(syncKeyboardOffset, 180));
syncKeyboardOffset();

function userCol(name) {
  return collection(db, "users", currentUserId, name);
}

function userDoc(name, id) {
  return doc(db, "users", currentUserId, name, id);
}

function today() {
  const now = new Date();
  const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
  return local.toISOString().split("T")[0];
}

function addDays(value, days) {
  const date = new Date(`${value || today()}T00:00:00`);
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().split("T")[0];
}

function changeSummaryDate(days) {
  overviewDate.value = addDays(overviewDate.value, days);
  renderOverview();
}

function money(value) {
  return `Rs ${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function getDayPart() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function normalize(value = "") {
  let normalized = String(value).toLowerCase();
  Object.entries(NUMBER_WORDS).forEach(([word, number]) => {
    normalized = normalized.replace(new RegExp(`\\b${regexEscape(word)}\\b`, "g"), String(number));
  });
  return normalized
    .replace(/₹/g, " rs ")
    .replace(/(\d+(?:\.\d+)?)\s*(kilograms?|kilos?)\b/g, "$1kg")
    .replace(/(\d+(?:\.\d+)?)\s*(grams?|gm)\b/g, "$1g")
    .replace(/(\d+(?:\.\d+)?)\s*(pieces?|pcs?|plates?|packets?|pkts?)\b/g, "$1piece")
    .replace(/\b(kilos?|kilograms?)\b/g, "kg")
    .replace(/\b(grams?|gm)\b/g, "g")
    .replace(/\b(pieces?|pcs?|plates?|packets?|pkts?)\b/g, "piece")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function titleCase(value = "") {
  return String(value).replace(/\b\w/g, char => char.toUpperCase());
}

function regexEscape(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function showToast(message) {
  const toast = document.getElementById("homeToast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

function chatModeKey() {
  return currentUserId ? `zunoChatSaleMode_${currentUserId}` : "zunoChatSaleMode";
}

function loadChatSaleMode() {
  const saved = localStorage.getItem(chatModeKey()) || localStorage.getItem("zunoChatSaleMode") || "ask";
  setChatSaleMode(saved, { silent: true });
}

function setChatSaleMode(mode, options = {}) {
  chatSaleMode = CHAT_SALE_MODES[mode] ? mode : "ask";
  if (fastModeLabel) fastModeLabel.textContent = CHAT_SALE_MODES[chatSaleMode].shortLabel;
  fastModeMenu?.querySelectorAll("[data-fast-mode]").forEach(button => {
    button.classList.toggle("selected", button.dataset.fastMode === chatSaleMode);
  });
  localStorage.setItem(chatModeKey(), chatSaleMode);
  closeComposerPopovers();
  if (!options.silent) showToast(`Sale mode: ${CHAT_SALE_MODES[chatSaleMode].label}`);
}

function currentSaleDefaults() {
  return CHAT_SALE_MODES[chatSaleMode] || CHAT_SALE_MODES.ask;
}

function toggleComposerMenu() {
  if (!composerMenu) return;
  const willOpen = composerMenu.hidden;
  closeComposerPopovers();
  composerMenu.hidden = !willOpen;
}

function toggleFastModeMenu() {
  if (!fastModeMenu) return;
  const willOpen = fastModeMenu.hidden;
  closeComposerPopovers();
  fastModeMenu.hidden = !willOpen;
}

function closeComposerPopovers() {
  if (composerMenu) composerMenu.hidden = true;
  if (fastModeMenu) fastModeMenu.hidden = true;
}

function setVoiceButtonListening(isListening) {
  if (!voiceChatBtn) return;
  voiceChatBtn.classList.toggle("listening", isListening);
  voiceChatBtn.title = isListening ? "Listening. Tap to stop" : "Tap to speak";
  voiceChatBtn.setAttribute("aria-label", isListening ? "Listening. Tap to stop." : "Tap to speak");
  voiceChatBtn.innerHTML = isListening
    ? `<span class="menu-icon recording-dot" aria-hidden="true"></span> Listening`
    : `<span class="menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3"/><path d="M8 21h8"/></svg></span> Voice`;
}

function historyKey() {
  return currentUserId ? `zunoChatHistory_${currentUserId}` : "";
}

function saveChatHistory() {
  const key = historyKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(chatHistory.slice(-100)));
}

function rememberChat(role, html, extraClass = "") {
  if (!currentUserId) return;
  chatHistory.push({ role, html, extraClass, ts: Date.now() });
  saveChatHistory();
}

function loadChatHistory() {
  const key = historyKey();
  if (!key) return;
  try {
    chatHistory = JSON.parse(localStorage.getItem(key) || "[]").filter(entry => entry?.role && entry?.html);
  } catch {
    chatHistory = [];
  }
  visibleHistoryCount = 0;
  chatThread.querySelectorAll(".bubble[data-history]").forEach(node => node.remove());
  if (loadOlderBtn) loadOlderBtn.hidden = chatHistory.length === 0;
}

function renderStoredChats() {
  chatThread.querySelectorAll(".bubble[data-history]").forEach(node => node.remove());
  const welcome = chatThread.querySelector(".bubble.assistant:not([data-history])");
  const recent = chatHistory.slice(-visibleHistoryCount);
  recent.forEach(entry => {
    const bubble = document.createElement("article");
    bubble.className = `bubble ${entry.role} ${entry.extraClass || ""}`.trim();
    bubble.dataset.history = "1";
    bubble.innerHTML = entry.html;
    chatThread.appendChild(bubble);
  });
  if (loadOlderBtn) loadOlderBtn.hidden = chatHistory.length <= visibleHistoryCount;
  scrollChat();
}

function loadOlderChats(shouldScroll = true) {
  const previousHeight = chatThread.scrollHeight;
  visibleHistoryCount = Math.min(chatHistory.length, Math.max(visibleHistoryCount, 0) + 30);
  renderStoredChats();
  if (!shouldScroll) {
    chatThread.scrollTop = chatThread.scrollHeight - previousHeight + 20;
  }
}

function scrollChat() {
  chatThread.scrollTop = chatThread.scrollHeight;
}

function appendBubble(role, html, extraClass = "", options = {}) {
  const bubble = document.createElement("article");
  bubble.className = `bubble ${role} ${extraClass}`.trim();
  bubble.innerHTML = html;
  chatThread.appendChild(bubble);
  const shouldPersist = options.persist !== false && !html.includes("<button") && !html.includes("preview-card");
  if (shouldPersist) rememberChat(role, html, extraClass);
  scrollChat();
  return bubble;
}

function appendUser(text) {
  collapseHero();
  appendBubble("user", `<p>${escapeHtml(text)}</p>`);
}

function appendAssistant(text, extraClass = "") {
  return appendBubble("assistant", `<p>${escapeHtml(text)}</p>`, extraClass);
}

function appendThinkingBubble(message = "Reading sale") {
  return appendBubble("assistant", `
    <div class="thinking-card">
      <span>${escapeHtml(message)}</span>
      <i></i><i></i><i></i>
    </div>
  `, "thinking", { persist: false });
}

function resetChatFlow() {
  pendingFollowup = null;
  closeComposerPopovers();
  chatInput.value = "";
  expandHero();
  appendAssistant("Started a fresh chat. Your older messages are still saved above.");
  chatInput.focus();
}

function handleChatFocus() {
  scheduleCollapseHero();
  syncKeyboardOffset();
  [80, 220, 420].forEach(delay => setTimeout(syncKeyboardOffset, delay));
  setTimeout(() => {
    scrollChat();
    chatInput.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, 260);
}

function scheduleCollapseHero() {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(collapseHero, 160);
}

function collapseHero() {
  chatHome?.classList.add("hero-collapsed");
  document.body.classList.add("home-chat-mode");
  if (heroToggleBtn) heroToggleBtn.textContent = "⌄";
}

function expandHero() {
  chatHome?.classList.remove("hero-collapsed");
  document.body.classList.remove("home-chat-mode");
  document.body.classList.remove("keyboard-open");
  document.documentElement.style.setProperty("--zuno-composer-nudge", "0px");
  document.documentElement.style.setProperty("--zuno-nav-keyboard-offset", "0px");
  if (heroToggleBtn) heroToggleBtn.textContent = "⌃";
}

function syncKeyboardOffset() {
  const viewport = window.visualViewport;
  const activeEditable = document.activeElement === chatInput || document.activeElement?.matches?.("input, textarea, select");
  const likelyTouchPhone = window.matchMedia("(max-width: 700px)").matches && navigator.maxTouchPoints > 0;
  if (!viewport || !activeEditable || !likelyTouchPhone) {
    baseViewportHeight = Math.max(baseViewportHeight, viewport?.height || window.innerHeight, window.innerHeight);
    document.body.classList.remove("keyboard-open");
    document.documentElement.style.setProperty("--zuno-composer-nudge", "0px");
    document.documentElement.style.setProperty("--zuno-nav-keyboard-offset", "0px");
    return;
  }
  const keyboardOffset = Math.max(0, baseViewportHeight - viewport.height - viewport.offsetTop);
  const keyboardOpen = keyboardOffset > 80 || document.activeElement === chatInput;
  document.body.classList.toggle("keyboard-open", keyboardOpen);
  if (keyboardOpen) {
    requestAnimationFrame(keepComposerVisible);
  }
  document.documentElement.style.setProperty("--zuno-nav-keyboard-offset", "0px");
}

function keepComposerVisible() {
  const composerShell = document.querySelector(".composer-shell");
  const viewport = window.visualViewport;
  if (!composerShell || !document.body.classList.contains("keyboard-open")) {
    document.documentElement.style.setProperty("--zuno-composer-nudge", "0px");
    return;
  }
  document.documentElement.style.setProperty("--zuno-composer-nudge", "0px");
  requestAnimationFrame(() => {
    const visibleBottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
    const overflow = composerShell.getBoundingClientRect().bottom - visibleBottom;
    document.documentElement.style.setProperty("--zuno-composer-nudge", overflow > 0 ? `${Math.ceil(overflow + 10)}px` : "0px");
  });
}

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    appendAssistant("Voice typing is not supported in this browser. You can still type the same message here.");
    return;
  }
  if (speechRecognition) {
    return;
  }
  collapseHero();
  voiceTranscript = "";
  voiceHadError = false;
  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = "en-IN";
  speechRecognition.interimResults = true;
  speechRecognition.maxAlternatives = 1;
  setVoiceButtonListening(true);
  speechRecognition.onresult = event => {
    const transcript = Array.from(event.results || [])
      .map(result => result?.[0]?.transcript || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (transcript) {
      voiceTranscript = transcript;
      chatInput.value = transcript;
    }
  };
  speechRecognition.onerror = () => {
    voiceHadError = true;
    appendAssistant("I could not hear that clearly. Please try again or type it.");
  };
  speechRecognition.onend = () => {
    const transcript = voiceTranscript.trim();
    speechRecognition = null;
    setVoiceButtonListening(false);
    if (transcript && !voiceHadError) {
      chatInput.value = transcript;
      setTimeout(() => chatForm.requestSubmit(), 0);
    }
  };
  try {
    speechRecognition.start();
  } catch (error) {
    speechRecognition = null;
    setVoiceButtonListening(false);
    appendAssistant("Voice could not start. Please try again or type it.");
  }
}

function stopVoiceInput() {
  if (!speechRecognition) return;
  try {
    speechRecognition.stop();
  } catch (error) {
    speechRecognition = null;
    setVoiceButtonListening(false);
  }
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUserId = user.uid;
  loadChatSaleMode();
  const [profileSnap, formSnap, learningSnap] = await Promise.all([
    getDoc(userDoc("settings", "profile")).catch(() => null),
    getDoc(userDoc("settings", "formConfig")).catch(() => null),
    getDoc(userDoc("settings", "chatLearning")).catch(() => null)
  ]);
  shopProfile = profileSnap?.exists() ? profileSnap.data() : {};
  formConfig = { ...DEFAULT_FORM_CONFIG, ...(formSnap?.exists() ? formSnap.data() : {}) };
  const learning = learningSnap?.exists() ? learningSnap.data() : {};
  learnedAliases = learning.productAliases || {};
  learnedPaymentAliases = learning.paymentAliases || {};
  learnedStatusAliases = learning.statusAliases || {};
  renderHeroProfile();
  loadChatHistory();
  listenForProducts();
  listenForInventory();
  listenForSales();
  listenForCredits();
  listenForCustomers();
  listenForOrders();
  if (shopProfile.foodMenuEnabled === true) listenForFoodMenu();
});

function listenForProducts() {
  onSnapshot(userCol("products"), snap => {
    productCosts = {};
    snap.forEach(productDoc => {
      const product = productDoc.data();
      if (!product.name) return;
      productCosts[normalize(product.name)] = {
        name: product.name,
        cost: Number(product.cost || 0),
        hasCost: product.costConfigured !== false,
        sellingPrice: Number(product.sellingPrice || 0),
        unit: product.unit || "kg",
        sellingUnit: normalizeSellingUnit(product.sellingUnit || "", product.unit || "kg")
      };
    });
  });
}

function listenForInventory() {
  onSnapshot(userCol("inventory"), snap => {
    inventoryMap = {};
    snap.forEach(inventoryDoc => {
      const item = inventoryDoc.data();
      const key = normalize(item.product);
      if (!key) return;
      inventoryMap[key] = {
        id: inventoryDoc.id,
        ...item,
        qty: Number(item.qty || 0),
        totalQtyBought: Number(item.totalQtyBought || 0),
        totalInvested: Number(item.totalInvested || 0)
      };
    });
  });
}

function listenForSales() {
  onSnapshot(userCol("sales"), snap => {
    allSales = snap.docs.map(saleDoc => ({ id: saleDoc.id, ...saleDoc.data() }));
    renderOverview();
  });
}

function listenForCredits() {
  onSnapshot(userCol("credit"), snap => {
    creditCustomers = snap.docs.map(creditDoc => creditDoc.data());
  });
}

function listenForCustomers() {
  onSnapshot(userCol("customers"), snap => {
    savedCustomers = snap.docs.map(customerDoc => customerDoc.data());
  });
}

function listenForOrders() {
  onSnapshot(userCol("customerOrders"), snap => {
    allCustomerOrders = snap.docs
      .map(orderDoc => ({ id: orderDoc.id, ...orderDoc.data() }))
      .filter(order => !["rejected", "cancelled"].includes(order.status));
    customerOrders = activeCustomerOrders();
    renderOverview();
    if (pendingModal && !pendingModal.hidden) renderPendingModal();
  });
}

function activeCustomerOrders() {
  return allCustomerOrders.filter(order => !["delivered", "rejected", "cancelled"].includes(order.status));
}

function listenForFoodMenu() {
  onSnapshot(userCol("foodItems"), snap => {
    foodMenuChoices = [];
    snap.forEach(itemDoc => {
      const item = itemDoc.data();
      const name = String(item.name || "").trim();
      if (!name || item.active === false) return;
      const pricedVariants = Array.isArray(item.variants)
        ? item.variants.filter(variant => Number(variant.price || 0) > 0)
        : [];
      const variants = pricedVariants.length ? pricedVariants : [{ id: "full", label: "", price: Number(item.price || 0) }];
      variants.forEach((variant, index) => {
        const label = variant.label || `Portion ${index + 1}`;
        foodMenuChoices.push({
          key: `${itemDoc.id}::${variant.id || `portion-${index + 1}`}`,
          name: variants.length > 1 ? `${name} - ${label}` : name,
          sellingPrice: Number(variant.price || 0)
        });
      });
    });
    rebuildFoodPricing();
  });
  onSnapshot(userCol("foodCosts"), snap => {
    foodCostRecords = {};
    snap.forEach(costDoc => {
      const value = costDoc.data();
      if (value.key) foodCostRecords[value.key] = value;
    });
    rebuildFoodPricing();
  });
}

function rebuildFoodPricing() {
  foodMenuPrices = {};
  foodMenuChoices.forEach(choice => {
    const record = foodCostRecords[choice.key];
    foodMenuPrices[normalize(choice.name)] = {
      name: choice.name,
      source: "food-menu",
      foodCostKey: choice.key,
      cost: Number(record?.cost || 0),
      hasCost: record?.cost !== undefined && record?.cost !== "",
      sellingPrice: choice.sellingPrice,
      unit: "piece",
      sellingUnit: "piece"
    };
  });
}

function saleCatalog() {
  return shopProfile.foodMenuEnabled === true ? foodMenuPrices : productCosts;
}

function renderOverview() {
  const date = overviewDate.value || today();
  const selected = allSales.filter(sale => sale.date === date);
  document.getElementById("selectedSales").textContent =
    money(selected.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0));
  document.getElementById("selectedProfit").textContent =
    money(selected.reduce((sum, sale) => sum + Number(sale.totalProfit || 0), 0));
  document.getElementById("selectedPending").textContent = activeCustomerOrders().length;
  renderHeroProfile();
}

function renderHeroProfile() {
  const part = getDayPart();
  const rawOwner = shopProfile.ownerName || shopProfile.name || shopProfile.shopName || shopProfile.displayName || auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "there";
  const owner = /^\+?\d{8,}$/.test(String(rawOwner).trim()) ? (shopProfile.shopName || "there") : rawOwner;
  const selectedSalesText = document.getElementById("selectedSales")?.textContent || "Rs 0";
  if (heroDayPart) heroDayPart.textContent = part;
  if (heroGreeting) heroGreeting.textContent = `Good ${part}`;
  if (heroName) heroName.textContent = owner.split(" ")[0] || "there";
  if (heroSubline) {
    heroSubline.textContent = selectedSalesText === "Rs 0"
      ? "Ready when your first sale comes in 🌿"
      : "Your shop is moving well today 🌿";
  }
}

function openPendingOrders() {
  renderPendingModal();
  pendingModal.hidden = false;
}

function closePendingModal() {
  pendingModal.hidden = true;
}

function renderPendingModal() {
  const active = activeCustomerOrders();
  const recentDelivered = allCustomerOrders
    .filter(order => order.status === "delivered")
    .slice(0, 3);
  const count = active.length;
  pendingModalCount.textContent = count === 1 ? "1 waiting" : `${count} waiting`;
  const activeHtml = count
    ? active.slice(0, 12).map(order => {
      const items = Array.isArray(order.items) ? order.items : [];
      const itemsText = items.map(item => `${item.product || "Item"}${item.qty ? ` x ${item.qty}` : ""}`).join(", ");
      return `
        <article class="pending-card">
          <strong>${escapeHtml(order.customerName || "Customer")}</strong>
          <span>${escapeHtml(order.customerPhone || "No phone")} - ${escapeHtml(orderStatusLabel(order.status))}</span>
          <span>${escapeHtml(itemsText || "No items listed")}</span>
          <em>${money(order.totalAmount || 0)}</em>
          <div class="pending-actions">
            ${order.status === "new" ? `<button data-order-action="packing" data-order-id="${order.id}">Start packing</button>` : ""}
            ${order.status !== "packed" ? `<button data-order-action="packed" data-order-id="${order.id}">Mark packed</button>` : ""}
            <button class="primary" data-order-action="delivered" data-order-id="${order.id}">${order.fulfillmentType === "pickup" ? "Received" : "Delivered"}</button>
            <button class="danger" data-order-action="rejected" data-order-id="${order.id}">Reject</button>
          </div>
        </article>
      `;
    }).join("")
    : `<div class="pending-empty">No pending orders right now.</div>`;
  const deliveredHtml = recentDelivered.length
    ? `
      <div class="pending-section-title">Recently delivered</div>
      ${recentDelivered.map(order => `
        <article class="pending-card muted">
          <strong>${escapeHtml(order.customerName || "Customer")}</strong>
          <span>Delivered ${order.orderNumber ? `- ${escapeHtml(order.orderNumber)}` : ""}</span>
          <em>${money(order.totalAmount || 0)}</em>
          <div class="pending-actions">
            <button data-order-action="reopen" data-order-id="${order.id}">Undo delivered</button>
          </div>
        </article>
      `).join("")}
    `
    : "";
  pendingOrderList.innerHTML = activeHtml + deliveredHtml;
  pendingOrderList.querySelectorAll("[data-order-action]").forEach(button => {
    button.addEventListener("click", () => handlePendingOrderAction(button.dataset.orderId, button.dataset.orderAction, button));
  });
}

function orderStatusLabel(status = "new") {
  const labels = {
    new: "New order",
    accepted: "Accepted",
    packing: "Packing",
    ready: "Packed",
    packed: "Packed",
    delivered: "Delivered",
    rejected: "Rejected",
    cancelled: "Cancelled"
  };
  return labels[status] || titleCase(status);
}

async function handlePendingOrderAction(orderId, action, button) {
  if (!orderId || !currentUserId) return;
  button.disabled = true;
  try {
    if (["packing", "packed", "rejected"].includes(action)) {
      await updateCustomerOrderStatus(orderId, action);
      showToast(`Order marked ${orderStatusLabel(action)}.`);
    } else if (action === "delivered") {
      await completeCustomerOrder(orderId);
    } else if (action === "reopen") {
      await reopenCustomerOrder(orderId);
      showToast("Order reopened and sale reversed.");
    }
    renderPendingModal();
  } catch (error) {
    console.error("Pending order action failed:", error);
    showToast("Could not update this order.");
    button.disabled = false;
  }
}

async function updateCustomerOrderStatus(orderId, status) {
  await updateDoc(userDoc("customerOrders", orderId), {
    status,
    updatedAt: serverTimestamp()
  });
}

async function completeCustomerOrder(orderId) {
  const orderRef = userDoc("customerOrders", orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) return;

  const order = orderSnap.data();
  if (order.saleId) {
    const linkedSale = await getDoc(userDoc("sales", order.saleId));
    if (linkedSale.exists() && linkedSale.data().deliveryStatus !== "delivered") {
      await updateLinkedSaleStatus(order.saleId, "delivered");
      showToast("Order delivered.");
      return;
    }
    if (linkedSale.exists()) {
      await updateDoc(orderRef, { status: "delivered", updatedAt: serverTimestamp() });
      showToast("Order delivered.");
      return;
    }
  }

  const items = normalizeCustomerOrderItems(order.items || []);
  const orderNumber = await getNextOrderNumber();
  const date = today();
  const itemSubtotal = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const serviceFees = Number(order.handlingFee || 0) + Number(order.deliveryFee || 0);
  const paymentMode = order.paymentMode === "online" && order.paymentStatus === "online_verified" ? "upi" : "cash";
  const totalAmount = Number(order.totalAmount || 0) || itemSubtotal + serviceFees;
  const totalProfit = items.reduce((sum, item) => sum + (item.profit === null ? 0 : Number(item.profit || 0)), 0) + serviceFees;

  const saleRef = await addDoc(userCol("sales"), {
    orderNumber,
    date,
    customer: order.customerName || "Online customer",
    phone: order.customerPhone || "",
    items,
    totalProfit,
    totalAmount,
    subtotal: Number(order.subtotal || itemSubtotal),
    handlingFee: Number(order.handlingFee || 0),
    deliveryFee: Number(order.deliveryFee || 0),
    paymentMode,
    paymentStatus: order.paymentStatus || "cod",
    deliveryStatus: "delivered",
    source: "customer-shop",
    customerOrderId: orderId
  });

  await deductInventory(items);
  await updateDoc(orderRef, {
    status: "delivered",
    paymentStatus: paymentMode === "cash" ? "cod_collected" : order.paymentStatus,
    saleId: saleRef.id,
    orderNumber,
    updatedAt: serverTimestamp()
  });
  showToast(`Order delivered as ${orderNumber}.`);
}

async function reopenCustomerOrder(orderId) {
  const orderRef = userDoc("customerOrders", orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) return;
  const order = orderSnap.data();
  if (order.saleId) {
    await updateLinkedSaleStatus(order.saleId, "pending");
    return;
  }
  await updateDoc(orderRef, {
    status: "packed",
    paymentStatus: order.paymentStatus === "cod_collected" ? "cod" : order.paymentStatus,
    updatedAt: serverTimestamp()
  });
}

function normalizeCustomerOrderItems(orderItems) {
  return orderItems.map(item => {
    const qty = Number(item.qty || 0);
    const unit = normalizeUnit(item.unit || "piece");
    const product = item.product || "item";
    const price = Number(item.price || 0);
    const sellingPrice = Number(item.sellingPrice || (qty ? price / qty : 0));
    return enrichSaleItem({
      product,
      qty,
      unit,
      price,
      sellingPrice,
      sellingUnit: normalizeSellingUnit(item.sellingUnit || "", unit),
      source: item.source || "",
      foodCostKey: item.foodCostKey || "",
      variantLabel: item.variantLabel || ""
    });
  });
}

async function updateLinkedSaleStatus(saleId, newStatus) {
  const saleRef = userDoc("sales", saleId);
  const saleSnap = await getDoc(saleRef);
  if (!saleSnap.exists()) return;

  const saleData = saleSnap.data();
  const wasDelivered = saleData.deliveryStatus === "delivered";
  const isNowDelivered = newStatus === "delivered";

  await updateDoc(saleRef, { deliveryStatus: newStatus });

  if (!wasDelivered && isNowDelivered) {
    await deductInventory(saleData.items || []);
    if (saleData.customerOrderId) await markCustomerOrderDelivered(saleData.customerOrderId, saleData);
    if (saleData.paymentMode === "credit" && saleData.creditApplied !== true && Number(saleData.totalAmount || 0) > 0) {
      const initialPaymentAmount = Number(saleData.amountPaid || 0);
      await handleCreditFromSale({
        userId: currentUserId,
        customer: saleData.customer,
        phone: saleData.phone,
        creditAmount: Math.max(0, Number(saleData.totalAmount || 0) - initialPaymentAmount),
        originalCreditAmount: Number(saleData.totalAmount || 0),
        initialPaymentAmount,
        orderNumber: saleData.orderNumber,
        date: saleData.date
      });
      await updateDoc(saleRef, { creditApplied: true, initialCreditPayment: initialPaymentAmount });
    }
  } else if (wasDelivered && !isNowDelivered) {
    await revertInventory(saleData.items || []);
    if (saleData.customerOrderId) await markCustomerOrderReopened(saleData.customerOrderId, saleData);
    if (saleData.paymentMode === "credit") {
      await reverseCreditForSale({
        userId: currentUserId,
        sale: saleData
      });
      await updateDoc(saleRef, { creditApplied: false });
    }
  }
}

async function markCustomerOrderDelivered(orderId, saleData) {
  const update = {
    status: "delivered",
    updatedAt: serverTimestamp()
  };
  if (saleData.paymentMode === "cash") update.paymentStatus = "cod_collected";
  await updateDoc(userDoc("customerOrders", orderId), update);
}

async function markCustomerOrderReopened(orderId, saleData) {
  const update = {
    status: "packed",
    updatedAt: serverTimestamp()
  };
  if (saleData.paymentMode === "cash") update.paymentStatus = "cod";
  await updateDoc(userDoc("customerOrders", orderId), update);
}

async function onChatSubmit(event) {
  event.preventDefault();
  closeComposerPopovers();
  const text = chatInput.value.trim();
  if (!text || !currentUserId) return;
  chatInput.value = "";
  appendUser(text);
  await processMessage(text);
}

async function processMessage(text) {
  const clean = normalize(text);
  if (pendingFollowup?.type === "sale-missing-price" && !/^(add\s+sale|sale|add\s+inventory|inventory|stock|query|teach|learn)\b/.test(clean)) {
    handleMissingSalePrice(text, pendingFollowup);
    return;
  }
  if (pendingFollowup?.type === "product-pricing" && !/^(add\s+sale|sale|add\s+inventory|inventory|stock|query|teach|learn)\b/.test(clean)) {
    handleNewProductPricing(text, pendingFollowup);
    return;
  }
  if (pendingFollowup?.type === "inventory-purchase" && !/^(add\s+sale|sale|add\s+inventory|inventory|stock|query|teach|learn)\b/.test(clean)) {
    const amountMatch = clean.match(/(?:cost|rs)?\s*(\d+(?:\.\d+)?)/);
    if (!amountMatch || Number(amountMatch[1]) <= 0) {
      appendAssistant("Please send the total purchase cost, for example: cost 400.");
      return;
    }
    pendingFollowup.draft.purchaseCost = Number(amountMatch[1]);
    pendingFollowup = { type: "inventory-vendor-payment", draft: pendingFollowup.draft };
    appendAssistant(`How much was paid to ${pendingFollowup.draft.vendorName} now? Reply with paid 0 if it is unpaid.`);
    return;
  }
  if (pendingFollowup?.type === "inventory-vendor-payment" && !/^(add\s+sale|sale|add\s+inventory|inventory|stock|query|teach|learn)\b/.test(clean)) {
    const paymentMatch = clean.match(/(?:paid|pay)?\s*(?:rs\s*)?(\d+(?:\.\d+)?)/);
    if (!paymentMatch) {
      appendAssistant("Please send the amount paid, for example: paid 200 or paid 0.");
      return;
    }
    const draft = pendingFollowup.draft;
    draft.vendorAmountPaid = Number(paymentMatch[1]);
    if (draft.vendorAmountPaid > draft.purchaseCost) {
      appendAssistant(`Paid amount cannot be more than the purchase cost of ${money(draft.purchaseCost)}.`);
      return;
    }
    pendingFollowup = null;
    renderInventoryPreview(draft);
    return;
  }
  if (/^(teach|learn)\b/.test(clean)) {
    await teachAlias(text);
    return;
  }
  if (/^(show\s+)?pending\s+orders?$/.test(clean)) {
    showPendingOrders();
    return;
  }
  if (pendingFollowup && !/^(add\s+sale|sale|add\s+inventory|inventory|stock|query)\b/.test(clean)) {
    let original = `${pendingFollowup.original} ${text}`;
    if (pendingFollowup.needsCustomer) {
      original = pendingFollowup.original.replace(/\b(add\s+sale|sale)\b/i, `$& ${text}`);
    } else if (pendingFollowup.quantityAlias && /\d+(?:\.\d+)?\s*(kg|g|piece)/.test(clean)) {
      original = pendingFollowup.original.replace(
        new RegExp(`\\b${regexEscape(pendingFollowup.quantityAlias)}\\b`, "i"),
        `${text} ${pendingFollowup.quantityAlias}`
      );
    }
    pendingFollowup = null;
    await processActionCommand(original);
    return;
  }
  await processActionCommand(text);
}

async function processActionCommand(text) {
  const clean = normalize(text);
  if (/^(hi|hello|hey|hii|namaste)(\s|$)/.test(clean)) {
    appendAssistant("Hello! You can ask for today's sales, profit, stock, pending orders, or type a sale directly.");
    return;
  }
  if (/^(what\s+is\s+|show\s+|how\s+much\s+)?(today'?s?\s+)?(sales|sale|profit)(\s+today)?\??$/.test(clean)) {
    answerTodaySummary(clean);
    return;
  }
  if (/^(show\s+)?(stock|inventory)\s+(of\s+)?/.test(clean) || /\s+(stock|inventory)\??$/.test(clean)) {
    answerStockQuestion(clean);
    return;
  }
  if (/^(query|support|message)\s*[:\-]?/.test(clean)) {
    const message = text.replace(/^\s*(query|support|message)\s*[:\-]?\s*/i, "").trim();
    if (!message) {
      appendAssistant("What query should I send to the Zuno team?");
      pendingFollowup = { original: "Query:" };
      return;
    }
    renderQueryPreview(message);
    return;
  }
  if (/\b(add\s+inventory|inventory|stock|restock|purchase|purchased|bought|received)\b/.test(clean)) {
    handleInventoryCommand(text);
    return;
  }
  if (/\b(sale|sold)\b/.test(clean)) {
    await handleSaleCommand(text);
    return;
  }
  const intent = inferIntent(clean);
  if (intent === "sale") {
    await handleSaleCommand(`Add sale ${text}`);
    return;
  }
  if (intent === "inventory") {
    handleInventoryCommand(`Add inventory ${text}`);
    return;
  }
  if (intent === "sale-or-inventory") {
    renderIntentQuestion(text);
    return;
  }
  if (await tryAiSaleHelper(text)) return;
  renderPossibleQuery(text);
}

function inferIntent(text) {
  const hasKnownItem = findMentions(text, saleCatalog()).length > 0;
  const hasQuantity = /\b\d+(?:\.\d+)?\s*(kg|g|piece)\b/.test(text) || /\b(ekta|akta|one)\s+[a-z]/.test(text);
  const saleSignal = /\b(cash|upi|credit|baki|udhar|delivered|deliver|pending|sold)\b/.test(text);
  const inventorySignal = /\b(stock|inventory|restock|purchase|purchased|bought|received|supplier|vendor)\b/.test(text);
  if (inventorySignal) return "inventory";
  if (hasKnownItem && (hasQuantity || saleSignal || shopProfile.foodMenuEnabled === true)) return "sale";
  if (hasQuantity && saleSignal) return "sale";
  if (hasQuantity) return "sale-or-inventory";
  return "query";
}

function answerTodaySummary(text) {
  const selected = allSales.filter(sale => sale.date === today());
  const sales = selected.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0);
  const profit = selected.reduce((sum, sale) => sum + Number(sale.totalProfit || 0), 0);
  if (/\bprofit\b/.test(text) && !/\bsales?\b/.test(text)) {
    appendAssistant(`Today's profit is ${money(profit)} from ${money(sales)} sales.`);
    return;
  }
  appendAssistant(`Today's sales are ${money(sales)} and profit is ${money(profit)}.`);
}

function answerStockQuestion(text) {
  let productText = text
    .replace(/\b(show|stock|inventory|of|how|much|is|left|available)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  productText = BUILTIN_PRODUCT_ALIASES[productText] || productText;
  const item = inventoryMap[normalize(productText)];
  if (!item) {
    appendAssistant(`I could not find ${titleCase(productText || "that item")} in current inventory.`);
    return;
  }
  appendAssistant(`${item.product || titleCase(productText)} stock is ${item.qty} ${item.unit || "piece"}.`);
}

function renderIntentQuestion(original) {
  const product = inferNewSaleProduct(normalize(original));
  const label = product ? `${product.qty} ${product.unit} ${product.name}` : original;
  const bubble = appendBubble("assistant", `
    <div class="preview-card">
      <p>What do you want to do with <strong>${escapeHtml(label)}</strong>?</p>
      <div class="preview-actions">
        <button class="confirm-action" data-intent="sale">Add Sale</button>
        <button class="minor-action" data-intent="inventory">Add Inventory</button>
        <button class="minor-action" data-intent="query">Send Query</button>
      </div>
    </div>
  `);
  bubble.querySelector('[data-intent="sale"]').addEventListener("click", () => handleSaleCommand(`Add sale ${original}`));
  bubble.querySelector('[data-intent="inventory"]').addEventListener("click", () => handleInventoryCommand(`Add inventory ${original}`));
  bubble.querySelector('[data-intent="query"]').addEventListener("click", () => renderQueryPreview(original));
}

async function tryAiSaleHelper(original, options = {}) {
  const clean = normalize(original);
  const looksLikeSale = options.forceSale
    || /\b\d+(?:\.\d+)?\s*(kg|g|piece)\b/.test(clean)
    || /\b(cash|cast|cas|credit|baki|udhar|upi|delivered|deliver|pending)\b/.test(clean);
  if (!looksLikeSale) return false;
  const thinkingBubble = appendThinkingBubble("Reading sale");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const response = await fetch(AI_HELPER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        text: original,
        mode: "sale",
        products: Object.values(saleCatalog()).slice(0, 80).map(product => ({
          name: product.name,
          unit: product.unit || product.sellingUnit || "piece",
          sellingPrice: Number(product.sellingPrice || 0),
          sellingUnit: product.sellingUnit || product.unit || "piece"
        })),
        aliases: { ...BUILTIN_PRODUCT_ALIASES, ...learnedAliases },
        customers: allCustomers().slice(0, 40).map(customer => ({
          name: customer.name || customer.customer || "",
          phone: customer.phone || ""
        }))
      })
    });
    clearTimeout(timer);
    let data = null;
    if (response.ok) {
      data = await response.json();
    } else {
      const legacy = await fetch(AI_LEGACY_EXTRACT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ text: original })
      });
      if (!legacy.ok) {
        thinkingBubble.remove();
        return false;
      }
      data = await legacy.json();
      data.intent = "add_sale";
      data.amountPaid = extractAmountPaid(clean);
    }
    thinkingBubble.remove();
    return renderAiSaleDraft(original, data);
  } catch (error) {
    console.warn("AI helper skipped:", error);
    thinkingBubble.remove();
    if (error?.name === "AbortError") {
      appendAssistant("AI is taking longer than usual. I kept the local parser ready; add the missing detail or try a shorter sale message.");
    }
    return false;
  }
}

function renderAiSaleDraft(original, data) {
  if (!data || !["sale", "add_sale"].includes(String(data.intent || "").toLowerCase())) return false;
  const items = Array.isArray(data.items) ? data.items.map(item => normalizeAiSaleItem(item)).filter(Boolean) : [];
  if (!items.length) return false;
  const paymentMode = ["cash", "upi", "credit"].includes(data.paymentMode) ? data.paymentMode : "cash";
  const deliveryStatus = ["pending", "delivered"].includes(data.deliveryStatus) ? data.deliveryStatus : "pending";
  const draft = {
    kind: "sale",
    original,
    aiAssisted: true,
    aiRaw: data,
    date: today(),
    customer: data.customer || "",
    phone: data.phone || "",
    items,
    paymentMode,
    deliveryStatus,
    creditType: Number(data.amountPaid || 0) > 0 ? "partial" : "full",
    amountPaid: paymentMode === "credit" ? Number(data.amountPaid || 0) : 0
  };
  const ambiguities = draft.items
    .filter(item => item.needsClarification || hasAiPriceConflict(original, item))
    .map(item => ({ item, value: Number(item.ambiguousAmount || item.price || item.sellingPrice || 0), pricing: getSalePricing(item.product) }));
  if (ambiguities.length) {
    renderPriceQuestion(draft, ambiguities);
    return true;
  }
  const missingPrices = draft.items.filter(item => Number(item.price || 0) <= 0);
  if (missingPrices.length) {
    renderMissingPriceQuestion(draft, missingPrices);
    return true;
  }
  renderSalePreview(draft);
  return true;
}

function normalizeAiSaleItem(item = {}) {
  const productName = item.product || item.name || "";
  const catalogItem = getSalePricing(productName) || getSalePricing(BUILTIN_PRODUCT_ALIASES[normalize(productName)] || "");
  const qty = Number(item.qty || item.quantity || 0);
  const unit = normalizeUnit(item.unit || catalogItem?.unit || "piece");
  if (!productName || qty <= 0) return null;
  const sellingPrice = Number(item.sellingPrice || item.rate || catalogItem?.sellingPrice || 0);
  const sellingUnit = normalizeSellingUnit(item.sellingUnit || catalogItem?.sellingUnit || unit, unit);
  const price = Number(item.price || item.total || 0) || (sellingPrice > 0
    ? calculateSellingLineTotal({ qty, unit, price: sellingPrice, sellingUnit })
    : 0);
  return {
    product: catalogItem?.name || titleCase(BUILTIN_PRODUCT_ALIASES[normalize(productName)] || productName),
    qty,
    unit,
    sellingPrice,
    sellingUnit,
    price,
    needsClarification: item.needsClarification === true,
    ambiguousAmount: Number(item.price || item.total || item.sellingPrice || item.rate || 0)
  };
}

function hasAiPriceConflict(original, item) {
  if (!item.sellingPrice || !item.price) return false;
  if (/\b(total|amount|mot|mota|bill)\b/i.test(original)) return false;
  const expected = calculateSellingLineTotal({
    qty: item.qty,
    unit: item.unit,
    price: item.sellingPrice,
    sellingUnit: item.sellingUnit || item.unit
  });
  return Math.abs(Number(item.price || 0) - expected) > 0.01;
}

function renderPossibleQuery(message) {
  const bubble = appendBubble("assistant", `
    <div class="preview-card">
      <p>Is this a query for the Zuno team?</p>
      <div class="preview-actions">
        <button class="confirm-action" data-query>Continue Query</button>
        <button class="minor-action" data-sale>Add Sale</button>
        <button class="minor-action" data-inventory>Add Inventory</button>
      </div>
    </div>
  `);
  bubble.querySelector("[data-query]").addEventListener("click", () => renderQueryPreview(message));
  bubble.querySelector("[data-sale]").addEventListener("click", () => handleSaleCommand(`Add sale ${message}`));
  bubble.querySelector("[data-inventory]").addEventListener("click", () => handleInventoryCommand(`Add inventory ${message}`));
}

function catalogAliases(catalog) {
  const aliases = [];
  const firstWordCounts = {};
  Object.keys(catalog).forEach(key => {
    const firstWord = key.split(" ")[0];
    firstWordCounts[firstWord] = (firstWordCounts[firstWord] || 0) + 1;
  });
  Object.entries(catalog).forEach(([key, product]) => {
    aliases.push({ alias: key, key, product });
    const compact = key.replace(/\s+/g, "");
    if (compact !== key) aliases.push({ alias: compact, key, product });
    const firstWord = key.split(" ")[0];
    if (firstWord !== key && firstWordCounts[firstWord] === 1) {
      aliases.push({ alias: firstWord, key, product });
    }
  });
  Object.entries(BUILTIN_PRODUCT_ALIASES).forEach(([alias, canonical]) => {
    const matches = findCatalogMatches(canonical, catalog);
    if (matches.length === 1) aliases.push({ alias, key: matches[0].key, product: matches[0].product });
  });
  Object.entries(learnedAliases).forEach(([alias, key]) => {
    const matches = findCatalogMatches(key, catalog);
    if (matches.length === 1) aliases.push({ alias: normalize(alias), key: matches[0].key, product: matches[0].product });
  });
  return aliases.sort((a, b) => b.alias.length - a.alias.length);
}

function findCatalogMatches(name, catalog = saleCatalog()) {
  const requested = normalize(name);
  if (!requested) return [];
  const entries = Object.entries(catalog).map(([key, product]) => ({ key, product }));
  const exact = entries.find(entry => entry.key === requested);
  if (exact) return [exact];
  const requestedWords = requested.split(/\s+/).filter(Boolean);
  return entries
    .map(entry => {
      const words = entry.key.split(/\s+/).filter(Boolean);
      const matchingWords = requestedWords.filter(word => words.includes(word)).length;
      const startsWith = entry.key.startsWith(requested);
      const contains = entry.key.includes(requested);
      return {
        ...entry,
        score: (startsWith ? 5 : 0) + (contains ? 3 : 0) + matchingWords
      };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.key.length - b.key.length);
}

function findMentions(text, catalog) {
  const found = [];
  catalogAliases(catalog).forEach(entry => {
    const expression = new RegExp(`(^|\\s)${regexEscape(entry.alias)}(?=\\s|$)`, "g");
    let match = expression.exec(text);
    while (match) {
      const index = match.index + match[1].length;
      const end = index + entry.alias.length;
      if (!found.some(item => index < item.end && end > item.index)) {
        found.push({ ...entry, index, end });
      }
      match = expression.exec(text);
    }
  });
  return found.sort((a, b) => a.index - b.index);
}

function findLooseProductRequest(text, catalog, mentions = []) {
  const ignored = new Set(["cash", "upi", "credit", "baki", "udhar", "pending", "delivered", "deliver", "sale", "sold"]);
  const patterns = [
    /\b\d+(?:\.\d+)?\s*(?:kg|g|piece)\s+([a-z][a-z0-9_-]*(?:\s+[a-z][a-z0-9_-]*){0,2})/g,
    /\b(?:ekta|akta|one)\s+([a-z][a-z0-9_-]*(?:\s+[a-z][a-z0-9_-]*){0,2})/g
  ];
  const catalogEntries = Object.entries(catalog).map(([key, product]) => ({
    key,
    product,
    words: key.split(/\s+/).filter(Boolean)
  }));
  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match) {
      const phrase = match[1]
        .split(/\s+/)
        .filter(word => !ignored.has(word))
        .join(" ")
        .trim();
      if (!phrase) {
        match = pattern.exec(text);
        continue;
      }
      const start = match.index + match[0].lastIndexOf(match[1]);
      const end = start + match[1].length;
      const overlapsKnown = mentions.some(mention => start < mention.end && end > mention.index);
      if (!overlapsKnown) {
        const canonicalPhrase = BUILTIN_PRODUCT_ALIASES[phrase] || learnedAliases[phrase] || phrase;
        const phraseWords = normalize(canonicalPhrase).split(/\s+/).filter(Boolean);
        const scored = catalogEntries
          .map(entry => {
            const matchingWords = phraseWords.filter(word => entry.words.includes(word)).length;
            const startsWithPhrase = entry.key.startsWith(normalize(canonicalPhrase));
            const containsPhrase = entry.key.includes(normalize(canonicalPhrase));
            return {
              ...entry,
              score: (startsWithPhrase ? 4 : 0) + (containsPhrase ? 2 : 0) + matchingWords
            };
          })
          .filter(entry => entry.score > 0)
          .sort((a, b) => b.score - a.score || a.key.length - b.key.length)
          .slice(0, 4);
        if (scored.length) {
          return { phrase, choices: scored };
        }
      }
      match = pattern.exec(text);
    }
  }
  return null;
}

function normalizeUnit(unit = "piece") {
  if (unit === "kg") return "kg";
  if (unit === "g") return "g";
  return "piece";
}

function isWeightUnit(unit) {
  return unit === "kg" || unit === "g";
}

function chooseStockStorageUnit(existingUnit, incomingUnit) {
  if (!existingUnit) return incomingUnit;
  if (isWeightUnit(existingUnit) && isWeightUnit(incomingUnit)) {
    return existingUnit === "kg" || incomingUnit === "kg" ? "kg" : "g";
  }
  return existingUnit;
}

function convertStockQty(qty, fromUnit, toUnit) {
  const value = Number(qty || 0);
  if (fromUnit === toUnit) return value;
  if (fromUnit === "g" && toUnit === "kg") return value / 1000;
  if (fromUnit === "kg" && toUnit === "g") return value * 1000;
  return value;
}

function quantityBefore(text, start, previousEnd, menuMode) {
  const before = text.slice(previousEnd, start);
  const numeric = before.match(/(\d+(?:\.\d+)?)\s*(kg|g|piece)?\s*$/);
  if (numeric) return { qty: Number(numeric[1]), unit: normalizeUnit(numeric[2] || "piece") };
  if (/\b(ekta|akta|one|a)\s*$/.test(before)) return { qty: 1, unit: "piece" };
  if (menuMode || formConfig.quantity === false) return { qty: 1, unit: "piece" };
  return null;
}

function extractPayment(text) {
  const aliases = { ...BUILTIN_PAYMENT_ALIASES, ...learnedPaymentAliases };
  const found = Object.entries(aliases)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([alias]) => new RegExp(`\\b${regexEscape(normalize(alias))}\\b`).test(text));
  if (found) return found[1];
  return null;
}

function extractAmountPaid(text) {
  const labelled = text.match(/\b(?:paid|pay|advance|given|diyechi|diya)\s*(?:rs\s*)?(\d+(?:\.\d+)?)/)
    || text.match(/\b(?:rs\s*)?(\d+(?:\.\d+)?)\s*(?:paid|advance|given)\b/);
  if (labelled) return Number(labelled[1]);
  const partial = text.match(/\b(?:partial|partly|part)\s*(?:credit)?\s*(?:paid)?\s*(?:rs\s*)?(\d+(?:\.\d+)?)/)
    || text.match(/\bcredit\s+(?:partial\s*)?(?:paid\s*)?(?:rs\s*)?(\d+(?:\.\d+)?)/);
  return partial ? Number(partial[1]) : 0;
}

function extractStatus(text) {
  if (/\bnot delivered\b/.test(text)) return "pending";
  const aliases = { ...BUILTIN_STATUS_ALIASES, ...learnedStatusAliases };
  const found = Object.entries(aliases)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([alias]) => new RegExp(`\\b${regexEscape(normalize(alias))}\\b`).test(text));
  if (found) return found[1];
  return null;
}

function allCustomers() {
  const records = allSales.map(sale => ({ name: sale.customer, phone: sale.phone }))
    .concat(creditCustomers.map(credit => ({ name: credit.name || credit.customer, phone: credit.phone })))
    .concat(savedCustomers.map(customer => ({ name: customer.name || customer.customer, phone: customer.phone })))
    .concat(customerOrders.map(order => ({ name: order.customerName, phone: order.customerPhone })));
  const byName = {};
  records.forEach(record => {
    const key = normalize(record.name);
    if (!key) return;
    if (!byName[key] || (!byName[key].phone && record.phone)) byName[key] = record;
  });
  return Object.values(byName);
}

function extractCustomer(text, mentions) {
  if (formConfig.customerName === false) return { customer: "", phone: "" };
  const phoneMatch = text.match(/\b\d{10}\b/);
  const phone = phoneMatch ? phoneMatch[0] : "";
  const existing = allCustomers()
    .sort((a, b) => String(b.name || "").length - String(a.name || "").length)
    .find(customer => text.includes(normalize(customer.name)));
  if (existing) return { customer: existing.name || existing.customer, phone: phone || existing.phone || "" };
  let candidate = text;
  mentions.forEach(mention => {
    candidate = candidate.replace(new RegExp(`\\b${regexEscape(mention.alias)}\\b`, "g"), " ");
  });
  candidate = candidate
    .replace(/\b(add|new|sale|sold|for|to|customer|inventory|stock)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(kg|g|piece)?\b/g, " ")
    .replace(/\b(ekta|akta|one)\b/g, " ")
    .replace(/\b(cash|upi|credit|baki|udhar|delivered|deliver|pending|done|complete|completed|diyechi|diya|given)\b/g, " ")
    .replace(/@?\s*(?:rs\s*)?\d+(?:\.\d+)?/g, " ")
    .replace(/\b\d{10}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { customer: candidate ? titleCase(candidate) : "", phone };
}

function priceData(afterText, qty, unit, product) {
  const explicitRate = afterText.match(/(?:@|rate\s*|at\s+|price\s*)(?:rs\s*)?(\d+(?:\.\d+)?)/);
  if (explicitRate) {
    const sellingPrice = Number(explicitRate[1]);
    return {
      sellingPrice,
      price: calculateSellingLineTotal({ qty, unit, price: sellingPrice, sellingUnit: unit })
    };
  }
  const bare = afterText.match(/^\s*(\d+(?:\.\d+)?)(?=\s|$)/);
  if (bare) return { ambiguousAmount: Number(bare[1]) };
  if (Number(product.sellingPrice || 0) > 0) {
    return {
      sellingPrice: Number(product.sellingPrice),
      price: calculateSellingLineTotal({ qty, unit, price: product.sellingPrice, sellingUnit: product.sellingUnit || unit })
    };
  }
  return { missingPrice: true };
}

async function handleSaleCommand(original) {
  const text = normalize(original);
  const catalog = saleCatalog();
  const mentions = findMentions(text, catalog);
  if (!mentions.length) {
    const looseMatch = findLooseProductRequest(text, catalog);
    if (looseMatch) {
      if (looseMatch.choices.length === 1) {
        handleSaleCommand(replaceProductPhrase(original, looseMatch.phrase, looseMatch.choices[0].product.name));
        return;
      }
      renderProductChoiceQuestion(original, looseMatch);
      return;
    }
    if (await tryAiSaleHelper(original, { forceSale: true })) return;
    const newProduct = inferNewSaleProduct(text);
    if (newProduct) {
      renderNewProductSuggestion(original, newProduct);
      return;
    }
    appendAssistant(`I could not find the item in your ${shopProfile.foodMenuEnabled === true ? "menu" : "products"}. Tell me the item after its quantity, for example: 10kg potato.`);
    return;
  }
  const unknownProduct = inferUnknownSaleProduct(text, mentions);
  if (unknownProduct) {
    const looseMatch = findLooseProductRequest(text, catalog, mentions);
    if (looseMatch) {
      if (looseMatch.choices.length === 1) {
        handleSaleCommand(replaceProductPhrase(original, looseMatch.phrase, looseMatch.choices[0].product.name));
        return;
      }
      renderProductChoiceQuestion(original, looseMatch);
      return;
    }
    renderNewProductSuggestion(original, unknownProduct);
    return;
  }

  const missing = [];
  const missingPrices = [];
  const ambiguities = [];
  const items = mentions.map((mention, index) => {
    const previousEnd = index ? mentions[index - 1].end : 0;
    const quantity = quantityBefore(text, mention.index, previousEnd, shopProfile.foodMenuEnabled === true);
    if (!quantity) {
      missing.push(`quantity for ${mention.product.name}`);
      return null;
    }
    const after = text.slice(mention.end, index + 1 < mentions.length ? mentions[index + 1].index : text.length);
    const pricingText = index + 1 < mentions.length
      ? after.replace(/\d+(?:\.\d+)?\s*(kg|g|piece)\s*$/, "").trim()
      : after;
    const pricing = priceData(pricingText, quantity.qty, quantity.unit, mention.product);
    const item = {
      product: mention.product.name,
      qty: quantity.qty,
      unit: quantity.unit,
      sellingPrice: pricing.sellingPrice || 0,
      price: pricing.price || 0
    };
    if (pricing.ambiguousAmount !== undefined) {
      ambiguities.push({ item, value: pricing.ambiguousAmount, pricing: mention.product });
    } else if (pricing.missingPrice) {
      missingPrices.push(item);
    }
    return item;
  }).filter(Boolean);

  const customer = extractCustomer(text, mentions);
  const saleDefaults = currentSaleDefaults();
  const paymentMode = extractPayment(text) || saleDefaults.paymentMode;
  if (formConfig.paymentMode !== false && !paymentMode) missing.push("payment (cash, UPI or credit)");
  if (paymentMode === "credit" && formConfig.customerName !== false && !customer.customer) missing.push("customer name for credit");
  if (paymentMode === "credit" && shopProfile.creditEnabled === false) {
    missing.push("a non-credit payment mode because credit is disabled");
  }
  const deliveryStatus = extractStatus(text) || saleDefaults.deliveryStatus;
  if (formConfig.deliveryStatus !== false && !deliveryStatus) missing.push("status (pending or delivered)");
  const partialCredit = paymentMode === "credit" && /\b(partial|partly|part|advance|paid|pay)\b/.test(text);
  const amountPaid = paymentMode === "credit" ? extractAmountPaid(text) : 0;
  if (partialCredit && amountPaid <= 0) missing.push("paid amount for partial credit");
  const draft = {
    kind: "sale",
    original,
    date: today(),
    customer: customer.customer,
    phone: customer.phone,
    items,
    paymentMode: paymentMode || "cash",
    deliveryStatus: deliveryStatus || "pending",
    creditType: amountPaid > 0 || partialCredit ? "partial" : "full",
    amountPaid
  };

  if (missing.length) {
    const onlyModeMissing = missing.every(value => value.includes("payment") || value.includes("status"));
    if (!onlyModeMissing && await tryAiSaleHelper(original, { forceSale: true })) return;
    pendingFollowup = {
      original,
      needsCustomer: missing.some(value => value.includes("customer name")),
      quantityAlias: missing.some(value => value.startsWith("quantity for ")) ? mentions[0]?.alias : ""
    };
    appendAssistant(`I found part of the sale. Please add ${missing.join(" and ")} in one message.`);
    return;
  }
  if (ambiguities.length) {
    renderPriceQuestion(draft, ambiguities);
    return;
  }
  if (missingPrices.length) {
    renderMissingPriceQuestion(draft, missingPrices);
    return;
  }
  renderSalePreview(draft);
}

function inferNewSaleProduct(text) {
  const quantity = text.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|piece)\s+([a-z][a-z0-9_-]*)\b/)
    || text.match(/\b(ekta|akta|one)\s+([a-z][a-z0-9_-]*)\b/);
  if (!quantity) return null;
  const isNumeric = /^\d/.test(quantity[1]);
  const rawName = isNumeric ? quantity[3] : quantity[2];
  if (!rawName || ["cash", "upi", "credit", "baki", "pending", "delivered"].includes(rawName)) return null;
  const canonical = BUILTIN_PRODUCT_ALIASES[rawName] || rawName;
  return {
    name: titleCase(canonical),
    qty: isNumeric ? Number(quantity[1]) : 1,
    unit: isNumeric ? normalizeUnit(quantity[2]) : "piece"
  };
}

function inferUnknownSaleProduct(text, mentions) {
  const patterns = [
    { expression: /\b(\d+(?:\.\d+)?)\s*(kg|g|piece)\s+([a-z][a-z0-9_-]*)\b/g, nameIndex: 3, qtyIndex: 1, unitIndex: 2 },
    { expression: /\b(ekta|akta|one)\s+([a-z][a-z0-9_-]*)\b/g, nameIndex: 2, qty: 1, unit: "piece" }
  ];
  for (const pattern of patterns) {
    let match = pattern.expression.exec(text);
    while (match) {
      const rawName = match[pattern.nameIndex];
      const productIndex = match.index + match[0].lastIndexOf(rawName);
      const isKnown = mentions.some(mention => productIndex >= mention.index && productIndex < mention.end);
      if (!isKnown && !["cash", "upi", "credit", "baki", "pending", "delivered"].includes(rawName)) {
        const canonical = BUILTIN_PRODUCT_ALIASES[rawName] || rawName;
        return {
          name: titleCase(canonical),
          qty: pattern.qty || Number(match[pattern.qtyIndex]),
          unit: pattern.unit || normalizeUnit(match[pattern.unitIndex])
        };
      }
      match = pattern.expression.exec(text);
    }
  }
  return null;
}

function renderProductChoiceQuestion(original, looseMatch) {
  const choices = looseMatch.choices || [];
  const prompt = choices.length === 1
    ? `Do you mean <strong>${escapeHtml(choices[0].product.name)}</strong>?`
    : `Which ${escapeHtml(looseMatch.phrase)} do you mean?`;
  const bubble = appendBubble("assistant", `
    <div class="preview-card">
      <div class="preview-title">Choose product</div>
      <p>${prompt}</p>
      <div class="preview-actions">
        ${choices.map((choice, index) => `<button class="choice-action" data-product-choice="${index}">${escapeHtml(choice.product.name)}</button>`).join("")}
        <button class="minor-action" data-edit-command>Edit</button>
      </div>
    </div>
  `);
  choices.forEach((choice, index) => {
    bubble.querySelector(`[data-product-choice="${index}"]`)?.addEventListener("click", () => {
      const updated = replaceProductPhrase(original, looseMatch.phrase, choice.product.name);
      bubble.remove();
      handleSaleCommand(updated);
    });
  });
  bubble.querySelector("[data-edit-command]")?.addEventListener("click", () => renderCommandEditForm(original, bubble));
}

function replaceProductPhrase(original, phrase, productName) {
  const expression = new RegExp(`\\b${regexEscape(phrase)}\\b`, "i");
  if (expression.test(original)) return original.replace(expression, productName);
  return `${original} ${productName}`;
}

function renderNewProductSuggestion(original, product) {
  const kind = shopProfile.foodMenuEnabled === true ? "menu item" : "product";
  const bubble = appendBubble("assistant", `
    <div class="preview-card">
      <div class="preview-title">New ${escapeHtml(kind)} found</div>
      <p><strong>${escapeHtml(product.name)}</strong> is not in your ${shopProfile.foodMenuEnabled === true ? "menu" : "products"} yet. Add it now and continue this sale?</p>
      <div class="preview-actions">
        <button class="confirm-action" data-add-product>Add ${escapeHtml(titleCase(kind))}</button>
        <button class="minor-action" data-correct>Edit</button>
      </div>
    </div>
  `);
  bubble.querySelector("[data-add-product]").addEventListener("click", () => {
    pendingFollowup = { type: "product-pricing", original, product };
    appendAssistant(`What is the selling price for ${product.name}? Reply like: sell 15/${product.unit} cost 10/${product.unit}, or sell 15/${product.unit} skip cost.`);
    chatInput.focus();
  });
  bubble.querySelector("[data-correct]").addEventListener("click", () => renderCommandEditForm(original, bubble));
}

function handleNewProductPricing(reply, followup) {
  const text = normalize(reply);
  const selling = text.match(/(?:sell|selling|price)\s*@?\s*(?:rs\s*)?(\d+(?:\.\d+)?)/)
    || text.match(/^@?\s*(?:rs\s*)?(\d+(?:\.\d+)?)/);
  if (!selling) {
    appendAssistant(`Please give the selling price for ${followup.product.name}, for example: sell 15/${followup.product.unit}. Cost is optional.`);
    return;
  }
  const cost = text.match(/\bcost\s*(?:rs\s*)?(\d+(?:\.\d+)?)/);
  const setup = {
    ...followup,
    sellingPrice: Number(selling[1]),
    cost: cost ? Number(cost[1]) : 0
  };
  pendingFollowup = null;
  const bubble = appendBubble("assistant", `
    <div class="preview-card">
      <div class="preview-title">Add ${shopProfile.foodMenuEnabled === true ? "menu item" : "product"}</div>
      <div class="preview-line"><span>Name</span><strong>${escapeHtml(setup.product.name)}</strong></div>
      <div class="preview-line"><span>Selling price</span><strong>${money(setup.sellingPrice)} / ${escapeHtml(setup.product.unit)}</strong></div>
      <div class="preview-line"><span>Cost price</span><strong>${setup.cost ? `${money(setup.cost)} / ${escapeHtml(setup.product.unit)}` : "Not set"}</strong></div>
      <div class="preview-actions">
        <button class="confirm-action" data-save-product>Add and Continue</button>
        <button class="minor-action" data-correct>Correct</button>
      </div>
    </div>
  `);
  bubble.querySelector("[data-save-product]").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    await addNewSaleProduct(setup, bubble);
  });
  bubble.querySelector("[data-correct]").addEventListener("click", () => {
    pendingFollowup = followup;
    renderCommandEditForm(reply, bubble);
  });
}

async function addNewSaleProduct(setup, bubble) {
  try {
    const unit = setup.product.unit;
    if (shopProfile.foodMenuEnabled === true) {
      const itemRef = await addDoc(userCol("foodItems"), {
        name: setup.product.name,
        description: "",
        variants: [{ id: "full", label: "Full Plate", pieces: "", price: setup.sellingPrice }],
        price: setup.sellingPrice,
        category: "Veg",
        imageUrl: "",
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      const key = `${itemRef.id}::full`;
      if (setup.cost > 0) {
        await setDoc(userDoc("foodCosts", encodeURIComponent(key)), {
          key,
          itemId: itemRef.id,
          variantId: "full",
          name: setup.product.name,
          sellingPrice: setup.sellingPrice,
          cost: setup.cost,
          updatedAt: serverTimestamp()
        });
      }
      foodMenuPrices[normalize(setup.product.name)] = {
        name: setup.product.name,
        source: "food-menu",
        foodCostKey: key,
        cost: setup.cost,
        hasCost: setup.cost > 0,
        sellingPrice: setup.sellingPrice,
        unit: "piece",
        sellingUnit: "piece"
      };
    } else {
      await addDoc(userCol("products"), {
        name: setup.product.name,
        cost: setup.cost,
        costConfigured: setup.cost > 0,
        sellingPrice: setup.sellingPrice,
        unit,
        sellingUnit: normalizeSellingUnit(unit, unit)
      });
      await syncInventoryProduct(setup.product.name, setup.cost, setup.sellingPrice, unit, unit);
      productCosts[normalize(setup.product.name)] = {
        name: setup.product.name,
        cost: setup.cost,
        hasCost: setup.cost > 0,
        sellingPrice: setup.sellingPrice,
        unit,
        sellingUnit: normalizeSellingUnit(unit, unit)
      };
    }
    bubble.classList.add("saved");
    bubble.innerHTML = `<p>${escapeHtml(setup.product.name)} added. Continuing your sale.</p>`;
    handleSaleCommand(setup.original);
  } catch (error) {
    console.error("Chat product setup failed:", error);
    appendAssistant("Could not add this product right now. Please try again.", "error");
    bubble.querySelector("[data-save-product]")?.removeAttribute("disabled");
  }
}

function renderPriceQuestion(draft, ambiguities) {
  const ambiguity = ambiguities[0];
  const remaining = ambiguities.slice(1);
  const bubble = appendBubble("assistant", `
    <div class="preview-card">
      <p>I found ${escapeHtml(ambiguity.item.product)} ${ambiguity.item.qty} ${ambiguity.item.unit}. Is ${money(ambiguity.value)} a rate or the total amount?</p>
      <div class="preview-actions">
        <button class="choice-action" data-choice="rate">Rate / ${escapeHtml(ambiguity.item.unit)}</button>
        <button class="choice-action" data-choice="total">Total amount</button>
      </div>
    </div>
  `);
  bubble.querySelector('[data-choice="rate"]').addEventListener("click", () => {
    ambiguity.item.sellingPrice = ambiguity.value;
    ambiguity.item.price = calculateSellingLineTotal({
      qty: ambiguity.item.qty,
      unit: ambiguity.item.unit,
      price: ambiguity.value,
      sellingUnit: ambiguity.item.unit
    });
    bubble.remove();
    if (remaining.length) {
      renderPriceQuestion(draft, remaining);
    } else {
      renderSalePreview(draft);
    }
  });
  bubble.querySelector('[data-choice="total"]').addEventListener("click", () => {
    ambiguity.item.price = ambiguity.value;
    bubble.remove();
    if (remaining.length) {
      renderPriceQuestion(draft, remaining);
    } else {
      renderSalePreview(draft);
    }
  });
}

function renderMissingPriceQuestion(draft, missingItems) {
  const item = missingItems[0];
  const remaining = missingItems.slice(1);
  pendingFollowup = { type: "sale-missing-price", draft, item, remaining };
  appendAssistant(
    missingItems.length === 1
      ? `What is the selling price for ${item.product}? Reply like: ${item.product} 15/kg.`
      : `Selling price is missing for ${missingItems.map(entry => entry.product).join(" and ")}. First, send ${item.product}'s price, for example: ${item.product} 15/${item.unit}.`
  );
}

function handleMissingSalePrice(reply, followup) {
  const text = normalize(reply);
  const match = text.match(/(?:@|rate\s*|price\s*|rs\s*)?(\d+(?:\.\d+)?)(?:\s*\/?\s*(kg|g|piece))?/);
  if (!match || Number(match[1]) <= 0) {
    appendAssistant(`Please send a price for ${followup.item.product}, for example: ${followup.item.product} 15/${followup.item.unit}.`);
    return;
  }
  followup.item.sellingPrice = Number(match[1]);
  followup.item.sellingUnit = normalizeUnit(match[2] || followup.item.unit);
  followup.item.price = calculateSellingLineTotal({
    qty: followup.item.qty,
    unit: followup.item.unit,
    price: followup.item.sellingPrice,
    sellingUnit: followup.item.sellingUnit
  });
  if (followup.remaining.length) {
    renderMissingPriceQuestion(followup.draft, followup.remaining);
    return;
  }
  pendingFollowup = null;
  renderSalePreview(followup.draft);
}

function renderSalePreview(draft) {
  const total = draft.items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  if (draft.amountPaid > total) {
    appendAssistant("The paid amount is greater than the sale total. Please correct the message.");
    return;
  }
  const due = draft.paymentMode === "credit" ? Math.max(0, total - draft.amountPaid) : 0;
  const bubble = appendBubble("assistant", `
    <div class="preview-card">
      <div class="preview-title">Sale found</div>
      ${draft.customer ? `<div class="preview-line"><span>Customer</span><strong>${escapeHtml(draft.customer)}${draft.phone ? ` - ${escapeHtml(draft.phone)}` : ""}</strong></div>` : ""}
      <div class="preview-items">
        ${draft.items.map(item => `<div class="preview-line"><span>${escapeHtml(item.product)} - ${item.qty} ${escapeHtml(item.unit)}${item.sellingPrice ? ` x ${money(item.sellingPrice)}` : ""}</span><strong>${money(item.price)}</strong></div>`).join("")}
      </div>
      <div class="preview-line"><span>Total</span><strong>${money(total)}</strong></div>
      <div class="preview-line"><span>Payment</span><strong>${escapeHtml(draft.paymentMode.toUpperCase())}${draft.paymentMode === "credit" ? ` - Due ${money(due)}` : ""}</strong></div>
      <div class="preview-line"><span>Status</span><strong>${escapeHtml(titleCase(draft.deliveryStatus))}</strong></div>
      <div class="preview-actions">
        <button class="confirm-action" data-confirm>Confirm Sale</button>
        <button class="minor-action" data-correct>Edit</button>
        <button class="minor-action" data-more-info>Add More Info</button>
      </div>
    </div>
  `);
  bubble.querySelector("[data-confirm]").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    await saveSaleDraft(draft, bubble);
  });
  bubble.querySelector("[data-correct]").addEventListener("click", () => renderSaleEditForm(draft, bubble));
  bubble.querySelector("[data-more-info]").addEventListener("click", () => renderAdditionalSaleInfo(draft));
}

function renderSaleEditForm(draft, bubble) {
  bubble.innerHTML = `
    <div class="preview-card">
      <div class="preview-title">Edit sale</div>
      <div class="edit-grid">
        <label>Customer <input class="optional-info-input" data-edit-customer value="${escapeHtml(draft.customer || "")}"></label>
        <label>Phone <input class="optional-info-input" data-edit-phone value="${escapeHtml(draft.phone || "")}"></label>
        <label>Date <input class="optional-info-input" data-edit-date type="date" value="${escapeHtml(draft.date || today())}"></label>
        <label>Payment
          <select class="optional-info-input" data-edit-payment>
            <option value="cash"${draft.paymentMode === "cash" ? " selected" : ""}>Cash</option>
            <option value="upi"${draft.paymentMode === "upi" ? " selected" : ""}>UPI</option>
            <option value="credit"${draft.paymentMode === "credit" ? " selected" : ""}>Credit</option>
          </select>
        </label>
        <label>Status
          <select class="optional-info-input" data-edit-status>
            <option value="pending"${draft.deliveryStatus === "pending" ? " selected" : ""}>Pending</option>
            <option value="delivered"${draft.deliveryStatus === "delivered" ? " selected" : ""}>Delivered</option>
          </select>
        </label>
        <label>Paid now <input class="optional-info-input" data-edit-paid type="number" min="0" value="${Number(draft.amountPaid || 0)}"></label>
      </div>
      <div class="edit-items">
        ${draft.items.map((item, index) => `
          <div class="edit-item" data-edit-item="${index}">
            <input class="optional-info-input" data-edit-product value="${escapeHtml(item.product)}" aria-label="Product">
            <input class="optional-info-input" data-edit-qty type="number" min="0" step="any" value="${Number(item.qty || 0)}" aria-label="Quantity">
            <select class="optional-info-input" data-edit-unit aria-label="Unit">
              <option value="kg"${item.unit === "kg" ? " selected" : ""}>kg</option>
              <option value="g"${item.unit === "g" ? " selected" : ""}>g</option>
              <option value="piece"${item.unit === "piece" ? " selected" : ""}>piece</option>
            </select>
            <input class="optional-info-input" data-edit-rate type="number" min="0" step="any" value="${Number(item.sellingPrice || 0)}" aria-label="Rate">
            <input class="optional-info-input" data-edit-total type="number" min="0" step="any" value="${Number(item.price || 0)}" aria-label="Total">
          </div>
        `).join("")}
      </div>
      <p class="edit-help">Rows are Product, Qty, Unit, Rate, Total. If Total is filled, it is used directly.</p>
      <div class="preview-actions">
        <button class="confirm-action" data-apply-edit>Apply Edit</button>
        <button class="minor-action" data-cancel-edit>Cancel</button>
      </div>
    </div>
  `;
  bubble.querySelector("[data-apply-edit]").addEventListener("click", () => {
    const paymentMode = bubble.querySelector("[data-edit-payment]").value;
    const amountPaid = paymentMode === "credit" ? Number(bubble.querySelector("[data-edit-paid]").value || 0) : 0;
    draft.customer = bubble.querySelector("[data-edit-customer]").value.trim();
    draft.phone = bubble.querySelector("[data-edit-phone]").value.trim();
    draft.date = bubble.querySelector("[data-edit-date]").value || today();
    draft.paymentMode = paymentMode;
    draft.deliveryStatus = bubble.querySelector("[data-edit-status]").value;
    draft.amountPaid = amountPaid;
    draft.creditType = paymentMode === "credit" && amountPaid > 0 ? "partial" : "full";
    draft.items = Array.from(bubble.querySelectorAll("[data-edit-item]")).map(row => {
      const product = row.querySelector("[data-edit-product]").value.trim();
      const qty = Number(row.querySelector("[data-edit-qty]").value || 0);
      const unit = normalizeUnit(row.querySelector("[data-edit-unit]").value);
      const sellingPrice = Number(row.querySelector("[data-edit-rate]").value || 0);
      const total = Number(row.querySelector("[data-edit-total]").value || 0);
      return {
        product,
        qty,
        unit,
        sellingPrice,
        price: total > 0 ? total : calculateSellingLineTotal({ qty, unit, price: sellingPrice, sellingUnit: unit })
      };
    }).filter(item => item.product && item.qty > 0);
    renderSalePreview(draft);
  });
  bubble.querySelector("[data-cancel-edit]").addEventListener("click", () => renderSalePreview(draft));
}

function renderAdditionalSaleInfo(draft) {
  const bubble = appendBubble("assistant", `
    <div class="preview-card">
      <div class="preview-title">Optional sale details</div>
      <input class="optional-info-input" data-customer-name placeholder="Customer name" value="${escapeHtml(draft.customer || "")}">
      <input class="optional-info-input" data-customer-phone placeholder="Phone number" value="${escapeHtml(draft.phone || "")}">
      <div class="preview-actions">
        <button class="confirm-action" data-apply-info>Apply Details</button>
        <button class="minor-action" data-cancel-info>Skip</button>
      </div>
    </div>
  `);
  bubble.querySelector("[data-apply-info]").addEventListener("click", () => {
    draft.customer = bubble.querySelector("[data-customer-name]").value.trim();
    draft.phone = bubble.querySelector("[data-customer-phone]").value.trim();
    bubble.remove();
    renderSalePreview(draft);
  });
  bubble.querySelector("[data-cancel-info]").addEventListener("click", () => bubble.remove());
}

function correctCommand(original) {
  renderCommandEditForm(original);
}

function renderCommandEditForm(original, existingBubble = null) {
  const bubble = existingBubble || appendBubble("assistant", "", "", { persist: false });
  bubble.innerHTML = `
    <div class="preview-card">
      <div class="preview-title">Edit message</div>
      <textarea class="optional-info-input command-edit-input" data-command-edit rows="3">${escapeHtml(original)}</textarea>
      <p class="edit-help">Fix the product name, quantity, payment or status, then apply.</p>
      <div class="preview-actions">
        <button class="confirm-action" data-apply-command-edit>Apply Edit</button>
        <button class="minor-action" data-cancel-command-edit>Cancel</button>
      </div>
    </div>
  `;
  const input = bubble.querySelector("[data-command-edit]");
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  bubble.querySelector("[data-apply-command-edit]").addEventListener("click", async () => {
    const edited = input.value.trim();
    if (!edited) {
      appendAssistant("Please keep some text in the message.");
      return;
    }
    bubble.remove();
    await processMessage(edited);
  });
  bubble.querySelector("[data-cancel-command-edit]").addEventListener("click", () => bubble.remove());
}

function handleInventoryCommand(original) {
  const text = normalize(original);
  const catalog = { ...productCosts };
  const mentions = findMentions(text, catalog);
  const quantityMatch = text.match(/(\d+(?:\.\d+)?)\s*(kg|g|piece)\b/);
  if (!quantityMatch) {
    pendingFollowup = { original };
    appendAssistant("Please add the stock quantity and unit, for example 10kg or 5 piece.");
    return;
  }
  let productName = mentions[0]?.product.name || "";
  if (!productName) {
    const start = quantityMatch.index + quantityMatch[0].length;
    productName = text.slice(start)
      .split(/\b(?:bought|purchase|cost|sell|selling|vendor|paid|at)\b|@/)[0]
      .replace(/\b(for|rs)\b/g, "")
      .trim();
    if (BUILTIN_PRODUCT_ALIASES[productName] && productCosts[BUILTIN_PRODUCT_ALIASES[productName]]) {
      productName = productCosts[BUILTIN_PRODUCT_ALIASES[productName]].name;
    } else {
      productName = titleCase(productName);
    }
  }
  if (!productName) {
    pendingFollowup = { original };
    appendAssistant("Which product are you adding to inventory?");
    return;
  }
  const purchaseMatch = text.match(/\b(?:bought\s*(?:for)?|purchase|cost)\s*(?:rs\s*)?(\d+(?:\.\d+)?)/);
  const sellingMatch = text.match(/\b(?:sell|selling)(?:\s*(?:at|price))?\s*@?\s*(?:rs\s*)?(\d+(?:\.\d+)?)/);
  const vendorMatch = text.match(/\b(?:from|vendor)\s+(.+?)(?=\s+(?:phone|mobile|paid|pay|sell|selling|bought|purchase|cost|note)\b|$)/);
  const vendorPhoneMatch = text.match(/\b(?:phone|mobile)\s*(\d{10})\b/);
  const vendorPaymentMatch = text.match(/\b(?:paid|pay)\s*(?:rs\s*)?(\d+(?:\.\d+)?)/);
  const draft = {
    kind: "inventory",
    original,
    product: productName,
    qty: Number(quantityMatch[1]),
    unit: normalizeUnit(quantityMatch[2]),
    date: today(),
    purchaseCost: purchaseMatch ? Number(purchaseMatch[1]) : 0,
    sellingPrice: sellingMatch ? Number(sellingMatch[1]) : 0,
    sellingUnit: normalizeUnit(quantityMatch[2]),
    alertThreshold: 0,
    note: "",
    vendorName: vendorMatch ? titleCase(vendorMatch[1].trim()) : "",
    vendorPhone: vendorPhoneMatch ? vendorPhoneMatch[1] : "",
    vendorAmountPaid: vendorPaymentMatch ? Number(vendorPaymentMatch[1]) : 0
  };
  if (draft.vendorName && !draft.purchaseCost) {
    pendingFollowup = { type: "inventory-purchase", draft };
    appendAssistant(`What was the total purchase cost from ${draft.vendorName}?`);
    return;
  }
  if (draft.vendorName && !vendorPaymentMatch) {
    pendingFollowup = { type: "inventory-vendor-payment", draft };
    appendAssistant(`How much was paid to ${draft.vendorName} now? Reply with paid 0 if it is unpaid.`);
    return;
  }
  if (draft.vendorAmountPaid > draft.purchaseCost) {
    pendingFollowup = { type: "inventory-vendor-payment", draft };
    appendAssistant(`Paid amount cannot be more than the purchase cost of ${money(draft.purchaseCost)}. Please send the paid amount again.`);
    return;
  }
  renderInventoryPreview(draft);
}

function renderInventoryPreview(draft) {
  const bubble = appendBubble("assistant", `
    <div class="preview-card">
      <div class="preview-title">Inventory update found</div>
      <div class="preview-line"><span>Product</span><strong>${escapeHtml(draft.product)}</strong></div>
      <div class="preview-line"><span>Quantity</span><strong>${draft.qty} ${escapeHtml(draft.unit)}</strong></div>
      ${draft.purchaseCost ? `<div class="preview-line"><span>Purchase cost</span><strong>${money(draft.purchaseCost)}</strong></div>` : ""}
      ${draft.sellingPrice ? `<div class="preview-line"><span>Selling price</span><strong>${money(draft.sellingPrice)} / ${escapeHtml(draft.sellingUnit)}</strong></div>` : ""}
      ${draft.vendorName ? `<div class="preview-line"><span>Vendor</span><strong>${escapeHtml(draft.vendorName)}${draft.vendorPhone ? ` - ${escapeHtml(draft.vendorPhone)}` : ""}</strong></div>
      <div class="preview-line"><span>Paid now</span><strong>${money(draft.vendorAmountPaid)}</strong></div>
      <div class="preview-line"><span>Vendor payable</span><strong>${money(Math.max(0, draft.purchaseCost - draft.vendorAmountPaid))}</strong></div>` : ""}
      <div class="preview-actions">
        <button class="confirm-action" data-confirm>Confirm Stock</button>
        <button class="minor-action" data-correct>Correct</button>
      </div>
    </div>
  `);
  bubble.querySelector("[data-confirm]").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    await saveInventoryDraft(draft, bubble);
  });
  bubble.querySelector("[data-correct]").addEventListener("click", () => correctCommand(draft.original));
}

function renderQueryPreview(message) {
  const bubble = appendBubble("assistant", `
    <div class="preview-card">
      <div class="preview-title">Send query to Zuno team?</div>
      <p>${escapeHtml(message)}</p>
      <div class="preview-actions">
        <button class="confirm-action" data-confirm>Send Query</button>
        <button class="minor-action" data-correct>Edit</button>
      </div>
    </div>
  `);
  bubble.querySelector("[data-confirm]").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    try {
      await addDoc(collection(db, "adminQueries"), {
        uid: currentUserId,
        shopName: shopProfile.name || shopProfile.shopName || "",
        ownerName: shopProfile.ownerName || auth.currentUser?.displayName || "",
        email: auth.currentUser?.email || "",
        text: message,
        status: "new",
        createdAt: serverTimestamp()
      });
      bubble.classList.add("saved");
      bubble.innerHTML = "<p>Query sent to the Zuno team.</p>";
    } catch (error) {
      console.error("Query submission failed:", error);
      appendAssistant("Could not send the query right now.", "error");
      event.currentTarget.disabled = false;
    }
  });
  bubble.querySelector("[data-correct]").addEventListener("click", () => correctCommand(`Query: ${message}`));
}

async function teachAlias(text) {
  const match = text.match(/^\s*(?:teach|learn)\s+(.+?)\s*(?:=|means|is)\s*(.+?)\s*$/i);
  if (!match) {
    appendAssistant("Teach me like this: Teach alu = Potato.");
    return;
  }
  const alias = normalize(match[1]);
  const requestedProduct = normalize(match[2]);
  const catalog = saleCatalog();
  const product = catalog[requestedProduct] || Object.values(catalog).find(entry => normalize(entry.name) === requestedProduct);
  if (!alias || !product) {
    appendAssistant(`I cannot find "${match[2].trim()}" in your ${shopProfile.foodMenuEnabled === true ? "menu" : "products"} yet.`);
    return;
  }
  learnedAliases[alias] = normalize(product.name);
  await setDoc(userDoc("settings", "chatLearning"), {
    productAliases: learnedAliases,
    updatedAt: serverTimestamp()
  }, { merge: true });
  appendAssistant(`Learned: ${match[1].trim()} means ${product.name}.`, "saved");
}

async function saveChatLearningPatch(patch = {}) {
  const nextProductAliases = { ...learnedAliases, ...(patch.productAliases || {}) };
  const nextPaymentAliases = { ...learnedPaymentAliases, ...(patch.paymentAliases || {}) };
  const nextStatusAliases = { ...learnedStatusAliases, ...(patch.statusAliases || {}) };
  learnedAliases = nextProductAliases;
  learnedPaymentAliases = nextPaymentAliases;
  learnedStatusAliases = nextStatusAliases;
  await setDoc(userDoc("settings", "chatLearning"), {
    productAliases: nextProductAliases,
    paymentAliases: nextPaymentAliases,
    statusAliases: nextStatusAliases,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function detectLearningFromDraft(draft) {
  if (!draft?.aiAssisted) return null;
  const clean = normalize(draft.original || "");
  const productAliases = {};
  const paymentAliases = {};
  const statusAliases = {};
  (draft.items || []).forEach(item => {
    const productKey = normalize(item.product);
    const productWords = productKey.split(/\s+/).filter(Boolean);
    const aliasMatches = [...clean.matchAll(/\b\d+(?:\.\d+)?\s*(?:kg|g|piece)?\s+([a-z][a-z0-9_-]*)/g)]
      .map(match => match[1]);
    aliasMatches.forEach(word => {
      if (
        word.length >= 3
        && !/\d/.test(word)
        && !["add", "sale", "sold", "cash", "cast", "credit", "upi", "delivered", "deliver", "pending"].includes(word)
        && !productWords.includes(word)
        && !BUILTIN_PAYMENT_ALIASES[word]
        && !BUILTIN_STATUS_ALIASES[word]
        && !learnedPaymentAliases[word]
        && !learnedStatusAliases[word]
      ) {
        const canonical = normalize(BUILTIN_PRODUCT_ALIASES[word] || "");
        if (canonical === productKey || (!canonical && item.product && !saleCatalog()[word])) {
          productAliases[word] = productKey;
        }
      }
    });
  });
  Object.entries(BUILTIN_PAYMENT_ALIASES).forEach(([alias, value]) => {
    if (clean.includes(alias) && value === draft.paymentMode && alias !== value) paymentAliases[alias] = value;
  });
  Object.entries(BUILTIN_STATUS_ALIASES).forEach(([alias, value]) => {
    if (clean.includes(alias) && value === draft.deliveryStatus && alias !== value) statusAliases[alias] = value;
  });
  return {
    productAliases: Object.fromEntries(Object.entries(productAliases).filter(([alias, product]) => alias && product)),
    paymentAliases,
    statusAliases
  };
}

function showPendingOrders() {
  openPendingOrders();
}

function getSalePricing(productName) {
  const catalog = saleCatalog();
  const exact = catalog[normalize(productName)];
  if (exact) return exact;
  const matches = findCatalogMatches(BUILTIN_PRODUCT_ALIASES[normalize(productName)] || productName, catalog);
  return matches.length === 1 ? matches[0].product : null;
}

function enrichSaleItem(item) {
  const productData = getSalePricing(item.product);
  let costQty = Number(item.qty || 0);
  if (productData && item.unit === "g" && productData.unit === "kg") costQty /= 1000;
  if (productData && item.unit === "kg" && productData.unit === "g") costQty *= 1000;
  const hasCost = Boolean(productData) && productData.hasCost !== false;
  return {
    ...item,
    product: item.product.toLowerCase(),
    source: productData?.source || "",
    foodCostKey: productData?.foodCostKey || "",
    sellingUnit: normalizeSellingUnit(productData?.sellingUnit || "", item.unit),
    profit: hasCost ? Number(item.price || 0) - Number(productData.cost || 0) * costQty : null,
    hasCost,
    costPrice: hasCost ? Number(productData.cost || 0) : null
  };
}

async function saveSaleDraft(draft, bubble) {
  try {
    const items = draft.items.map(enrichSaleItem);
    const totalAmount = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const totalProfit = items.reduce((sum, item) => sum + (item.hasCost ? Number(item.profit || 0) : 0), 0);
    const orderNumber = await getNextOrderNumber();
    const creditAmount = draft.paymentMode === "credit" ? Math.max(0, totalAmount - draft.amountPaid) : 0;
    const sale = {
      orderNumber,
      date: draft.date,
      customer: draft.customer,
      phone: draft.phone,
      items,
      totalProfit,
      totalAmount,
      paymentMode: draft.paymentMode,
      deliveryStatus: draft.deliveryStatus,
      creditType: draft.paymentMode === "credit" ? draft.creditType : null,
      amountPaid: draft.paymentMode === "credit" ? draft.amountPaid : 0,
      creditAmount,
      originalCreditAmount: draft.paymentMode === "credit" ? totalAmount : 0,
      initialCreditPayment: draft.paymentMode === "credit" ? draft.amountPaid : 0,
      creditApplied: false
    };
    const saleRef = await addDoc(userCol("sales"), sale);
    if (sale.deliveryStatus === "delivered") {
      await deductInventory(items);
      if (sale.paymentMode === "credit" && sale.originalCreditAmount > 0) {
        await handleCreditFromSale({
          userId: currentUserId,
          customer: sale.customer,
          phone: sale.phone,
          creditAmount: sale.creditAmount,
          originalCreditAmount: sale.originalCreditAmount,
          initialPaymentAmount: sale.initialCreditPayment,
          orderNumber: sale.orderNumber,
          date: sale.date
        });
        await updateDoc(saleRef, { creditApplied: true });
      }
    }
    const learningPatch = detectLearningFromDraft(draft);
    if (learningPatch && (
      Object.keys(learningPatch.productAliases).length
      || Object.keys(learningPatch.paymentAliases).length
      || Object.keys(learningPatch.statusAliases).length
    )) {
      await saveChatLearningPatch(learningPatch);
    }
    bubble.classList.add("saved");
    bubble.innerHTML = `<p>Saved ${escapeHtml(orderNumber)} - ${money(totalAmount)}.</p>`;
    showToast("Sale saved.");
  } catch (error) {
    console.error("Chat sale failed:", error);
    appendAssistant("Could not save the sale. Please try again.", "error");
    bubble.querySelector("[data-confirm]")?.removeAttribute("disabled");
  }
}

async function saveInventoryDraft(draft, bubble) {
  try {
    const key = normalize(draft.product);
    const existing = inventoryMap[key];
    if (existing && existing.unit !== draft.unit && !(isWeightUnit(existing.unit) && isWeightUnit(draft.unit))) {
      appendAssistant("This product already uses a different unit type.", "error");
      bubble.querySelector("[data-confirm]")?.removeAttribute("disabled");
      return;
    }
    const storageUnit = chooseStockStorageUnit(existing?.unit, draft.unit);
    const stockQty = convertStockQty(draft.qty, draft.unit, storageUnit);
    const costPerUnit = draft.purchaseCost > 0 ? draft.purchaseCost / stockQty : 0;
    if (existing) {
      const unitChanged = existing.unit !== storageUnit;
      const existingQty = convertStockQty(existing.qty, existing.unit, storageUnit);
      const existingBoughtQty = convertStockQty(existing.totalQtyBought, existing.unit, storageUnit);
      const newTotalQty = existingBoughtQty + stockQty;
      const newTotalCost = existing.totalInvested + draft.purchaseCost;
      const isNewer = draft.date > (existing.lastPurchaseDate || "");
      await updateDoc(userDoc("inventory", existing.id), {
        qty: existingQty + stockQty,
        unit: storageUnit,
        alertThreshold: convertStockQty(existing.alertThreshold, existing.unit, storageUnit),
        weightedAvgCost: newTotalQty > 0 ? newTotalCost / newTotalQty : 0,
        totalInvested: newTotalCost,
        totalQtyBought: newTotalQty,
        ...(draft.sellingPrice > 0 && { sellingPrice: draft.sellingPrice }),
        sellingUnit: normalizeSellingUnit(draft.sellingUnit, storageUnit),
        ...(isNewer && { lastPurchaseDate: draft.date })
      });
      if ((costPerUnit > 0 && (isNewer || unitChanged)) || draft.sellingPrice > 0) {
        await updateProductCost(draft.product, costPerUnit > 0 && (isNewer || unitChanged) ? costPerUnit : null, storageUnit, draft.sellingPrice, draft.sellingUnit);
      }
    } else {
      await addDoc(userCol("inventory"), {
        product: draft.product,
        qty: stockQty,
        unit: storageUnit,
        alertThreshold: 0,
        weightedAvgCost: costPerUnit,
        totalInvested: draft.purchaseCost,
        totalQtyBought: stockQty,
        sellingPrice: draft.sellingPrice,
        sellingUnit: normalizeSellingUnit(draft.sellingUnit, storageUnit),
        firstPurchaseDate: draft.date,
        lastPurchaseDate: draft.date
      });
      if (costPerUnit > 0 || draft.sellingPrice > 0) {
        await updateProductCost(draft.product, costPerUnit > 0 ? costPerUnit : null, storageUnit, draft.sellingPrice, draft.sellingUnit);
      }
    }
    let cashAdjustmentId = "";
    let vendorPaymentId = "";
    if (!draft.vendorName && draft.purchaseCost > 0) {
      const cashRef = await addDoc(userCol("cashAdjustments"), {
        type: "inventory_purchase",
        amount: draft.purchaseCost,
        date: draft.date,
        product: draft.product,
        note: `Inventory purchase: ${draft.product} ${draft.qty} ${draft.unit}`
      });
      cashAdjustmentId = cashRef.id;
    }
    if (draft.vendorName && draft.purchaseCost > 0) {
      const vendorRef = await addDoc(userCol("vendorPayments"), {
        vendorName: draft.vendorName,
        vendorPhone: draft.vendorPhone || "",
        product: draft.product,
        totalCost: draft.purchaseCost,
        amountPaid: draft.vendorAmountPaid,
        remaining: Math.max(0, draft.purchaseCost - draft.vendorAmountPaid),
        date: draft.date,
        status: draft.vendorAmountPaid >= draft.purchaseCost ? "paid" : draft.vendorAmountPaid > 0 ? "partial" : "unpaid"
      });
      vendorPaymentId = vendorRef.id;
    }
    await addDoc(userCol("inventoryHistory"), {
      product: draft.product,
      qty: draft.qty,
      unit: draft.unit,
      date: draft.date,
      type: "in",
      costPerUnit: draft.purchaseCost > 0 ? draft.purchaseCost / draft.qty : 0,
      purchaseCost: draft.purchaseCost,
      sellingPrice: draft.sellingPrice,
      sellingUnit: draft.sellingUnit,
      alertThreshold: draft.alertThreshold,
      vendorName: draft.vendorName,
      vendorPhone: draft.vendorPhone,
      vendorAmountPaid: draft.vendorAmountPaid,
      cashAdjustmentId,
      vendorPaymentId,
      note: "Stock added from chat",
      createdAt: serverTimestamp()
    });
    bubble.classList.add("saved");
    bubble.innerHTML = `<p>Added ${escapeHtml(draft.product)} - ${draft.qty} ${escapeHtml(draft.unit)} to inventory.</p>`;
    showToast("Inventory updated.");
  } catch (error) {
    console.error("Chat inventory failed:", error);
    appendAssistant("Could not update inventory. Please try again.", "error");
    bubble.querySelector("[data-confirm]")?.removeAttribute("disabled");
  }
}

async function updateProductCost(productName, costPerUnit, unit, sellingPrice, sellingUnit) {
  const snap = await getDocs(userCol("products"));
  let existing = null;
  snap.forEach(productDoc => {
    if (normalize(productDoc.data().name) === normalize(productName)) existing = { id: productDoc.id, ...productDoc.data() };
  });
  const update = { unit, sellingUnit: normalizeSellingUnit(sellingUnit, unit) };
  if (costPerUnit !== null && costPerUnit > 0) {
    update.cost = Math.round(costPerUnit * 100) / 100;
    update.costConfigured = true;
  }
  if (sellingPrice > 0) update.sellingPrice = Math.round(sellingPrice * 100) / 100;
  if (existing) {
    await updateDoc(userDoc("products", existing.id), update);
  } else {
    await addDoc(userCol("products"), {
      name: productName,
      cost: update.cost || 0,
      sellingPrice: update.sellingPrice || 0,
      ...update
    });
  }
}

async function syncInventoryProduct(name, cost, sellingPrice, unit, sellingUnit = "") {
  const snap = await getDocs(userCol("inventory"));
  for (const item of snap.docs) {
    const data = item.data();
    if (normalize(data.product) === normalize(name)) {
      await updateDoc(userDoc("inventory", item.id), {
        product: name,
        unit,
        sellingPrice,
        sellingUnit: normalizeSellingUnit(sellingUnit, unit)
      });
      return;
    }
  }
  await addDoc(userCol("inventory"), {
    product: name,
    qty: 0,
    unit,
    alertThreshold: 0,
    weightedAvgCost: cost,
    totalInvested: 0,
    totalQtyBought: 0,
    sellingPrice,
    sellingUnit: normalizeSellingUnit(sellingUnit, unit),
    firstPurchaseDate: "",
    lastPurchaseDate: ""
  });
}

async function getNextOrderNumber() {
  const snap = await getDocs(userCol("sales"));
  const numbers = snap.docs
    .map(saleDoc => Number(String(saleDoc.data().orderNumber || "").replace("ORD-", "")))
    .filter(Number.isFinite);
  return `ORD-${String(numbers.length ? Math.max(...numbers) + 1 : 1).padStart(3, "0")}`;
}

async function deductInventory(items) {
  for (const item of items) {
    if (item.source === "food-menu") continue;
    const snap = await getDocs(userCol("inventory"));
    let existing = null;
    snap.forEach(inventoryDoc => {
      if (normalize(inventoryDoc.data().product) === normalize(item.product)) {
        existing = { id: inventoryDoc.id, ...inventoryDoc.data() };
      }
    });
    if (!existing) continue;
    let qty = Number(item.qty || 0);
    if (item.unit === "g" && existing.unit === "kg") qty /= 1000;
    if (item.unit === "kg" && existing.unit === "g") qty *= 1000;
    await updateDoc(userDoc("inventory", existing.id), { qty: Math.max(0, Number(existing.qty || 0) - qty) });
    await addDoc(userCol("inventoryHistory"), {
      product: item.product,
      qty: item.qty,
      unit: item.unit,
      date: today(),
      type: "out",
      note: "Auto-deducted from sale"
    });
  }
}

async function revertInventory(items) {
  for (const item of items) {
    if (item.source === "food-menu") continue;
    const snap = await getDocs(userCol("inventory"));
    let existing = null;
    snap.forEach(inventoryDoc => {
      if (normalize(inventoryDoc.data().product) === normalize(item.product)) {
        existing = { id: inventoryDoc.id, ...inventoryDoc.data() };
      }
    });
    if (!existing) continue;
    let qty = Number(item.qty || 0);
    if (item.unit === "g" && existing.unit === "kg") qty /= 1000;
    if (item.unit === "kg" && existing.unit === "g") qty *= 1000;
    await updateDoc(userDoc("inventory", existing.id), {
      qty: Number(existing.qty || 0) + qty
    });
    await addDoc(userCol("inventoryHistory"), {
      product: item.product,
      qty,
      unit: existing.unit || item.unit,
      date: today(),
      type: "in",
      note: "Restored from reopened order"
    });
  }
}
