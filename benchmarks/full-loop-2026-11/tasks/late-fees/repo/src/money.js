'use strict';

/** Rounds to the smallest currency unit, half away from zero. */
function roundMoney(n) {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** 450000 -> "$4,500.00" */
function formatMoney(amount) {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}$${whole}.${frac}`;
}

module.exports = { roundMoney, formatMoney };
