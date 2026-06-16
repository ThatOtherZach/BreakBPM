import { useMemo } from 'react';
import { marked } from 'marked';
import Navbar from './Navbar';
import PricingPanel from './PricingPanel';
import ballImg from '/eightball_nobg.png';
import aboutMd from '../ABOUT.md?raw';
import { APP_VERSION } from '../lib/version';
import { pickTagline } from '../lib/taglines';
import { usePageMeta, PAGE_META } from '../lib/pageMeta';

const tagline = pickTagline();

interface AboutScreenProps {
  onBack: () => void;
  onPasses: () => void;
}

export default function AboutScreen({ onBack, onPasses }: AboutScreenProps) {
  usePageMeta(PAGE_META.about);
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
                <span>VER {APP_VERSION}</span>
                <span>© 2026 Saym Services Inc.</span>
              </div>
              <div className="splash-tagline text-left">
                {tagline.split('\n').map((line, i, arr) => (
                  <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="about-content panel">
            <div
              className="about-markdown"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>

          <PricingPanel showBuyButtons onBuy={onPasses} hideCardCallout />
        </div>
      </div>

      <div className="statusbar">
        <span><a href="https://github.com/ThatOtherZach/BreakBPM" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>BREAKBPM SYS v{APP_VERSION}</a> - Saym Services Inc.</span>
        <a href="/legal" style={{ color: 'inherit', textDecoration: 'underline', marginLeft: 12 }}>Legal</a>
      </div>
    </div>
  );
}
