import { useEffect, useMemo, useRef, useState } from 'react';

function pctColor(pct) {
  if (pct < 60) return 'green';
  if (pct < 80) return 'yellow';
  return 'red';
}

function gridClass(count) {
  if (count <= 1) return 'grid-1';
  if (count === 2) return 'grid-2';
  if (count === 3) return 'grid-3';
  if (count === 4) return 'grid-4';
  if (count <= 6) return 'grid-6';
  return 'grid-9';
}

function normalizeMessages(arr = []) {
  return arr.map((m) => ({ role: m.role, content: m.content || '' })).filter((m) => m.content);
}

// 发送音效 - 使用Web Audio API生成清脆的提示音
function playSendSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.frequency.setValueAtTime(880, ctx.currentTime); // A5音
    oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.1); // 上升
    
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.2);
  } catch (e) {
    console.log('Audio not supported');
  }
}

function AgentPanel({ agent, session, state, setState, onSend, onCommand, customName }) {
  const displayName = customName || agent.name;
  const [input, setInput] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const [reasoning, setReasoning] = useState('off');
  const [thinkingLevel, setThinkingLevel] = useState('low');
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const chatRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [state.messages, state.thinking]);

  const total = session?.totalTokens || 0;
  const ctx = session?.contextTokens || 0;
  const pct = ctx > 0 ? (total / ctx) * 100 : 0;

  const send = async () => {
    const text = input.trim();
    if (!text && !imagePreview) return;
    if (sending) return;
    
    // 立即清空输入框并显示发送状态
    const msgText = text;
    const msgImage = imagePreview;
    setInput('');
    setImagePreview(null);
    setSending(true);
    
    try {
      await onSend(agent, msgText, msgImage);
      // 发送成功反馈 - 快速闪烁
      setSendSuccess(true);
      playSendSound();
      setTimeout(() => setSendSuccess(false), 150);
    } catch (err) {
      console.error('Send failed:', err);
      // 发送失败，恢复输入内容
      setInput(msgText);
      setImagePreview(msgImage);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onPaste = (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (ev) => setImagePreview(String(ev.target?.result || ''));
        reader.readAsDataURL(file);
        e.preventDefault();
        break;
      }
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div className="title">{agent.emoji} {displayName} <span className="agent-id">({agent.id})</span></div>
        <div className="sub">{session?.model || 'unknown'}</div>
      </div>

      <div className="context-row">
        <span>{pctColor(pct) === 'green' ? '🟢' : pctColor(pct) === 'yellow' ? '🟡' : '🔴'} Context {pct.toFixed(0)}%</span>
        <span>{total.toLocaleString()}/{ctx.toLocaleString()}</span>
      </div>
      <div className="progress"><div className={`bar ${pctColor(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>

      {/* 记忆管理区域 */}
      {pct >= 70 && (
        <div className={`memory-alert ${pct >= 85 ? 'critical' : 'warning'}`}>
          <span className="alert-text">
            {pct >= 85 ? '⚠️ Context 即将满！请立即保存记忆' : '💡 Context > 70%，建议保存记忆'}
          </span>
        </div>
      )}
      <div className="memory-actions">
        <button 
          className="memory-btn" 
          onClick={() => onSend(agent, '写日记，详细记录最近对话的重点内容和决策', null)}
          title="让 Agent 写日记保存记忆"
        >
          📝 写日记
        </button>
        <button 
          className="memory-btn" 
          onClick={() => onSend(agent, '保存当前工作进度到日记，包括：正在做什么、做到哪里、下一步计划', null)}
          title="保存工作进度"
        >
          💾 保存进度
        </button>
        <button 
          className="memory-btn compact" 
          onClick={() => onSend(agent, 'Context 快满了！请立即：1) 写详细日记保存所有重要信息 2) 完成后告诉我可以 compact 了', null)}
          title="准备压缩记忆"
        >
          🗜️ 压缩准备
        </button>
      </div>

      <details>
        <summary>💭 Thinking / Controls</summary>
        <div className="controls-row">
          <select value={reasoning} onChange={(e) => setReasoning(e.target.value)}>
            <option value="off">Reasoning off</option>
            <option value="on">Reasoning on</option>
            <option value="stream">Reasoning stream</option>
          </select>
          <button onClick={() => onCommand(agent, `/reasoning ${reasoning}`)}>应用</button>
          <select value={thinkingLevel} onChange={(e) => setThinkingLevel(e.target.value)}>
            <option value="low">Thinking low</option>
            <option value="high">Thinking high</option>
            <option value="xhigh">Thinking xhigh</option>
          </select>
          <button onClick={() => onCommand(agent, `/thinking ${thinkingLevel}`)}>应用</button>
        </div>
        <pre className="thinking">{state.thinking || '(暂无)'}</pre>
      </details>

      <div className="chat" ref={chatRef}>
        {state.messages.slice(-80).map((m, idx) => (
          <div key={`${m.role}-${idx}`} className={`msg ${m.role}`}>
            <b>{m.role === 'user' ? '你' : displayName}:</b> {m.content}
          </div>
        ))}
      </div>

      {imagePreview && <img src={imagePreview} alt="paste-preview" className="preview" />}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        disabled={sending}
        placeholder={`给 ${displayName} 发送消息（Enter发送 / Shift+Enter换行 / Ctrl+V粘贴图片）`}
      />
      <button 
        className={`send ${sending ? 'sending' : ''} ${sendSuccess ? 'success' : ''}`} 
        onClick={send}
        disabled={sending}
      >
        {sending ? '⋯' : '发送'}
      </button>
    </section>
  );
}

// localStorage 键
const STORAGE_KEY_SELECTED = 'workbench-selected';
const STORAGE_KEY_NAMES = 'workbench-custom-names';

export default function App() {
  const [agents, setAgents] = useState([]);
  const [selected, setSelected] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SELECTED);
      return saved ? JSON.parse(saved) : ['helper', 'main'];
    } catch { return ['helper', 'main']; }
  });
  const [customNames, setCustomNames] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_NAMES);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [sessions, setSessions] = useState({});
  const [system, setSystem] = useState(null);
  const [stateMap, setStateMap] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const pollOffsets = useRef({});

  // 加载 agents 列表
  const loadAgents = async (isInitial = false) => {
    console.log('loadAgents called, isInitial:', isInitial);
    setRefreshing(true);
    try {
      const [cfg, sys, sess] = await Promise.all([
        fetch('/api/config').then((r) => r.json()),
        fetch('/api/system').then((r) => r.json()),
        fetch('/api/sessions').then((r) => r.json()),
      ]);
      
      const newAgents = cfg.agents || [];
      console.log('Loaded agents:', newAgents.map(a => a.id));
      setAgents(newAgents);
      setSystem(sys);
      setSessions(sess.sessions || {});
      
      // 只有初始加载且没有保存的 selected 时才使用默认值
      if (isInitial) {
        const savedSelected = localStorage.getItem(STORAGE_KEY_SELECTED);
        if (!savedSelected) {
          const ids = newAgents.slice(0, 2).map((a) => a.id);
          if (ids.length) setSelected(ids);
        }
      }

      // 为新 agent 加载 transcript
      const newStates = {};
      for (const a of newAgents) {
        const transcript = await fetch(`/api/transcript/${a.id}?limit=60`).then((r) => r.json());
        pollOffsets.current[a.id] = transcript.offset || 0;
        newStates[a.id] = { messages: normalizeMessages(transcript.messages), thinking: transcript.thinking || '' };
      }
      setStateMap(prev => ({ ...prev, ...newStates }));
    } finally {
      setRefreshing(false);
    }
  };

  // 保存 selected 到 localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SELECTED, JSON.stringify(selected));
  }, [selected]);

  // 保存 customNames 到 localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_NAMES, JSON.stringify(customNames));
  }, [customNames]);

  // 初始加载
  useEffect(() => {
    loadAgents(true);
  }, []);

  useEffect(() => {
    const t = setInterval(async () => {
      const [sys, sess] = await Promise.all([
        fetch('/api/system').then((r) => r.json()),
        fetch('/api/sessions').then((r) => r.json()),
      ]);
      setSystem(sys);
      setSessions(sess.sessions || {});
    }, 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!agents.length) return;
    const t = setInterval(async () => {
      for (const a of agents) {
        const offset = pollOffsets.current[a.id] || 0;
        const r = await fetch(`/api/transcript/${a.id}/poll?offset=${offset}`).then((x) => x.json());
        pollOffsets.current[a.id] = r.offset || offset;
        if ((r.messages && r.messages.length) || r.thinking) {
          setStateMap((prev) => ({
            ...prev,
            [a.id]: {
              messages: [...(prev[a.id]?.messages || []), ...normalizeMessages(r.messages)].slice(-200),
              thinking: r.thinking ? `${prev[a.id]?.thinking || ''}\n\n${r.thinking}`.slice(-12000) : (prev[a.id]?.thinking || ''),
            },
          }));
        }
      }
    }, 1000);
    return () => clearInterval(t);
  }, [agents]);

  const selectedAgents = useMemo(() => agents.filter((a) => selected.includes(a.id)).slice(0, 9), [agents, selected]);

  async function sendMessage(agent, text, imagePreview) {
    const content = [];
    if (text) content.push({ type: 'text', text });
    if (imagePreview) content.push({ type: 'image_url', image_url: { url: imagePreview } });

    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: agent.id,
        sessionKey: agent.sessionKey,
        messages: [{ role: 'user', content: content.length === 1 && content[0].type === 'text' ? text : content }],
      }),
    });
  }

  async function sendCommand(agent, command) {
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: agent.id,
        sessionKey: agent.sessionKey,
        messages: [{ role: 'user', content: command }],
      }),
    });
  }

  return (
    <div className="app">
      <header>
        <h1>🤖 Multi-Agent Workbench (React)</h1>
        <div className="metrics">
          <span>CPU: {system?.cpuPercent ?? '--'}%</span>
          <span>RAM: {system ? `${system.ramUsedGb}/${system.ramTotalGb} GB` : '--'}</span>
          <span>GPU: {system?.gpu?.available 
            ? `${system.gpu.usage}% (${Math.round(system.gpu.memoryUsed/1024*10)/10}/${Math.round(system.gpu.memoryTotal/1024*10)/10}GB, ${system.gpu.temperature}°C)` 
            : 'N/A'}</span>
          <span>Gateway: {system?.gateway?.online ? '🟢 Online' : '🔴 Offline'}</span>
        </div>
      </header>

      <div className="selector">
        <button 
          className={`refresh-btn ${refreshing ? 'refreshing' : ''}`}
          onClick={() => loadAgents(false)}
          disabled={refreshing}
          title="刷新 Agent 列表"
        >
          {refreshing ? '⏳' : '🔄'}
        </button>
        {agents.map((a) => {
          const checked = selected.includes(a.id);
          const displayName = customNames[a.id] || a.name;
          const isEditing = editingId === a.id;
          
          return (
            <label key={a.id} className="agent-selector">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  setSelected((prev) => {
                    if (e.target.checked) return [...new Set([...prev, a.id])].slice(0, 9);
                    return prev.filter((id) => id !== a.id);
                  });
                }}
              />
              <span className="agent-emoji">{a.emoji}</span>
              {isEditing ? (
                <input
                  type="text"
                  className="name-edit"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => {
                    if (editValue.trim()) {
                      setCustomNames(prev => ({ ...prev, [a.id]: editValue.trim() }));
                    }
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (editValue.trim()) {
                        setCustomNames(prev => ({ ...prev, [a.id]: editValue.trim() }));
                      }
                      setEditingId(null);
                    } else if (e.key === 'Escape') {
                      setEditingId(null);
                    }
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span 
                  className="agent-name-editable"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditingId(a.id);
                    setEditValue(displayName);
                  }}
                  title="点击修改名称"
                >
                  {displayName}
                </span>
              )}
            </label>
          );
        })}
      </div>

      <main className={`grid ${gridClass(selectedAgents.length)}`}>
        {selectedAgents.map((a) => (
          <AgentPanel
            key={a.id}
            agent={a}
            session={sessions[a.id]}
            state={stateMap[a.id] || { messages: [], thinking: '' }}
            setState={(x) => setStateMap((p) => ({ ...p, [a.id]: x }))}
            onSend={sendMessage}
            onCommand={sendCommand}
            customName={customNames[a.id]}
          />
        ))}
      </main>
    </div>
  );
}
