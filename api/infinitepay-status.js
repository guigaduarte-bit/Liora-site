'use strict';

function clean(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

function setResponseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

module.exports = async function handler(req, res) {
  setResponseHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const handle = clean(process.env.INFINITEPAY_HANDLE, 100);
  if (!handle) {
    return res.status(500).json({ error: 'InfinitePay temporariamente indisponível' });
  }

  const orderId = clean(req.query && (req.query.order_id || req.query.order_nsu), 100);
  const transactionNsu = clean(req.query && req.query.transaction_nsu, 120);
  const slug = clean(req.query && (req.query.slug || req.query.invoice_slug), 160);
  if (!/^LIORA-[A-Z0-9-]{10,80}$/.test(orderId) || !transactionNsu || !slug) {
    return res.status(400).json({ error: 'Identificação do pagamento inválida' });
  }

  try {
    const response = await fetch('https://api.checkout.infinitepay.io/payment_check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        handle,
        order_nsu: orderId,
        transaction_nsu: transactionNsu,
        slug
      })
    });
    const payment = await response.json().catch(() => ({}));
    if (!response.ok || payment.success === false) {
      console.error('InfinitePay não retornou o pagamento', { status: response.status });
      return res.status(502).json({ error: 'Não foi possível confirmar o pagamento' });
    }

    return res.status(200).json({
      order_id: orderId,
      status: payment.paid ? 'approved' : 'pending',
      amount: Number.isFinite(Number(payment.amount)) ? Number(payment.amount) : null,
      paid_amount: Number.isFinite(Number(payment.paid_amount)) ? Number(payment.paid_amount) : null,
      installments: Number.isFinite(Number(payment.installments)) ? Number(payment.installments) : null,
      capture_method: clean(payment.capture_method, 40) || null
    });
  } catch (error) {
    console.error('Erro ao consultar pagamento InfinitePay', error);
    return res.status(500).json({ error: 'Erro interno ao confirmar pagamento' });
  }
};

