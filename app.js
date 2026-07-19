const state = {
  products: [],
  categories: [],
  brands: [],
  types: [],
  cart: JSON.parse(localStorage.getItem("autoobenz-cart-v1") || "[]"),
};

const app = document.querySelector("#app");
const cartCount = document.querySelector("#cartCount");
const cartDrawer = document.querySelector("#cartDrawer");
const mobileNav = document.querySelector("#mobileNav");

const money = (value) => {
  const options = value >= 100 ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 1 };
  return `${Number(value || 0).toLocaleString("en-US", options)} د.ك`;
};

const imgLocal = (url) => {
  if (!url) return "/assets/images/autoobenz-logo.png";
  try {
    return `/assets/images/${new URL(url).pathname.split("/").pop()}`;
  } catch {
    return `/assets/images/${String(url).split("/").pop()}`;
  }
};

const brandLogo = (slug) => {
  const map = {
    "mercedes-benz": "brand-mercedes.svg",
    bmw: "brand-bmw.svg",
    v: "brand-porsche.svg",
    "land-rover": "brand-landrover.svg",
    audi: "brand-audi.svg",
    ferrari: "brand-ferrari.svg",
    lamborghini: "brand-lamborghini.svg",
    mclaren: "brand-mclaren.svg",
    "rolls-royce": "brand-rollsroyce.svg",
    bentley: "brand-bentley.svg",
  };
  return `/assets/images/${map[slug] || "autoobenz-logo.png"}`;
};

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const descendants = (slug) => {
  const root = state.categories.find((cat) => cat.slug === slug && Number(cat.parent) === 0);
  const slugs = new Set([slug]);
  if (!root) return slugs;
  const queue = [root.id];
  while (queue.length) {
    const id = queue.shift();
    state.categories.forEach((cat) => {
      if (cat.parent === id) {
        slugs.add(cat.slug);
        queue.push(cat.id);
      }
    });
  }
  return slugs;
};

const inBrand = (product, brandSlug) => {
  if (!brandSlug) return true;
  const allowed = descendants(brandSlug);
  return product.cat_slugs.some((slug) => allowed.has(slug));
};

const productBrand = (product) => state.brands.find((brand) => inBrand(product, brand.slug));

const brandProductCount = (brandSlug) => state.products.filter((product) => inBrand(product, brandSlug)).length;

const brandModels = (brandSlug) => {
  const root = state.categories.find((category) => category.slug === brandSlug && Number(category.parent) === 0);
  if (!root) return [];
  return state.categories
    .filter((category) => category.parent === root.id && category.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
};

function navigate(path) {
  history.pushState(null, "", path);
  mobileNav.classList.remove("open");
  render();
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-link]");
  if (!link) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin) return;
  event.preventDefault();
  navigate(`${url.pathname}${url.search}`);
});

window.addEventListener("popstate", render);

document.querySelector("#menuButton").addEventListener("click", () => {
  mobileNav.classList.toggle("open");
});

document.querySelector("#cartButton").addEventListener("click", openCart);
document.querySelector("#closeCart").addEventListener("click", closeCart);
cartDrawer.addEventListener("click", (event) => {
  if (event.target === cartDrawer) closeCart();
});

function saveCart() {
  localStorage.setItem("autoobenz-cart-v1", JSON.stringify(state.cart));
  renderCart();
}

function addToCart(id, qty = 1) {
  const product = state.products.find((item) => item.id === Number(id));
  if (!product) return;
  const existing = state.cart.find((item) => item.id === product.id);
  if (existing) existing.qty += qty;
  else state.cart.push({ id: product.id, qty });
  saveCart();
  openCart();
}

function setQty(id, qty) {
  if (qty <= 0) state.cart = state.cart.filter((item) => item.id !== id);
  else state.cart = state.cart.map((item) => item.id === id ? { ...item, qty } : item);
  saveCart();
}

function openCart() {
  cartDrawer.classList.add("open");
  cartDrawer.setAttribute("aria-hidden", "false");
}

function closeCart() {
  cartDrawer.classList.remove("open");
  cartDrawer.setAttribute("aria-hidden", "true");
}

