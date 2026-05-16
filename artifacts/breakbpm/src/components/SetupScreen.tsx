import { useState } from 'react';
import type { GameType, Player } from '../lib/gameLogic';
import ballImg from '/eightball_nobg.png';
import Navbar from './Navbar';
import CooldownDialog from './CooldownDialog';
import { useStartGame } from '@workspace/api-client-react';
import { getDeviceId } from '../lib/device';

const GAME_TYPES: { id: GameType; label: string; desc: string }[] = [
  { id: '8ball', label: '8-Ball', desc: 'Solids vs Stripes' },
  { id: '9ball', label: '9-Ball', desc: 'Sink the 9 to win' },
  { id: 'practice', label: 'Practice', desc: 'Solo drills' },
];

const DEFAULT_NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];

interface Props {
  onStart: (gt: GameType, players: Player[]) => void;
  onAbout: () => void;
  onAccount: () => void;
  onSignIn: () => void;
}

export default function SetupScreen({ onStart, onAbout, onAccount, onSignIn }: Props) {
  const startGame = useStartGame();
  const [cooldownSec, setCooldownSec] = useState<number | null>(null);
  const [startError, setStartError] = useState('');
  const [gameType, setGameType] = useState<GameType>('8ball');
  const [playerCount, setPlayerCount] = useState(2);
  const [names, setNames] = useState(['', '', '', '']);
  const [autoTeam, setAutoTeam] = useState(true);
  const [manualTeams, setManualTeams] = useState<('solids' | 'stripes' | '')[]>(['', '', '', '']);
  const [joinCode, setJoinCode] = useState('');

  const isPractice = gameType === 'practice';
  const count = isPractice ? 1 : playerCount;

  async function handleStart() {
    setStartError('');
    const players: Player[] = Array.from({ length: count }, (_, i) => {
      const p: Player = { id: i, name: names[i] || DEFAULT_NAMES[i] };
      if (gameType === '8ball' && !autoTeam && manualTeams[i]) {
        p.team = manualTeams[i] as 'solids' | 'stripes';
      }
      return p;
    });
    try {
      await startGame.mutateAsync({ data: { deviceId: getDeviceId() } });
      onStart(gameType, players);
    } catch (e: unknown) {
      // useStartGame surfaces a fetch error with the response status; on 429 we
      // also get back cooldownSecondsRemaining in the body.
      const err = e as { status?: number; response?: { data?: { cooldownSecondsRemaining?: number; error?: string } } };
      const data = err?.response?.data;
      if (err?.status === 429 || data?.cooldownSecondsRemaining) {
        setCooldownSec(data?.cooldownSecondsRemaining ?? 300);
      } else {
        setStartError(data?.error ?? (e instanceof Error ? e.message : 'Could not start game'));
      }
    }
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
      <Navbar onAbout={onAbout} onAccount={onAccount} onSignIn={onSignIn} />
      {/* ── PC-98 Splash Panel ── */}
      <div className="splash-panel">
        {/* Left: 8-ball art in a CRT-style frame */}
        <div className="splash-art-frame">
          <img src={ballImg} alt="8-ball" className="splash-ball-img" />
        </div>

        {/* Right: title block */}
        <div className="splash-title-block">
          <div className="splash-title-main">BREAK<span className="splash-title-accent">BPM</span></div>
          <div className="splash-title-sub">BILLIARDS SCORE SYSTEM</div>
          <div className="splash-title-rule" />
          <div className="splash-meta">
            <span>VER 1.00</span>
            <span>© 2026 Saym Services Inc.</span>
          </div>
          <div className="splash-tagline text-left">
            PLAY FAST,<br />
            TRACK STATS
          </div>
        </div>
      </div>
      {/* ── Menu body ── */}
      <div className="app-body">

        {/* Game type */}
        <div>
          <div className="menu-section-label">▶ SELECT GAME TYPE</div>
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

        {/* Player count */}
        {!isPractice && (
          <div>
            <div className="menu-section-label">▶ NUMBER OF PLAYERS</div>
            <div className="flex gap-1">
              {[1, 2, 4].map(n => (
                <button
                  key={n}
                  className={`btn ${playerCount === n ? 'selected' : ''}`}
                  style={{ flex: 1, fontSize: 16, fontWeight: 'bold', minHeight: 44 }}
                  onClick={() => setPlayerCount(n)}
                >
                  {n}P
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Player names */}
        <div>
          <div className="menu-section-label">▶ {isPractice ? 'YOUR NAME' : 'PLAYER NAMES'}</div>
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
                {gameType === '8ball' && !autoTeam && (
                  <select
                    className="input"
                    style={{ width: 'auto', minWidth: 110, flex: '0 0 auto' }}
                    value={manualTeams[i]}
                    onChange={e => setTeam(i, e.target.value)}
                  >
                    <option value="">-Select-</option>
                    <option value="solids">Solids (1-7)</option>
                    <option value="stripes">Stripes (9-15)</option>
                  </select>
                )}
              </div>
            ))}
          </div>

          {gameType === '8ball' && !isPractice && (
            <div style={{ marginTop: 10 }}>
              <div className="menu-section-label">▶ TEAM ASSIGNMENT</div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={autoTeam}
                  onChange={e => setAutoTeam(e.target.checked)}
                />
                Automatic team assignment
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
        {startError && (
          <div className="notice" style={{ color: '#c00' }}>
            <span>!</span><span>{startError}</span>
          </div>
        )}
        <button
          className="btn btn-primary btn-big btn-full"
          onClick={handleStart}
          disabled={startGame.isPending}
        >
          ▶ {startGame.isPending ? 'STARTING…' : isPractice ? 'START PRACTICE' : 'START GAME'}
        </button>

        <hr className="sep" />

        {/* Join shared game */}
        <div>
          <div className="menu-section-label">▶ JOIN SHARED GAME</div>
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
        </div>

      </div>
      {/* Status bar */}
      <div className="statusbar">
        <div className="statusbar-item" style={{ flex: 1 }}>READY</div>
        <div className="statusbar-item">BREAKBPM SYS v1.0</div>
      </div>

      {cooldownSec !== null && (
        <CooldownDialog
          cooldownSecondsRemaining={cooldownSec}
          onDismiss={() => setCooldownSec(null)}
          onSignIn={onSignIn}
        />
      )}
    </div>
  );
}
