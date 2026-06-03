import { useState } from 'react';
import { SignedIn, SignedOut } from '../lib/authClient';
import { useGetMe } from '@workspace/api-client-react';

interface NavbarProps {
  onAbout?: () => void;
  onBack?: () => void;
  onAccount?: () => void;
  onStats?: () => void;
  onSignIn?: () => void;
}

export default function Navbar({ onAbout, onBack, onAccount, onStats, onSignIn }: NavbarProps) {
  const [open, setOpen] = useState(false);
  const me = useGetMe();

  const tier = me.data?.entitlement?.tier;
  const tierBadge =
    tier === 'pass' ? '★'
    : tier === 'account' ? '●'
    : null;

  const showHamburger = !!(onAbout || onAccount || onStats || onSignIn);

  return (
    <>
      <div className="navbar">
        <div className="navbar-left">
          {onBack ? (
            <button className="navbar-back-btn" onClick={onBack}>← Back</button>
          ) : (
            <>
              <img src="/eightball_nobg.png" alt="8-ball" className="navbar-icon-img" />
              <span className="navbar-title">BreakBPM</span>
              {tierBadge && (
                <span
                  title={tier === 'pass' ? 'Pass holder' : 'Signed in'}
                  style={{
                    fontSize: 14,
                    color: tier === 'pass' ? '#ffd700' : '#aaffaa',
                    marginLeft: 4,
                  }}
                >
                  {tierBadge}
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
          {onStats && (
            <button className="navbar-menu-item" onClick={() => { setOpen(false); onStats(); }}>
              <span style={{ textDecoration: 'underline' }}>S</span>tats
            </button>
          )}
          {onAbout && (
            <button className="navbar-menu-item" onClick={() => { setOpen(false); onAbout(); }}>
              <span style={{ textDecoration: 'underline' }}>A</span>bout
            </button>
          )}
          <SignedIn>
            {onAccount && (
              <button className="navbar-menu-item" onClick={() => { setOpen(false); onAccount(); }}>
                <span style={{ textDecoration: 'underline' }}>A</span>ccount
              </button>
            )}
          </SignedIn>
          <SignedOut>
            {onSignIn && (
              <button className="navbar-menu-item" onClick={() => { setOpen(false); onSignIn(); }}>
                <span style={{ textDecoration: 'underline' }}>S</span>ign In
              </button>
            )}
          </SignedOut>
        </div>
      )}
    </>
  );
}
