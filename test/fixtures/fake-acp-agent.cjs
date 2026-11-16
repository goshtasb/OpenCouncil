#!/usr/bin/env node
// A minimal Agent Client Protocol (ACP) agent for tests: newline-delimited JSON-RPC 2.0 on stdio.
// It stands in for `agy acp` (or any ACP agent) so the acp and happy-agent seat adapters can be
// tested without a real model or a login.
//
// What it does on a prompt depends on a word in the prompt text:
//   SCENARIO:write  asks permission (kind "edit") to write fake-write.txt in its cwd, writes it only
//                   if the client allows, then answers WROTE or DENIED.
//   SCENARIO:die    streams one chunk, then exits with code 3 mid-turn (a seat dying mid-run).
//   SCENARIO:hang   never answers (for timeout tests).
//   council-probe.txt  (the Mac probe's prompt) behaves like SCENARIO:write on that file name.
//   With FAKE_ACP_CLIENT_FS=1 and a client that offers fs.writeTextFile, a write goes through the
//   client's fs/write_text_file instead of the agent's own tool, with no permission ask.
//   FAKE_ACP_QUOTA=<model>  any prompt run on that model gets agy's quota notice instead.
//   FAKE_ACP_MODELS=a,b     extra model values to advertise.
//   anything else   answers "fake answer: <first 40 chars of the prompt>".
// It logs every config option the client sets to $FAKE_ACP_LOG (one JSON line each), if set.
const fs = require('fs');
const path = require('path');

let nextId = 1000;
const pending = new Map();
const sessions = new Map();
let clientCaps = {};
const log = (entry) => { if (process.env.FAKE_ACP_LOG) fs.appendFileSync(process.env.FAKE_ACP_LOG, JSON.stringify(entry) + '\n'); };
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const request = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  send({ id, method, params });
});
const update = (sessionId, u) => send({ method: 'session/update', params: { sessionId, update: u } });
const chunk = (sessionId, text) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

const configOptions = (s) => [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: s.model, options: ['fake-model', ...(process.env.FAKE_ACP_MODELS || '').split(',').filter(Boolean)].map(v => ({ value: v, name: v })) },
  { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: s.mode, options: ['plan', 'accept-edits', 'auto'].map(v => ({ value: v, name: v })) },
];

async function onPrompt(id, params) {
  const s = sessions.get(params.sessionId);
  const text = (params.prompt || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  // A client may replay earlier turns into the prompt, so only the last scenario word counts.
  let scenario = (text.match(/SCENARIO:(\w+)/g) || []).pop() || '';
  const fileName = /council-probe\.txt/.test(text) && !scenario ? 'council-probe.txt' : 'fake-write.txt';
  if (fileName === 'council-probe.txt') scenario = 'SCENARIO:write';
  log({ promptChars: text.length, scenario, mode: s.mode });
  if (process.env.FAKE_ACP_QUOTA && process.env.FAKE_ACP_QUOTA === s.model) {
    chunk(params.sessionId, '\u26a0 Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 71h16m3s.');
    send({ id, result: { stopReason: 'end_turn' } });
    return;
  }
  if (scenario === 'SCENARIO:die') {
    chunk(params.sessionId, 'starting work...');
    setTimeout(() => process.exit(3), 50);
    return;
  }
  if (scenario === 'SCENARIO:hang' || /3000 word essay/.test(text)) return;
  if (scenario === 'SCENARIO:write') {
    const target = path.join(s.cwd, fileName);
    if (process.env.FAKE_ACP_CLIENT_FS === '1') {
      if (!clientCaps?.fs?.writeTextFile) {
        chunk(params.sessionId, 'NO FS');
      } else {
        let ok = true;
        try { await request('fs/write_text_file', { sessionId: params.sessionId, path: target, content: 'PROBE' }); } catch { ok = false; }
        chunk(params.sessionId, ok ? 'WROTE' : 'DENIED');
      }
      send({ id, result: { stopReason: 'end_turn' } });
      return;
    }
    const toolCallId = `call-${nextId}`;
    update(params.sessionId, { sessionUpdate: 'tool_call', toolCallId, title: `Write ${target}`, kind: 'edit', status: 'pending', locations: [{ path: target }] });
    let answer;
    try {
      answer = await request('session/request_permission', {
        sessionId: params.sessionId,
        toolCall: { toolCallId, title: `Write ${target}`, kind: 'edit', locations: [{ path: target }] },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      });
    } catch (err) {
      answer = { outcome: { outcome: 'cancelled' } };
    }
    const allowed = answer?.outcome?.outcome === 'selected' && answer.outcome.optionId === 'allow';
    log({ permission: answer?.outcome });
    if (allowed) fs.writeFileSync(target, 'written by fake agent\n');
    update(params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status: allowed ? 'completed' : 'failed' });
    chunk(params.sessionId, allowed ? 'WROTE' : 'DENIED');
    send({ id, result: { stopReason: 'end_turn' } });
    return;
  }
  chunk(params.sessionId, `fake answer: ${text.slice(0, 40)}`);
  send({ id, result: { stopReason: 'end_turn' } });
}

function onMessage(msg) {
  if (msg.method === undefined) {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); msg.error ? p.reject(msg.error) : p.resolve(msg.result); }
    return;
  }
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      clientCaps = params?.clientCapabilities || {};
      return send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false, promptCapabilities: {}, mcpCapabilities: { http: false, sse: false } }, authMethods: [] } });
    case 'session/new': {
      const sessionId = `fake-${sessions.size + 1}`;
      const s = { cwd: params.cwd, model: 'fake-model', mode: 'auto' };
      sessions.set(sessionId, s);
      return send({ id, result: { sessionId, configOptions: configOptions(s) } });
    }
    case 'session/set_config_option': {
      const s = sessions.get(params.sessionId);
      if (!s) return send({ id, error: { code: -32602, message: 'unknown session' } });
      s[params.configId] = params.value;
      log({ set: params.configId, value: params.value });
      return send({ id, result: { configOptions: configOptions(s) } });
    }
    case 'session/set_mode': {
      const s = sessions.get(params.sessionId);
      if (s) s.mode = params.modeId;
      log({ set: 'mode', value: params.modeId });
      return send({ id, result: {} });
    }
    case 'session/prompt':
      return void onPrompt(id, params);
    case 'session/cancel':
      return;
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: `method not found: ${method}` } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  buffer += data;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) { try { onMessage(JSON.parse(line)); } catch (err) { process.stderr.write(`bad line: ${err}\n`); } }
  }
});
process.stdin.on('end', () => process.exit(0));
