import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = os.homedir();
const BASE = path.join(HOME, '.openclaw', 'agents');
const CONFIG_PATH = path.join(HOME, '.openclaw', 'openclaw.json');

// 动态查找最新的session文件
function findLatestSession(agentId) {
  const sessionsDir = path.join(BASE, agentId, 'sessions');
  try {
    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(sessionsDir, f),
        mtime: fs.statSync(path.join(sessionsDir, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.path || null;
  } catch {
    return null;
  }
}

// 从 openclaw.json 动态读取 agents 列表
function loadAgentsFromConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    // agents 结构: { defaults: {...}, list: [{id, name, ...}, ...] }
    const agentsList = config.agents?.list || [];
    
    return agentsList.map(agent => ({
      id: agent.id,
      name: agent.name || agent.id,
      emoji: agent.emoji || '🤖',
      sessionKey: `agent:${agent.id}:main`,
      get transcriptPath() { return findLatestSession(agent.id); },
    }));
  } catch (e) {
    console.error('Failed to load agents from config:', e.message);
    // 返回空数组而不是失败
    return [];
  }
}

// 动态导出 - 每次调用时重新读取配置
export function getAgents() {
  return loadAgentsFromConfig();
}

// 为了向后兼容，AGENTS 变量在初次加载时读取
// 但推荐使用 getAgents() 以获取最新配置
export const AGENTS = loadAgentsFromConfig();

export function getAgentMap() {
  return new Map(getAgents().map((a) => [a.id, a]));
}

// 向后兼容
export const AGENT_MAP = new Map(AGENTS.map((a) => [a.id, a]));
