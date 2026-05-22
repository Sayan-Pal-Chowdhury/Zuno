const SELLING_UNIT_DEFS = {
  kg: { label: "kg", stockUnit: "kg", stockQty: 1 },
  "500g": { label: "500g", stockUnit: "kg", stockQty: 0.5 },
  "250g": { label: "250g", stockUnit: "kg", stockQty: 0.25 },
  "100g": { label: "100g", stockUnit: "kg", stockQty: 0.1 },
  g: { label: "gram", stockUnit: "g", stockQty: 1 },
  piece: { label: "piece", stockUnit: "piece", stockQty: 1 }
};

export function normalizeSellingUnit(sellingUnit = "", stockUnit = "kg") {
  if (SELLING_UNIT_DEFS[sellingUnit]) return sellingUnit;
  return stockUnit === "g" ? "g" : stockUnit === "piece" ? "piece" : "kg";
}

export function sellingUnitLabel(sellingUnit = "", stockUnit = "kg") {
  return SELLING_UNIT_DEFS[normalizeSellingUnit(sellingUnit, stockUnit)].label;
}

export function getSellingUnitStockQty(sellingUnit = "", stockUnit = "kg") {
  const normalized = normalizeSellingUnit(sellingUnit, stockUnit);
  const def = SELLING_UNIT_DEFS[normalized];
  if (stockUnit === "kg" && normalized === "g") return 0.001;
  if (stockUnit === "g" && normalized === "kg") return 1000;
  if (stockUnit === "g" && ["100g", "250g", "500g"].includes(normalized)) {
    return Number(normalized.replace("g", ""));
  }
  return def.stockQty;
}

export function getQtyStepForSellingUnit(product = {}) {
  const name = String(product.name || product.product || "").toLowerCase();
  if (["garlic", "ginger", "chilli", "chili", "coriander", "dhaniya", "mint", "pudina"].some(item => name.includes(item))) {
    return product.unit === "g" ? 50 : 0.05;
  }
  return getSellingUnitStockQty(product.sellingUnit, product.unit);
}

export function calculateSellingLineTotal(item = {}) {
  const qty = Number(item.qty || 0);
  const price = Number(item.price || item.sellingPrice || 0);
  const perQty = getSellingUnitStockQty(item.sellingUnit, item.unit);
  if (!qty || !price || !perQty) return 0;
  return (qty / perQty) * price;
}

export function formatDisplayQtyForSellingUnit(value, item = {}) {
  const qty = Number(value || 0);
  const unit = item.unit || "kg";
  if (unit === "kg" && qty > 0 && qty < 1) {
    return `${Math.round(qty * 1000).toLocaleString("en-IN")} g`;
  }
  if (unit === "g") {
    return `${Math.round(qty).toLocaleString("en-IN")} g`;
  }
  return `${Number(qty || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unit}`.trim();
}
