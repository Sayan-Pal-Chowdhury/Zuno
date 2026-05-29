if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    const localDevelopment = ["127.0.0.1", "localhost"].includes(window.location.hostname);
    if (localDevelopment) {
      const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
      await Promise.all(registrations.map(registration => registration.unregister()));
      const cacheNames = await caches.keys().catch(() => []);
      await Promise.all(cacheNames
        .filter(cacheName => cacheName.startsWith("zuno-pwa-"))
        .map(cacheName => caches.delete(cacheName)));
      return;
    }
    navigator.serviceWorker.register("/service-worker.js", { updateViaCache: "none" }).catch((error) => {
      console.warn("Zuno service worker registration failed:", error);
    });
  });
}

showZunoBootSplash();

let zunoInstallPromptEvent = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  zunoInstallPromptEvent = event;
  showInstallPromptIfNeeded();
});

window.addEventListener("appinstalled", () => {
  zunoInstallPromptEvent = null;
  sessionStorage.setItem("zunoInstallPromptSeen", "installed");
  document.getElementById("zunoInstallPrompt")?.remove();
});

document.addEventListener("DOMContentLoaded", () => {
  if (isIosSafari()) showInstallPromptIfNeeded();
});

function showInstallPromptIfNeeded() {
  if (isStandaloneApp()) return;
  if (sessionStorage.getItem("zunoInstallPromptSeen")) return;
  if (document.getElementById("zunoInstallPrompt")) return;
  if (!isIosSafari() && !zunoInstallPromptEvent) return;

  sessionStorage.setItem("zunoInstallPromptSeen", "shown");
  injectInstallStyles();
  const canPromptInstall = !!zunoInstallPromptEvent;

  const prompt = document.createElement("div");
  prompt.id = "zunoInstallPrompt";
  prompt.className = "zuno-install-prompt";
  prompt.innerHTML = `
    <div class="zuno-install-card">
      <img src="/zuno-logo.png" alt="">
      <div class="zuno-install-copy">
        <strong>Add Zuno to Home Screen</strong>
        <span>${canPromptInstall ? "Open faster like a normal app." : "Tap Share, then Add to Home Screen."}</span>
      </div>
      <button class="zuno-install-primary" id="zunoInstallBtn" type="button">${canPromptInstall ? "Add" : "How"}</button>
      <button class="zuno-install-close" id="zunoInstallClose" type="button" aria-label="Continue in browser">×</button>
    </div>
  `;

  document.body.appendChild(prompt);

  document.getElementById("zunoInstallBtn")?.addEventListener("click", async () => {
    if (!zunoInstallPromptEvent) {
      prompt.classList.add("show-instructions");
      prompt.querySelector(".zuno-install-copy span").textContent = isIosSafari()
        ? "Tap the Share button in Safari, then choose Add to Home Screen."
        : "Use your browser menu and choose Install app or Add to Home Screen.";
      return;
    }

    zunoInstallPromptEvent.prompt();
    await zunoInstallPromptEvent.userChoice.catch(() => null);
    zunoInstallPromptEvent = null;
    prompt.remove();
  });

  document.getElementById("zunoInstallClose")?.addEventListener("click", () => {
    prompt.remove();
  });
}

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

function isIosSafari() {
  const ua = window.navigator.userAgent || "";
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  return isIos && isSafari;
}

