import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot,
  deleteDoc, doc, updateDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "sale-data-8d963.firebaseapp.com",
  projectId: "sale-data-8d963",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let productCosts = {};
let productList = [];
let editId = null;
let productEditId = null; // ✅ NEW
let allSales = [];
let chart = null;
function populateMonthFilter(data) {
  const select = document.getElementById("monthFilter");

  let months = new Set();

  data.forEach(s => {
    if (s.date) {
      const month = s.date.substring(0, 7); // YYYY-MM
      months.add(month);
    }
  });

  select.innerHTML = `<option value="all">All</option>` +
    [...months].map(m => `<option value="${m}">${m}</option>`).join("");
}

/* ---------- ITEM ROW ---------- */
function createItemRow(isFirst = false, data = {}) {
  const row = document.createElement("div");
  row.className = "itemRow";

row.innerHTML = `
  <input class="product" list="productsList" placeholder="Item" value="${data.product || ""}">
  <input type="number" class="qty" placeholder="Qty" value="${data.qty || ""}">

  <select class="unit">
    <option value="kg" ${data.unit === "kg" ? "selected" : ""}>kg</option>
    <option value="g" ${data.unit === "g" ? "selected" : ""}>gram</option>
    <option value="piece" ${data.unit === "piece" ? "selected" : ""}>piece</option>
  </select>

  <input type="number" class="sellingPrice" placeholder="Price/unit">
  <input type="number" class="price" placeholder="Total Amount" value="${data.price || ""}">

  ${!isFirst ? `<button class="removeBtn">X</button>` : ""}
`;

  // ✅ live total trigger
  const priceInput = row.querySelector(".price");
  if (priceInput) {
    priceInput.addEventListener("input", calculateLiveTotal);
  }

  const qtyInput = row.querySelector(".qty");
const sellInput = row.querySelector(".sellingPrice");
const totalInput = row.querySelector(".price");

function updateFromSelling() {
  const qty = Number(qtyInput.value) || 0;
  const sp = Number(sellInput.value) || 0;

  if (qty && sp) {
    totalInput.value = qty * sp;
    calculateLiveTotal();
  }
}

qtyInput.addEventListener("input", updateFromSelling);
sellInput.addEventListener("input", updateFromSelling);

  // ✅ remove button
  if (!isFirst) {
    row.querySelector(".removeBtn").onclick = () => {
      row.remove();
      calculateLiveTotal();
    };
  }

  return row;
}

/* ---------- INIT ITEMS ---------- */
const container = document.getElementById("itemsContainer");

container.appendChild(createItemRow(true));

document.getElementById("addItemBtn").onclick = () => {
  container.appendChild(createItemRow(false));
};
/* ---------- SAVE SALE ---------- */
document.getElementById("mainBtn").onclick = async () => {

  const date = document.getElementById("date").value;
  const customer = document.getElementById("customerName").value;

  const rows = document.querySelectorAll(".itemRow");

  let items = [];
  let totalProfit = 0;
  let totalAmount = 0;

  rows.forEach(r => {
    const product = r.querySelector(".product").value.toLowerCase();
    const qty = Number(r.querySelector(".qty").value);
    const price = Number(r.querySelector(".price").value);
    const unit = r.querySelector(".unit").value;

    if (product && qty && price) {

     const productData = productCosts[product];

let cost = 0;
let baseUnit = "kg";

if (productData) {
  cost = productData.cost;
  baseUnit = productData.unit;
}

let finalQty = qty;

// 🔥 UNIT CONVERSION
if (unit === "g" && baseUnit === "kg") {
  finalQty = qty / 1000;
}

if (unit === "kg" && baseUnit === "g") {
  finalQty = qty * 1000;
}

// 🔥 TOTAL = user entered
const itemTotal = price;

// 🔥 COST FOR THIS SALE
const costTotal = cost * finalQty;

// 🔥 PROFIT
const profit = itemTotal - costTotal;

      items.push({ product, qty, unit, price, profit });

      totalAmount += itemTotal;
      totalProfit += profit;
    }
  });

  if (!date || items.length === 0) return alert("Fill data");

  const data = { date, customer, items, totalProfit, totalAmount };

  if (editId) {
    await updateDoc(doc(db, "sales", editId), data);
    editId = null;
  } else {
    await addDoc(collection(db, "sales"), data);
  }

  resetForm();
};

