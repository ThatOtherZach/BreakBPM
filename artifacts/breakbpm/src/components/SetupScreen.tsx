import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import type { GameType, GameState, Player, SharkAggression } from '../lib/gameLogic';
import { normalizeShareCode } from '../lib/gameLogic';
import ballImg from '/eightball_nobg.png';
import Navbar from './Navbar';
import {
  useStartGame,
  useGetResumableGame,
  useAbandonGame,
} from '@workspace/api-client-react';
import { saveInProgressGame, clearInProgressGame, normalizeSharkIdentity } from '../lib/gameLogic';
import SharkIcon from './SharkIcon';
import { useAuth } from '../lib/authClient';
import { APP_VERSION } from '../lib/version';
import { pickTagline } from '../lib/taglines';

const tagline = pickTagline();

const GAME_TYPES: { id: GameType; label: string; desc: string }[] = [
  { id: '8ball', label: '8-Ball', desc: 'Solids vs Stripes' },
  { id: '9ball', label: '9-Ball', desc: 'Sink the 9 to win' },
  { id: 'practice', label: 'Practice', desc: 'Solo drills' },
];

const DEFAULT_NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
const PLAYER_BALL_COLORS = ['#FDD307', '#1F4E9E', '#C3342B', '#5B247A'];

interface Props {
  onStart: (gt: GameType, players: Player[], serverGameId: string | null, maxGameDurationMs: number | null, serverShareCode: string | null, sharkAggression?: SharkAggression) => void;
  /** Resume an existing game from the server-side in-progress snapshot. */
  onResume: (state: GameState, serverGameId: string | null, maxGameDurationMs: number | null, pausedDuration: number) => void;
  onAbout: () => void;
  onLegal: () => void;
  onAccount: () => void;
  onStats: () => void;
  onFindPlayers: () => void;
  onSignIn: () => void;
}

