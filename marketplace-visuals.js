const CATEGORY_VISUALS = {
  all: { title: "Zuno", a: "#ffda00", b: "#fff5b8", kind: "market" },
  food: { title: "Food", a: "#ff9f43", b: "#ffe7c2", kind: "plate" },
  street_food: { title: "Street", a: "#ff7043", b: "#ffe0d5", kind: "wrap" },
  grocery: { title: "Grocery", a: "#17b978", b: "#d9f7e8", kind: "basket" },
  daily_needs: { title: "Daily", a: "#6aa5ff", b: "#e1efff", kind: "bag" },
  home_services: { title: "Service", a: "#9b7cf6", b: "#eee7ff", kind: "tools" },
  health: { title: "Health", a: "#25c2a0", b: "#dcfff5", kind: "health" },
  beauty: { title: "Beauty", a: "#f07ab3", b: "#ffe3f0", kind: "beauty" },
  repairs: { title: "Repair", a: "#6b7280", b: "#eceff3", kind: "tools" }
};

const PRODUCT_VISUALS = [
  { keys: ["potato", "aloo"], title: "Potato", a: "#d79b55", b: "#fff0c9", kind: "potato" },
  { keys: ["garlic", "lahsun"], title: "Garlic", a: "#eee1c8", b: "#fff8e7", kind: "garlic" },
  { keys: ["ginger", "adrak"], title: "Ginger", a: "#c98b45", b: "#ffe8bd", kind: "ginger" },
  { keys: ["rice", "chawal"], title: "Rice", a: "#f5f1de", b: "#ffffff", kind: "rice" },
  { keys: ["dal", "lentil"], title: "Dal", a: "#f1b13b", b: "#fff0bc", kind: "grain" },
  { keys: ["oil"], title: "Oil", a: "#ffd24a", b: "#fff2b4", kind: "bottle" },
  { keys: ["milk"], title: "Milk", a: "#d8efff", b: "#ffffff", kind: "milk" },
  { keys: ["egg"], title: "Eggs", a: "#f4d6a4", b: "#fff5df", kind: "eggs" },
  { keys: ["onion", "pyaz"], title: "Onion", a: "#c77bd8", b: "#f5ddff", kind: "onion" },
  { keys: ["tomato"], title: "Tomato", a: "#f2554a", b: "#ffd7d2", kind: "tomato" },
  { keys: ["chilli", "chili", "mirchi"], title: "Chilli", a: "#21a965", b: "#d7ffe8", kind: "chilli" },
  { keys: ["bread", "roti", "naan", "paratha", "luchi", "puri"], title: "Bread", a: "#d7904b", b: "#ffe6bd", kind: "bread" },
  { keys: ["roll", "egg roll", "kathi"], title: "Roll", a: "#ffb35c", b: "#ffe7bd", kind: "wrap" },
  { keys: ["chicken"], title: "Chicken", a: "#d96b4a", b: "#ffe2d7", kind: "plate" },
  { keys: ["fish"], title: "Fish", a: "#5fb3e8", b: "#ddf4ff", kind: "fish" },
  { keys: ["paneer"], title: "Paneer", a: "#fff0c2", b: "#fffaf0", kind: "box" },
  { keys: ["biscuit", "cookie"], title: "Biscuit", a: "#c58a45", b: "#ffe8bd", kind: "bread" },
  { keys: ["soap"], title: "Soap", a: "#7dd3fc", b: "#e0f7ff", kind: "box" },
  { keys: ["tea"], title: "Tea", a: "#8b5e34", b: "#ead4b5", kind: "cup" },
  { keys: ["coffee"], title: "Coffee", a: "#6f4e37", b: "#ead7c5", kind: "cup" }
];

export function getCategoryVisual(categoryId = "all") {
  const visual = CATEGORY_VISUALS[categoryId] || CATEGORY_VISUALS.all;
  return makeVisual(visual);
}

export function getProductVisual(productName = "", fallbackKind = "bag") {
  const lower = productName.toLowerCase();
  const visual = PRODUCT_VISUALS.find(item => item.keys.some(key => lower.includes(key)));
  return makeVisual(visual || { title: productName || "Item", a: "#ffda00", b: "#fff2a8", kind: fallbackKind });
}