function renderCart() {
  const count = state.cart.reduce((sum, item) => sum + item.qty, 0);
  cartCount.textContent = count;
  const rows = state.cart.map((item) => {
    const product = state.products.find((entry) => entry.id === item.id);
    if (!product) return "";
    return `
      <div class="cart-item">
        <img src="${imgLocal(product.images[0])}" alt="${escapeHtml(product.name)}">
        <div>
          <h4>${escapeHtml(product.name)}</h4>
          <div class="qty-row">
            <button type="button" data-qty="${product.id}" data-step="-1">-</button>
            <span>${item.qty}</span>
            <button type="button" data-qty="${product.id}" data-step="1">+</button>
            <b>${money(product.price * item.qty)}</b>
          </div>
        </div>
        <button class="remove" type="button" data-remove="${product.id}">حذف</button>
      </div>
    `;
  }).join("");
  document.querySelector("#cartItems").innerHTML = rows || `<div class="empty-state"><b>السلة فارغة</b><p>أضف منتجاتك ثم أرسل الطلب عبر واتساب.</p></div>`;
  const total = state.cart.reduce((sum, item) => {
    const product = state.products.find((entry) => entry.id === item.id);
    return sum + (product ? product.price * item.qty : 0);
  }, 0);
  document.querySelector("#cartTotal").textContent = money(total);
  const message = state.cart.map((item) => {
    const product = state.products.find((entry) => entry.id === item.id);
    return product ? `${item.qty} × ${product.name} - ${money(product.price)}` : "";
  }).filter(Boolean).join("\n");
  document.querySelector("#checkoutLink").href = `https://wa.me/96550304591?text=${encodeURIComponent(`مرحبا، أريد طلب:\n${message}\nالإجمالي: ${money(total)}`)}`;
}

document.querySelector("#cartItems").addEventListener("click", (event) => {
  const qtyButton = event.target.closest("[data-qty]");
  const removeButton = event.target.closest("[data-remove]");
  if (qtyButton) {
    const id = Number(qtyButton.dataset.qty);
    const current = state.cart.find((item) => item.id === id);
    setQty(id, (current?.qty || 0) + Number(qtyButton.dataset.step));
  }
  if (removeButton) setQty(Number(removeButton.dataset.remove), 0);
});

function productCard(product) {
  const brand = productBrand(product);
  const discount = product.regular_price > product.price ? Math.round((1 - product.price / product.regular_price) * 100) : 0;
  return `
    <a class="product-card" href="/product/${product.slug}" data-link>
      <div class="product-image">
        <img src="${imgLocal(product.images[0])}" alt="${escapeHtml(product.name)}" loading="lazy">
        ${discount ? `<span class="sale-badge">خصم ${discount}%</span>` : ""}
      </div>
      <div class="product-body">
        ${brand ? `<span class="product-brand">${escapeHtml(brand.ar)}</span>` : ""}
        <div class="product-title">${escapeHtml(product.name)}</div>
        <div class="price-row">
          <span class="price">${money(product.price)}</span>
          ${discount ? `<span class="old-price">${money(product.regular_price)}</span>` : ""}
        </div>
      </div>
    </a>
  `;
}

