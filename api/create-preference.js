'use strict';

const orders = require('./_orders');
const { cpf, createPix } = require('./_pix');
const { createInfinitePay } = require('./_infinitepay');
const paymentPolicy = require('../content/payment-policy.json');
const { randomUUID } = require('node:crypto');
const CATALOG = require('./catalog');
const { SHIP_FREE, cleanZip, quoteShipping, roundCurrency, ShippingQuoteError } = require('./_shipping');
const { verifyQuote } = require('./_shipping-proof');
const { PaymentError, configuration, siteOrigin, signProof, pixSubtotal, httpsUrl, providerRequest, fail, respondError, responseHeaders } = require('./_payment');

const PAYMENT_TYPES = ['credit_card', 'debit_card', 'ticket', 'bank_transfer'];
const PAYMENT_METHODS = new Set(['pix', 'card', 'boleto', 'infinitepay']);
const SHIPPING_METHODS = new Set(['delivery']);

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString());
  return {};
}

function validateCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Carrinho vazio');
  if (items.length > 50) throw new Error('Carrinho possui itens demais');

  const quantitiesByProduct = new Map();
  const validated = items.map((item) => {
    const id = cleanText(item && item.id, 100);
    const product = CATALOG[id];
    const quantity = Number(item && item.qty);

    if (!product || product.soldout || product.stock < 1) {
      throw new Error('Um produto do carrinho não está disponível');
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error('Quantidade inválida no carrinho');
    }

    const accumulated = (quantitiesByProduct.get(id) || 0) + quantity;
    if (accumulated > product.stock) {
      throw new Error(`Estoque insuficiente para ${product.name}`);
    }
    quantitiesByProduct.set(id, accumulated);

    return {
      id,
      name: product.name,
      price: product.price,
      quantity,
      fragrance: cleanText(item.frag, 60)
    };
  });

  const totalQuantity = validated.reduce((sum, item) => sum + item.quantity, 0);
  if (totalQuantity > 200) throw new Error('Quantidade total inválida');
  return validated;
}

function titleFor(item) {
  const fragrance = item.fragrance ? ` — ${item.fragrance}` : '';
  return `${item.name}${fragrance}`.slice(0, 250);
}

function buildPaymentItems(cart, payMethod, subtotal) {
  if (payMethod !== 'pix') {
    return cart.map((item) => ({
      id: item.id,
      title: titleFor(item),
      quantity: item.quantity,
      unit_price: item.price,
      currency_id: 'BRL'
    }));
  }

  // Checkout Pro não deve receber item com preço negativo. No Pix, cada linha
  // vira uma unidade com o total já descontado; a última absorve os centavos de
  // arredondamento para manter exatamente 5% no total do carrinho.
  const discountedSubtotal = pixSubtotal(subtotal);
  let allocated = 0;
  return cart.map((item, index) => {
    const isLast = index === cart.length - 1;
    const lineTotal = roundCurrency(item.price * item.quantity);
    const unitPrice = isLast
      ? roundCurrency(discountedSubtotal - allocated)
      : pixSubtotal(lineTotal);
    allocated = roundCurrency(allocated + unitPrice);
    return {
      id: item.id,
      title: `${item.quantity}× ${titleFor(item)}`.slice(0, 250),
      quantity: 1,
      unit_price: unitPrice,
      currency_id: 'BRL'
    };
  });
}

function paymentSettings(payMethod) {
  let allowed = PAYMENT_TYPES;
  let installments;

  if (payMethod === 'pix') allowed = ['bank_transfer'];
  if (payMethod === 'boleto') allowed = ['ticket'];
  if (payMethod === 'card') {
    allowed = ['credit_card'];
    installments = paymentPolicy.maxInstallments;
  }

  return {
    excluded_payment_types: PAYMENT_TYPES
      .filter((type) => !allowed.includes(type))
      .map((id) => ({ id })),
    ...(installments ? { installments } : {})
  };
}

