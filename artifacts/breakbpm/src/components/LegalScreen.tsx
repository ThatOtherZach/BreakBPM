import Navbar from './Navbar';
import LegalDisclosure from './LegalDisclosure';
import { APP_VERSION } from '../lib/version';

interface LegalScreenProps {
  onBack: () => void;
}

export default function LegalScreen({ onBack }: LegalScreenProps) {
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
      </div>
    </div>
  );
}
