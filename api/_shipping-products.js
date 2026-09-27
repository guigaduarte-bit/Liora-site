'use strict';

const CATALOG = require('./catalog');
const SHIPPING_PRODUCTS = require('../content/shipping-products.json');

class ShippingDataError extends Error {
  constructor() {
    super('O frete destes produtos ainda está sendo configurado. Entre em contato com a Liora para combinar a entrega.');
    this.name = 'ShippingDataError';
    this.code = 'SHIPPING_DATA_INCOMPLETE';
    this.status = 503;
  }
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function completeDimensions(dimensions) {
  return dimensions && ['length', 'width', 'height'].every((axis) => positiveNumber(dimensions[axis]));
}

// Somente o catálogo do servidor fornece as medidas. weightGrams é o peso da
// peça completa (incluindo recipiente, se houver). packingWeightGrams é a
// parcela de caixa/proteção por unidade, medida e homologada separadamente.
// shippingDimensionsCm corresponde à unidade protegida. Os dados extraídos
// de textos comerciais nunca são aprovados automaticamente para expedição.
function buildShippingProducts(cart) {
  const quantities = new Map();
  for (const item of cart) {
    if (!Object.hasOwn(CATALOG, item.id) || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new ShippingDataError();
    }
    quantities.set(item.id, (quantities.get(item.id) || 0) + item.quantity);
  }
  if (!quantities.size) throw new ShippingDataError();

  // A validação cobre o carrinho inteiro antes de qualquer chamada externa.
  // Fragrâncias do mesmo SKU compartilham peso, dimensões e quantidade.
  return [...quantities].map(([id, quantity]) => {
    const data = Object.hasOwn(SHIPPING_PRODUCTS, id) ? SHIPPING_PRODUCTS[id] : null;
    if (!data || data.confirmedForShipping !== true
      || !positiveNumber(data.weightGrams)
      || !positiveNumber(data.packingWeightGrams)
      || !completeDimensions(data.dimensionsCm)
      || !completeDimensions(data.shippingDimensionsCm)) {
      throw new ShippingDataError();
    }
    // A proteção pode alterar a orientação da peça; compare lados ordenados.
    const bareSides = ['length', 'width', 'height'].map((axis) => data.dimensionsCm[axis]).sort((a, b) => a - b);
    const packedSides = ['length', 'width', 'height'].map((axis) => data.shippingDimensionsCm[axis]).sort((a, b) => a - b);
    const totalWeightGrams = data.weightGrams + data.packingWeightGrams;
    if (!Number.isFinite(totalWeightGrams)
      || bareSides.some((side, index) => side > packedSides[index])) throw new ShippingDataError();

    return {
      quantity,
      // SuperFrete recebe kg por unidade. Não arredondar como moeda: 65g = 0,065kg.
      weight: totalWeightGrams / 1000,
      height: data.shippingDimensionsCm.height,
      width: data.shippingDimensionsCm.width,
      length: data.shippingDimensionsCm.length
    };
  });
}

module.exports = { buildShippingProducts };
