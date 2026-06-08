export const COMMON_ITEM_NAMES = [
  "Potato",
  "Onion",
  "Tomato",
  "Garlic",
  "Ginger",
  "Green Chilli",
  "Coriander",
  "Rice",
  "Dal",
  "Atta",
  "Maida",
  "Sugar",
  "Salt",
  "Mustard Oil",
  "Sunflower Oil",
  "Milk",
  "Curd",
  "Paneer",
  "Egg",
  "Bread",
  "Biscuit",
  "Tea",
  "Coffee",
  "Soap",
  "Chicken",
  "Fish",
  "Egg Roll",
  "Chowmein",
  "Momo"
];

export function mergeSuggestions(...lists) {
  const seen = new Set();
  const merged = [];
  lists.flat().forEach(name => {
    const clean = String(name || "").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    merged.push(clean);
  });
  return merged.sort((a, b) => a.localeCompare(b));
}

export function renderOptions(items) {
  return items.map(item => `<option value="${escapeHtml(item)}"></option>`).join("");
}

export function attachSuggestionDropdown(input, getSuggestions, onPick = null) {
  if (!input || input.dataset.zunoSuggestBound) return;
  input.dataset.zunoSuggestBound = "1";
  const box = document.createElement("div");
  box.className = "zuno-suggestion-box";
  box.hidden = true;
  document.body.appendChild(box);
  let renderedSuggestions = [];

  const close = () => { box.hidden = true; };
  const position = () => {
    if (box.hidden) return;
    const rect = input.getBoundingClientRect();
    const viewport = window.visualViewport || null;
    const viewportTop = viewport ? viewport.offsetTop : 0;
    const viewportLeft = viewport ? viewport.offsetLeft : 0;
    const viewportHeight = viewport ? viewport.height : window.innerHeight;
    const viewportWidth = viewport ? viewport.width : window.innerWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const margin = 12;
    const gap = 6;
    const maxWidth = viewportWidth - margin * 2;
    const width = Math.min(Math.max(rect.width || 280, 180), maxWidth);
    const left = Math.min(Math.max(viewportLeft + margin, rect.left), viewportRight - width - margin);
    const spaceBelow = Math.max(0, viewportBottom - rect.bottom - margin);
    const spaceAbove = Math.max(0, rect.top - viewportTop - margin);
    const preferredHeight = Math.min(220, Math.max(92, box.scrollHeight || 160));
    const openAbove = spaceBelow < 72 && spaceAbove > spaceBelow;
    const available = Math.max(44, (openAbove ? spaceAbove : spaceBelow) - gap);
    const maxHeight = Math.min(preferredHeight, available);
    const top = openAbove
      ? Math.max(viewportTop + margin, rect.top - gap - maxHeight)
      : rect.bottom + gap;

    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${width}px`;
    box.style.maxHeight = `${maxHeight}px`;
  };
  const render = () => {
    const term = input.value.trim().toLowerCase();
    renderedSuggestions = (typeof getSuggestions === "function" ? getSuggestions() : getSuggestions || [])
      .map(normalizeSuggestion)
      .filter(Boolean)
      .filter(item => !term || item.searchText.includes(term))
      .slice(0, 6);

    if (renderedSuggestions.length === 0 || !term) {
      close();
      return;
    }

    box.innerHTML = renderedSuggestions.map((item, index) => `
      <button type="button" data-index="${index}" data-value="${escapeHtml(item.value)}" data-label="${escapeHtml(item.label)}">
        ${escapeHtml(item.label)}
      </button>
    `).join("");
    box.hidden = false;
    position();
    box.querySelectorAll("button").forEach(button => {
      button.addEventListener("pointerdown", event => {
        event.preventDefault();
        event.stopPropagation();
        const item = renderedSuggestions[Number(button.dataset.index)] || null;
        const value = button.dataset.value || button.dataset.label || button.textContent;
        const label = button.dataset.label || button.textContent;
        input.value = value;
        close();
        if (onPick) onPick(value, label, item);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  window.addEventListener("scroll", position, true);
  window.addEventListener("resize", position);
  window.visualViewport?.addEventListener("scroll", position);
  window.visualViewport?.addEventListener("resize", position);
  input.addEventListener("blur", () => setTimeout(close, 150));
}

function normalizeSuggestion(item) {
  if (!item) return null;
  if (typeof item === "object") {
    const label = String(item.label || item.value || "").trim();
    const value = String(item.value || item.label || "").trim();
    const searchText = String(item.searchText || `${label} ${value}`).toLowerCase();
    return label && value ? { ...item, label, value, searchText } : null;
  }
  const value = String(item || "").trim();
  return value ? { label: value, value, searchText: value.toLowerCase() } : null;
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
