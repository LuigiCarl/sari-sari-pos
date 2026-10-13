function toCentavos(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Enter a valid amount with at most two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 9999999999) throw new Error('Amount is too large.');
  return cents;
}

function fromCentavos(cents) {
  return (cents / 100).toFixed(2);
}

module.exports = { toCentavos, fromCentavos };
