function json(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function cleanSecret(value) {
  return String(value || "").replace(/\s+/g, "");
}

function pick(obj, names) {
  for (const name of names) {
    if (obj && obj[name] !== undefined && obj[name] !== null && obj[name] !== "") return obj[name];
  }
  return "";
}

function pickDeep(obj, names) {
  if (!obj || typeof obj !== "object") return "";
  const direct = pick(obj, names);
  if (direct) return direct;
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const nested = pickDeep(value, names);
      if (nested) return nested;
    }
  }
  return "";
}

async function supabasePatch(filter, payload) {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const serviceKey = cleanSecret(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
  if (!supabaseUrl || !serviceKey || !filter) return false;

  const response = await fetch(`${supabaseUrl}/rest/v1/orders?${filter}`, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });
  return response.ok;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const webhookSecret = cleanSecret(process.env.TALY_WEBHOOK_SECRET);
  if (webhookSecret) {
    const sentSecret = cleanSecret(req.headers["x-taly-webhook-key"]);
    if (sentSecret !== webhookSecret) {
      return json(res, 401, { ok: false, error: "Invalid webhook key" });
    }
  }

  const body = req.method === "POST" ? await readBody(req) : {};
  const query = req.query || {};
  const event = body?.data || body?.response || body || query;
  const talyOrderId = String(pickDeep(event, ["talyOrderId", "taly_order_id", "orderId", "order_id", "id"]));
  const orderReference = String(pickDeep(event, ["orderReference", "order_reference", "reference"]));
  const merchantOrderId = String(pickDeep(event, ["merchantOrderId", "merchant_order_id", "orderNumber", "order_number"]));
  const statusRaw = String(pickDeep(event, ["status", "paymentStatus", "payment_status", "state"])).toLowerCase();
  const isPaid = ["confirmed", "paid", "success", "successful", "completed", "captured", "approved"].some((word) => statusRaw.includes(word));
  const isFailed = ["cancel", "cancelled", "canceled", "reject", "rejected", "failed", "failure", "declined"].some((word) => statusRaw.includes(word));
  const updatePayload = {
    payment_method: "taly",
    payment_status: isPaid ? "paid" : (isFailed ? "failed" : (statusRaw || "updated")),
    status: isPaid ? "paid" : (isFailed ? "cancelled" : "new"),
    taly_status: statusRaw || null,
    taly_webhook_payload: req.method === "POST" ? body : query,
    paid_at: isPaid ? new Date().toISOString() : null,
  };

  let updated = false;
  if (talyOrderId) updated = await supabasePatch(`taly_order_id=eq.${encodeURIComponent(talyOrderId)}`, updatePayload);
  if (!updated && orderReference) updated = await supabasePatch(`taly_order_reference=eq.${encodeURIComponent(orderReference)}`, updatePayload);
  if (!updated && merchantOrderId) updated = await supabasePatch(`order_number=eq.${encodeURIComponent(merchantOrderId)}`, updatePayload);

  return json(res, 200, { ok: true });
};
