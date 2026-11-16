'use strict';
const { randomUUID } = require('node:crypto');
const { GatewayTimeoutError } = require('./errors');

const MAX_RETRIES = 3;

/**
 * Charges a customer for one purchase and returns the charge.
 * Retries gateway timeouts with the same Idempotency-Key, so a timeout after a successful charge
 * returns that charge instead of making a second one. Declines and other errors are not retried.
 */
async function chargeCustomer(gateway, customer, amountCents, { idempotencyKey = randomUUID(), sleep = defaultSleep } = {}) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new RangeError('amountCents must be a positive integer');
  for (let attempt = 0; ; attempt++) {
    try {
      return await gateway.charge({ customerId: customer.id, amountCents, idempotencyKey });
    } catch (err) {
      if (!(err instanceof GatewayTimeoutError) || attempt >= MAX_RETRIES) throw err;
      await sleep(50 * 2 ** attempt);
    }
  }
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { chargeCustomer };
