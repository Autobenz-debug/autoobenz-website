const config = window.AUTOOBENZ_SUPABASE;
const SESSION_KEY = "autoobenz-admin-session-v1";
const IMAGE_BUCKET = "product-images";

const adminState = {
  session: null,
  products: [],
  brands: [],
  categories: [],
  types: [],
  selectedProduct: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const money = (value) => `${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })} د.ك`;

const showMessage = (element, message, type = "") => {
  element.textContent = message || "";
  element.classList.toggle("error", type === "error");
  element.classList.toggle("success", type === "success");
};

const slugify = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/['"]/g, "")
  .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 180);

const getSession = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
};

const setSession = (session) => {
  adminState.session = session;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
};

const authHeaders = () => ({
  apikey: config.publishableKey,
  Authorization: `Bearer ${adminState.session?.access_token || config.publishableKey}`,
});

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function supabaseRest(path, options = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await readResponse(response);
  if (!response.ok) {
    const message = body?.message || body || `Supabase ${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function signIn(email, password) {
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: config.publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await readResponse(response);
  if (!response.ok) throw new Error(body?.error_description || body?.msg || body?.message || "تعذر تسجيل الدخول");
  setSession(body);
  return body;
}

async function validateSession() {
  if (!adminState.session?.access_token) return false;
  const response = await fetch(`${config.url}/auth/v1/user`, { headers: authHeaders() });
  if (!response.ok) {
    setSession(null);
    return false;
  }
  return true;
}

function showDashboard() {
  $("#loginView").classList.add("hidden");
  $("#dashboardView").classList.remove("hidden");
}

function showLogin() {
  $("#dashboardView").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
}

async function loadData() {
  const select = "*,brands(id,slug,name_ar,name_en),categories(id,slug,name_ar,name_en),product_types(id,slug,name_ar,name_en),product_images(id,image_url,sort_order)";
  const [products, brands, categories, types] = await Promise.all([
    supabaseRest(`products?select=${select}&order=created_at.desc`),
    supabaseRest("brands?select=*&order=sort_order.asc"),
    supabaseRest("categories?select=*&order=sort_order.asc"),
    supabaseRest("product_types?select=*&order=sort_order.asc"),
  ]);
  adminState.products = products || [];
  adminState.brands = brands || [];
  adminState.categories = categories || [];
  adminState.types = types || [];
  renderEverything();
}

function productImage(product) {
  const images = [...(product.product_images || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  return images[0]?.image_url || "/assets/images/autoobenz-logo.png";
}

function renderStats() {
  const products = adminState.products;
  const active = products.filter((product) => product.is_active).length;
  const hidden = products.length - active;
  const featured = products.filter((product) => product.is_featured).length;
  $("#statsGrid").innerHTML = [
    ["كل المنتجات", products.length],
    ["ظاهرة في المتجر", active],
    ["مخفية", hidden],
    ["الأكثر طلباً", featured],
  ].map(([label, value]) => `<div class="stat-card"><span>${label}</span><b>${value}</b></div>`).join("");
}

function filteredProducts() {
  const query = $("#productSearch").value.trim().toLowerCase();
  const filter = $("#activeFilter").value;
  return adminState.products.filter((product) => {
    const title = `${product.title_ar || ""} ${product.title_en || ""}`.toLowerCase();
    const matchesSearch = !query || title.includes(query) || String(product.old_id || "").includes(query);
    const matchesStatus = filter === "all"
      || (filter === "active" && product.is_active)
      || (filter === "hidden" && !product.is_active);
    return matchesSearch && matchesStatus;
  });
}

function renderProducts() {
  const rows = filteredProducts().map((product) => `
    <tr>
      <td>
        <div class="product-cell">
          <img src="${productImage(product)}" alt="">
          <div>
            <b>${escapeHtml(product.title_ar || product.title_en || "بدون اسم")}</b>
            <small dir="ltr">${escapeHtml(product.slug || "")}</small>
          </div>
        </div>
      </td>
      <td>${escapeHtml(product.brands?.name_ar || "-")}</td>
      <td>${escapeHtml(product.product_types?.name_ar || product.categories?.name_ar || "-")}</td>
      <td>${money(product.price_kwd)}</td>
      <td>${Number(product.stock_quantity || 0)}</td>
      <td><span class="status-pill ${product.is_active ? "active" : "hidden-status"}">${product.is_active ? "ظاهر" : "مخفي"}</span></td>
      <td>
        <div class="row-actions">
          <button class="small-button" type="button" data-edit="${product.id}">تعديل</button>
          <a class="small-button" href="/product/${encodeURIComponent(product.slug)}" target="_blank" rel="noreferrer">عرض</a>
        </div>
      </td>
    </tr>
  `).join("");
  $("#productsTable").innerHTML = rows || `<tr><td colspan="7"><div class="empty-panel"><b>لا توجد نتائج</b><span>غير البحث أو الفلتر.</span></div></td></tr>`;
}

function renderOptions() {
  $("#productBrand").innerHTML = `<option value="">بدون ماركة</option>${adminState.brands.map((brand) => (
    `<option value="${brand.id}">${escapeHtml(brand.name_ar)} — ${escapeHtml(brand.name_en || brand.slug)}</option>`
  )).join("")}`;
  $("#productType").innerHTML = `<option value="">بدون قسم</option>${adminState.types.map((type) => (
    `<option value="${type.id}">${escapeHtml(type.name_ar)}</option>`
  )).join("")}`;
  $("#productCategory").innerHTML = `<option value="">بدون موديل</option>${adminState.categories.map((category) => (
    `<option value="${category.id}">${escapeHtml(category.name_ar)} (${escapeHtml(category.slug)})</option>`
  )).join("")}`;
}

function renderEverything() {
  renderStats();
  renderOptions();
  renderProducts();
}

function openProductModal(product = null) {
  adminState.selectedProduct = product;
  $("#modalTitle").textContent = product ? "تعديل منتج" : "منتج جديد";
  $("#productId").value = product?.id || "";
  $("#productTitle").value = product?.title_ar || product?.title_en || "";
  $("#productSlug").value = product?.slug || "";
  $("#productPrice").value = product?.price_kwd || 0;
  $("#productComparePrice").value = product?.compare_at_price_kwd || product?.price_kwd || 0;
  $("#productStock").value = product?.stock_quantity ?? 999;
  $("#productBrand").value = product?.brand_id || "";
  $("#productType").value = product?.type_id || "";
  $("#productCategory").value = product?.category_id || "";
  $("#productCatSlugs").value = (product?.cat_slugs || []).join(", ");
  $("#productDescription").value = product?.description_ar || product?.description_en || "";
  $("#productActive").checked = product?.is_active ?? true;
  $("#productFeatured").checked = product?.is_featured ?? false;
  $("#productImages").value = "";
  $("#imageList").innerHTML = (product?.product_images || [])
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((image) => `<img src="${image.image_url}" alt="">`)
    .join("");
  $("#hideProductButton").classList.toggle("hidden", !product);
  showMessage($("#productMessage"), "");
  $("#productModal").classList.remove("hidden");
  $("#productModal").setAttribute("aria-hidden", "false");
}

function closeProductModal() {
  $("#productModal").classList.add("hidden");
  $("#productModal").setAttribute("aria-hidden", "true");
}

function productPayload() {
  const title = $("#productTitle").value.trim();
  const slug = $("#productSlug").value.trim() || slugify(title);
  const brandId = $("#productBrand").value || null;
  const typeId = $("#productType").value || null;
  const categoryId = $("#productCategory").value || null;
  const catSlugs = $("#productCatSlugs").value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    title_ar: title,
    title_en: title,
    slug,
    description_ar: $("#productDescription").value.trim(),
    description_en: $("#productDescription").value.trim(),
    price_kwd: Number($("#productPrice").value || 0),
    compare_at_price_kwd: Number($("#productComparePrice").value || $("#productPrice").value || 0),
    stock_quantity: Number($("#productStock").value || 0),
    brand_id: brandId,
    type_id: typeId,
    category_id: categoryId,
    model: adminState.categories.find((category) => String(category.id) === String(categoryId))?.slug || null,
    cat_slugs: catSlugs,
    is_active: $("#productActive").checked,
    is_featured: $("#productFeatured").checked,
  };
}

async function saveProduct(event) {
  event.preventDefault();
  const message = $("#productMessage");
  showMessage(message, "جاري الحفظ...");
  const id = $("#productId").value;
  try {
    const payload = productPayload();
    let saved;
    if (id) {
      saved = await supabaseRest(`products?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });
      saved = saved?.[0];
    } else {
      saved = await supabaseRest("products", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ...payload, old_id: null, sort_order: 0 }),
      });
      saved = saved?.[0];
      $("#productId").value = saved?.id || "";
    }
    await uploadSelectedImages(saved || adminState.selectedProduct);
    showMessage(message, "تم الحفظ بنجاح.", "success");
    await loadData();
    const updated = adminState.products.find((product) => product.id === (saved?.id || id));
    if (updated) openProductModal(updated);
  } catch (error) {
    showMessage(message, error.message, "error");
  }
}

