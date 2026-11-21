'use strict';

/**
 * NyxMail ingest plugin for Haraka.
 *
 * Place this file at haraka/plugins/nyxmail_ingest.js, enable it in
 * haraka/config/plugins (after SPF/DKIM/DMARC plugins), and set:
 *
 *   NYXMAIL_URL=https://mail.example.com
 *   NYXMAIL_INGEST_SECRET=<same value as INGEST_SECRET in .env>
 *   NYXMAIL_WEBHOOK_PATH=/api/v1/ingest
 *
 * The plugin buffers the raw MIME, signs `${timestamp}.${body}` with HMAC-SHA256
 * and hands the message to NyxMail. A non-2xx response returns a temporary SMTP
 * failure so the sending MTA retries instead of bouncing.
 */

const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const { DENYSOFT } = require('haraka-constants');

const state = {
  endpoint: null,
  secret: null,
  maxBytes: 60 * 1024 * 1024,
};

exports.register = function () {
  const base = (process.env.NYXMAIL_URL || '').replace(/\/+$/, '');
  const path = process.env.NYXMAIL_WEBHOOK_PATH || '/api/v1/ingest';
  state.secret = process.env.NYXMAIL_INGEST_SECRET || '';
  state.maxBytes = Number(process.env.NYXMAIL_MAX_MESSAGE_BYTES || state.maxBytes);
  if (!base || !state.secret) {
    this.logerror('nyxmail_ingest: NYXMAIL_URL and NYXMAIL_INGEST_SECRET are required');
    state.endpoint = null;
    return;
  }
  try {
    state.endpoint = new URL(`${base}${path}`);
  } catch (error) {
    this.logerror(`nyxmail_ingest: invalid NYXMAIL_URL: ${error.message}`);
    state.endpoint = null;
    return;
  }
  this.register_hook('data_post', 'ingest');
  this.loginfo(`nyxmail_ingest: forwarding mail to ${state.endpoint.toString()}`);
};

function postJson(url, body, callback) {
  const payload = Buffer.from(body, 'utf8');
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': payload.length,
    'User-Agent': 'Haraka-NyxMail-Ingest/1.0',
    'X-NyxMail-Timestamp': String(Date.now()),
  };
  headers['X-NyxMail-Signature'] = crypto
    .createHmac('sha256', state.secret)
    .update(`${headers['X-NyxMail-Timestamp']}.${body}`)
    .digest('hex');

  const transport = url.protocol === 'https:' ? https : http;
  const request = transport.request(
    url,
    { method: 'POST', headers, timeout: 30_000 },
    (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        callback(null, response.statusCode, Buffer.concat(chunks).toString('utf8'));
      });
    },
  );
  request.on('timeout', () => request.destroy(new Error('NyxMail ingest timed out')));
  request.on('error', (error) => callback(error));
  request.end(payload);
}

exports.ingest = function (next, connection) {
  const plugin = this;
  const transaction = connection.transaction;
  if (!state.endpoint || !transaction) return next();

  const recipients = (transaction.rcpt_to || [])
    .map((recipient) => (typeof recipient.address === 'function' ? recipient.address() : recipient.address))
    .filter(Boolean);
  if (recipients.length === 0) return next();

  const chunks = [];
  let total = 0;
  let finished = false;

  const fail = (error) => {
    if (finished) return;
    finished = true;
    connection.logerror(plugin, `nyxmail_ingest: ${error}`);
    next(DENYSOFT, 'Encrypted mailbox temporarily unavailable; retry later');
  };

  transaction.message_stream.on('data', (chunk) => {
    total += chunk.length;
    if (total > state.maxBytes) {
      transaction.message_stream.destroy?.();
      fail(`message exceeds ${state.maxBytes} bytes`);
      return;
    }
    chunks.push(chunk);
  });

  transaction.message_stream.on('error', (error) => fail(error.message));

  transaction.message_stream.on('end', () => {
    if (finished) return;
    const raw = Buffer.concat(chunks);
    const envelopeFrom =
      transaction.mail_from && typeof transaction.mail_from.address === 'function'
        ? transaction.mail_from.address()
        : transaction.mail_from?.address || '';

    const body = JSON.stringify({
      envelopeFrom: envelopeFrom || undefined,
      envelopeTo: recipients,
      rawMimeBase64: raw.toString('base64'),
    });

    postJson(state.endpoint, body, (error, status, responseBody) => {
      if (finished) return;
      if (error) return fail(error.message);
      if (status >= 200 && status < 300) {
        finished = true;
        connection.loginfo(plugin, `nyxmail_ingest: accepted ${recipients.length} recipient(s)`);
        return next();
      }
      fail(`webhook returned ${status}: ${String(responseBody).slice(0, 300)}`);
    });
  });

  transaction.message_stream.resume();
};
