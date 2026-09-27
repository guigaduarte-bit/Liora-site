'use strict';

const CATALOG = require('./catalog');
const SHIPPING_PRODUCTS = require('../content/shipping-products.json');
const EDITORIAL = require('../content/product-editorial.json');
const DISPLAY_NAMES = new Map(EDITORIAL.map((product) => [product.id, product.displayName]));
const { estimateCartPackaging, isShippingEstimatePreview } = require('./_shipping-estimate');

// This endpoint estimates packaging only. It does not create quotes, labels,
// orders or payments, and never uses customer contact/address information.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!isShippingEstimatePreview()) return res.status(404).json({ error: 'Não encontrado' });
  if (req.method === 'GET') {
    return res.status(200).json({
      products: Object.entries(CATALOG).map(([id, product]) => ({
        id, name: DISPLAY_NAMES.get(id) || product.name, stock: product.stock,
        weightGrams: SHIPPING_PRODUCTS[id]?.weightGrams ?? null,
        dimensionsCm: SHIPPING_PRODUCTS[id]?.dimensionsCm ?? null
      }))
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }
  try {
    const body = typeof req.body === 'string' || Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString()) : req.body;
    const items = body?.items;
    if (!Array.isArray(items) || !items.length || items.length > 50) {
      return res.status(400).json({ error: 'Selecione entre 1 e 50 linhas de produtos.' });
    }
    let count = 0;
    const cart = items.map((item) => {
      if (!item || typeof item.id !== 'string' || !Object.hasOwn(CATALOG, item.id)
        || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 100) {
        throw new Error('INVALID_ITEMS');
      }
      count += item.qty;
      return { id: item.id, quantity: item.qty };
    });
    if (count > 100) throw new Error('INVALID_ITEMS');
    // Simulation may exceed current inventory. The checkout endpoint continues
    // to enforce stock before using the exact same estimator.
    return res.status(200).json({ packaging: estimateCartPackaging(cart) });
  } catch {
    return res.status(400).json({ error: 'Informe produtos válidos e até 100 peças para simular.' });
  }
};
