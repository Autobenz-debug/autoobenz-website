function json(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
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
    if (obj && obj[name] !== undefined && obj[name] !== null) return obj[name];
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

  const body = req.method === "POST" ? await readBody(req) : {};
  const query = req.query || {};
  const event = body?.data || body?.response || body || query;
  const orderReference = String(pick(event, ["order_reference", "orderReference", "reference", "id"]));
  const merchantOrderId = String(pick(event, ["merchant_order_id", "merchantOrderId", "order_number", "orderNumber"]));
  const statusRaw = String(pick(event, ["status", "payment_status", "paymentStatus", "state"])).toLowerCase();
  const isPaid = ["paid", "success", "successful", "completed", "captured", "approved"].some((word) => statusRaw.includes(word));
  const updatePayload = {
    payment_method: "deema",
    payment_status: isPaid ? "paid" : (statusRaw || "updated"),
    status: isPaid ? "paid" : "new",
    deema_status: statusRaw || null,
    deema_webhook_payload: req.method === "POST" ? body : query,
    paid_at: isPaid ? new Date().toISOString() : null,
  };

  let updated = false;
  if (orderReference) {
    updated = await supabasePatch(`deema_order_reference=eq.${encodeURIComponent(orderReference)}`, updatePayload);
  }
  if (!updated && merchantOrderId) {
    updated = await supabasePatch(`order_number=eq.${encodeURIComponent(merchantOrderId)}`, updatePayload);
  }

  return json(res, 200, { ok: true });
};
