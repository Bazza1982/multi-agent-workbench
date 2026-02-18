import express from 'express';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import WebSocket from 'ws';
import { getAgents, getAgentMap } from './agents.js';

// 日志文件路径
const LOG_FILE = path.join(import.meta.dirname, '..', 'debug.log');

function debugLog(...args) {
  const timestamp = new Date().toISOString();
  const msg = `[${timestamp}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : a).join(' ')}\n`;
  fs.appendFileSync(LOG_FILE, msg);
  console.log(...args);
}

// CPU使用率缓存（Windows需要采样计算）
let lastCpuInfo = null;
let lastCpuTime = 0;

function getCpuUsage() {
  const cpus = os.cpus();
  const now = Date.now();
  
  let totalIdle = 0;
  let totalTick = 0;
  
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  
  if (!lastCpuInfo || now - lastCpuTime > 5000) {
    lastCpuInfo = { idle: totalIdle, total: totalTick };
    lastCpuTime = now;
    return null;
  }
  
  const idleDiff = totalIdle - lastCpuInfo.idle;
  const totalDiff = totalTick - lastCpuInfo.total;
  
  lastCpuInfo = { idle: totalIdle, total: totalTick };
  lastCpuTime = now;
  
  if (totalDiff === 0) return 0;
  return ((1 - idleDiff / totalDiff) * 100);
}

// GPU信息缓存
let gpuCache = { data: null, time: 0 };

function getGpuInfo() {
  const now = Date.now();
  if (gpuCache.data && now - gpuCache.time < 2000) {
    return gpuCache.data;
  }
  
  try {
    const output = execSync(
      'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits',
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    ).trim();
    
    if (output) {
      const parts = output.split(',').map(s => s.trim());
      if (parts.length >= 5) {
        gpuCache.data = {
          available: true,
          name: parts[0],
          usage: parseFloat(parts[1]) || 0,
          memoryUsed: parseInt(parts[2]) || 0,
          memoryTotal: parseInt(parts[3]) || 0,
          temperature: parseInt(parts[4]) || 0,
        };
        gpuCache.time = now;
        return gpuCache.data;
      }
    }
  } catch {
    // nvidia-smi不可用
  }
  
  gpuCache.data = { available: false };
  gpuCache.time = now;
  return gpuCache.data;
}

const app = express();
const PORT = 3001;
const GATEWAY_HTTP = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:18789';
const GATEWAY_WS = GATEWAY_HTTP.replace(/^http/i, 'ws');

app.use(express.json({ limit: '50mb' }));

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

// ==================== WebSocket Gateway 客户端 ====================

class GatewayClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.challengeNonce = null;
  }

  async connect() {
    if (this.ws && this.connected) return true;

    return new Promise((resolve, reject) => {
      const token = readGatewayToken();
      const wsUrl = token ? `${GATEWAY_WS}/?token=${encodeURIComponent(token)}` : GATEWAY_WS;
      
      debugLog('Connecting to Gateway WebSocket:', GATEWAY_WS);
      // 设置 origin header 以通过 CORS 检查
      this.ws = new WebSocket(wsUrl, {
        origin: 'http://localhost:18789',
        headers: {
          'Origin': 'http://localhost:18789',
        },
      });

      const timeout = setTimeout(() => {
        this.ws?.close();
        reject(new Error('WebSocket connection timeout'));
      }, 10000);

      this.ws.on('open', () => {
        debugLog('WebSocket opened, waiting for challenge...');
      });

      this.ws.on('message', async (data) => {
        try {
          const frame = JSON.parse(data.toString());
          debugLog('WS received:', JSON.stringify(frame).slice(0, 500));

          // 处理 connect.challenge 事件
          if (frame.type === 'event' && frame.event === 'connect.challenge') {
            this.challengeNonce = frame.payload?.nonce;
            debugLog('Got challenge nonce:', this.challengeNonce);
            
            // 发送 connect 请求 - 使用 cli mode 获取完整权限
            const connectParams = {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'cli',  // 使用官方 cli client id
                version: '1.0.0',
                platform: 'workbench',
                mode: 'cli',  // 必须是: cli|node|ui|test|webchat|backend|probe
              },
              role: 'operator',
              auth: token ? { token } : undefined,
              scopes: ['operator.read', 'operator.write'],
            };

            this.send({
              type: 'req',
              id: 'connect-1',
              method: 'connect',
              params: connectParams,
            });
          }

          // 处理 connect 响应
          if (frame.type === 'res' && frame.id === 'connect-1') {
            clearTimeout(timeout);
            if (frame.ok) {
              this.connected = true;
              debugLog('✅ WebSocket connected successfully!');
              resolve(true);
            } else {
              debugLog('❌ Connect failed:', frame.error);
              reject(new Error(frame.error?.message || 'Connect failed'));
            }
          }

          // 处理 hello-ok（有些版本直接发 hello-ok）
          if (frame.type === 'hello-ok') {
            clearTimeout(timeout);
            this.connected = true;
            debugLog('✅ WebSocket connected (hello-ok)!');
            resolve(true);
          }

          // 处理普通响应
          if (frame.type === 'res' && frame.id !== 'connect-1') {
            const pending = this.pendingRequests.get(frame.id);
            if (pending) {
              this.pendingRequests.delete(frame.id);
              if (frame.ok) {
                pending.resolve(frame.payload);
              } else {
                pending.reject(new Error(frame.error?.message || 'Request failed'));
              }
            }
          }

        } catch (e) {
          debugLog('WS message parse error:', e);
        }
      });

      this.ws.on('error', (err) => {
        debugLog('WebSocket error:', err.message);
        clearTimeout(timeout);
        this.connected = false;
        reject(err);
      });

      this.ws.on('close', () => {
        debugLog('WebSocket closed');
        this.connected = false;
        this.ws = null;
      });
    });
  }

  send(frame) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    const data = JSON.stringify(frame);
    debugLog('WS sending:', data.slice(0, 500));
    this.ws.send(data);
  }

  async request(method, params, timeoutMs = 120000) {
    if (!this.connected) {
      await this.connect();
    }

    const id = `req-${++this.requestId}`;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (payload) => {
          clearTimeout(timeout);
          resolve(payload);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.send({
        type: 'req',
        id,
        method,
        params,
      });
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

// 全局 Gateway 客户端实例
let gatewayClient = new GatewayClient();

// ==================== Transcript 读取函数 ====================

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

// ==================== API 路由 ====================

app.get('/api/config', (_req, res) => {
  res.json({
    gatewayHttp: GATEWAY_HTTP,
    gatewayWs: GATEWAY_WS,
    token: readGatewayToken(),
    agents: getAgents(), // 动态读取最新配置
  });
});

app.get('/api/sessions', (_req, res) => {
  const agents = getAgents(); // 动态读取
  const sessions = Object.fromEntries(agents.map((a) => [a.id, getSessionInfo(a)]));
  res.json({ sessions });
});

app.get('/api/transcript/:agentId', (req, res) => {
  const agent = getAgentMap().get(req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const limit = Number(req.query.limit || 50);
  return res.json(readTranscriptRecent(agent.transcriptPath, Math.max(1, Math.min(limit, 200))));
});

app.get('/api/transcript/:agentId/poll', (req, res) => {
  const agent = getAgentMap().get(req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const offset = Number(req.query.offset || 0);
  return res.json(readTranscriptIncrement(agent.transcriptPath, offset));
});

app.get('/api/system', async (_req, res) => {
  const cpuPercent = getCpuUsage() ?? 0;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramUsed = totalMem - freeMem;
  const gpu = getGpuInfo();

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
    gpu,
    gateway: { online: gatewayOnline, status: gatewayStatus },
  });
});

// Chat API - 使用 WebSocket 发送图片消息
app.post('/api/chat', async (req, res) => {
  try {
    const { agentId, sessionKey, messages, stream = false } = req.body || {};
    if (!agentId || !Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'agentId and messages are required' });
    }

    debugLog('\n=== /api/chat ===');
    debugLog('agentId:', agentId);
    debugLog('sessionKey:', sessionKey);

    // 解析消息内容
    const userMessage = messages[0];
    let textContent = '';
    const attachments = [];

    if (typeof userMessage.content === 'string') {
      textContent = userMessage.content;
    } else if (Array.isArray(userMessage.content)) {
      for (const part of userMessage.content) {
        if (part.type === 'text') {
          textContent += (textContent ? '\n' : '') + part.text;
        } else if (part.type === 'image_url') {
          // 处理 base64 图片
          const url = part.image_url?.url || '';
          if (url.startsWith('data:')) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              const mimeType = match[1];
              const base64Data = match[2];
              attachments.push({
                mimeType,
                data: base64Data,
                filename: `image_${Date.now()}.${mimeType.split('/')[1] || 'png'}`,
              });
            }
          }
        }
      }
    }

    debugLog('Text content:', textContent?.slice(0, 100));
    debugLog('Attachments count:', attachments.length);

    // 如果有图片，保存到文件并在消息中引用
    if (attachments.length > 0) {
      debugLog('Saving images to files...');
      const savedPaths = [];
      
      for (const att of attachments) {
        const ext = att.mimeType.split('/')[1] || 'png';
        const filename = `workbench_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const MEDIA_DIR = path.join(os.homedir(), '.openclaw', 'media', 'inbound');
        
        // 确保目录存在
        if (!fs.existsSync(MEDIA_DIR)) {
          fs.mkdirSync(MEDIA_DIR, { recursive: true });
        }
        
        const filePath = path.join(MEDIA_DIR, filename);
        const buffer = Buffer.from(att.data, 'base64');
        fs.writeFileSync(filePath, buffer);
        savedPaths.push(filePath);
        debugLog('Saved image to:', filePath);
      }
      
      // 在消息中添加图片路径引用
      const imageRefs = savedPaths.map(p => `[Image: ${p}]`).join('\n');
      textContent = `${imageRefs}\n\n${textContent || '(请查看上面的图片)'}`;
      debugLog('Message with image refs:', textContent.slice(0, 200));
    }

    // 纯文本消息或 WebSocket 失败时，使用 HTTP API
    debugLog('Using HTTP API...');
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
      messages: [{ role: 'user', content: textContent || '(空消息)' }],
    };

    const resp = await fetch(`${GATEWAY_HTTP}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    debugLog('Gateway response status:', resp.status);
    debugLog('Gateway response:', text.slice(0, 300));
    debugLog('=== End ===\n');

    res.status(resp.status).type(resp.headers.get('content-type') || 'application/json').send(text);

  } catch (error) {
    debugLog('Chat error:', error);
    res.status(500).json({ error: String(error.message || error) });
  }
});