/* ---------- RESET ---------- */
function resetForm() {
  document.getElementById("date").value = "";
  document.getElementById("customerName").value = "";
  container.innerHTML = "";
  container.appendChild(createItemRow(true));
  document.getElementById("liveTotal").innerText = 0;
  document.getElementById("phone").value = "";
}

/* ---------- PRODUCTS ---------- */
onSnapshot(collection(db, "products"), snap => {

  const table = document.getElementById("productTable");
  table.innerHTML = "";

  productCosts = {};
  productList = [];

  snap.forEach(d => {
    const p = d.data();

    productCosts[p.name.toLowerCase()] = {
  cost: Number(p.cost),
  unit: p.unit || "kg"
};
    productList.push(p.name);

    table.innerHTML += `
      <tr>
        <td>${p.name}</td>
<td>${p.cost} / ${p.unit || "kg"}</td>
        <td>
          <button onclick="editProduct('${d.id}', '${p.name}', '${p.cost}', '${p.unit}')">Edit</button>
          <button onclick="deleteProduct('${d.id}')">Delete</button>
        </td>
      </tr>
    `;
  });

  // dropdown
  document.getElementById("productsList")?.remove();
  const dl = document.createElement("datalist");
  dl.id = "productsList";
  dl.innerHTML = productList.map(p => `<option value="${p}">`).join("");
  document.body.appendChild(dl);
});

/* ---------- PRODUCT ADD / UPDATE ---------- */
window.addOrUpdateProduct = async () => {

  const name = document.getElementById("prodName").value;
  const cost = document.getElementById("prodCost").value;
  const unit = document.getElementById("prodUnit").value; // ✅ NEW

  if (!name || !cost) return;

  if (productEditId) {
    await updateDoc(doc(db, "products", productEditId), {
      name,
      cost: Number(cost),
      unit // ✅ SAVE
    });

    productEditId = null;
    document.getElementById("prodBtn").innerText = "Add";
  } else {
    await addDoc(collection(db, "products"), {
      name,
      cost: Number(cost),
      unit // ✅ SAVE
    });
  }

  document.getElementById("prodName").value = "";
  document.getElementById("prodCost").value = "";
  document.getElementById("prodUnit").value = "kg"; // reset
};
/* ---------- EDIT PRODUCT ---------- */
window.editProduct = (id, name, cost, unit) => {
  document.getElementById("prodName").value = name;
  document.getElementById("prodCost").value = cost;
  document.getElementById("prodUnit").value = unit || "kg";

  productEditId = id;
  document.getElementById("prodBtn").innerText = "Update";
};

/* ---------- DELETE PRODUCT ---------- */
window.deleteProduct = async (id) => {
  await deleteDoc(doc(db,"products",id));
};

/* ---------- SALES ---------- */
onSnapshot(query(collection(db, "sales"), orderBy("date","desc")), snap => {

  const table = document.getElementById("salesTable");
  table.innerHTML = "";

  allSales = [];

snap.forEach(d => {

  const s = d.data();

  // ✅ FULL SAFETY CHECK
  if (!s) return;

  allSales.push(s);

  // ✅ SAFE ITEMS (NO CRASH EVER)
  let itemsText = "";

  if (Array.isArray(s.items)) {
    itemsText = s.items.map(i => `${i.product}(${i.qty})`).join(", ");
  } else {
    // fallback for old data
    itemsText = s.product
      ? `${s.product}(${s.quantity || 1})`
      : "No items";
  }

  table.innerHTML += `
    <tr>
      <td>${s.date || ""}</td>
      <td>${s.customer || "Retail"}</td>
      <td>${itemsText}</td>
      <td>${Math.round(s.totalAmount || 0)}</td>
      <td>${Math.round(s.totalProfit || 0)}</td>
      <td>
        <button onclick='editSale("${d.id}", ${JSON.stringify(s)})'>Edit</button>
        <button onclick="deleteSale('${d.id}')">Delete</button>
      </td>
    </tr>
  `;
});
  populateMonthFilter(allSales);
updateDashboard(allSales);
});

