'use strict';

/**
 * Charges a customer for one purchase and returns the charge.
 * Called from the checkout handler and from the subscription renewal job.
 */
async function chargeCustomer(gateway, customer, amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new RangeError('amountCents must be a positive integer');
  return gateway.charge({ customerId: customer.id, amountCents });
}

module.exports = { chargeCustomer };
