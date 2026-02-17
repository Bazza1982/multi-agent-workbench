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

function AgentPanel({ agent, session, state, setState, onSend, onCommand }) {
  const [input, setInput] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const [reasoning, setReasoning] = useState('off');
  const [thinkingLevel, setThinkingLevel] = useState('low');
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
    await onSend(agent, text, imagePreview);
    setInput('');
    setImagePreview(null);
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
        <div className="title">{agent.emoji} {agent.name}</div>
        <div className="sub">{session?.model || 'unknown'}</div>
      </div>

      <div className="context-row">
        <span>{pctColor(pct) === 'green' ? '🟢' : pctColor(pct) === 'yellow' ? '🟡' : '🔴'} Context {pct.toFixed(0)}%</span>
        <span>{total.toLocaleString()}/{ctx.toLocaleString()}</span>
      </div>
      <div className="progress"><div className={`bar ${pctColor(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>

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
            <b>{m.role === 'user' ? '你' : agent.name}:</b> {m.content}
          </div>
        ))}
      </div>

      {imagePreview && <img src={imagePreview} alt="paste-preview" className="preview" />}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={`给 ${agent.name} 发送消息（Enter发送 / Shift+Enter换行 / Ctrl+V粘贴图片）`}
      />
      <button className="send" onClick={send}>发送</button>
    </section>
  );
}

export default function App() {
  const [agents, setAgents] = useState([]);
  const [selected, setSelected] = useState(['main', 'coder']);
  const [sessions, setSessions] = useState({});
  const [system, setSystem] = useState(null);
  const [stateMap, setStateMap] = useState({});
  const pollOffsets = useRef({});

  useEffect(() => {
    (async () => {
      const [cfg, sys, sess] = await Promise.all([
        fetch('/api/config').then((r) => r.json()),
        fetch('/api/system').then((r) => r.json()),
        fetch('/api/sessions').then((r) => r.json()),
      ]);
      setAgents(cfg.agents || []);
      setSystem(sys);
      setSessions(sess.sessions || {});
      const ids = (cfg.agents || []).slice(0, 2).map((a) => a.id);
      if (ids.length) setSelected(ids);

      const initStates = {};
      for (const a of cfg.agents || []) {
        const transcript = await fetch(`/api/transcript/${a.id}?limit=60`).then((r) => r.json());
        pollOffsets.current[a.id] = transcript.offset || 0;
        initStates[a.id] = { messages: normalizeMessages(transcript.messages), thinking: transcript.thinking || '' };
      }
      setStateMap(initStates);
    })();
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
          <span>GPU: {system?.gpu?.available ? 'available' : 'N/A'}</span>
          <span>Gateway: {system?.gateway?.online ? '🟢 Online' : '🔴 Offline'}</span>
        </div>
      </header>

      <div className="selector">
        {agents.map((a) => {
          const checked = selected.includes(a.id);
          return (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  setSelected((prev) => {
                    if (e.target.checked) return [...new Set([...prev, a.id])].slice(0, 9);
                    return prev.filter((id) => id !== a.id);
                  });
                }}
              /> {a.emoji} {a.name}
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
          />
        ))}
      </main>
    </div>
  );
}
