import { useMemo, useState } from 'react';
import { marked } from 'marked';
import Navbar from './Navbar';
import PricingPanel from './PricingPanel';
import ballImg from '/eightball_nobg.png';
import aboutMd from '../ABOUT.md?raw';
import { APP_VERSION } from '../lib/version';
import { pickTagline } from '../lib/taglines';
import { usePageMeta, PAGE_META } from '../lib/pageMeta';
import { RAW_BASE_URL, buildTranslateLinks } from '../lib/aiTranslate';

const tagline = pickTagline();

/**
 * Canonical, always-current source for the guide text. The same ABOUT.md file
 * that renders this page is hosted publicly on GitHub raw, so an AI assistant
 * can fetch and translate it with zero drift and no extra endpoint/build step.
 */
const GUIDE_RAW_URL = `${RAW_BASE_URL}ABOUT.md`;

interface AboutScreenProps {
  onBack: () => void;
  onPasses: () => void;
}

export default function AboutScreen({ onBack, onPasses }: AboutScreenProps) {
  usePageMeta(PAGE_META.about);
  const html = useMemo(() => marked(aboutMd) as string, []);

  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');

  const { translateLabel, perplexityUrl, chatgptUrl } = useMemo(
    () =>
      buildTranslateLinks(
        'BreakBPM billiards app guide',
        GUIDE_RAW_URL,
        '🌐 Translate this guide',
      ),
    [],
  );

  async function handleCopyGuide() {
    try {
      await navigator.clipboard.writeText(aboutMd);
      setCopyState('ok');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      /* clipboard unavailable — point the reader at the View raw text link */
      setCopyState('fail');
      window.setTimeout(() => setCopyState('idle'), 4000);
    }
  }

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

          <div className="panel">
            <div className="panel-header">🌐 Read in your language</div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 12, margin: 0, lineHeight: 1.4 }}>
                Open this guide in an AI assistant and have it translated into your language.
              </p>
              <a
                className="btn btn-primary btn-full"
                href={perplexityUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {translateLabel}
              </a>
              <div style={{ display: 'flex', gap: 6 }}>
                <a
                  className="btn"
                  style={{ flex: 1 }}
                  href={chatgptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  🤖 ChatGPT
                </a>
                <button className="btn" style={{ flex: 1 }} onClick={handleCopyGuide}>
                  {copyState === 'ok' ? '✓ Copied' : '📋 Copy text'}
                </button>
              </div>
              {copyState === 'fail' && (
                <p style={{ fontSize: 11, color: '#800000', margin: 0, textAlign: 'center' }}>
                  Couldn't copy — use “View raw text” below instead.
                </p>
              )}
              <a
                href={GUIDE_RAW_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, color: '#000080', textAlign: 'center', textDecoration: 'underline' }}
              >
                View raw text ↗
              </a>
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
