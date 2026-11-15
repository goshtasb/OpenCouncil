'use strict';

/** Opaque page cursors: base64url JSON, so clients can't build or edit them. */
function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    return JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    const err = new Error('invalid cursor');
    err.status = 400;
    throw err;
  }
}

module.exports = { encodeCursor, decodeCursor };
