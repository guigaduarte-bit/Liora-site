'use strict';

const orders = require('./_orders');
const { checkInfinitePay } = require('./_infinitepay');
const { configuration, verifyProof, fail, respondError, responseHeaders } = require('./_payment');

module.exports = async function handler(req, res) {
  responseHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido' });
  }
  try {
    const config = configuration('infinitepay');
    const proof = verifyProof(req, 'infinitepay', config);
    const query = req.query || {};
    const orderId = query.order_id || query.order_nsu;
    const transactionNsu = query.transaction_nsu;
    const slug = query.slug || query.invoice_slug;
    if (orderId !== proof.orderId || typeof transactionNsu !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(transactionNsu)
      || typeof slug !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(slug)) {
      fail('PAYMENT_IDENTIFICATION_INVALID', 'Identificação do pagamento inválida.', 400);
    }
    const result = await checkInfinitePay({ config, proof, transactionNsu, slug });
    const recorded = await orders.reconcile(proof, result);
    return res.status(200).json({ order_id: proof.orderId, status: recorded?.status || result.status, payment_mode: proof.mode });
  } catch (error) { return respondError(res, error); }
};