/* ---------- DASHBOARD ---------- */
function updateDashboard(data) {

  let totalSales = 0;
  let totalProfit = 0;
  let customers = new Set();

data.forEach(s => {
  totalSales += Number(s.totalAmount || 0);
  totalProfit += Number(s.totalProfit || 0);

  if (s.customer && s.customer !== "") {
    customers.add(s.customer);
  }
});

  document.getElementById("totalSales").innerText = totalSales;
  document.getElementById("totalProfit").innerText = totalProfit;
  document.getElementById("totalCustomers").innerText = customers.size;

  drawChart(data);
}

/* ---------- CHART ---------- */
function drawChart(data) {

  const canvas = document.getElementById("chart");

  // ❌ if canvas missing → stop
  if (!canvas) {
    console.error("Canvas not found");
    return;
  }

  const ctx = canvas.getContext("2d"); // ✅ IMPORTANT FIX

  let dateMap = {};

data.forEach(s => {

  if (!s || !s.date) return; // ✅ prevents crash

  if (!dateMap[s.date]) {
    dateMap[s.date] = { sales: 0, profit: 0 };
  }

  dateMap[s.date].sales += Number(s.totalAmount || 0);
  dateMap[s.date].profit += Number(s.totalProfit || 0);
});

  let labels = Object.keys(dateMap);
  let salesData = labels.map(d => dateMap[d].sales);
  let profitData = labels.map(d => dateMap[d].profit);

  // ✅ show empty chart if no data
  if (labels.length === 0) {
    labels = ["No Data"];
    salesData = [0];
    profitData = [0];
  }

  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        { label: "Sales", data: salesData },
        { label: "Profit", data: profitData }
      ]
    }
  });
}
/* ---------- OTHER ---------- */
window.editSale = (id, data) => {
  window.scrollTo({ top: 0, behavior: "smooth" });

  document.getElementById("date").value = data.date;
  document.getElementById("customerName").value = data.customer || "";

  container.innerHTML = "";
  data.items.forEach((item, i) => {
    container.appendChild(createItemRow(i === 0, item));
  });

  editId = id;
};

window.deleteSale = async (id) => {
  await deleteDoc(doc(db,"sales",id));
};

window.toggleSection = (id) => {
  document.getElementById(id).classList.toggle("hidden");
};
document.getElementById("monthFilter").addEventListener("change", (e) => {
  const value = e.target.value;

  if (value === "all") {
    updateDashboard(allSales);
  } else {
    const filtered = allSales.filter(s => s.date && s.date.startsWith(value));
    updateDashboard(filtered);
  }
});

// =========================
// 🤖 AI SUMMARY
// =========================
window.generateSummary = async function () {
  try {
    let salesData = [];

    const snapshot = await getDocs(collection(db, "sales"));

    snapshot.forEach((doc) => {
      salesData.push(doc.data());
    });

    if (salesData.length === 0) {
      document.getElementById("summary").innerText = "No data available.";
      return;
    }

    const response = await fetch("http://localhost:5000/summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sales: salesData }),
    });

    const data = await response.json();

    document.getElementById("summary").innerText = data.summary;

  } catch (error) {
    console.error("AI Error:", error);
    document.getElementById("summary").innerText = "Error generating summary";
  }
};
// 🔥 AI WARMUP (runs once when page loads)
window.addEventListener("load", async () => {
  try {
    await fetch("http://localhost:5000/summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sales: [] }),
    });
  } catch (e) {
    console.log("AI warmup failed (ok)");
  }
});
function calculateLiveTotal() {
  const rows = document.querySelectorAll(".itemRow");
  let total = 0;

  rows.forEach(r => {
    const price = Number(r.querySelector(".price").value) || 0;
    total += price;
  });

  document.getElementById("liveTotal").innerText = total;
}