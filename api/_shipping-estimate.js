'use strict';

const CATALOG = require('./catalog');
const SHIPPING_PRODUCTS = require('../content/shipping-products.json');
const PACKAGING = require('../content/shipping-packaging-estimate.json');

const AXES = ['length', 'width', 'height'];

function isShippingEstimatePreview() {
  return process.env.VERCEL_ENV === 'preview';
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmToMm(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const millimeters = Math.round(value * 10);
  return Number.isSafeInteger(millimeters) && Math.abs(value * 10 - millimeters) < 1e-7
    ? millimeters : null;
}

function dimensionsToMm(dimensions) {
  if (!dimensions || typeof dimensions !== 'object') return null;
  const converted = Object.fromEntries(AXES.map((axis) => [axis, cmToMm(dimensions[axis])]));
  return AXES.every((axis) => converted[axis] !== null && converted[axis] > 0) ? converted : null;
}

function issue(id, code, message) {
  return { id, code, message };
}

function result(status, assumptions, { parcels = [], issues = [], pieceCount = 0 } = {}) {
  return {
    status,
    assumptions,
    parcels,
    totalWeightGrams: parcels.reduce((sum, parcel) => sum + parcel.totalWeightGrams, 0),
    issues,
    pieceCount
  };
}

function orientations(piece) {
  const original = { length: piece.length, width: piece.width, rotatedBase: false };
  return piece.length === piece.width ? [original] : [original, {
    length: piece.width, width: piece.length, rotatedBase: true
  }];
}

function fitsBox(piece, box) {
  return piece.height <= box.inner.height
    && orientations(piece).some((orientation) => orientation.length <= box.inner.length
      && orientation.width <= box.inner.width);
}

// Heurística determinista, sem empilhamento: divide o piso livre em retângulos
// disjuntos após cada colocação. Pode escolher mais caixas que uma busca ótima,
// mas nunca considera apenas a soma dos volumes nem permite sobreposição.
// No máximo 100 peças: cada tentativa mantém até 101 retângulos livres.
function packBox(pieces, box) {
  const free = [{ x: 0, y: 0, length: box.inner.length, width: box.inner.width }];
  const placed = [];
  const remaining = [];

  for (const piece of pieces) {
    let selected = null;
    if (piece.height <= box.inner.height) {
      for (let rectangleIndex = 0; rectangleIndex < free.length; rectangleIndex += 1) {
        const rectangle = free[rectangleIndex];
        for (const orientation of orientations(piece)) {
          if (orientation.length > rectangle.length || orientation.width > rectangle.width) continue;
          const lengthLeft = rectangle.length - orientation.length;
          const widthLeft = rectangle.width - orientation.width;
          const score = [rectangle.y, rectangle.x, Math.min(lengthLeft, widthLeft), Math.max(lengthLeft, widthLeft), Number(orientation.rotatedBase), rectangleIndex];
          if (!selected || score.some((value, index) => value < selected.score[index]
            && score.slice(0, index).every((previous, previousIndex) => previous === selected.score[previousIndex]))) {
            selected = { rectangleIndex, rectangle, orientation, score };
          }
        }
      }
    }
    if (!selected) {
      remaining.push(piece);
      continue;
    }

    const { rectangleIndex, rectangle, orientation } = selected;
    free.splice(rectangleIndex, 1);
    const lengthLeft = rectangle.length - orientation.length;
    const widthLeft = rectangle.width - orientation.width;
    const next = lengthLeft > widthLeft ? [
      { x: rectangle.x + orientation.length, y: rectangle.y, length: lengthLeft, width: rectangle.width },
      { x: rectangle.x, y: rectangle.y + orientation.width, length: orientation.length, width: widthLeft }
    ] : [
      { x: rectangle.x + orientation.length, y: rectangle.y, length: lengthLeft, width: orientation.width },
      { x: rectangle.x, y: rectangle.y + orientation.width, length: rectangle.length, width: widthLeft }
    ];
    free.push(...next.filter((space) => space.length > 0 && space.width > 0));
    placed.push({
      piece,
      placement: {
        id: piece.id,
        unitIndex: piece.unitIndex,
        positionMm: { x: rectangle.x, y: rectangle.y, z: 0 },
        dimensionsMm: { length: orientation.length, width: orientation.width, height: piece.height },
        rotatedBase: orientation.rotatedBase
      }
    });
  }
  return { box, placed, remaining };
}

function parcelFromPacked(packed, assumptions) {
  const quantities = new Map();
  for (const { piece } of packed.placed) quantities.set(piece.id, (quantities.get(piece.id) || 0) + 1);
  const itemsWeightGrams = packed.placed.reduce((sum, { piece }) => sum + piece.weightGrams, 0);
  const protectionWeightGrams = packed.placed.length * assumptions.protectionWeightPerPieceGrams
    + assumptions.protectionWeightPerParcelGrams;
  return {
    boxCode: packed.box.code,
    dimensionsCm: { ...packed.box.dimensionsCm },
    itemsWeightGrams,
    boxWeightGrams: packed.box.weightGrams,
    protectionWeightGrams,
    totalWeightGrams: itemsWeightGrams + packed.box.weightGrams + protectionWeightGrams,
    items: [...quantities].sort(([a], [b]) => compareText(a, b)).map(([id, quantity]) => ({ id, quantity })),
    placements: packed.placed.map(({ placement }) => placement)
  };
}

function estimateCartPackaging(cart, options = {}) {
  const optionsValid = options !== null && typeof options === 'object' && !Array.isArray(options);
  const protectionPerFaceCm = optionsValid && options.protectionPerFaceCm !== undefined
    ? options.protectionPerFaceCm : PACKAGING.protectionPerFaceCm;
  const paddingMm = cmToMm(protectionPerFaceCm);
  const wallMm = cmToMm(PACKAGING.wallPerFaceCm);
  const assumptions = {
    estimated: true,
    protectionPerFaceCm: paddingMm === null ? PACKAGING.protectionPerFaceCm : protectionPerFaceCm,
    wallPerFaceCm: PACKAGING.wallPerFaceCm,
    protectionWeightPerPieceGrams: PACKAGING.protectionWeightPerPieceGrams,
    protectionWeightPerParcelGrams: PACKAGING.protectionWeightPerParcelGrams,
    uprightOnly: true,
    allowStacking: false,
    maxPieces: PACKAGING.maxPieces,
    maxParcels: PACKAGING.maxParcels,
    placementUnits: 'mm',
    placementOrigin: 'inside-box',
    packingMethod: 'deterministic-floor-guillotine'
  };
  if (!optionsValid || paddingMm === null || paddingMm > 100) {
    return result('unavailable', assumptions, { issues: [issue(null, 'INVALID_ASSUMPTION', 'A proteção informada não é válida para esta estimativa.')] });
  }
  if (!Array.isArray(cart) || !cart.length || cart.length > PACKAGING.maxPieces) {
    return result('unavailable', assumptions, { issues: [issue(null, 'INVALID_CART', 'O carrinho não é válido para esta estimativa.')] });
  }

  const quantities = new Map();
  let pieceCount = 0;
  for (const item of cart) {
    if (!item || typeof item.id !== 'string' || !Object.hasOwn(CATALOG, item.id)) {
      // Identificadores desconhecidos não são refletidos: podem conter dados pessoais.
      return result('unavailable', assumptions, { issues: [issue(null, 'INVALID_PRODUCT', 'Há um produto inválido no carrinho.')] });
    }
    const quantity = item.quantity ?? item.qty;
    if (!Number.isSafeInteger(quantity) || quantity < 1
      || (item.quantity !== undefined && item.qty !== undefined && item.quantity !== item.qty)) {
      return result('unavailable', assumptions, { issues: [issue(item.id, 'INVALID_QUANTITY', 'Há uma quantidade inválida no carrinho.')] });
    }
    pieceCount += quantity;
    if (pieceCount > PACKAGING.maxPieces) {
      return result('unavailable', assumptions, { pieceCount, issues: [issue(null, 'PIECE_LIMIT_EXCEEDED', 'O carrinho ultrapassa o limite de peças desta estimativa.')] });
    }
    quantities.set(item.id, (quantities.get(item.id) || 0) + quantity);
  }

  const boxes = PACKAGING.boxes.map((box) => {
    const exterior = dimensionsToMm(box.dimensionsCm);
    return {
      ...box,
      inner: Object.fromEntries(AXES.map((axis) => [axis, exterior[axis] - 2 * wallMm])),
      volume: exterior.length * exterior.width * exterior.height,
      longestSide: Math.max(...AXES.map((axis) => exterior[axis]))
    };
  }).sort((a, b) => a.volume - b.volume || a.longestSide - b.longestSide || compareText(a.code, b.code));

  const pieces = [];
  const missing = [];
  const oversized = [];
  for (const [id, quantity] of [...quantities].sort(([a], [b]) => compareText(a, b))) {
    const data = Object.hasOwn(SHIPPING_PRODUCTS, id) ? SHIPPING_PRODUCTS[id] : null;
    const dimensions = data && dimensionsToMm(data.dimensionsCm);
    if (!data || !Number.isSafeInteger(data.weightGrams) || data.weightGrams <= 0 || !dimensions) {
      missing.push(issue(id, 'PIECE_DATA_INCOMPLETE', 'Faltam peso ou dimensões da peça para estimar a embalagem.'));
      continue;
    }
    const piece = {
      id,
      weightGrams: data.weightGrams,
      length: dimensions.length + 2 * paddingMm,
      width: dimensions.width + 2 * paddingMm,
      height: dimensions.height + 2 * paddingMm
    };
    if (!boxes.some((box) => fitsBox(piece, box))) {
      oversized.push(issue(id, 'NO_BOX_FITS', 'A peça em pé precisa de uma caixa maior nesta hipótese de proteção.'));
      continue;
    }
    for (let unitIndex = 1; unitIndex <= quantity; unitIndex += 1) pieces.push({ ...piece, unitIndex });
  }
  if (missing.length || oversized.length) {
    return result(missing.length ? 'incomplete' : 'unavailable', assumptions, {
      pieceCount, issues: [...missing, ...oversized]
    });
  }

  pieces.sort((a, b) => b.length * b.width - a.length * a.width
    || b.height - a.height || Math.max(b.length, b.width) - Math.max(a.length, a.width)
    || compareText(a.id, b.id) || a.unitIndex - b.unitIndex);
  let remaining = pieces;
  const parcels = [];
  while (remaining.length) {
    if (parcels.length >= PACKAGING.maxParcels) {
      return result('unavailable', assumptions, { pieceCount, issues: [issue(null, 'PARCEL_LIMIT_EXCEEDED', 'O pedido precisa de mais volumes que o limite desta estimativa.')] });
    }
    // Primeiro tenta acomodar todo o restante na menor caixa. Se não couber,
    // escolhe a que recebe mais peças, com desempate pela ordem das caixas.
    let selected = null;
    for (const box of boxes) {
      const packed = packBox(remaining, box);
      if (!selected || packed.placed.length > selected.placed.length) selected = packed;
      if (!packed.remaining.length) {
        selected = packed;
        break;
      }
    }
    if (!selected || !selected.placed.length) {
      return result('unavailable', assumptions, { pieceCount, issues: [issue(null, 'PACKING_UNAVAILABLE', 'Não foi possível compor uma embalagem para o pedido nesta estimativa.')] });
    }
    parcels.push(parcelFromPacked(selected, assumptions));
    remaining = selected.remaining;
  }
  return result('estimated', assumptions, { pieceCount, parcels });
}

module.exports = { estimateCartPackaging, isShippingEstimatePreview };
