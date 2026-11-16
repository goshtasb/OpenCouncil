'use strict';

// Accounts created before we stored a time zone only have a data region.
const REGION_TIME_ZONES = {
  'us-west': 'America/Los_Angeles',
  'us-east': 'America/New_York',
  'eu-central': 'Europe/Berlin',
  'ap-south': 'Asia/Kolkata'
};

/** The time zone an account's days are counted in, for invoices and anything else customer-facing. */
function accountTimeZone(account) {
  if (account && account.timezone) return account.timezone;
  return (account && REGION_TIME_ZONES[account.region]) || 'UTC';
}

module.exports = { accountTimeZone, REGION_TIME_ZONES };
