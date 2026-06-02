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
  input.insertAdjacentElement("afterend", box);

  const close = () => { box.hidden = true; };
  const position = () => {
    const rect = input.getBoundingClientRect();
    box.style.left = `${Math.max(12, rect.left)}px`;
    box.style.top = `${Math.min(window.innerHeight - 80, rect.bottom + 6)}px`;
    box.style.width = `${Math.min(rect.width || 280, window.innerWidth - 24)}px`;
  };
  const render = () => {
    const term = input.value.trim().toLowerCase();
    const suggestions = (typeof getSuggestions === "function" ? getSuggestions() : getSuggestions || [])
      .map(normalizeSuggestion)
      .filter(Boolean)
      .filter(item => !term || item.searchText.includes(term))
      .slice(0, 6);

    if (suggestions.length === 0 || !term) {
      close();
      return;
    }

    position();
    box.innerHTML = suggestions.map(item => `
      <button type="button" data-value="${escapeHtml(item.value)}" data-label="${escapeHtml(item.label)}">
        ${escapeHtml(item.label)}
      </button>
    `).join("");
    box.hidden = false;
    box.querySelectorAll("button").forEach(button => {
      button.addEventListener("pointerdown", event => {
        event.preventDefault();
        const value = button.dataset.value || button.dataset.label || button.textContent;
        const label = button.dataset.label || button.textContent;
        input.value = value;
        close();
        if (onPick) onPick(value, label);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  window.addEventListener("scroll", position, true);
  window.addEventListener("resize", position);
  input.addEventListener("blur", () => setTimeout(close, 150));
}

function normalizeSuggestion(item) {
  if (!item) return null;
  if (typeof item === "object") {
    const label = String(item.label || item.value || "").trim();
    const value = String(item.value || item.label || "").trim();
    const searchText = String(item.searchText || `${label} ${value}`).toLowerCase();
    return label && value ? { label, value, searchText } : null;
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
