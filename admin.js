const config = window.AUTOOBENZ_SUPABASE;
const SESSION_KEY = "autoobenz-admin-session-v1";
const IMAGE_BUCKET = "product-images";

const adminState = {
  session: null,
  products: [],
  orders: [],
  customers: [],
  coupons: [],
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

const normalizeCouponCode = (value = "") => String(value)
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, "");

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
  const [products, brands, categories, types, orders, customers, coupons] = await Promise.all([
    supabaseRest(`products?select=${select}&order=created_at.desc`),
    supabaseRest("brands?select=*&order=sort_order.asc"),
    supabaseRest("categories?select=*&order=sort_order.asc"),
    supabaseRest("product_types?select=*&order=sort_order.asc"),
    loadOrders(),
    loadCustomers(),
    loadCoupons(),
  ]);
  adminState.products = products || [];
  adminState.orders = orders || [];
  adminState.customers = customers || [];
  adminState.coupons = coupons || [];
  adminState.brands = brands || [];
  adminState.categories = categories || [];
  adminState.types = types || [];
  renderEverything();
}

async function loadOrders() {
  try {
    return await supabaseRest("orders?select=*,order_items(*)&order=created_at.desc");
  } catch (error) {
    console.warn("Orders table is not ready yet.", error);
    return [];
  }
}

async function loadCustomers() {
  try {
    return await supabaseRest("customer_profiles?select=*&order=created_at.desc");
  } catch (error) {
    console.warn("Customer profiles table is not ready yet.", error);
    return [];
  }
}