module.exports = async function handler(req, res) {
  responseHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { items, payMethod, shipping, payer, returnOrigin, checkoutKey } = parseBody(req);
    const selectedPayment = cleanText(payMethod, 20);
    const selectedShipping = cleanText(shipping && shipping.method, 20);

    if (!PAYMENT_METHODS.has(selectedPayment)) {
      return res.status(400).json({ code: 'PAYMENT_METHOD_UNAVAILABLE', error: 'Escolha uma das formas de pagamento disponíveis.' });
    }
    if (!SHIPPING_METHODS.has(selectedShipping)) {
      return res.status(400).json({ error: 'Meio de envio inválido' });
    }

    const provider = selectedPayment === 'infinitepay' ? 'infinitepay' : 'mercadopago';
    const config = configuration(provider);
    const durable = orders.enabled();
    if (durable) {
      orders.settings();
      if (provider === 'mercadopago' && (!process.env.MP_WEBHOOK_SECRET || process.env.MP_WEBHOOK_SECRET.length < 32)) fail('PAYMENT_WEBHOOK_NOT_CONFIGURED');
    }
    const siteUrl = siteOrigin(config, returnOrigin);
    if (returnOrigin !== undefined && returnOrigin !== siteUrl) {
      fail('CHECKOUT_ORIGIN_MISMATCH', 'Abra a loja pelo endereço configurado para este checkout antes de continuar.', 409);
    }

    const name = cleanText(payer && payer.name, 120);
    const email = cleanText(payer && payer.email, 160).toLowerCase();
    const zipCode = cleanZip(payer && payer.cep);
    const streetNumber = cleanText(payer && payer.num, 20);
    const address = cleanText(payer && payer.addr, 250);

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Nome e e-mail válidos são obrigatórios' });
    }
    if (selectedShipping === 'delivery' && (zipCode.length !== 8 || !address)) {
      return res.status(400).json({ error: 'Endereço de entrega incompleto' });
    }

    const cart = validateCart(items);
    if (durable && selectedPayment === 'pix' && !cpf(payer?.cpf)) fail('PIX_CPF_INVALID', 'Informe um CPF válido para gerar o Pix.', 400);
    const subtotal = roundCurrency(cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    ));
    let selectedQuote = null;
    let shippingCost = 0;
    if (selectedShipping === 'delivery') {
      const serviceId = cleanText(shipping && shipping.serviceId, 80);
      if (shipping.quoteProof !== undefined) {
        selectedQuote = verifyQuote(shipping.quoteProof, { zipCode, cart, serviceId }, config);
      } else {
        // Compatibilidade com páginas abertas antes da atualização.
        const quoteResult = await quoteShipping({ zipCode, cart, subtotal });
        selectedQuote = quoteResult.quotes.find((quote) => quote.id === serviceId);
      }
      if (!selectedQuote) return res.status(400).json({ error: 'Selecione novamente a opção de entrega' });
      if (selectedQuote.preview) {
        return res.status(503).json({
          error: selectedQuote.estimated
            ? 'A embalagem estimada precisa ser conferida antes de liberar o pagamento com este frete.'
            : 'A cotação real da SuperFrete precisa ser conectada antes do pagamento',
          code: selectedQuote.estimated ? 'SHIPPING_ESTIMATE_NOT_VALIDATED' : 'SHIPPING_PREVIEW_ONLY'
        });
      }
      shippingCost = subtotal >= SHIP_FREE ? 0 : selectedQuote.price;
    }
    const productTotal = selectedPayment === 'pix'
      ? pixSubtotal(subtotal)
      : subtotal;
    const total = roundCurrency(productTotal + shippingCost);
    const orderId = durable ? orders.identity(checkoutKey, config) : `LIORA-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const checkoutProof = signProof({ orderId, provider, totalCents: Math.round(total * 100), method: selectedPayment, registered: durable }, config);
    const returnUrl = `${siteUrl}/?checkout=return&order_id=${encodeURIComponent(orderId)}`;

    if (durable) {
      const snapshot = { id: orderId, provider, environment: config.environment, mode: config.mode, method: selectedPayment,
        total_cents: Math.round(total * 100), subtotal_cents: Math.round(subtotal * 100), discount_cents: Math.round((subtotal - productTotal) * 100),
        shipping_cents: Math.round(shippingCost * 100), interest_free_installments: paymentPolicy.interestFreeInstallments,
        customer: { name, email, cep: zipCode, number: streetNumber || 'S/N', address }, items: cart,
        shipping: { id: selectedQuote.id, name: selectedQuote.name, carrier: selectedQuote.carrier, deliveryDays: selectedQuote.deliveryDays || 0 } };
      const registered = await orders.register(snapshot, { snapshot, cpf: selectedPayment === 'pix' ? cpf(payer.cpf) : null });
      if (registered.order.checkout_response) return res.status(200).json({ ...registered.order.checkout_response, checkout_proof: checkoutProof });
      if (!registered.created && selectedPayment !== 'pix') fail('ORDER_ALREADY_STARTED', 'Este pedido já está sendo processado. Consulte o pagamento antes de tentar novamente.', 409);
    }
    const finish = async (data) => {
      if (durable) await orders.saveCheckout(orderId, config.environment, data);
      return res.status(200).json({ ...data, checkout_proof: checkoutProof });
    };
    if (durable && selectedPayment === 'pix') {
      const pix = await createPix({ orderId, total, payer: { name, email, cpf: payer.cpf }, config, notificationUrl: `${siteUrl}/api/payment-webhook?provider=mercadopago` });
      return await finish({ ...pix, order_id: orderId, provider, payment_mode: config.mode, total });
    }

    if (provider === 'infinitepay') {
      const checkout = await createInfinitePay({ config, orderId, siteUrl, cart, shippingCost, selectedQuote,
        customer: { name, email }, address: { cep: zipCode, number: streetNumber || 'S/N', complement: address }, durable });
      return await finish({ ...checkout, order_id: orderId, provider, payment_mode: config.mode, total });
    }

    const preference = {
      items: buildPaymentItems(cart, selectedPayment, subtotal),
      payer: {
        name,
        email,
        ...(selectedShipping === 'delivery' ? {
          address: {
            zip_code: zipCode,
            street_name: address,
            street_number: streetNumber || 'S/N'
          }
        } : {})
      },
      ...(selectedShipping === 'delivery' ? {
        shipments: { cost: shippingCost, mode: 'not_specified' }
      } : {}),
      payment_methods: paymentSettings(selectedPayment),
      back_urls: {
        success: returnUrl,
        failure: returnUrl,
        pending: returnUrl
      },
      auto_return: 'approved',
      external_reference: orderId,
      statement_descriptor: 'LIORA AROMAS',
      metadata: {
        order_id: orderId,
        shipping_method: selectedShipping,
        shipping_service: selectedQuote.name,
        shipping_carrier: selectedQuote.carrier,
        shipping_delivery_days: selectedQuote.deliveryDays || 0,
        subtotal,
        total
      }
    };

    if (durable) preference.notification_url = `${siteUrl}/api/payment-webhook?provider=mercadopago`;
    else if (process.env.MP_WEBHOOK_URL) {
      const webhookUrl = httpsUrl(process.env.MP_WEBHOOK_URL, [new URL(siteUrl).hostname]);
      if (!webhookUrl) fail('PAYMENT_WEBHOOK_URL_INVALID');
      preference.notification_url = webhookUrl.toString();
    }

    const data = await providerRequest('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.credential}`
      },
      body: JSON.stringify(preference)
    });
    const checkoutUrl = httpsUrl(data.init_point, ['www.mercadopago.com.br', 'mercadopago.com.br', ...(config.mode === 'test' ? ['sandbox.mercadopago.com.br'] : [])]);
    if (!checkoutUrl || typeof data.id !== 'string' || !data.id || data.id.length > 200) fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível iniciar o pagamento.', 502);
    if (typeof data.live_mode !== 'undefined' && data.live_mode !== (config.mode === 'live')) fail('PAYMENT_ENVIRONMENT_MISMATCH');

    return await finish({
      id: data.id,
      init_point: checkoutUrl.toString(),
      order_id: orderId,
      provider: 'mercadopago',
      payment_mode: config.mode,
      total
    });
  } catch (error) {
    if (error instanceof ShippingQuoteError) {
      console.warn(JSON.stringify({ event: 'checkout_shipping_failed', code: error.code }));
      return res.status(error.status).json({ code: error.code, error: error.message });
    }
    if (error instanceof PaymentError) return respondError(res, error);
    if (error instanceof SyntaxError) {
      return res.status(400).json({ error: 'Dados do checkout inválidos' });
    }
    if (error && error.code === 'SHIPPING_DATA_INCOMPLETE') {
      return res.status(503).json({ error: error.message, code: error.code });
    }
    if (error && /Carrinho|produto|Quantidade|Estoque/i.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    return respondError(res, error);
  }
};
