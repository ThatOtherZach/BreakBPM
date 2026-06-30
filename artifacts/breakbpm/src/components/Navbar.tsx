import { useState } from 'react';
import { useLocation } from 'wouter';
import { SignedIn, SignedOut } from '../lib/authClient';
import { useGetMe } from '@workspace/api-client-react';

interface NavbarProps {
  onManual?: () => void;
  onBack?: () => void;
  onAccount?: () => void;
  onStats?: () => void;
  onFindPlayers?: () => void;
  onLeaderboard?: () => void;
  onSignIn?: () => void;
}

export default function Navbar({ onManual, onBack, onAccount, onStats, onFindPlayers, onLeaderboard, onSignIn }: NavbarProps) {
  const [open, setOpen] = useState(false);
  const me = useGetMe();
  const [location, setLocation] = useLocation();

  const tier = me.data?.entitlement?.tier;
  const screenName = me.data?.account?.screenName ?? null;

  // Hide the menu item for the page the user is already on.
  const at = (path: string) => location === path;

  const showHamburger = !!(onManual || onAccount || onStats || onFindPlayers || onLeaderboard || onSignIn);

  return (
    <div className="navbar-wrapper">
      {/* Always-present anchors for crawler discovery — visually hidden, not interactive */}
      <div style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
        <a href="/pool-stats-app">About BreakBPM</a>
        <a href="/passes">Passes &amp; Pricing</a>
        <a href="/about">BreakBPM Manual</a>
        <a href="/for-venues">List Your Pool Hall</a>
        <a href="/legal">Legal</a>
      </div>
      <div className="navbar">
        <div className="navbar-left">
          {onBack ? (
            <button className="navbar-back-btn" onClick={onBack}>← Back</button>
          ) : (
            <>
              <img src="/eightball_nobg.png" alt="8-ball" className="navbar-icon-img" />
              <span className="navbar-title">BreakBPM</span>
              {screenName && (
                <span
                  title={tier === 'pass' ? 'Pass holder' : 'Signed in'}
                  style={{
                    fontSize: 14,
                    color: tier === 'pass' ? '#ffd700' : '#aaffaa',
                    marginLeft: 6,
                  }}
                >
                  {screenName}
                </span>
              )}
            </>
          )}
        </div>
        {/* Hamburger always shows when menu items exist, even alongside back btn */}
        {showHamburger && (
          <button
            className={`navbar-hamburger${open ? ' is-open' : ''}`}
            onClick={() => setOpen(o => !o)}
            aria-label="Menu"
          >
            <span className="hamburger-bar" />
            <span className="hamburger-bar" />
            <span className="hamburger-bar" />
          </button>
        )}
      </div>

      {open && showHamburger && (
        <div className="navbar-menu">
          {!at('/pool-stats-app') && (
            <button className="navbar-menu-item" onClick={() => { setOpen(false); setLocation('/pool-stats-app'); }}>
              <span style={{ textDecoration: 'underline' }}>A</span>bout
            </button>
          )}
          <SignedOut>
            {!at('/for-venues') && (
              <button className="navbar-menu-item" onClick={() => { setOpen(false); setLocation('/for-venues'); }}>
                For <span style={{ textDecoration: 'underline' }}>V</span>enues
              </button>
            )}
          </SignedOut>
          <SignedIn>
            {onAccount && !at('/account') && (
              <button className="navbar-menu-item" onClick={() => { setOpen(false); onAccount(); }}>
                <span style={{ textDecoration: 'underline' }}>A</span>ccount
              </button>
            )}
            {onFindPlayers && !at('/find-players') && (
              <button className="navbar-menu-item" onClick={() => { setOpen(false); onFindPlayers(); }}>
                <span style={{ textDecoration: 'underline' }}>F</span>ind Players
              </button>
            )}
          </SignedIn>
          {onLeaderboard && !at('/leaderboard') && (
            <button className="navbar-menu-item" onClick={() => { setOpen(false); onLeaderboard(); }}>
              <span style={{ textDecoration: 'underline' }}>L</span>eaderboard
            </button>
          )}
          {onManual && !at('/about') && (
            <button className="navbar-menu-item" onClick={() => { setOpen(false); onManual(); }}>
              <span style={{ textDecoration: 'underline' }}>M</span>anual
            </button>
          )}
          <SignedOut>
            {onSignIn && (
              <button className="navbar-menu-item" onClick={() => { setOpen(false); onSignIn(); }}>
                <span style={{ textDecoration: 'underline' }}>S</span>ign In
              </button>
            )}
          </SignedOut>
          <SignedIn>
            {onStats && !at('/stats') && (
              <button className="navbar-menu-item" onClick={() => { setOpen(false); onStats(); }}>
                <span style={{ textDecoration: 'underline' }}>S</span>tats
              </button>
            )}
          </SignedIn>
        </div>
      )}
    </div>
  );
}