function hero() {
  return `
    <section class="hero">
      <div class="container">
        <div class="hero-copy">
          <p class="hero-kicker">AUTOOBENZ — KUWAIT</p>
          <h1>سيارتك تستاهل<br><span>كاربون حقيقي</span></h1>
          <p class="hero-lead">بودي كت، ستيرنق، شاشات وإضاءة بجودة الوكالة للسيارات الفاخرة — توصيل لكل الكويت وشحن عالمي.</p>
          <div class="hero-stats">
            <span><i></i>+216 منتج أصلي</span>
            <span><i></i>10 ماركات فاخرة</span>
            <span><i></i>سجل تجاري 525945</span>
          </div>
        </div>
        <form class="car-finder" id="homeFinder">
          <p>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13M5 13h14M5 13v5a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-5"></path>
              <circle cx="8" cy="16" r="0.5"></circle>
              <circle cx="16" cy="16" r="0.5"></circle>
            </svg>
            اختر سيارتك وشوف القطع المتوافقة معها فقط
          </p>
          <div>
            <select name="brand" aria-label="الماركة">
              <option value="">الماركة</option>
              ${state.brands.map((brand) => `<option value="${brand.slug}">${brand.ar} — ${brand.en}</option>`).join("")}
            </select>
            <select name="model" aria-label="الموديل">
              <option value="">كل الموديلات</option>
            </select>
            <button type="submit">عرض القطع</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function brandMarquee() {
  const items = [...state.brands, ...state.brands];
  return `
    <div class="brand-marquee" dir="ltr">
      <div class="marquee-track">
        ${items.map((brand) => `
          <span>
            <img alt="" aria-hidden="true" loading="lazy" src="${brandLogo(brand.slug)}">
            <b>${escapeHtml(brand.en.toUpperCase())}</b>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderHome() {
  const featured = state.products.slice(-8).reverse();
  app.innerHTML = `
    ${hero()}
    ${brandMarquee()}
    <section class="brands-section">
      <div class="container">
        <div class="center-title">
          <span></span>
          <h2>تسوق بماركتك</h2>
        </div>
        <div class="brand-strip">
          ${state.brands.map((brand) => `
            <a class="brand-card" href="/shop?brand=${brand.slug}" data-link>
              <span class="brand-logo"><img src="${brandLogo(brand.slug)}" alt="${escapeHtml(brand.ar)}"></span>
              <b>${brand.ar}</b>
              <small>${brand.en} · ${brandProductCount(brand.slug)}</small>
            </a>
          `).join("")}
        </div>
      </div>
    </section>
    <section class="promo-section">
      <div class="container">
        <div class="promo-grid">
          <a class="promo-card" href="/shop?type=body-kit" data-link>
            <img src="/assets/images/26499-0.webp" alt="غيّر شخصية سيارتك كاملة">
            <span class="promo-shade"></span>
            <div>
              <p>بودي كت كاربون</p>
              <h3>غيّر شخصية سيارتك كاملة</h3>
              <b>تصفح البودي كت ←</b>
            </div>
          </a>
          <a class="promo-card" href="/shop?type=steering-wheel" data-link>
            <img src="/assets/images/26476-0.webp" alt="لمستك الخاصة بين يدينك">
            <span class="promo-shade"></span>
            <div>
              <p>ستيرنق مخصص</p>
              <h3>لمستك الخاصة بين يدينك</h3>
              <b>تصفح الستيرنق ←</b>
            </div>
          </a>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="container">
        <div class="section-head demand-head">
          <div><span></span><h2>الأكثر طلباً</h2></div>
          <a href="/shop" data-link>عرض الكل ←</a>
        </div>
        <div class="product-grid">${featured.map(productCard).join("")}</div>
      </div>
    </section>
    <section class="categories-section">
      <div class="container">
        <div class="categories-head">
          <span></span>
          <h2>الأقسام</h2>
        </div>
        <div class="categories-grid">
          ${state.types.map((type, index) => `
            <a class="category-tile" style="transition-delay:${index * 50}ms" href="/shop?type=${type.slug}" data-link>${type.ar}</a>
          `).join("")}
        </div>
      </div>
    </section>
    <section class="benefits-section">
      <div class="container">
        <div class="benefits-grid">
          <div><p>توصيل لكل الكويت</p><span>وشحن عالمي لجميع الدول</span></div>
          <div><p>قسّطها على 4 دفعات</p><span>بدون فوائد مع تابي</span></div>
          <div><p>دفع آمن 100%</p><span>KNET وApple Pay والبطاقات</span></div>
          <div><p>دعم واتساب فوري</p><span>نرد عليك بنفس اليوم</span></div>
        </div>
      </div>
    </section>
    <section class="instagram-section">
      <div class="container">
        <h2>+34 ألف متابع على انستغرام</h2>
        <p>شوف أحدث القطع وتركيبات عملائنا أول بأول</p>
        <a href="https://www.instagram.com/autoobenz/" target="_blank" rel="noopener noreferrer">@autoobenz — حساب موثّق ✓</a>
      </div>
    </section>
  `;
  const finder = document.querySelector("#homeFinder");
  const brandSelect = finder.querySelector('select[name="brand"]');
  const modelSelect = finder.querySelector('select[name="model"]');
  brandSelect.addEventListener("change", () => {
    const models = brandModels(brandSelect.value);
    modelSelect.innerHTML = `<option value="">كل الموديلات</option>${models.map((model) => `<option value="${model.slug}">${escapeHtml(model.name)}</option>`).join("")}`;
  });
  finder.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    if (data.get("brand")) params.set("brand", data.get("brand"));
    if (data.get("model")) params.set("model", data.get("model"));
    navigate(`/shop${params.toString() ? `?${params}` : ""}`);
  });
}

function renderShop() {
  const params = new URLSearchParams(location.search);
  const selectedBrand = params.get("brand") || "";
  const selectedType = params.get("type") || "";
  const selectedModel = params.get("model") || "";
  const q = params.get("q") || "";
  const modelOptions = selectedBrand ? brandModels(selectedBrand) : [];

  const filtered = state.products.filter((product) => {
    return inBrand(product, selectedBrand)
      && (!selectedModel || product.cat_slugs.includes(selectedModel))
      && (!selectedType || product.cat_slugs.includes(selectedType))
      && (!q || product.name.toLowerCase().includes(q.toLowerCase()));
  });

  app.innerHTML = `
    <section class="shop-layout">
      <div class="container">
        <h1 class="page-title">${selectedBrand ? `قطع ${state.brands.find((brand) => brand.slug === selectedBrand)?.ar || ""}` : "كل المنتجات"}</h1>
        <form class="filters" id="filtersForm">
          <select name="brand" aria-label="الماركة">
            <option value="">كل الماركات</option>
            ${state.brands.map((brand) => `<option value="${brand.slug}" ${brand.slug === selectedBrand ? "selected" : ""}>${brand.ar} — ${brand.en}</option>`).join("")}
          </select>
          <select name="model" aria-label="الموديل" ${!selectedBrand ? "disabled" : ""}>
            <option value="">كل الموديلات</option>
            ${modelOptions.map((model) => `<option value="${model.slug}" ${model.slug === selectedModel ? "selected" : ""}>${model.name}</option>`).join("")}
          </select>
          <select name="type" aria-label="نوع القطعة">
            <option value="">كل الأقسام</option>
            ${state.types.map((type) => `<option value="${type.slug}" ${type.slug === selectedType ? "selected" : ""}>${type.ar}</option>`).join("")}
          </select>
          <input name="q" value="${escapeHtml(q)}" placeholder="ابحث باسم المنتج..." aria-label="بحث">
        </form>
        <div class="results-line">${filtered.length} منتج</div>
        ${filtered.length ? `<div class="product-grid">${filtered.map(productCard).join("")}</div>` : `<div class="empty-state"><b>ما لقينا نتائج</b><p>جرب تغير الفلتر، أو كلمنا واتساب ونوفر لك القطعة اللي تبيها.</p></div>`}
      </div>
    </section>
  `;

  document.querySelector("#filtersForm").addEventListener("change", updateFilters);
  document.querySelector("#filtersForm").addEventListener("input", (event) => {
    if (event.target.name === "q") updateFilters();
  });
}

function updateFilters() {
  const form = document.querySelector("#filtersForm");
  const data = new FormData(form);
  const params = new URLSearchParams();
  ["brand", "model", "type", "q"].forEach((key) => {
    const value = data.get(key);
    if (value) params.set(key, value);
  });
  history.replaceState(null, "", `/shop${params.toString() ? `?${params}` : ""}`);
  renderShop();
}

function renderProduct(slug) {
  const product = state.products.find((item) => item.slug === slug);
  if (!product) {
    renderNotFound();
    return;
  }
  const brand = productBrand(product);
  const related = state.products
    .filter((item) => item.id !== product.id && brand && inBrand(item, brand.slug))
    .slice(0, 4);
  const discount = product.regular_price > product.price ? Math.round((1 - product.price / product.regular_price) * 100) : 0;
  app.innerHTML = `
    <section class="product-page">
      <div class="container">
        <nav class="breadcrumbs"><a href="/" data-link>الرئيسية</a> / <a href="/shop" data-link>المتجر</a></nav>
        <div class="product-detail">
          <div>
            <div class="gallery-main"><img id="mainImage" src="${imgLocal(product.images[0])}" alt="${escapeHtml(product.name)}"></div>
            <div class="thumbs">
              ${product.images.map((image, index) => `<button class="${index === 0 ? "active" : ""}" data-image="${imgLocal(image)}"><img src="${imgLocal(image)}" alt=""></button>`).join("")}
            </div>
          </div>
          <div class="product-info">
            ${brand ? `<div class="eyebrow">${escapeHtml(brand.ar)}</div>` : ""}
            <h1>${escapeHtml(product.name)}</h1>
            <div class="detail-price">
              <span class="price">${money(product.price)}</span>
              ${discount ? `<span class="old-price">${money(product.regular_price)}</span><span class="sale-badge">خصم ${discount}%</span>` : ""}
            </div>
            <p class="installment">أو قسّطها على 4 دفعات × <b>${money(product.price / 4)}</b> بدون فوائد مع تابي</p>
            <p class="description">${escapeHtml(product.description || "تواصل معنا لمعرفة التفاصيل والتوافق.")}</p>
            <div class="chips"><span>التوافق:</span>${product.categories.map((cat) => `<span class="chip">${escapeHtml(cat)}</span>`).join("")}</div>
            <div class="product-actions">
              <button class="primary-button" type="button" onclick="addToCart(${product.id})">إضافة للسلة</button>
              <a class="secondary-button" href="https://wa.me/96550304591?text=${encodeURIComponent(`مرحبا، عندي استفسار عن ${product.name}`)}" target="_blank" rel="noreferrer">استفسار واتساب</a>
            </div>
            <ul class="trust-list">
              <li>✓ توصيل لكل مناطق الكويت — وشحن عالمي</li>
              <li>✓ دفع آمن: KNET، Apple Pay، Visa/Mastercard</li>
              <li>✓ متجر موثّق — سجل تجاري 525945</li>
            </ul>
          </div>
        </div>
        ${related.length ? `<section class="section"><div class="section-head"><h2>قطع ثانية لـ ${brand.ar}</h2></div><div class="product-grid">${related.map(productCard).join("")}</div></section>` : ""}
      </div>
    </section>
  `;
  document.querySelectorAll(".thumbs button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("#mainImage").src = button.dataset.image;
      document.querySelectorAll(".thumbs button").forEach((entry) => entry.classList.remove("active"));
      button.classList.add("active");
    });
  });
}

function renderVin() {
  app.innerHTML = `
    <section class="shop-layout">
      <div class="container">
        <h1 class="page-title">افحص سيارتك VIN</h1>
        <div class="vin-panel">
          <label>اكتب رقم الشاصي (VIN) ونجيب لك القطع المتوافقة مع سيارتك بالضبط</label>
          <div class="vin-row">
            <input id="vinInput" maxlength="20" placeholder="مثال: WDD2130421A123456">
            <button class="primary-button" id="vinButton">افحص سيارتي</button>
          </div>
          <div class="vin-result" id="vinResult">رقم الشاصي تلقاه بالاستمارة أو خلف الزجاج الأمامي.</div>
        </div>
      </div>
    </section>
  `;
  document.querySelector("#vinButton").addEventListener("click", () => {
    const vin = document.querySelector("#vinInput").value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
    const result = document.querySelector("#vinResult");
    if (vin.length !== 17) {
      result.textContent = `${vin.length}/17 خانة — تأكد من إدخال رقم الشاصي كامل.`;
      return;
    }
    result.innerHTML = `تم استلام رقم الشاصي <b dir="ltr">${vin}</b>. تواصل معنا على واتساب لإرسال القطع المتوافقة بدقة.`;
  });
}

function renderNotFound() {
  app.innerHTML = `<div class="container"><div class="empty-state"><b>الصفحة غير موجودة</b><p>ارجع للمتجر وتصفح المنتجات.</p><a class="primary-button" href="/shop" data-link>المتجر</a></div></div>`;
}

function renderFooterLinks() {
  document.querySelector("#footerTypes").innerHTML = state.types.map((type) => `<li><a href="/shop?type=${type.slug}" data-link>${type.ar}</a></li>`).join("");
  document.querySelector("#footerBrands").innerHTML = state.brands.slice(0, 6).map((brand) => `<li><a href="/shop?brand=${brand.slug}" data-link>${brand.ar}</a></li>`).join("");
}

function setActiveNav() {
  const path = location.pathname;
  document.querySelectorAll(".desktop-nav a").forEach((link) => {
    link.classList.toggle("active", new URL(link.href).pathname === path);
  });
}

function render() {
  setActiveNav();
  if (location.pathname === "/" || location.pathname === "/index.html") renderHome();
  else if (location.pathname === "/shop") renderShop();
  else if (location.pathname === "/vin-check") renderVin();
  else if (location.pathname.startsWith("/product/")) renderProduct(decodeURIComponent(location.pathname.split("/product/")[1]));
  else renderNotFound();
  renderCart();
  scrollTo({ top: 0, behavior: "instant" });
}

async function boot() {
  const [products, categories, brands, types] = await Promise.all([
    fetch("/assets/data/products.json").then((res) => res.json()),
    fetch("/assets/data/categories.json").then((res) => res.json()),
    fetch("/assets/data/brands.json").then((res) => res.json()),
    fetch("/assets/data/types.json").then((res) => res.json()),
  ]);
  state.products = products.sort((a, b) => Number(b.id) - Number(a.id));
  state.categories = categories;
  state.brands = brands;
  state.types = types;
  renderFooterLinks();
  render();
}

boot().catch((error) => {
  app.innerHTML = `<div class="container"><div class="empty-state"><b>تعذر تحميل بيانات الموقع</b><p>${escapeHtml(error.message)}</p></div></div>`;
});
