import { useState } from 'react';
import { Win98Window, Win98Button, Win98Input, Win98RadioGroup } from './Win98';
import type { GameType, Player } from '../lib/gameLogic';
import { generateShareCode } from '../lib/gameLogic';

interface SetupScreenProps {
  onStart: (gameType: GameType, players: Player[]) => void;
}

const GAME_TYPE_INFO: Record<GameType, { label: string; desc: string; icon: string }> = {
  '8ball': { label: '8-Ball', desc: 'Solids vs. Stripes — sink your group then the 8', icon: '8' },
  '9ball': { label: '9-Ball', desc: 'Balls 1-9 in order — sink the 9 to win', icon: '9' },
  'practice': { label: 'Practice', desc: 'Solo mode — track your shots & BPM freely', icon: '▶' },
};

const DEFAULT_NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];

export default function SetupScreen({ onStart }: SetupScreenProps) {
  const [gameType, setGameType] = useState<GameType>('8ball');
  const [playerCount, setPlayerCount] = useState(2);
  const [names, setNames] = useState<string[]>(['', '', '', '']);
  const [teamMode, setTeamMode] = useState<'auto' | 'manual'>('auto');
  const [manualTeams, setManualTeams] = useState<('solids' | 'stripes' | '')[]>(['', '', '', '']);

  const isPractice = gameType === 'practice';

  const effectivePlayerCount = isPractice ? 1 : playerCount;

  const getPlayerName = (i: number) => names[i] || DEFAULT_NAMES[i];

  function handleStart() {
    const players: Player[] = [];
    for (let i = 0; i < effectivePlayerCount; i++) {
      const p: Player = { id: i, name: getPlayerName(i) };
      if (gameType === '8ball' && teamMode === 'manual' && manualTeams[i]) {
        p.team = manualTeams[i] as 'solids' | 'stripes';
      }
      players.push(p);
    }
    onStart(gameType, players);
  }

  const canStart = effectivePlayerCount >= 1;

  return (
    <div className="app-root">
      <div className="app-center">
        <Win98Window title="BreakBPM — New Game" icon="🎱" style={{ marginBottom: 8 }}>
          <div className="setup-layout">

            {/* Title */}
            <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
              <div style={{
                fontFamily: "'VT323', 'Courier New', monospace",
                fontSize: 42,
                color: '#000080',
                letterSpacing: 2,
                lineHeight: 1,
              }}>
                BREAK<span style={{ color: '#008000' }}>BPM</span>
              </div>
              <div style={{ fontSize: 11, color: '#444', marginTop: 2 }}>
                Pool &amp; Billiards Score Tracker
              </div>
            </div>

            <hr className="win98-sep" />

            {/* Game Type */}
            <div className="win98-group">
              <span className="win98-group-label">Game Type</span>
              <div className="setup-game-types">
                {(Object.keys(GAME_TYPE_INFO) as GameType[]).map(gt => (
                  <Win98Button
                    key={gt}
                    className={`game-type-btn ${gameType === gt ? 'selected' : ''}`}
                    onClick={() => {
                      setGameType(gt);
                      if (gt === 'practice') setPlayerCount(1);
                    }}
                  >
                    <div style={{ fontWeight: 'bold', fontSize: 13 }}>{GAME_TYPE_INFO[gt].label}</div>
                    <div style={{ fontSize: 9, marginTop: 2, whiteSpace: 'normal', lineHeight: 1.3 }}>
                      {GAME_TYPE_INFO[gt].desc}
                    </div>
                  </Win98Button>
                ))}
              </div>
            </div>

            {/* Players */}
            {!isPractice && (
              <div className="win98-group">
                <span className="win98-group-label">Players</span>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span className="win98-label">Number of Players:</span>
                  <div className="player-count-row">
                    {[2, 3, 4].map(n => (
                      <Win98Button
                        key={n}
                        className={`player-count-btn ${playerCount === n ? 'selected' : ''}`}
                        onClick={() => setPlayerCount(n)}
                      >
                        {n}
                      </Win98Button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
                  {Array.from({ length: playerCount }).map((_, i) => (
                    <div key={i} className="player-panel" style={{ padding: '6px' }}>
                      <div className="win98-label" style={{ marginBottom: 3 }}>Player {i + 1}</div>
                      <Win98Input
                        value={names[i]}
                        onChange={v => {
                          const n = [...names];
                          n[i] = v;
                          setNames(n);
                        }}
                        placeholder={DEFAULT_NAMES[i]}
                        maxLength={16}
                      />
                      {gameType === '8ball' && teamMode === 'manual' && (
                        <div style={{ marginTop: 4 }}>
                          <Win98RadioGroup
                            name={`team-${i}`}
                            options={[
                              { value: 'solids', label: 'Solids (1-7)' },
                              { value: 'stripes', label: 'Stripes (9-15)' },
                            ]}
                            value={manualTeams[i]}
                            onChange={v => {
                              const t = [...manualTeams] as ('solids' | 'stripes' | '')[];
                              t[i] = v as 'solids' | 'stripes';
                              setManualTeams(t);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {gameType === '8ball' && (
                  <div style={{ marginTop: 8 }}>
                    <span className="win98-label" style={{ marginRight: 8 }}>Team assignment:</span>
                    <Win98RadioGroup
                      name="team-mode"
                      options={[
                        { value: 'auto', label: 'Auto (first ball sunk decides)' },
                        { value: 'manual', label: 'Manual (set teams now)' },
                      ]}
                      value={teamMode}
                      onChange={v => setTeamMode(v as 'auto' | 'manual')}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Practice mode info */}
            {isPractice && (
              <div className="win98-notice">
                <span className="win98-notice-icon">ℹ</span>
                <div>
                  <strong>Solo Practice Mode</strong> — No win conditions. Freely track every ball you sink.
                  The BPM counter and timer will run. Perfect for warm-ups and drills.
                </div>
              </div>
            )}

            {/* Load from URL */}
            <LoadFromUrl />

            <hr className="win98-sep" />

            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, paddingBottom: 4 }}>
              <Win98Button
                variant="primary"
                onClick={handleStart}
                disabled={!canStart}
                style={{ minWidth: 120, fontSize: 13, fontWeight: 'bold' }}
              >
                {isPractice ? '▶ Start Practice' : '▶ Start Game'}
              </Win98Button>
            </div>
          </div>
        </Win98Window>

        <div style={{ textAlign: 'center', fontSize: 10, color: '#c0e0c0', paddingTop: 4 }}>
          BreakBPM v1.0 — Windows 98 Edition
        </div>
      </div>
    </div>
  );
}

function LoadFromUrl() {
  const [code, setCode] = useState('');

  function handleLoad() {
    const url = new URL(window.location.href);
    url.searchParams.set('game', code.trim().toUpperCase());
    window.location.href = url.toString();
  }

  return (
    <div className="win98-group">
      <span className="win98-group-label">Join Shared Game</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Win98Input
          value={code}
          onChange={setCode}
          placeholder="Enter 4-digit code..."
          maxLength={4}
          style={{ width: 130, fontFamily: "'VT323', monospace", fontSize: 16, letterSpacing: 4, textTransform: 'uppercase' }}
        />
        <Win98Button onClick={handleLoad} disabled={code.trim().length < 1}>
          Load Game
        </Win98Button>
      </div>
      <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
        Or paste a full share URL in your browser address bar.
      </div>
    </div>
  );
}
