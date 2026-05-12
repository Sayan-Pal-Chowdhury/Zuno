import { initShopTopbar } from "./shop-topbar.js";
import { listPublicShops } from "./shop-store.js";

let allShops = [];

initShopTopbar(null);
loadShops();

async function loadShops() {
  const grid = document.getElementById("shopsGrid");
  try {
    allShops = await listPublicShops();
    renderShops(allShops);
  } catch (error) {
    console.error("Shop list failed:", error);
    grid.innerHTML = `<div class="empty-state">Could not load shops.</div>`;
  }
}

function renderShops(shops) {
  const grid = document.getElementById("shopsGrid");
  document.getElementById("shopCount").textContent = `${shops.length} shops`;

  if (shops.length === 0) {
    grid.innerHTML = `<div class="empty-state">No shops are live yet.</div>`;
    return;
  }

  grid.innerHTML = shops.map(shop => {
    const initials = (shop.name || "Shop").trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
    return `
      <a class="shop-card" href="shop.html?store=${shop.storeId}">
        <span class="shop-logo" style="margin-bottom:12px">${initials || "S"}</span>
        <h3>${shop.name}</h3>
        <p class="muted">${shop.location || "Open now"}</p>
        <p class="muted">${shop.tagline || "Fresh products, fair prices"}</p>
      </a>
    `;
  }).join("");
}

window.filterShops = function() {
  const search = document.getElementById("shopSearch").value.toLowerCase().trim();
  renderShops(allShops.filter(shop => {
    return !search || `${shop.name} ${shop.location}`.toLowerCase().includes(search);
  }));
};