export default function SetupScreen({ onStart, onResume, onAbout, onLegal, onAccount, onStats, onFindPlayers, onSignIn }: Props) {
  const [, setLocation] = useLocation();
  const startGame = useStartGame();
  const abandonGame = useAbandonGame();
  const { user } = useAuth();
  // Signed-in users always play as themselves in slot 1 — their screen
  // name is prefilled and the input is locked so they can't masquerade
  // as someone else (which would also pollute their own BPM history).
  const lockedPlayer1Name = user?.screenName ?? null;
  // SetupScreen only mounts when localStorage has no in-progress game
  // (App.tsx routes straight to GameScreen otherwise), so this fetch is
  // already the "fallback path" — different device / cleared browser.
  const resumable = useGetResumableGame();
  const [resumeDismissed, setResumeDismissed] = useState(false);

  const [startError, setStartError] = useState('');
  const [gameType, setGameType] = useState<GameType>('8ball');
  const [playerCount, setPlayerCount] = useState(2);
  const [names, setNames] = useState(['', '', '', '']);
  const [autoTeam, setAutoTeam] = useState(true);
  const [manualTeams, setManualTeams] = useState<('solids' | 'stripes' | '')[]>(['', '', '', '']);
  const [joinCode, setJoinCode] = useState('');
  // Join Shared Game panel starts collapsed to keep the main menu short
  // on mobile. Users who don't intend to join shouldn't have to scroll
  // past the input. Not persisted — resets to collapsed on every visit.
  const [joinOpen, setJoinOpen] = useState(false);
  // Shark mode (8-ball + 1P) aggression toggle. Default to 'normal' so new
  // players aren't overwhelmed. Only sent to onStart when the combo matches.
  const [sharkAggression, setSharkAggression] = useState<SharkAggression>('normal');

  // Keep slot 1 in sync with the signed-in user's screen name. Runs when
  // auth resolves (login mid-session, page reload, etc.) so the field
  // doesn't lag behind the locked state.
  useEffect(() => {
    if (lockedPlayer1Name === null) return;
    setNames(prev => {
      if (prev[0] === lockedPlayer1Name) return prev;
      const next = [...prev];
      next[0] = lockedPlayer1Name;
      return next;
    });
  }, [lockedPlayer1Name]);

  function handleResume() {
    const offered = resumable.data?.game;
    if (!offered) return;
    const gs = normalizeSharkIdentity((offered.gameState ?? {}) as Partial<GameState>);
    // Best-effort rehydration: if players are missing (older row, server
    // snapshot never received, etc.) fall back to placeholders so the
    // game is still playable rather than silently destroyed. We log what
    // was missing so we can diagnose future issues.
    const missing: string[] = [];
    const resolvedGameType = gs.gameType ?? offered.gameType;
    // Validate each player object — a malformed snapshot (missing id/name)
    // would crash GameScreen on first render. Discard the whole array if
    // any entry is bad and fall back to placeholders.
    const rawPlayers = Array.isArray(gs.players) ? gs.players : [];
    const validPlayers = rawPlayers.filter((p): p is Player =>
      !!p && typeof p === 'object' && typeof (p as Player).id === 'number' && typeof (p as Player).name === 'string',
    );
    let players: Player[] = validPlayers.length === rawPlayers.length ? validPlayers : [];
    if (players.length === 0) {
      missing.push('players');
      // Placeholders sized by game type — practice is solo, 8/9-ball
      // need at least two. The user can rename or start fresh.
      players = resolvedGameType === 'practice'
        ? [{ id: 0, name: 'Player 1' }]
        : [
            { id: 0, name: 'Player 1' },
            { id: 1, name: 'Player 2' },
          ];
    }
    // Clamp currentPlayerIndex into the valid range so a stale/corrupted
    // index can't index past the (possibly-fallback) players array.
    const rawIndex = gs.currentPlayerIndex ?? 0;
    const safeCurrentPlayerIndex = Number.isFinite(rawIndex)
      ? Math.max(0, Math.min(players.length - 1, Math.floor(rawIndex)))
      : 0;
    if (!gs.shareCode) missing.push('shareCode');
    // Validate gameStartTime fallback — NaN here would break the elapsed-
    // time clock. Use now() as a last-resort floor.
    const parsedStarted = new Date(offered.startedAt).getTime();
    const fallbackStart = Number.isFinite(parsedStarted) ? parsedStarted : Date.now();
    const safeGameStartTime = typeof gs.gameStartTime === 'number' && Number.isFinite(gs.gameStartTime)
      ? gs.gameStartTime
      : (missing.push('gameStartTime'), fallbackStart);
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[resume] snapshot missing fields, using fallbacks:', missing);
    }
    const rehydrated: GameState = {
      phase: 'playing',
      gameType: resolvedGameType,
      players,
      currentPlayerIndex: safeCurrentPlayerIndex,
      sunkBalls: gs.sunkBalls ?? [],
      shotLog: gs.shotLog ?? [],
      gameStartTime: safeGameStartTime,
      firstActionTime: gs.firstActionTime ?? null,
      timerStartTime: gs.timerStartTime ?? null,
      lastActionTime: gs.lastActionTime ?? null,
      winner: gs.winner ?? null,
      winMessage: gs.winMessage ?? '',
      shareCode: gs.shareCode ?? '',
      teamAssigned: gs.teamAssigned ?? false,
      // Preserve shark identity across resume — otherwise a restored Shark
      // game silently degrades into a non-shark solo 8-ball (no steals).
      sharkAggression: gs.sharkAggression,
      sharkSunkBalls: gs.sharkSunkBalls,
      undoCount: gs.undoCount ?? 0,
    };
    // Seed localStorage so the next refresh resumes from local too.
    saveInProgressGame({
      state: rehydrated,
      serverGameId: offered.gameId,
      maxGameDurationMs: null,
      pausedDuration: 0,
      savedAt: Date.now(),
    });
    // Hand off via onResume (NOT onStart) so App.tsx preserves the full
    // rehydrated state instead of overwriting it with a fresh game.
    onResume(rehydrated, offered.gameId, null, 0);
  }

  const [discardError, setDiscardError] = useState('');
  async function handleDiscardResume() {
    const offered = resumable.data?.game;
    if (!offered) {
      setResumeDismissed(true);
      return;
    }
    setDiscardError('');
    try {
      await abandonGame.mutateAsync({ data: { gameId: offered.gameId } });
      clearInProgressGame();
      setResumeDismissed(true);
    } catch (err) {
      // Surface the failure so the user can retry — don't silently
      // dismiss, otherwise the orphan row lingers until the inactivity
      // sweep and the prompt comes back next visit.
      const msg = err instanceof Error ? err.message : 'Network error';
      setDiscardError(`Couldn't discard: ${msg}. Try again.`);
    }
  }

  const isPractice = gameType === 'practice';
  const count = isPractice ? 1 : playerCount;
  // Shark mode is the 1-player flavor of 8-ball — no solids/stripes,
  // every miss/foul lets the invisible Shark steal a ball.
  const isShark = gameType === '8ball' && playerCount === 1;

  // 9-Ball has no solo/Shark variant. If the user is on Shark (1P) and
  // switches to 9-Ball, bump them to Singles (2P) so the player-count
  // selector doesn't show a stale/invalid selection.
  useEffect(() => {
    if (gameType === '9ball' && playerCount === 1) {
      setPlayerCount(2);
    }
  }, [gameType, playerCount]);

  // Normalize manualTeams when entering Singles 8-ball manual mode. Doubles
  // legally allows duplicates (3v1 splits), so the user can land here with
  // both slot 0 and slot 1 on the same group after switching from Doubles
  // → Singles. Clear slot 1 in that case so the invalid pairing can't
  // survive a mode transition and get into handleStart.
  useEffect(() => {
    if (gameType !== '8ball' || playerCount !== 2 || autoTeam) return;
    if (manualTeams[0] && manualTeams[0] === manualTeams[1]) {
      const t = [...manualTeams] as ('solids' | 'stripes' | '')[];
      t[1] = '';
      setManualTeams(t);
    }
  }, [gameType, playerCount, autoTeam, manualTeams]);

  async function handleStart() {
    setStartError('');
    // Defensive guard: in Singles 8-ball manual mode the two players must
    // be on opposite groups. The dropdown UI already enforces this on
    // change, but a mode transition (e.g. Doubles → Singles) could in
    // theory leave a stale duplicate in state — refuse to start in that
    // case rather than handing GameScreen an invalid pairing.
    if (gameType === '8ball' && !isShark && !autoTeam && count === 2 &&
        manualTeams[0] && manualTeams[0] === manualTeams[1]) {
      setStartError('Players must be on opposite groups (Solids vs Stripes).');
      return;
    }
    const players: Player[] = Array.from({ length: count }, (_, i) => {
      const p: Player = { id: i, name: names[i] || DEFAULT_NAMES[i] };
      // Manual team assignment is only relevant for multiplayer 8-ball.
      if (gameType === '8ball' && !isShark && !autoTeam && manualTeams[i]) {
        p.team = manualTeams[i] as 'solids' | 'stripes';
      }
      return p;
    });
    try {
      // Server enum only knows '8ball'/'9ball'/'practice'; shark is a
      // client-side variant of 8-ball, so the API call stays as '8ball'.
      const res = await startGame.mutateAsync({
        data: { gameType, maxPlayers: count },
      });
      onStart(
        gameType,
        players,
        res.gameId ?? null,
        res.maxGameDurationMs ?? null,
        res.shareCode ?? null,
        isShark ? sharkAggression : undefined,
      );
    } catch (e: unknown) {
      const err = e as { data?: { error?: string } };
      setStartError(err?.data?.error ?? (e instanceof Error ? e.message : 'Could not start game'));
    }
  }

  function handleJoin() {
    const code = normalizeShareCode(joinCode);
    if (!code) {
      setStartError('Codes are 5 characters (letters & digits, no 0/1/I/O).');
      return;
    }
    setLocation(`/join/${code}`);
  }

  function setName(i: number, v: string) {
    const n = [...names]; n[i] = v; setNames(n);
  }
  function setTeam(i: number, v: string) {
    const t = [...manualTeams] as ('solids' | 'stripes' | '')[];
    t[i] = v as 'solids' | 'stripes';
    // Singles 8-ball: the two players must be on opposite groups. If the
    // other slot already holds the value we just picked, clear it so the
    // user is forced to re-pick (rather than silently flipping their
    // group). Doubles (4P) deliberately allows duplicates — 3v1 splits.
    if (count === 2 && v) {
      const other = i === 0 ? 1 : 0;
      if (t[other] === v) t[other] = '';
    }
    setManualTeams(t);
  }

  return (
    // app-window--page: lets the whole document scroll (splash + body
    // together) instead of trapping scroll inside .app-body. The navbar
    // stays sticky at the top. Matches the Account/About/Passes screens
    // so the splash panel scrolls away on mobile when the keyboard
    // appears for player-name input.
    <div className="app-window app-window--page">
      {/* Title bar */}
      <Navbar onAbout={onAbout} onAccount={onAccount} onStats={onStats} onFindPlayers={onFindPlayers} onSignIn={onSignIn} />
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
            <span>v{APP_VERSION}</span>
            <span>©Saym Services 2026</span>
          </div>
          <div className="splash-tagline text-left">
            {tagline.split('\n').map((line, i, arr) => (
              <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
            ))}
          </div>
        </div>
      </div>
      {/* ── Menu body ── */}
      <div className="app-body pb-[10px]">

        {/* Resume in-progress game (signed-in users whose localStorage was
            cleared — different device, new browser, etc.) */}
        {!resumeDismissed && resumable.data?.resumable && resumable.data.game && (() => {
          const offered = resumable.data.game;
          const gs = (offered.gameState ?? {}) as Partial<GameState>;
          // "Degraded" means we'd have to rehydrate with placeholder players
          // because the server snapshot is incomplete or malformed. Mirror
          // the same validation handleResume() uses so the UI never claims
          // "Resume game in progress?" when names will actually be lost.
          const rawPlayers = Array.isArray(gs.players) ? gs.players : [];
          const allValid = rawPlayers.length > 0 && rawPlayers.every(p =>
            !!p && typeof p === 'object' && typeof (p as Player).id === 'number' && typeof (p as Player).name === 'string',
          );
          const degraded = !allValid;
          return (
          <div className="notice" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div>
              <strong>{degraded ? "Couldn't fully restore this game" : 'Resume game in progress?'}</strong>
              <div style={{ fontSize: 11, marginTop: 2, opacity: 0.8 }}>
                {offered.gameType.toUpperCase()} — started {new Date(offered.startedAt).toLocaleString()}
              </div>
              {degraded && (
                <div style={{ fontSize: 11, marginTop: 4, color: '#c70' }}>
                  Player names couldn't be recovered. Resume with placeholders, or start fresh.
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleResume}>
                {degraded ? '▶ Resume anyway' : '▶ Resume'}
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleDiscardResume} disabled={abandonGame.isPending}>
                {abandonGame.isPending ? '…' : 'Start fresh'}
              </button>
            </div>
            {discardError && (
              <div style={{ color: '#c33', fontSize: 11 }}>{discardError}</div>
            )}
          </div>
          );
        })()}

        {/* Game type */}
        <div>
          <div className="menu-section-label">▶ GAME TYPE</div>
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
        {!isPractice && <hr className="sep mt-[1px] mb-[1px]" />}
        {!isPractice && (
          <div>
            <div className="flex gap-1">
              {(gameType === '9ball' ? [2, 4] : [1, 2, 4]).map(n => (
                <button
                  key={n}
                  className={`btn ${playerCount === n ? 'selected' : ''}`}
                  style={{ flex: 1, fontSize: 13, fontWeight: 'bold', minHeight: 44 }}
                  onClick={() => setPlayerCount(n)}
                >
                  {n === 1 ? 'Shark Mode' : n === 2 ? 'Singles' : 'Doubles'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Player names — hidden in Shark Mode (solo, no need to name) */}
        {!isShark && (<div>
          <div className="menu-section-label">▶ {isPractice ? 'YOUR NAME' : 'PLAYERS'}</div>
          <div className="flex flex-col gap-2">
            {Array.from({ length: count }).map((_, i) => {
              // Slot 1 is locked to the signed-in user so they can't
              // play under someone else's name and skew their stats.
              const isLockedSlot = i === 0 && lockedPlayer1Name !== null;
              return (
              <div key={i} className="player-row">
                <span
                  className="hud-chip hud-chip-solid"
                  data-number={i + 1}
                  aria-hidden="true"
                  style={{ '--chip-color': PLAYER_BALL_COLORS[i] } as React.CSSProperties}
                />
                <input
                  className="input"
                  value={isLockedSlot ? lockedPlayer1Name : names[i]}
                  onChange={e => setName(i, e.target.value)}
                  placeholder={DEFAULT_NAMES[i]}
                  maxLength={16}
                  readOnly={isLockedSlot}
                  aria-readonly={isLockedSlot || undefined}
                  title={isLockedSlot ? 'Signed in — name locked to your account' : undefined}
                  style={isLockedSlot ? { opacity: 0.85, cursor: 'not-allowed' } : undefined}
                />
                {gameType === '8ball' && !isShark && !autoTeam && (() => {
                  // Singles only: hide the group the other player has
                  // already claimed so both players can't end up on the
                  // same team. Doubles keeps both options for everyone
                  // so 3v1 / 2v2 / 4v0 splits remain possible.
                  const takenByOther = count === 2
                    ? manualTeams[i === 0 ? 1 : 0]
                    : '';
                  return (
                    <select
                      className="input"
                      // Fixed width sized for the longer label "Stripes (9-15)"
                      // so the dropdown doesn't shrink when "Stripes" is hidden
                      // (because the other player took it). Keeps both rows
                      // visually aligned.
                      style={{ width: 130, flex: '0 0 auto' }}
                      value={manualTeams[i]}
                      onChange={e => setTeam(i, e.target.value)}
                    >
                      <option value="">-Select-</option>
                      {takenByOther !== 'solids' && (
                        <option value="solids">Solids (1-7)</option>
                      )}
                      {takenByOther !== 'stripes' && (
                        <option value="stripes">Stripes (9-15)</option>
                      )}
                    </select>
                  );
                })()}
              </div>
              );
            })}
          </div>

          {gameType === '8ball' && !isPractice && !isShark && (
            <div
              className="inset"
              style={{
                marginTop: 10,
                padding: '6px 10px',
                background: 'var(--silver)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, flex: 1 }}>
                  <span style={{ fontWeight: 'bold', fontSize: 13 }}>Automatic Team Assignment</span>
                  <span style={{ fontSize: 11, color: '#444' }}>First ball locks player groups</span>
                </span>
                <div className="flex gap-1" style={{ flexShrink: 0 }}>
                  <button
                    type="button"
                    className={`btn ${autoTeam ? 'selected' : ''}`}
                    style={{ minWidth: 48, minHeight: 32, fontWeight: 'bold' }}
                    onClick={() => setAutoTeam(true)}
                    aria-pressed={autoTeam}
                  >
                    On
                  </button>
                  <button
                    type="button"
                    className={`btn ${!autoTeam ? 'selected' : ''}`}
                    style={{ minWidth: 48, minHeight: 32, fontWeight: 'bold' }}
                    onClick={() => setAutoTeam(false)}
                    aria-pressed={!autoTeam}
                  >
                    Off
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>)}

        {isPractice && (
          <div className="notice">
            <span>ℹ</span>
            <span>Solo mode — no win conditions. Track every ball and watch your BPM improve.</span>
          </div>
        )}

        {isShark && (
          <div>
            <div className="menu-section-label">▶ SHARK MODE</div>
            <div className="notice" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11 }}>Solo 8-ball with an invisible Shark player. Your first ball locks in solids or stripes; the other group goes to the Shark. Clear your group and sink the 8 ball to win. Misses and fouls feed balls to the Shark.</span>
            </div>
            <div className="menu-section-label" style={{ marginTop: 4 }}>▶ AGGRESSION</div>
            <div className="flex gap-1">
              <button
                className={`btn ${sharkAggression === 'normal' ? 'selected' : ''}`}
                style={{ flex: 1, fontWeight: 'bold', minHeight: 40 }}
                onClick={() => setSharkAggression('normal')}
              >
                Normal
                <span style={{ display: 'block', fontWeight: 'normal', fontSize: 10, marginTop: 2 }}>Removes on foul</span>
              </button>
              <button
                className={`btn ${sharkAggression === 'hard' ? 'selected' : ''}`}
                style={{ flex: 1, fontWeight: 'bold', minHeight: 40 }}
                onClick={() => setSharkAggression('hard')}
              >
                Hard
                <span style={{ display: 'block', fontWeight: 'normal', fontSize: 10, marginTop: 2 }}>Removes on miss & foul</span>
              </button>
            </div>
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
          <span className="cue-ball-icon" aria-hidden="true" style={{ marginRight: 6, verticalAlign: 'middle' }} />
          {startGame.isPending ? 'STARTING…' : isPractice ? 'START PRACTICE' : 'START GAME'}
        </button>

        <hr className="sep" />

        {/* Join shared game — collapsible panel.
            Header mirrors AccountScreen's Recent Games panel (icon + label).
            Body (input + Join button) is mounted only when expanded so the
            input is fully removed from tab order / autofocus when closed. */}
        <div className="panel">
          <button
            type="button"
            className="panel-header"
            onClick={() => setJoinOpen(o => !o)}
            aria-expanded={joinOpen}
            aria-controls="join-shared-body"
            style={{
              width: '100%',
              border: 'none',
              cursor: 'pointer',
              font: 'inherit',
              textAlign: 'left',
            }}
          >
            <span
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              className="justify-start items-center flex-row text-left text-[13px] font-semibold text-[#ffffff]">
              JOIN SHARED GAME
            </span>
            <span aria-hidden="true" className="text-[#000000]">{joinOpen ? '▼' : '▶'}</span>
          </button>
          {joinOpen && (
            <div className="panel-body" id="join-shared-body">
              <div className="flex gap-2 items-center">
                <input
                  className="input"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="5-CHAR CODE"
                  maxLength={5}
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
          )}
        </div>

      </div>
      {/* Status bar */}
      <div className="statusbar">
        <div className="statusbar-item" style={{ flex: 1 }}>READY</div>
        <button type="button" className="statusbar-item statusbar-link" onClick={onLegal}>LEGAL</button>
        <div className="statusbar-item"><a href="https://github.com/ThatOtherZach/BreakBPM" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>BREAKBPM SYS v{APP_VERSION}</a></div>
      </div>
    </div>
  );
}