async function loadCoupons() {
  try {
    return await supabaseRest("coupons?select=*,products(title_ar,title_en,slug)&order=created_at.desc");
  } catch (error) {
    console.warn("Coupons table is not ready yet.", error);
    return [];
  }
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
    ["طلبات جديدة", adminState.orders.filter((order) => order.status === "new").length],
    ["العملاء", customerRows().length],
    ["كوبونات فعالة", adminState.coupons.filter((coupon) => coupon.is_active).length],
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

const statusLabels = {
  new: "جديد",
  processing: "قيد التجهيز",
  shipped: "تم الشحن",
  completed: "مكتمل",
  cancelled: "ملغي",
};

const paymentLabels = {
  pending: "بانتظار الدفع",
  paid: "مدفوع",
  failed: "فشل الدفع",
  refunded: "مسترجع",
};

function filteredOrders() {
  const query = $("#orderSearch")?.value.trim().toLowerCase() || "";
  const status = $("#orderStatusFilter")?.value || "all";
  return adminState.orders.filter((order) => {
    const haystack = `${order.order_number || ""} ${order.customer_name || ""} ${order.customer_phone || ""}`.toLowerCase();
    return (!query || haystack.includes(query)) && (status === "all" || order.status === status);
  });
}

function renderOrders() {
  const table = $("#ordersTable");
  if (!table) return;
  const rows = filteredOrders().map((order) => `
    <tr>
      <td>
        <b dir="ltr">${escapeHtml(order.order_number || order.id)}</b>
        <small>${new Date(order.created_at).toLocaleString("ar-KW")}</small>
      </td>
      <td>${escapeHtml(order.customer_name || "-")}</td>
      <td dir="ltr">${escapeHtml(order.customer_phone || "-")}</td>
      <td>
        ${money(order.total_kwd)}
        ${Number(order.discount_kwd || 0) > 0 ? `<small>خصم ${escapeHtml(order.coupon_code || "")}: -${money(order.discount_kwd)}</small>` : ""}
      </td>
      <td>${escapeHtml(paymentLabels[order.payment_status] || order.payment_status || "-")}</td>
      <td>
        <select class="status-select" data-order-status="${order.id}">
          ${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${order.status === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </td>
      <td>
        <div class="row-actions">
          <button class="small-button" type="button" data-order="${order.id}">تفاصيل</button>
          <a class="small-button" href="https://wa.me/${String(order.customer_phone || "").replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`مرحباً، بخصوص طلبك ${order.order_number || ""} من أوتوبنز`)}" target="_blank" rel="noreferrer">واتساب</a>
        </div>
      </td>
    </tr>
  `).join("");
  table.innerHTML = rows || `<tr><td colspan="7"><div class="empty-panel"><b>ما في طلبات</b><span>الطلبات الجديدة ستظهر هنا بعد إتمام العميل للطلب.</span></div></td></tr>`;
}

function customerRows() {
  const rows = new Map();
  adminState.customers.forEach((customer) => {
    const key = customer.id || customer.email || customer.phone;
    if (!key) return;
    rows.set(key, {
      id: customer.id,
      full_name: customer.full_name || "-",
      email: customer.email || "",
      phone: customer.phone || "",
      created_at: customer.created_at,
      orders: [],
    });
  });
  adminState.orders.forEach((order) => {
    const profileKey = order.customer_id || order.customer_email || order.customer_phone;
    if (!profileKey) return;
    if (!rows.has(profileKey)) {
      rows.set(profileKey, {
        id: order.customer_id,
        full_name: order.customer_name || "-",
        email: order.customer_email || "",
        phone: order.customer_phone || "",
        created_at: order.created_at,
        orders: [],
      });
    }
    rows.get(profileKey).orders.push(order);
  });
  adminState.orders.forEach((order) => {
    rows.forEach((customer) => {
      const emailMatches = customer.email && order.customer_email && customer.email.toLowerCase() === order.customer_email.toLowerCase();
      const idMatches = customer.id && order.customer_id && customer.id === order.customer_id;
      if ((emailMatches || idMatches) && !customer.orders.some((item) => item.id === order.id)) customer.orders.push(order);
    });
  });
  return [...rows.values()].sort((a, b) => {
    const lastA = a.orders[0]?.created_at || a.created_at || "";
    const lastB = b.orders[0]?.created_at || b.created_at || "";
    return String(lastB).localeCompare(String(lastA));
  });
}

function filteredCustomers() {
  const query = $("#customerSearch")?.value.trim().toLowerCase() || "";
  return customerRows().filter((customer) => {
    const haystack = `${customer.full_name || ""} ${customer.email || ""} ${customer.phone || ""}`.toLowerCase();
    return !query || haystack.includes(query);
  });
}

function renderCustomers() {
  const table = $("#customersTable");
  if (!table) return;
  const rows = filteredCustomers().map((customer) => {
    const orders = customer.orders || [];
    const total = orders.reduce((sum, order) => sum + Number(order.total_kwd || 0), 0);
    const lastOrder = orders[0];
    return `
      <tr>
        <td>
          <div class="customer-cell">
            <b>${escapeHtml(customer.full_name || "-")}</b>
            <small>${escapeHtml(customer.email || "-")}</small>
          </div>
        </td>
        <td dir="ltr">${escapeHtml(customer.phone || "-")}</td>
        <td>${orders.length}</td>
        <td>${money(total)}</td>
        <td>${lastOrder ? `${escapeHtml(lastOrder.order_number || lastOrder.id)}<small>${new Date(lastOrder.created_at).toLocaleString("ar-KW")}</small>` : "-"}</td>
        <td>
          ${customer.phone ? `<a class="small-button" href="https://wa.me/${String(customer.phone).replace(/[^0-9]/g, "")}" target="_blank" rel="noreferrer">واتساب</a>` : ""}
        </td>
      </tr>
    `;
  }).join("");
  table.innerHTML = rows || `<tr><td colspan="6"><div class="empty-panel"><b>لا يوجد عملاء</b><span>حسابات العملاء والطلبات ستظهر هنا.</span></div></td></tr>`;
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

const categoryOldId = (category) => Number(category.old_id || category.id || 0);

const categoryParentId = (category) => Number(category.parent_old_id || category.parent_id || category.parent || 0);

function modelOptionsForBrand(brandId) {
  const brand = adminState.brands.find((item) => String(item.id) === String(brandId));
  if (!brand) return [];
  const root = adminState.categories.find((category) => category.slug === brand.slug && categoryParentId(category) === 0);
  const rootId = root ? categoryOldId(root) : null;
  const seen = new Set();
  return adminState.categories
    .filter((category) => rootId && categoryParentId(category) === rootId)
    .filter((category) => {
      if (seen.has(category.slug)) return false;
      seen.add(category.slug);
      return true;
    })
    .sort((a, b) => String(a.name_ar || a.name_en || a.slug).localeCompare(String(b.name_ar || b.name_en || b.slug)));
}

function selectedModelIdsForProduct(product) {
  if (!product) return [];
  const selected = new Set();
  if (product.category_id) selected.add(String(product.category_id));
  const slugs = new Set(product.cat_slugs || []);
  adminState.categories.forEach((category) => {
    if (slugs.has(category.slug)) selected.add(String(category.id));
  });
  return [...selected];
}

function renderModelOptions(selectedIds = []) {
  const brandId = $("#productBrand")?.value || "";
  const selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds.map(String) : [String(selectedIds)].filter(Boolean));
  const options = modelOptionsForBrand(brandId);
  const extraSelected = adminState.categories.filter((category) => (
    selectedSet.has(String(category.id)) && !options.some((option) => String(option.id) === String(category.id))
  ));
  const entries = [...extraSelected, ...options];
  $("#productCategory").disabled = !brandId;
  $("#productCategory").innerHTML = [
    `<option value="" disabled>${brandId ? "بدون موديل" : "اختر الماركة أولاً"}</option>`,
    ...entries.map((category) => `<option value="${category.id}" ${selectedSet.has(String(category.id)) ? "selected" : ""}>${escapeHtml(category.name_ar || category.name_en || category.slug)}</option>`),
  ].join("");
}

function generateCouponCode() {
  return `KW${Math.floor(1000 + Math.random() * 9000)}`;
}

function couponProductLabel(coupon) {
  if (coupon.scope !== "product") return "السلة كاملة";
  return coupon.products?.title_ar || coupon.products?.title_en || coupon.products?.slug || coupon.product_old_id || "منتج محدد";
}

function renderCouponOptions() {
  const select = $("#couponProduct");
  if (!select) return;
  select.innerHTML = `<option value="">اختر المنتج</option>${adminState.products.map((product) => (
    `<option value="${product.id}">${escapeHtml(product.title_ar || product.title_en || product.slug || product.id)}</option>`
  )).join("")}`;
}

function renderCoupons() {
  const table = $("#couponsTable");
  if (!table) return;
  const rows = adminState.coupons.map((coupon) => `
    <tr>
      <td><span class="coupon-code">${escapeHtml(coupon.code)}</span></td>
      <td>${money(coupon.discount_kwd)}</td>
      <td>${escapeHtml(couponProductLabel(coupon))}</td>
      <td><span class="status-pill ${coupon.is_active ? "active" : "hidden-status"}">${coupon.is_active ? "فعال" : "متوقف"}</span></td>
      <td>
        <div class="row-actions">
          <button class="small-button" type="button" data-coupon-toggle="${coupon.id}" data-coupon-active="${coupon.is_active ? "false" : "true"}">${coupon.is_active ? "تعطيل" : "تفعيل"}</button>
          <button class="small-button danger-text" type="button" data-coupon-delete="${coupon.id}">حذف</button>
        </div>
      </td>
    </tr>
  `).join("");
  table.innerHTML = rows || `<tr><td colspan="5"><div class="empty-panel"><b>لا توجد كوبونات</b><span>اضغط توليد ثم احفظ أول كوبون خصم.</span></div></td></tr>`;
}

function resetCouponForm() {
  $("#couponCodeAdmin").value = generateCouponCode();
  $("#couponDiscount").value = "";
  $("#couponScope").value = "cart";
  $("#couponProduct").value = "";
  $("#couponProduct").disabled = true;
  $("#couponActive").checked = true;
}

async function saveCoupon(event) {
  event.preventDefault();
  const message = $("#couponMessageAdmin");
  showMessage(message, "جاري حفظ الكوبون...");
  try {
    const scope = $("#couponScope").value;
    const productId = scope === "product" ? $("#couponProduct").value : "";
    const product = adminState.products.find((item) => String(item.id) === String(productId));
    const payload = {
      code: normalizeCouponCode($("#couponCodeAdmin").value),
      discount_kwd: Number($("#couponDiscount").value || 0),
      scope,
      product_id: scope === "product" ? product?.id : null,
      product_old_id: scope === "product" && product?.old_id ? String(product.old_id) : null,
      is_active: $("#couponActive").checked,
    };
    if (!/^KW\d{4}$/.test(payload.code)) throw new Error("الكود لازم يكون مثل KW1234.");
    if (payload.discount_kwd <= 0) throw new Error("اكتب قيمة خصم صحيحة.");
    if (scope === "product" && !product?.id) throw new Error("اختر المنتج المرتبط بالكوبون.");
    await supabaseRest("coupons", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(payload),
    });
    showMessage(message, "تم حفظ الكوبون.", "success");
    resetCouponForm();
    await loadData();
  } catch (error) {
    showMessage(message, error.message, "error");
  }
}

