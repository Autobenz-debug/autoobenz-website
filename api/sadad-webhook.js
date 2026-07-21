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

function pick(obj, names) {
  for (const name of names) {
    if (obj && obj[name] !== undefined && obj[name] !== null) return obj[name];
  }
  return "";
}

async function supabaseUpdateByInvoice(invoiceId, payload) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey || !invoiceId) return false;

  const response = await fetch(`${supabaseUrl}/rest/v1/orders?sadad_invoice_id=eq.${encodeURIComponent(invoiceId)}`, {
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
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const body = await readBody(req);
  const event = body?.response || body?.data || body;
  const invoiceId = String(pick(event, ["invoiceId", "InvoiceId", "invoice_id", "id"]));
  const statusRaw = String(pick(event, ["status", "Status", "paymentStatus", "PaymentStatus"])).toLowerCase();
  const isPaid = statusRaw.includes("paid") || statusRaw.includes("success") || statusRaw.includes("complete");

  await supabaseUpdateByInvoice(invoiceId, {
    payment_status: isPaid ? "paid" : (statusRaw || "updated"),
    status: isPaid ? "paid" : "new",
    sadad_status: statusRaw || null,
    sadad_webhook_payload: body,
    paid_at: isPaid ? new Date().toISOString() : null,
  });

  return json(res, 200, { ok: true });
};
