'use strict';

const formatters = new Map();

/** The calendar day ('YYYY-MM-DD') that a timestamp in ms falls on in an IANA time zone. */
function localDay(ts, timeZone = 'UTC') {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f.format(new Date(ts));
}

module.exports = { localDay };