async function setCouponActive(id, isActive) {
  await supabaseRest(`coupons?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ is_active: isActive }),
  });
  await loadData();
}

async function deleteCoupon(id) {
  if (!confirm("حذف الكوبون؟")) return;
  await supabaseRest(`coupons?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  await loadData();
}

function renderEverything() {
  renderStats();
  renderOptions();
  renderCouponOptions();
  renderProducts();
  renderOrders();
  renderCustomers();
  renderCoupons();
}

function openOrderModal(order) {
  $("#orderModalTitle").textContent = order.order_number || "تفاصيل الطلب";
  const items = order.order_items || [];
  $("#orderDetail").innerHTML = `
    <div class="order-meta">
      <div><span>العميل</span><b>${escapeHtml(order.customer_name || "-")}</b></div>
      <div><span>الهاتف</span><b dir="ltr">${escapeHtml(order.customer_phone || "-")}</b></div>
      <div><span>البريد</span><b>${escapeHtml(order.customer_email || "-")}</b></div>
      <div><span>الإجمالي</span><b>${money(order.total_kwd)}</b></div>
    </div>
    ${Number(order.discount_kwd || 0) > 0 ? `
      <div class="order-address">
        <span>كود الخصم</span>
        <p>${escapeHtml(order.coupon_code || "-")} - خصم ${money(order.discount_kwd)}</p>
      </div>
    ` : ""}
    <div class="order-address">
      <span>العنوان</span>
      <p>${escapeHtml([order.shipping_country, order.shipping_city, order.shipping_address].filter(Boolean).join(" - "))}</p>
      ${order.notes ? `<p>${escapeHtml(order.notes)}</p>` : ""}
    </div>
    <div class="order-items">
      ${items.map((item) => `
        <div class="order-item">
          <b>${escapeHtml(item.product_title || item.product_slug || "-")}</b>
          <span>${Number(item.quantity || 0)} × ${money(item.unit_price_kwd)}</span>
          <strong>${money(item.total_kwd)}</strong>
        </div>
      `).join("") || `<div class="empty-panel"><b>لا توجد منتجات مرفقة</b></div>`}
    </div>
  `;
  $("#orderModal").classList.remove("hidden");
  $("#orderModal").setAttribute("aria-hidden", "false");
}

function closeOrderModal() {
  $("#orderModal").classList.add("hidden");
  $("#orderModal").setAttribute("aria-hidden", "true");
}

async function updateOrderStatus(id, status) {
  await supabaseRest(`orders?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status }),
  });
  const order = adminState.orders.find((item) => String(item.id) === String(id));
  if (order) order.status = status;
  renderStats();
  renderCustomers();
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
  renderModelOptions(selectedModelIdsForProduct(product));
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
  const selectedCategoryIds = [...$("#productCategory").selectedOptions]
    .map((option) => option.value)
    .filter(Boolean);
  const categoryId = selectedCategoryIds[0] || null;
  const selectedBrand = adminState.brands.find((brand) => String(brand.id) === String(brandId));
  const selectedType = adminState.types.find((type) => String(type.id) === String(typeId));
  const selectedCategories = selectedCategoryIds
    .map((id) => adminState.categories.find((category) => String(category.id) === String(id)))
    .filter(Boolean);
  const selectedCategory = selectedCategories[0];
  const catSlugs = [...new Set([
    selectedBrand?.slug,
    selectedType?.slug,
    ...selectedCategories.map((category) => category.slug),
    ...$("#productCatSlugs").value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  ].filter(Boolean))];
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
    model: selectedCategory?.slug || null,
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
      ["productsPanel", "ordersPanel", "customersPanel", "couponsPanel"].forEach((id) => $(`#${id}`).classList.toggle("hidden", id !== button.dataset.panel));
    });
  });

  $("#productSearch").addEventListener("input", renderProducts);
  $("#activeFilter").addEventListener("change", renderProducts);
  $("#orderSearch").addEventListener("input", renderOrders);
  $("#orderStatusFilter").addEventListener("change", renderOrders);
  $("#customerSearch")?.addEventListener("input", renderCustomers);
  $("#couponForm")?.addEventListener("submit", saveCoupon);
  $("#generateCouponButton")?.addEventListener("click", () => {
    $("#couponCodeAdmin").value = generateCouponCode();
  });
  $("#couponScope")?.addEventListener("change", () => {
    $("#couponProduct").disabled = $("#couponScope").value !== "product";
  });
  $("#newProductButton").addEventListener("click", () => openProductModal());
  $("#closeModalButton").addEventListener("click", closeProductModal);
  $("#productModal").addEventListener("click", (event) => {
    if (event.target === $("#productModal")) closeProductModal();
  });
  $("#closeOrderModalButton").addEventListener("click", closeOrderModal);
  $("#orderModal").addEventListener("click", (event) => {
    if (event.target === $("#orderModal")) closeOrderModal();
  });
  $("#productTitle").addEventListener("input", () => {
    if (!$("#productId").value) $("#productSlug").value = slugify($("#productTitle").value);
  });
  $("#productBrand").addEventListener("change", () => {
    renderModelOptions("");
  });
  $("#productCategory").addEventListener("mousedown", (event) => {
    const option = event.target.closest("option");
    if (!option || option.disabled) return;
    event.preventDefault();
    option.selected = !option.selected;
    $("#productCategory").dispatchEvent(new Event("change", { bubbles: true }));
  });
  $("#productForm").addEventListener("submit", saveProduct);
  $("#hideProductButton").addEventListener("click", hideProduct);
  $("#productsTable").addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit]");
    if (!button) return;
    const product = adminState.products.find((item) => String(item.id) === String(button.dataset.edit));
    if (product) openProductModal(product);
  });
  $("#ordersTable").addEventListener("click", (event) => {
    const button = event.target.closest("[data-order]");
    if (!button) return;
    const order = adminState.orders.find((item) => String(item.id) === String(button.dataset.order));
    if (order) openOrderModal(order);
  });
  $("#ordersTable").addEventListener("change", async (event) => {
    const select = event.target.closest("[data-order-status]");
    if (!select) return;
    select.disabled = true;
    try {
      await updateOrderStatus(select.dataset.orderStatus, select.value);
    } catch (error) {
      alert(error.message);
    } finally {
      select.disabled = false;
    }
  });
  $("#couponsTable")?.addEventListener("click", async (event) => {
    const toggle = event.target.closest("[data-coupon-toggle]");
    const remove = event.target.closest("[data-coupon-delete]");
    try {
      if (toggle) {
        toggle.disabled = true;
        await setCouponActive(toggle.dataset.couponToggle, toggle.dataset.couponActive === "true");
      }
      if (remove) {
        remove.disabled = true;
        await deleteCoupon(remove.dataset.couponDelete);
      }
    } catch (error) {
      alert(error.message);
      if (toggle) toggle.disabled = false;
      if (remove) remove.disabled = false;
    }
  });
  resetCouponForm();
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
