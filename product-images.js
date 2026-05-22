import { getProductVisual } from "./marketplace-visuals.js";

export async function findProductImage(productName = "") {
  return getProductVisual(productName);
}
