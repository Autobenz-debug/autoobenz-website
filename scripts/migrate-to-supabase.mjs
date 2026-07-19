import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SKIP_IMAGE_UPLOAD = process.env.SKIP_IMAGE_UPLOAD === "1";
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BUCKET = "product-images";

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables.");
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

const readJson = async (file) => JSON.parse(await readFile(join(ROOT, "assets", "data", file), "utf8"));

const api = async (path, options = {}) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${await response.text()}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

const upsert = (table, rows, onConflict) => api(`${table}?on_conflict=${onConflict}`, {
  method: "POST",
  headers: {
    Prefer: "resolution=merge-duplicates,return=representation",
  },
  body: JSON.stringify(rows),
});

const publicImageUrl = (name) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${name}`;

const localImageName = (url) => {
  try {
    return new URL(url).pathname.split("/").pop();
  } catch {
    return String(url).split("/").pop();
  }
};

const uploadImage = async (name) => {
  if (SKIP_IMAGE_UPLOAD) return publicImageUrl(name);
  const filePath = join(ROOT, "assets", "images", name);
  if (!existsSync(filePath)) return null;
  const body = await readFile(filePath);
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "image/webp",
      "x-upsert": "true",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Upload ${name} failed: ${response.status} ${await response.text()}`);
  }
  return publicImageUrl(name);
};

const slugSet = (items) => new Set(items.map((item) => item.slug));

const main = async () => {
  const [products, categories, brands, types] = await Promise.all([
    readJson("products.json"),
    readJson("categories.json"),
    readJson("brands.json"),
    readJson("types.json"),
  ]);

  console.log("Upserting brands, categories, and product types...");
  const savedBrands = await upsert("brands", brands.map((brand, index) => ({
    slug: brand.slug,
    name_ar: brand.ar,
    name_en: brand.en,
    sort_order: index,
  })), "slug");

  const savedTypes = await upsert("product_types", types.map((type, index) => ({
    slug: type.slug,
    name_ar: type.ar,
    name_en: type.en || type.ar,
    sort_order: index,
  })), "slug");

  const savedCategories = await upsert("categories", categories.map((category, index) => ({
    slug: category.slug,
    name_ar: category.name,
    name_en: category.name,
    sort_order: index,
    old_id: category.id,
    parent_old_id: category.parent || 0,
    product_count: category.count || 0,
  })), "slug");

  const brandBySlug = new Map(savedBrands.map((brand) => [brand.slug, brand.id]));
  const typeBySlug = new Map(savedTypes.map((type) => [type.slug, type.id]));
  const categoryBySlug = new Map(savedCategories.map((category) => [category.slug, category.id]));
  const brandSlugs = slugSet(brands);
  const typeSlugs = slugSet(types);

  console.log("Upserting products...");
  const savedProducts = await upsert("products", products.map((product, index) => {
    const catSlugs = product.cat_slugs || [];
    const brandSlug = catSlugs.find((slug) => brandSlugs.has(slug)) || brands.find((brand) => product.name.toLowerCase().includes(brand.en.toLowerCase()))?.slug;
    const typeSlug = catSlugs.find((slug) => typeSlugs.has(slug));
    const categorySlug = catSlugs.find((slug) => !brandSlugs.has(slug) && !typeSlugs.has(slug)) || catSlugs[0];
    return {
      old_id: String(product.id),
      slug: product.slug,
      title_ar: product.name,
      title_en: product.name,
      description_ar: product.description || "",
      description_en: product.description || "",
      price_kwd: Number(product.price || 0),
      compare_at_price_kwd: Number(product.regular_price || product.price || 0),
      brand_id: brandSlug ? (brandBySlug.get(brandSlug) ?? null) : null,
      category_id: categorySlug ? (categoryBySlug.get(categorySlug) ?? null) : null,
      type_id: typeSlug ? (typeBySlug.get(typeSlug) ?? null) : null,
      model: categorySlug || null,
      stock_quantity: product.in_stock === false ? 0 : 999,
      is_active: true,
      is_featured: index >= products.length - 8,
      sort_order: index,
      cat_slugs: catSlugs,
    };
  }), "old_id");

  const productByOldId = new Map(savedProducts.map((product) => [product.old_id, product.id]));

  console.log("Uploading images and creating image rows...");
  const imageRows = [];
  let uploaded = 0;
  for (const product of products) {
    const productId = productByOldId.get(String(product.id));
    if (!productId) continue;
    for (const [index, url] of (product.images || []).entries()) {
      const name = localImageName(url);
      const imageUrl = await uploadImage(name);
      if (!imageUrl) continue;
      uploaded += 1;
      imageRows.push({
        product_id: productId,
        image_url: imageUrl,
        alt_text: product.name,
        sort_order: index,
      });
      if (uploaded % 50 === 0) console.log(`Uploaded ${uploaded} images...`);
    }
  }

  await api("product_images?id=not.is.null", { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (imageRows.length) {
    for (let i = 0; i < imageRows.length; i += 100) {
      await api("product_images", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(imageRows.slice(i, i + 100)),
      });
    }
  }

  console.log(`Done. Products: ${products.length}, images uploaded: ${uploaded}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
