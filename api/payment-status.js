'use strict';

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

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({ error: 'Pagamento temporariamente indisponível' });
  }

  const paymentId = String(req.query && req.query.payment_id || '');
  const orderId = String(req.query && req.query.order_id || '');
  if (!/^\d{1,30}$/.test(paymentId) || !/^LIORA-[A-Z0-9-]{10,80}$/.test(orderId)) {
    return res.status(400).json({ error: 'Identificação do pagamento inválida' });
  }

  try {
    const mpResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const payment = await mpResponse.json().catch(() => ({}));

    if (!mpResponse.ok) {
      console.error('Mercado Pago não retornou o pagamento', { status: mpResponse.status });
      return res.status(502).json({ error: 'Não foi possível confirmar o pagamento' });
    }
    if (payment.external_reference !== orderId) {
      return res.status(409).json({ error: 'Pagamento não corresponde a este pedido' });
    }

    return res.status(200).json({
      payment_id: String(payment.id),
      order_id: orderId,
      status: payment.status,
      status_detail: payment.status_detail || null
    });
  } catch (error) {
    console.error('Erro ao consultar pagamento', error);
    return res.status(500).json({ error: 'Erro interno ao confirmar pagamento' });
  }
};