function injectInstallStyles() {
  if (document.getElementById("zunoInstallStyles")) return;

  const style = document.createElement("style");
  style.id = "zunoInstallStyles";
  style.textContent = `
    .zuno-install-prompt {
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: calc(14px + env(safe-area-inset-bottom));
      z-index: 5000;
      display: grid;
      place-items: center;
      pointer-events: none;
    }

    .zuno-install-card {
      width: min(100%, 520px);
      min-height: 74px;
      display: grid;
      grid-template-columns: 48px 1fr auto 34px;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border: 1px solid rgba(25, 23, 19, 0.12);
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.96);
      color: #191713;
      box-shadow: 0 22px 60px rgba(25, 23, 19, 0.18);
      pointer-events: auto;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .zuno-install-card img {
      width: 48px;
      height: 48px;
      border-radius: 15px;
      background: #ffda00;
    }

    .zuno-install-copy {
      min-width: 0;
      display: grid;
      gap: 2px;
    }

    .zuno-install-copy strong {
      font-size: 15px;
      font-weight: 900;
      line-height: 1.15;
    }

    .zuno-install-copy span {
      color: #81786c;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.35;
    }

    .zuno-install-primary,
    .zuno-install-close {
      border: 0;
      cursor: pointer;
      font: inherit;
      font-weight: 900;
    }

    .zuno-install-primary {
      min-height: 40px;
      padding: 0 16px;
      border-radius: 14px;
      background: #17b978;
      color: #fff;
    }

    .zuno-install-close {
      width: 34px;
      height: 34px;
      border-radius: 12px;
      background: #f3f0e9;
      color: #191713;
      font-size: 22px;
      line-height: 1;
    }

    @media (max-width: 430px) {
      .zuno-install-card {
        grid-template-columns: 42px 1fr 34px;
      }

      .zuno-install-card img {
        width: 42px;
        height: 42px;
      }

      .zuno-install-primary {
        grid-column: 1 / -1;
        width: 100%;
      }
    }
  `;
  document.head.appendChild(style);
}

function showZunoBootSplash() {
  if (document.getElementById("zunoBootSplash")) return;
  if (sessionStorage.getItem("zunoBootSplashSeen")) return;
  sessionStorage.setItem("zunoBootSplashSeen", "shown");

  const style = document.createElement("style");
  style.id = "zunoBootSplashStyles";
  style.textContent = `
    #zunoBootSplash {
      position: fixed;
      inset: 0;
      z-index: 9000;
      display: grid;
      place-items: center;
      background: #ffda00;
      overflow: hidden;
      transition: opacity .42s ease, visibility .42s ease;
    }
    #zunoBootSplash.hide {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
    .zuno-boot-mark {
      display: grid;
      place-items: center;
      gap: 16px;
      color: #191713;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 900;
      text-align: center;
      animation: zunoBootMarkIn .62s ease both;
    }
    .zuno-boot-logo {
      width: 104px;
      height: 104px;
      border-radius: 30px;
      background: #fff;
      display: grid;
      place-items: center;
      box-shadow: 0 22px 60px rgba(25,23,19,.18);
      animation: zunoBootPulse 1.1s ease-in-out infinite alternate;
    }
    .zuno-boot-logo img { width: 84px; height: 84px; object-fit: contain; }
    .zuno-boot-name { font-size: 30px; line-height: 1; letter-spacing: 0; }
    .zuno-boot-copy {
      max-width: min(310px, calc(100vw - 42px));
      color: rgba(25,23,19,.78);
      font-size: 15px;
      line-height: 1.35;
      font-weight: 800;
      letter-spacing: 0;
      opacity: 0;
      transform: translateY(12px);
      animation: zunoBootCopyIn .58s .58s ease forwards;
    }
    @keyframes zunoBootMarkIn {
      from { opacity: 0; transform: translateY(18px) scale(.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes zunoBootPulse {
      from { transform: scale(.96); }
      to { transform: scale(1.04); }
    }
    @keyframes zunoBootCopyIn {
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);

  const splash = document.createElement("div");
  splash.id = "zunoBootSplash";
  splash.innerHTML = `
    <div class="zuno-boot-mark">
      <div class="zuno-boot-logo"><img src="/zuno-logo.png" alt=""></div>
      <div class="zuno-boot-name">ZUNO</div>
      <div class="zuno-boot-copy">Order from your favourite shops.</div>
    </div>
  `;
  document.documentElement.appendChild(splash);

  const hide = () => {
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 520);
  };
  window.addEventListener("load", () => setTimeout(hide, 1450), { once: true });
  setTimeout(hide, 3200);
}
