export const CUSTOMER_CATEGORIES = [
  {
    id: "all",
    label: "All",
    shortLabel: "All",
    imageQuery: "local marketplace",
    icon: "Z",
    colors: ["#ffda00", "#fff2a8"]
  },
  {
    id: "food",
    label: "Food",
    shortLabel: "Food",
    imageQuery: "restaurant food",
    icon: "FD",
    colors: ["#ffb35c", "#ffe7bd"]
  },
  {
    id: "street_food",
    label: "Street Food",
    shortLabel: "Street",
    imageQuery: "street food",
    icon: "SF",
    colors: ["#ff7043", "#ffe0d5"]
  },
  {
    id: "grocery",
    label: "Grocery",
    shortLabel: "Grocery",
    imageQuery: "grocery products",
    icon: "GR",
    colors: ["#17b978", "#d9f7e8"]
  },
  {
    id: "daily_needs",
    label: "Daily Needs",
    shortLabel: "Daily",
    imageQuery: "daily essentials",
    icon: "DN",
    colors: ["#6aa5ff", "#e1efff"]
  },
  {
    id: "home_services",
    label: "Home Services",
    shortLabel: "Services",
    imageQuery: "home service repair",
    icon: "HS",
    colors: ["#9b7cf6", "#eee7ff"]
  },
  {
    id: "health",
    label: "Health",
    shortLabel: "Health",
    imageQuery: "pharmacy health",
    icon: "RX",
    colors: ["#25c2a0", "#dcfff5"]
  },
  {
    id: "beauty",
    label: "Beauty",
    shortLabel: "Beauty",
    imageQuery: "salon beauty",
    icon: "BT",
    colors: ["#f07ab3", "#ffe3f0"]
  },
  {
    id: "repairs",
    label: "Repairs",
    shortLabel: "Repairs",
    imageQuery: "repair tools",
    icon: "RP",
    colors: ["#6b7280", "#eceff3"]
  }
];

export const BUSINESS_TYPES = [
  { id: "kirana", label: "Kirana Store", category: "grocery", mode: "delivery" },
  { id: "grocery", label: "Grocery Shop", category: "grocery", mode: "delivery" },
  { id: "vegetables", label: "Vegetable Shop", category: "daily_needs", mode: "delivery" },
  { id: "dairy", label: "Dairy", category: "daily_needs", mode: "delivery" },
  { id: "restaurant", label: "Restaurant", category: "food", mode: "delivery" },
  { id: "street_food", label: "Street Food", category: "street_food", mode: "pickup" },
  { id: "rolls_fast_food", label: "Rolls / Fast Food", category: "street_food", mode: "pickup" },
  { id: "home_food", label: "Home Food", category: "food", mode: "delivery" },
  { id: "bakery", label: "Bakery", category: "food", mode: "delivery" },
  { id: "sweets_snacks", label: "Sweets & Snacks", category: "food", mode: "delivery" },
  { id: "meat_fish", label: "Meat / Fish", category: "daily_needs", mode: "delivery" },
  { id: "pharmacy", label: "Pharmacy", category: "health", mode: "delivery" },
  { id: "salon_beauty", label: "Salon / Beauty", category: "beauty", mode: "home_service" },
  { id: "home_service", label: "Home Service", category: "home_services", mode: "home_service" },
  { id: "electrician", label: "Electrician", category: "repairs", mode: "home_service" },
  { id: "plumber", label: "Plumber", category: "repairs", mode: "home_service" },
  { id: "appliance_repair", label: "Appliance Repair", category: "repairs", mode: "home_service" },
  { id: "laundry", label: "Laundry", category: "home_services", mode: "pickup" },
  { id: "tailor", label: "Tailor", category: "home_services", mode: "pickup" },
  { id: "stationery", label: "Stationery", category: "daily_needs", mode: "delivery" },
  { id: "hardware", label: "Hardware", category: "repairs", mode: "delivery" },
  { id: "general", label: "General Store", category: "daily_needs", mode: "delivery" },
  { id: "other", label: "Other Local Business", category: "daily_needs", mode: "delivery" }
];

export function getBusinessType(id = "other") {
  return BUSINESS_TYPES.find(type => type.id === id) || BUSINESS_TYPES.find(type => type.id === "other");
}

export function getCustomerCategory(id = "daily_needs") {
  return CUSTOMER_CATEGORIES.find(category => category.id === id) || CUSTOMER_CATEGORIES[0];
}

export function getCategoryForBusinessType(id = "other") {
  return getBusinessType(id).category;
}

export function getBusinessTypesForCategory(categoryId = "all") {
  if (categoryId === "all") return BUSINESS_TYPES;
  return BUSINESS_TYPES.filter(type => type.category === categoryId);
}
