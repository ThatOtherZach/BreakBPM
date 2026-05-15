import { useEffect, useState } from 'react';
import { marked } from 'marked';
import Navbar from './Navbar';
import ballImg from '/eightball_nobg.png';

const README_URL = 'https://raw.githubusercontent.com/ThatOtherZach/dont-break-the-bpm/refs/heads/main/README.md';

interface AboutScreenProps {
  onBack: () => void;
}

export default function AboutScreen({ onBack }: AboutScreenProps) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(README_URL)
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch');
        return r.text();
      })
      .then(md => {
        setHtml(marked(md) as string);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  return (
    <div className="app-window">
      <Navbar onBack={onBack} />

      <div className="app-body">
        <div className="splash-panel">
          <div className="splash-art-frame">
            <img src={ballImg} alt="8-ball" className="splash-ball-img" />
          </div>
          <div className="splash-title-block">
            <div className="splash-title-main">BREAK<span className="splash-title-accent">BPM</span></div>
            <div className="splash-title-sub">BILLIARDS SCORE SYSTEM</div>
            <div className="splash-title-rule" />
            <div className="splash-meta">
              <span>VER 1.00</span>
              <span>© 1998</span>
            </div>
            <div className="splash-tagline">
              TRACK YOUR<br />BALLS PER MINUTE
            </div>
          </div>
        </div>

        <div className="about-content panel">
          {loading && (
            <div className="about-loading">Loading README...</div>
          )}
          {error && (
            <div className="about-error">Could not load README. Check your connection.</div>
          )}
          {!loading && !error && (
            <div
              className="about-markdown"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>

      <div className="statusbar">
        <span>ABOUT</span>
        <span>BREAKBPM SYS v1.0</span>
      </div>
    </div>
  );
}
