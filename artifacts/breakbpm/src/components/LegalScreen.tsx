import Navbar from './Navbar';
import LegalDisclosure from './LegalDisclosure';
import { APP_VERSION } from '../lib/version';
import { usePageMeta, PAGE_META } from '../lib/pageMeta';

interface LegalScreenProps {
  onBack: () => void;
}

export default function LegalScreen({ onBack }: LegalScreenProps) {
  usePageMeta(PAGE_META.legal);
  return (
    <div className="app-window about-window">
      <Navbar onBack={onBack} />

      <div className="about-scroll-area">
        <div className="app-body" style={{ overflow: 'visible', flex: 'none' }}>
          <LegalDisclosure defaultOpen />
        </div>
      </div>

      <div className="statusbar">
        <span><a href="https://github.com/ThatOtherZach/BreakBPM" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>BREAKBPM SYS v{APP_VERSION}</a> - Saym Services Inc.</span>
        <a href="/about" style={{ color: 'inherit', textDecoration: 'underline', marginLeft: 12 }}>About</a>
      </div>
    </div>
  );
}