async function uploadSelectedImages(product) {
  const files = [...$("#productImages").files];
  if (!files.length || !product?.id) return;
  const existingCount = product.product_images?.length || 0;
  for (const [index, file] of files.entries()) {
    const extension = file.name.split(".").pop() || "webp";
    const safeName = `${product.id}-${Date.now()}-${index}.${extension}`.replace(/[^a-zA-Z0-9._-]/g, "-");
    const uploadResponse = await fetch(`${config.url}/storage/v1/object/${IMAGE_BUCKET}/${encodeURIComponent(safeName)}`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: file,
    });
    const uploadBody = await readResponse(uploadResponse);
    if (!uploadResponse.ok) throw new Error(uploadBody?.message || uploadBody || "تعذر رفع الصورة");
    const imageUrl = `${config.url}/storage/v1/object/public/${IMAGE_BUCKET}/${encodeURIComponent(safeName)}`;
    await supabaseRest("product_images", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        product_id: product.id,
        image_url: imageUrl,
        alt_text: product.title_ar || product.title_en || "",
        sort_order: existingCount + index,
      }),
    });
  }
}

async function hideProduct() {
  const id = $("#productId").value;
  if (!id) return;
  showMessage($("#productMessage"), "جاري إخفاء المنتج...");
  try {
    await supabaseRest(`products?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ is_active: false }),
    });
    closeProductModal();
    await loadData();
  } catch (error) {
    showMessage($("#productMessage"), error.message, "error");
  }
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = $("#loginMessage");
    showMessage(message, "جاري تسجيل الدخول...");
    try {
      await signIn($("#loginEmail").value.trim(), $("#loginPassword").value);
      showDashboard();
      await loadData();
    } catch (error) {
      showMessage(message, error.message, "error");
    }
  });

  $("#logoutButton").addEventListener("click", () => {
    setSession(null);
    showLogin();
  });

  $$(".nav-item[data-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".nav-item[data-panel]").forEach((entry) => entry.classList.remove("active"));
      button.classList.add("active");
      ["productsPanel", "ordersPanel"].forEach((id) => $(`#${id}`).classList.toggle("hidden", id !== button.dataset.panel));
    });
  });

  $("#productSearch").addEventListener("input", renderProducts);
  $("#activeFilter").addEventListener("change", renderProducts);
  $("#newProductButton").addEventListener("click", () => openProductModal());
  $("#closeModalButton").addEventListener("click", closeProductModal);
  $("#productModal").addEventListener("click", (event) => {
    if (event.target === $("#productModal")) closeProductModal();
  });
  $("#productTitle").addEventListener("input", () => {
    if (!$("#productId").value) $("#productSlug").value = slugify($("#productTitle").value);
  });
  $("#productForm").addEventListener("submit", saveProduct);
  $("#hideProductButton").addEventListener("click", hideProduct);
  $("#productsTable").addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit]");
    if (!button) return;
    const product = adminState.products.find((item) => String(item.id) === String(button.dataset.edit));
    if (product) openProductModal(product);
  });
}

async function boot() {
  bindEvents();
  setSession(getSession());
  if (await validateSession()) {
    showDashboard();
    await loadData();
  } else {
    showLogin();
  }
}

boot().catch((error) => {
  showLogin();
  showMessage($("#loginMessage"), error.message, "error");
});