// Compact API - 通过 WebSocket 发送 /compact 命令给 Gateway
app.post('/api/compact/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const agent = getAgentMap().get(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'agent not found' });
    }

    debugLog('\n=== /api/compact ===');
    debugLog('agentId:', agentId);
    debugLog('sessionKey:', agent.sessionKey);

    // 尝试通过 WebSocket 发送 /compact 命令
    try {
      await gatewayClient.connect();
      
      // 使用 chat.send 方法发送 /compact 命令
      const result = await gatewayClient.request('chat.send', {
        sessionKey: agent.sessionKey,
        message: '/compact',
      }, 30000);
      
      debugLog('Compact via WebSocket success:', result);
      return res.json({ ok: true, method: 'websocket', result });
    } catch (wsError) {
      debugLog('WebSocket chat.send failed:', wsError.message);
      
      // WebSocket 失败，尝试 HTTP API
      // 发送 /compact 作为普通消息，Gateway 会解析斜杠命令
      const token = readGatewayToken();
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'x-openclaw-session-key': agent.sessionKey,
        'x-openclaw-agent-id': agentId,
      };

      const payload = {
        model: `openclaw:${agentId}`,
        stream: false,
        messages: [{ role: 'user', content: '/compact' }],
      };

      const resp = await fetch(`${GATEWAY_HTTP}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const text = await resp.text();
      debugLog('HTTP compact response:', text.slice(0, 300));
      
      if (resp.ok) {
        return res.json({ ok: true, method: 'http', response: text.slice(0, 500) });
      } else {
        return res.status(resp.status).json({ ok: false, method: 'http', error: text });
      }
    }
  } catch (error) {
    debugLog('Compact error:', error);
    res.status(500).json({ error: String(error.message || error) });
  }
});

// 启动服务器
const server = app.listen(PORT, () => {
  console.log(`Workbench API listening on http://localhost:${PORT}`);
  console.log(`Gateway HTTP: ${GATEWAY_HTTP}`);
  console.log(`Gateway WS: ${GATEWAY_WS}`);
  
  // 尝试预先建立 WebSocket 连接（不阻塞服务器启动）
  gatewayClient.connect().then(() => {
    console.log('✅ WebSocket pre-connected to Gateway');
  }).catch((e) => {
    console.log('⚠️  WebSocket pre-connect failed (will retry on demand):', e.message);
  });
});

// 保持服务器运行
server.on('error', (err) => {
  console.error('Server error:', err);
});
