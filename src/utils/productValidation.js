const { toCentavos, fromCentavos } = require('./money');

function whole(value, fallback, label) {
  const number = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 2147483647) throw new Error(`${label} must be a non-negative whole number.`);
  return number;
}

function productValues(body) {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('Product name is required.');
  const category = body.category_id ? whole(body.category_id, 0, 'Category') : null;
  if (category === 0) throw new Error('Select a valid category.');
  return [name, String(body.barcode || '').trim() || null, category,
    String(body.unit || '').trim() || 'pc',
    fromCentavos(toCentavos(body.cost_price == null || body.cost_price === '' ? '0' : body.cost_price)),
    fromCentavos(toCentavos(body.selling_price)),
    whole(body.stock_quantity, 0, 'Stock'), whole(body.reorder_level, 5, 'Reorder level')];
}

module.exports = { productValues };
