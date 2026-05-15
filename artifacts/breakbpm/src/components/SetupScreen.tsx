import { useState } from 'react';
import type { GameType, Player } from '../lib/gameLogic';

const GAME_TYPES: { id: GameType; label: string; desc: string }[] = [
  { id: '8ball', label: '8-Ball', desc: 'Solids vs Stripes' },
  { id: '9ball', label: '9-Ball', desc: 'Sink the 9 to win' },
  { id: 'practice', label: 'Practice', desc: 'Solo / drill mode' },
];

const DEFAULT_NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];

interface Props { onStart: (gt: GameType, players: Player[]) => void; }

export default function SetupScreen({ onStart }: Props) {
  const [gameType, setGameType] = useState<GameType>('8ball');
  const [playerCount, setPlayerCount] = useState(2);
  const [names, setNames] = useState(['', '', '', '']);
  const [teamMode, setTeamMode] = useState<'auto' | 'manual'>('auto');
  const [manualTeams, setManualTeams] = useState<('solids' | 'stripes' | '')[]>(['', '', '', '']);
  const [joinCode, setJoinCode] = useState('');

  const isPractice = gameType === 'practice';
  const count = isPractice ? 1 : playerCount;

  function handleStart() {
    const players: Player[] = Array.from({ length: count }, (_, i) => {
      const p: Player = { id: i, name: names[i] || DEFAULT_NAMES[i] };
      if (gameType === '8ball' && teamMode === 'manual' && manualTeams[i]) {
        p.team = manualTeams[i] as 'solids' | 'stripes';
      }
      return p;
    });
    onStart(gameType, players);
  }

  function handleJoin() {
    const url = new URL(window.location.href);
    url.searchParams.set('game', joinCode.trim().toUpperCase());
    window.location.href = url.toString();
  }

  function setName(i: number, v: string) {
    const n = [...names]; n[i] = v; setNames(n);
  }
  function setTeam(i: number, v: string) {
    const t = [...manualTeams] as ('solids' | 'stripes' | '')[];
    t[i] = v as 'solids' | 'stripes';
    setManualTeams(t);
  }

  return (
    <div className="app-window">
      {/* Title bar */}
      <div className="titlebar">
        <div className="titlebar-left">
          <span className="titlebar-icon">🎱</span>
          <span className="titlebar-title">BreakBPM — New Game</span>
        </div>
        <div className="titlebar-btns">
          <button className="tb-btn">_</button>
          <button className="tb-btn">□</button>
          <button className="tb-btn">✕</button>
        </div>
      </div>

      <div className="app-body">
        {/* Logo */}
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{
            fontFamily: "'VT323','Courier New',monospace",
            fontSize: 52,
            lineHeight: 1,
            letterSpacing: 2,
          }}>
            <span style={{ color: '#000080' }}>BREAK</span><span style={{ color: '#008000' }}>BPM</span>
          </div>
          <div style={{ fontSize: 12, color: '#444', marginTop: 2 }}>
            Pool &amp; Billiards Score Tracker
          </div>
        </div>

        <hr className="sep" />

        {/* Game type */}
        <div>
          <div style={{ fontWeight: 'bold', marginBottom: 6, fontSize: 12 }}>Game Type</div>
          <div className="game-type-grid">
            {GAME_TYPES.map(gt => (
              <button
                key={gt.id}
                className={`btn type-btn ${gameType === gt.id ? 'selected' : ''}`}
                onClick={() => { setGameType(gt.id); if (gt.id === 'practice') setPlayerCount(1); }}
              >
                <span className="type-btn-label">{gt.label}</span>
                <span className="type-btn-desc">{gt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Player count (not practice) */}
        {!isPractice && (
          <div>
            <div style={{ fontWeight: 'bold', marginBottom: 6, fontSize: 12 }}>Number of Players</div>
            <div className="flex gap-1">
              {[2, 3, 4].map(n => (
                <button
                  key={n}
                  className={`btn ${playerCount === n ? 'btn-primary' : ''}`}
                  style={{ flex: 1, fontSize: 16, fontWeight: 'bold', minHeight: 44 }}
                  onClick={() => setPlayerCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Player names */}
        <div>
          <div style={{ fontWeight: 'bold', marginBottom: 6, fontSize: 12 }}>
            {isPractice ? 'Your Name' : 'Player Names'}
          </div>
          <div className="flex flex-col gap-2">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="player-row">
                <span className="player-num">{i + 1}.</span>
                <input
                  className="input"
                  value={names[i]}
                  onChange={e => setName(i, e.target.value)}
                  placeholder={DEFAULT_NAMES[i]}
                  maxLength={16}
                />
                {gameType === '8ball' && teamMode === 'manual' && (
                  <select
                    className="input"
                    style={{ width: 'auto', minWidth: 110, flex: '0 0 auto' }}
                    value={manualTeams[i]}
                    onChange={e => setTeam(i, e.target.value)}
                  >
                    <option value="">Team?</option>
                    <option value="solids">Solids (1-7)</option>
                    <option value="stripes">Stripes (9-15)</option>
                  </select>
                )}
              </div>
            ))}
          </div>

          {/* Team assignment mode for 8-ball */}
          {gameType === '8ball' && !isPractice && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 12 }}>Team Assignment</div>
              <label className="radio-label">
                <input type="radio" name="teamMode" checked={teamMode === 'auto'} onChange={() => setTeamMode('auto')} />
                Auto (first ball sunk decides)
              </label>
              <label className="radio-label">
                <input type="radio" name="teamMode" checked={teamMode === 'manual'} onChange={() => setTeamMode('manual')} />
                Manual (set teams now)
              </label>
            </div>
          )}
        </div>

        {isPractice && (
          <div className="notice">
            <span>ℹ</span>
            <span>Solo mode — no win conditions. Track every ball and watch your BPM improve.</span>
          </div>
        )}

        {/* Start */}
        <button className="btn btn-primary btn-big btn-full" onClick={handleStart}>
          ▶ {isPractice ? 'Start Practice' : 'Start Game'}
        </button>

        <hr className="sep" />

        {/* Join shared game */}
        <div>
          <div style={{ fontWeight: 'bold', marginBottom: 6, fontSize: 12 }}>Join Shared Game</div>
          <div className="flex gap-2 items-center">
            <input
              className="input"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              placeholder="4-DIGIT CODE"
              maxLength={4}
              style={{ fontFamily: "'VT323',monospace", fontSize: 20, letterSpacing: 6, flex: 1 }}
            />
            <button
              className="btn"
              onClick={handleJoin}
              disabled={joinCode.trim().length < 1}
              style={{ flexShrink: 0 }}
            >
              Join →
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
            Or paste a full share URL into your browser.
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 10, color: '#888', paddingBottom: 4 }}>
          BreakBPM v1.0 — Windows 98 Edition
        </div>
      </div>

      {/* Status bar */}
      <div className="statusbar">
        <div className="statusbar-item" style={{ flex: 1 }}>Ready</div>
        <div className="statusbar-item">BreakBPM</div>
      </div>
    </div>
  );
}
