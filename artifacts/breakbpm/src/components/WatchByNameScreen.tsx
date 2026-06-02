import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import Navbar from './Navbar';
import JoinedGameScreen from './JoinedGameScreen';
import {
  useResolveWatchByName,
  getResolveWatchByNameQueryKey,
} from '@workspace/api-client-react';

interface Props {
  name: string;
  onBack: () => void;
  onAbout: () => void;
  onAccount: () => void;
  onSignIn: () => void;
}

/**
 * Persistent watch-by-name entry point (/watch/{screenName}). Resolves the
 * host's screen name to the share code of their CURRENT live game, then hands
 * off to the read-only JoinedGameScreen. Unlike a per-game share code, this
 * handle is stable across the host's games — bookmark it once and it always
 * lands on whatever game they have open now.
 *
 * While the host has no live game we keep polling so the page promotes itself
 * the moment they start one. Once a live game is found we latch its share code
 * and JoinedGameScreen owns everything from there (polling + the ended state);
 * to follow a later game, reload the page.
 */
export default function WatchByNameScreen({ name, onBack, onAbout, onAccount, onSignIn }: Props) {
  const [, setLocation] = useLocation();
  const [liveCode, setLiveCode] = useState<string | null>(null);

  const resolve = useResolveWatchByName(
    { name },
    {
      query: {
        queryKey: getResolveWatchByNameQueryKey({ name }),
        refetchInterval: liveCode ? false : 4000,
        enabled: !liveCode,
      },
    },
  );

  useEffect(() => {
    if (resolve.data?.found && resolve.data.shareCode) {
      setLiveCode(resolve.data.shareCode);
    }
  }, [resolve.data]);

  if (liveCode) {
    return (
      <JoinedGameScreen
        code={liveCode.toUpperCase()}
        onBack={onBack}
        onAbout={onAbout}
        onAccount={onAccount}
        onSignIn={onSignIn}
      />
    );
  }

  const reason = resolve.data && !resolve.data.found ? resolve.data.reason : undefined;
  let message = `Finding ${name}'s game…`;
  let isError = false;
  if (resolve.isError) {
    message = "Couldn't reach the server. Check your connection and try again.";
    isError = true;
  } else if (reason === 'not_found') {
    message = `No player named "${name}". Double-check the link.`;
    isError = true;
  } else if (reason === 'rate_limited') {
    message = 'Too many attempts. Please wait a minute and try again.';
    isError = true;
  } else if (reason === 'not_live') {
    message = `${name} isn't in a game right now — this page will update automatically when they start one.`;
  }

  return (
    <div className="app-window">
      <Navbar onAbout={onAbout} onAccount={onAccount} onSignIn={onSignIn} />
      <div className="app-body">
        <div className="notice" style={isError ? { color: '#c00' } : undefined}>
          <span>{isError ? '!' : '📡'}</span>
          <span>{message}</span>
        </div>
        <button
          className="btn btn-primary btn-big btn-full"
          onClick={() => { onBack(); setLocation('/'); }}
        >
          ← Back to menu
        </button>
      </div>
    </div>
  );
}
