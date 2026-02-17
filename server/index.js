import express from 'express';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { AGENTS, AGENT_MAP } from './agents.js';

const app = express();
const PORT = 3001;
const GATEWAY_HTTP = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:18789';
const GATEWAY_WS = GATEWAY_HTTP.replace(/^http/i, 'ws');

app.use(express.json({ limit: '20mb' }));

function readGatewayToken() {
  if (process.env.OPENCLAW_TOKEN) return process.env.OPENCLAW_TOKEN;
  const cfgPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  try {
    const data = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return data?.gateway?.auth?.token || null;
  } catch {
    return null;
  }
}

function parseMessageRecord(line) {
  if (!line?.trim()) return null;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (obj.type !== 'message' || !obj.message) return null;

  const role = obj.message.role;
  if (role !== 'user' && role !== 'assistant') return null;

  let content = '';
  let thinking = '';
  const c = obj.message.content;

  if (typeof c === 'string') {
    content = c;
  } else if (Array.isArray(c)) {
    const textParts = [];
    const thinkingParts = [];
    for (const item of c) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'text') {
        if (typeof item.text === 'string') textParts.push(item.text);
        else if (item.text && typeof item.text.value === 'string') textParts.push(item.text.value);
      }
      if (item.type === 'thinking' || item.type === 'reasoning') {
        const t = item.thinking || item.reasoning || item.text;
        if (typeof t === 'string') thinkingParts.push(t);
      }
    }
    content = textParts.join('\n').trim();
    thinking = thinkingParts.join('\n').trim();
  }

  if (!content && !thinking) return null;
  return { role, content, thinking };
}

function readTranscriptRecent(filePath, limit = 50) {
  if (!fs.existsSync(filePath)) return { messages: [], thinking: '', offset: 0 };
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const msgs = [];
  const thinking = [];
  for (const line of lines) {
    const rec = parseMessageRecord(line);
    if (!rec) continue;
    if (rec.content) msgs.push({ role: rec.role, content: rec.content });
    if (rec.thinking) thinking.push(rec.thinking);
  }
  return {
    messages: msgs.slice(-limit),
    thinking: thinking.join('\n\n').slice(-12000),
    offset: Buffer.byteLength(text, 'utf8'),
  };
}

function readTranscriptIncrement(filePath, offset = 0) {
  if (!fs.existsSync(filePath)) return { messages: [], thinking: '', offset: 0 };
  const stat = fs.statSync(filePath);
  let safeOffset = Number(offset) || 0;
  if (safeOffset < 0 || safeOffset > stat.size) safeOffset = 0;

  const fd = fs.openSync(filePath, 'r');
  try {
    const len = stat.size - safeOffset;
    if (len <= 0) return { messages: [], thinking: '', offset: stat.size };
    const buffer = Buffer.alloc(len);
    fs.readSync(fd, buffer, 0, len, safeOffset);
    const slice = buffer.toString('utf8');
    const lines = slice.split(/\r?\n/).filter(Boolean);
    const messages = [];
    const thinking = [];
    for (const line of lines) {
      const rec = parseMessageRecord(line);
      if (!rec) continue;
      if (rec.content) messages.push({ role: rec.role, content: rec.content });
      if (rec.thinking) thinking.push(rec.thinking);
    }
    return { messages, thinking: thinking.join('\n\n').slice(-12000), offset: stat.size };
  } finally {
    fs.closeSync(fd);
  }
}

function getSessionInfo(agent) {
  const sessionsPath = path.join(os.homedir(), '.openclaw', 'agents', agent.id, 'sessions', 'sessions.json');
  try {
    const data = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    const row = data[agent.sessionKey] || {};
    const model = row.modelProvider && row.model ? `${row.modelProvider}/${row.model}` : (row.model || 'unknown');
    return {
      model,
      totalTokens: row.totalTokens || 0,
      contextTokens: row.contextTokens || 0,
      updatedAt: row.updatedAt || null,
    };
  } catch {
    return { model: 'unknown', totalTokens: 0, contextTokens: 0, updatedAt: null };
  }
}

app.get('/api/config', (_req, res) => {
  res.json({
    gatewayHttp: GATEWAY_HTTP,
    gatewayWs: GATEWAY_WS,
    token: readGatewayToken(),
    agents: AGENTS,
  });
});

app.get('/api/sessions', (_req, res) => {
  const sessions = Object.fromEntries(AGENTS.map((a) => [a.id, getSessionInfo(a)]));
  res.json({ sessions });
});

app.get('/api/transcript/:agentId', (req, res) => {
  const agent = AGENT_MAP.get(req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const limit = Number(req.query.limit || 50);
  return res.json(readTranscriptRecent(agent.transcriptPath, Math.max(1, Math.min(limit, 200))));
});

app.get('/api/transcript/:agentId/poll', (req, res) => {
  const agent = AGENT_MAP.get(req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const offset = Number(req.query.offset || 0);
  return res.json(readTranscriptIncrement(agent.transcriptPath, offset));
});

app.get('/api/system', async (_req, res) => {
  const cpuPercent = os.loadavg()[0] > 0 ? (os.loadavg()[0] / os.cpus().length) * 100 : 0;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramUsed = totalMem - freeMem;

  let gatewayOnline = false;
  let gatewayStatus = 'offline';
  try {
    const token = readGatewayToken();
    const resp = await fetch(`${GATEWAY_HTTP}/`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    gatewayOnline = resp.status < 500;
    gatewayStatus = gatewayOnline ? 'online' : `http-${resp.status}`;
  } catch {
    gatewayOnline = false;
  }

  res.json({
    cpuPercent: Number(cpuPercent.toFixed(1)),
    ramUsedGb: Number((ramUsed / 1024 ** 3).toFixed(2)),
    ramTotalGb: Number((totalMem / 1024 ** 3).toFixed(2)),
    gpu: { available: false },
    gateway: { online: gatewayOnline, status: gatewayStatus },
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { agentId, sessionKey, messages, stream = false } = req.body || {};
    if (!agentId || !Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'agentId and messages are required' });
    }

    const token = readGatewayToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(sessionKey ? { 'x-openclaw-session-key': sessionKey } : {}),
      'x-openclaw-agent-id': agentId,
    };

    const payload = {
      model: `openclaw:${agentId}`,
      stream,
      messages,
    };

    const resp = await fetch(`${GATEWAY_HTTP}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    res.status(resp.status).type(resp.headers.get('content-type') || 'application/json').send(text);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.listen(PORT, () => {
  console.log(`Workbench API listening on http://localhost:${PORT}`);
});
