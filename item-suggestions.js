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
    const margin = 12;
    const gap = 6;
    const width = Math.min(Math.max(rect.width || 280, 180), window.innerWidth - margin * 2);
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const preferredHeight = Math.min(260, Math.max(120, box.scrollHeight || 180));
    const openAbove = spaceBelow < 120 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(96, Math.min(preferredHeight, openAbove ? spaceAbove - gap : spaceBelow - gap));
    const top = openAbove
      ? Math.max(margin, rect.top - gap - maxHeight)
      : Math.min(rect.bottom + gap, window.innerHeight - margin - maxHeight);

    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${width}px`;
    box.style.maxHeight = `${maxHeight}px`;
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

    box.innerHTML = suggestions.map(item => `
      <button type="button" data-value="${escapeHtml(item.value)}" data-label="${escapeHtml(item.label)}">
        ${escapeHtml(item.label)}
      </button>
    `).join("");
    box.hidden = false;
    position();
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
