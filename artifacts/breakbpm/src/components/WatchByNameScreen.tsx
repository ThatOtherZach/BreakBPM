import { useEffect, useState } from 'react';
import JoinedGameScreen from './JoinedGameScreen';
import PlayerProfileScreen from './PlayerProfileScreen';
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
        spectatorOnly
      />
    );
  }

  // No live game (yet). Show the player's public profile while we keep polling
  // in the background; the effect above promotes us to the live spectator view
  // the moment they break. The profile screen owns its own loading / not-found
  // / rate-limited / error states.
  return (
    <PlayerProfileScreen
      name={name}
      onBack={onBack}
      onAbout={onAbout}
      onAccount={onAccount}
      onSignIn={onSignIn}
    />
  );
}