export function shouldReplaceAutoImage(url = "") {
  return String(url).startsWith("data:image/svg+xml") || /wikimedia|wikipedia|commons\.|thumbnail/i.test(String(url));
}

function makeVisual({ title, a, b, kind }) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(renderSvg(title, a, b, kind))}`;
}

function renderSvg(title, a, b, kind) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 520">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${a}"/>
          <stop offset="1" stop-color="${b}"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#211b12" flood-opacity=".18"/>
        </filter>
      </defs>
      <rect width="700" height="520" rx="44" fill="url(#bg)"/>
      <circle cx="600" cy="82" r="92" fill="#fff" opacity=".22"/>
      <circle cx="98" cy="458" r="128" fill="#fff" opacity=".18"/>
      ${shape(kind)}
      <text x="48" y="455" font-family="Arial, sans-serif" font-size="54" font-weight="800" fill="#191713" opacity=".82">${escapeSvg(title).slice(0, 18)}</text>
    </svg>
  `;
}

function shape(kind) {
  const shapes = {
    potato: `<g filter="url(#shadow)"><ellipse cx="348" cy="222" rx="154" ry="105" fill="#b7773c"/><circle cx="300" cy="198" r="10" fill="#7b4a22"/><circle cx="388" cy="238" r="8" fill="#7b4a22"/><circle cx="428" cy="190" r="7" fill="#7b4a22"/></g>`,
    garlic: `<g filter="url(#shadow)" fill="#fff8e8" stroke="#d6c29b" stroke-width="10"><path d="M250 270c-28-78 4-150 72-170 28 34 38 108-5 190z"/><path d="M330 286c-22-92 8-162 72-184 34 42 48 120 0 190z"/><path d="M405 270c-20-72 4-132 58-150 30 38 38 98 2 158z"/></g>`,
    ginger: `<g filter="url(#shadow)" fill="#c58a45"><path d="M208 260c42-88 126-92 168-55 58-28 112 0 118 48 52 8 72 58 38 92-46 46-146 18-196 36-74 28-156-30-128-121z"/></g>`,
    rice: `<g filter="url(#shadow)" fill="#fffdf0"><ellipse cx="350" cy="260" rx="190" ry="88"/><ellipse cx="260" cy="238" rx="35" ry="12" transform="rotate(-20 260 238)"/><ellipse cx="340" cy="220" rx="35" ry="12" transform="rotate(18 340 220)"/><ellipse cx="440" cy="254" rx="35" ry="12" transform="rotate(-8 440 254)"/></g>`,
    grain: `<g filter="url(#shadow)" fill="#f0b739"><circle cx="270" cy="250" r="42"/><circle cx="350" cy="222" r="48"/><circle cx="430" cy="260" r="42"/><circle cx="340" cy="306" r="44"/></g>`,
    bottle: `<g filter="url(#shadow)"><rect x="300" y="138" width="100" height="250" rx="34" fill="#f6c343"/><rect x="316" y="92" width="68" height="70" rx="18" fill="#725a1f"/><rect x="318" y="212" width="64" height="90" rx="16" fill="#fff3b0" opacity=".7"/></g>`,
    milk: `<g filter="url(#shadow)"><path d="M270 144h160l-20 70v174H290V214z" fill="#fff"/><path d="M290 214h120" stroke="#8ecaf2" stroke-width="18"/><path d="M270 144l38-48h84l38 48" fill="#d8efff"/></g>`,
    eggs: `<g filter="url(#shadow)" fill="#fff4dc"><ellipse cx="288" cy="260" rx="58" ry="80"/><ellipse cx="390" cy="260" rx="58" ry="80"/><path d="M220 326h240l-28 54H248z" fill="#d7a45d"/></g>`,
    onion: `<g filter="url(#shadow)"><circle cx="350" cy="260" r="120" fill="#9f55b7"/><path d="M350 116c42 28 54 68 38 106" stroke="#f4d5ff" stroke-width="16" fill="none"/><path d="M350 116c-42 28-54 68-38 106" stroke="#f4d5ff" stroke-width="16" fill="none"/></g>`,
    tomato: `<g filter="url(#shadow)"><circle cx="350" cy="260" r="122" fill="#e53935"/><path d="M350 134l26 56 60-16-44 44 44 38-62-8-24 58-24-58-62 8 44-38-44-44 60 16z" fill="#1c9b52"/></g>`,
    chilli: `<g filter="url(#shadow)"><path d="M238 300c126-8 190-70 224-172 34 52 8 150-74 202-64 42-126 38-150-30z" fill="#1da65a"/><path d="M458 128c22-24 44-28 66-14" stroke="#725a1f" stroke-width="16" fill="none"/></g>`,
    bread: `<g filter="url(#shadow)"><rect x="220" y="190" width="260" height="160" rx="38" fill="#d4914c"/><path d="M240 198c28-70 192-70 220 0" fill="#eab36c"/></g>`,
    fish: `<g filter="url(#shadow)"><path d="M220 260c78-82 196-82 274 0-78 82-196 82-274 0z" fill="#4aa3df"/><path d="m494 260 62-54v108z" fill="#2f7fb4"/><circle cx="292" cy="248" r="12" fill="#191713"/></g>`,
    cup: `<g filter="url(#shadow)"><rect x="250" y="190" width="190" height="150" rx="34" fill="#fff"/><path d="M438 220h42c34 0 34 82 0 82h-42" fill="none" stroke="#fff" stroke-width="26"/><ellipse cx="345" cy="190" rx="96" ry="28" fill="#6f4e37"/></g>`,
    plate: `<g filter="url(#shadow)"><ellipse cx="350" cy="274" rx="190" ry="100" fill="#fff"/><circle cx="310" cy="250" r="48" fill="#ff7043"/><circle cx="380" cy="246" r="42" fill="#f0b739"/><path d="M270 300h180" stroke="#17b978" stroke-width="18" stroke-linecap="round"/></g>`,
    wrap: `<g filter="url(#shadow)"><path d="M230 330 370 120l122 210z" fill="#f0c66d"/><path d="M306 232h138" stroke="#d24c35" stroke-width="18" stroke-linecap="round"/><path d="M286 270h170" stroke="#17b978" stroke-width="18" stroke-linecap="round"/></g>`,
    basket: `<g filter="url(#shadow)"><path d="M220 238h260l-32 126H252z" fill="#b7773c"/><path d="M280 238c0-80 140-80 140 0" fill="none" stroke="#7b4a22" stroke-width="20"/><circle cx="302" cy="236" r="34" fill="#e53935"/><circle cx="370" cy="228" r="36" fill="#f0b739"/><circle cx="430" cy="244" r="30" fill="#17b978"/></g>`,
    tools: `<g filter="url(#shadow)" stroke="#191713" stroke-width="28" stroke-linecap="round"><path d="M252 338 430 160"/><path d="m390 132 70 70"/><path d="M252 160l196 196"/></g>`,
    health: `<g filter="url(#shadow)"><rect x="248" y="150" width="204" height="204" rx="42" fill="#fff"/><path d="M350 202v100M300 252h100" stroke="#25c2a0" stroke-width="34" stroke-linecap="round"/></g>`,
    beauty: `<g filter="url(#shadow)"><circle cx="330" cy="238" r="84" fill="#fff0f6"/><path d="M260 326c62-34 124-34 186 0" stroke="#d9488f" stroke-width="22" stroke-linecap="round"/><path d="M412 140l58 58" stroke="#191713" stroke-width="18" stroke-linecap="round"/></g>`,
    bag: `<g filter="url(#shadow)"><rect x="238" y="190" width="224" height="180" rx="44" fill="#fff"/><path d="M292 190c0-70 116-70 116 0" fill="none" stroke="#191713" stroke-width="18"/></g>`,
    market: `<g filter="url(#shadow)"><rect x="218" y="176" width="264" height="190" rx="32" fill="#fff"/><path d="M218 214h264" stroke="#191713" stroke-width="20"/><path d="M252 176l26-56h144l60 56" fill="#ff7043"/></g>`,
    box: `<g filter="url(#shadow)"><rect x="250" y="170" width="200" height="190" rx="28" fill="#fff"/><path d="M250 230h200" stroke="#7dd3fc" stroke-width="20"/></g>`
  };
  return shapes[kind] || shapes.bag;
}

function escapeSvg(value = "") {
  return String(value).replace(/[&<>]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;"
  }[char]));
}
