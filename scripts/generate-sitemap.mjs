import fs from "node:fs";

const products = JSON.parse(fs.readFileSync(new URL("../assets/data/products.json", import.meta.url), "utf8"));
const baseUrl = "https://www.autoobenz.com";
const lastmod = new Date().toISOString().slice(0, 10);

const staticUrls = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/shop", priority: "0.9", changefreq: "daily" },
  { path: "/vin-check", priority: "0.5", changefreq: "monthly" },
];

const urls = [
  ...staticUrls,
  ...products.map((product) => ({
    path: `/product/${encodeURIComponent(product.slug)}`,
    priority: "0.8",
    changefreq: "weekly",
  })),
];

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(({ path, priority, changefreq }) => [
    "  <url>",
    `    <loc>${baseUrl}${path}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n")),
  "</urlset>",
].join("\n");

fs.writeFileSync(new URL("../sitemap.xml", import.meta.url), `${xml}\n`);
console.log(`Generated sitemap.xml with ${urls.length} URLs.`);
