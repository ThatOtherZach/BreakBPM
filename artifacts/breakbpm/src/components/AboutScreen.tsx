import { useMemo } from 'react';
import { marked } from 'marked';
import Navbar from './Navbar';
import ballImg from '/eightball_nobg.png';
import aboutMd from '../ABOUT.md?raw';

interface AboutScreenProps {
  onBack: () => void;
}

export default function AboutScreen({ onBack }: AboutScreenProps) {
  const html = useMemo(() => marked(aboutMd) as string, []);

  return (
    <div className="app-window about-window">
      <Navbar onBack={onBack} />

      <div className="about-scroll-area">
        <div className="app-body" style={{ overflow: 'visible', flex: 'none' }}>
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
                <span>© 2026 Saym Services Inc.</span>
              </div>
              <div className="splash-tagline text-left">
                PLAY FAST,<br />TRACK STATS
              </div>
            </div>
          </div>

          <div className="about-content panel">
            <div
              className="about-markdown"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>
      </div>

      <div className="statusbar">
        <span><a href="https://github.com/ThatOtherZach/BreakBPM" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>BREAKBPM SYS v1.0</a> - Saym Services Inc.</span>
      </div>
    </div>
  );
}
