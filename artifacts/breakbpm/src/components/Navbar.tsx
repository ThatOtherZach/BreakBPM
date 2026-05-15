import { useState } from 'react';

interface NavbarProps {
  onAbout?: () => void;
  onBack?: () => void;
}

export default function Navbar({ onAbout, onBack }: NavbarProps) {
  const [open, setOpen] = useState(false);

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
            </>
          )}
        </div>
        {onAbout && (
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

      {open && onAbout && (
        <>
          <div className="navbar-overlay" onClick={() => setOpen(false)} />
          <div className="navbar-menu">
            <button
              className="navbar-menu-item"
              onClick={() => { setOpen(false); onAbout(); }}
            >
              About
            </button>
          </div>
        </>
      )}
    </>
  );
}
