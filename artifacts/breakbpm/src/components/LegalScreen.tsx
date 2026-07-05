import Navbar from './Navbar';
import Footer from './Footer';
import LegalDisclosure from './LegalDisclosure';
import { usePageMeta, PAGE_META } from '../lib/pageMeta';

interface LegalScreenProps {
  onBack: () => void;
  onLegal: () => void;
}

export default function LegalScreen({ onBack, onLegal }: LegalScreenProps) {
  usePageMeta(PAGE_META.legal);
  return (
    <div className="app-window about-window">
      <Navbar onBack={onBack} />

      <div className="about-scroll-area">
        <div className="app-body" style={{ overflow: 'visible', flex: 'none' }}>
          <LegalDisclosure defaultOpen />
        </div>
      </div>

      <Footer onLegal={onLegal} />
    </div>
  );
}
