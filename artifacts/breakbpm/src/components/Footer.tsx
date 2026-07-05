import { useGetAppConfig } from "@workspace/api-client-react";
import { APP_VERSION } from "../lib/version";

interface Props {
  onLegal: () => void;
}

/**
 * Shared bottom status bar shown on every non-in-game page. Mirrors the
 * home page (SetupScreen) footer exactly — READY/players-online readout,
 * a LEGAL link, and the versioned GitHub link. GameScreen/JoinedGameScreen
 * keep their own special in-game status bars and do not use this.
 */
export default function Footer({ onLegal }: Props) {
  const appConfig = useGetAppConfig();
  return (
    <div className="statusbar">
      <div className="statusbar-item" style={{ flex: 1 }}>
        READY
        {typeof appConfig.data?.playersOnline === "number" && (
          <> • {appConfig.data.playersOnline} PLAYERS ONLINE</>
        )}
      </div>
      <a href="/legal" className="statusbar-item statusbar-link" onClick={(e) => { e.preventDefault(); onLegal(); }}>LEGAL</a>
      <div className="statusbar-item"><a href="https://github.com/ThatOtherZach/BreakBPM" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>BREAKBPM SYS v{APP_VERSION}</a></div>
    </div>
  );
}
