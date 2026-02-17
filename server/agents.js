import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const BASE = path.join(HOME, '.openclaw', 'agents');

export const AGENTS = [
  {
    id: 'main',
    name: '主小夏',
    emoji: '🌸',
    sessionKey: 'agent:main:main',
    transcriptPath: path.join(BASE, 'main', 'sessions', '6c9657cd-8c02-4835-a709-c6132648d003.jsonl'),
  },
  {
    id: 'coder',
    name: '码农小夏',
    emoji: '🔧',
    sessionKey: 'agent:coder:main',
    transcriptPath: path.join(BASE, 'coder', 'sessions', 'd7611513-eb10-4e91-934d-118551d19f85.jsonl'),
  },
  {
    id: 'helper',
    name: '帮手小夏',
    emoji: '🧰',
    sessionKey: 'agent:helper:main',
    transcriptPath: path.join(BASE, 'helper', 'sessions', '321c0f4d-1236-41d7-bee9-27f086cd3e4d.jsonl'),
  },
  {
    id: 'opus',
    name: 'Opus小夏',
    emoji: '🎼',
    sessionKey: 'agent:opus:main',
    transcriptPath: path.join(BASE, 'opus', 'sessions', 'f15418ad-44e7-430a-9722-3d3f12701e9c.jsonl'),
  },
  {
    id: 'wudi',
    name: '无敌小夏',
    emoji: '⚔️',
    sessionKey: 'agent:wudi:main',
    transcriptPath: path.join(BASE, 'wudi', 'sessions', 'b3dbdf5b-c169-4eb0-81e5-22193056de45.jsonl'),
  },
  {
    id: 'xiaoying',
    name: '小颖',
    emoji: '🎀',
    sessionKey: 'agent:xiaoying:main',
    transcriptPath: path.join(BASE, 'xiaoying', 'sessions', '8b474b8b-282f-47f8-9e20-562e4f91c93c.jsonl'),
  },
];

export const AGENT_MAP = new Map(AGENTS.map((a) => [a.id, a]));
