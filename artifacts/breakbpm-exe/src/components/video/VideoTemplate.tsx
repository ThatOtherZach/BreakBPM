import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1Boot } from './video_scenes/Scene1Boot';
import { Scene2Window } from './video_scenes/Scene2Window';
import { Scene3Corruption } from './video_scenes/Scene3Corruption';
import { Scene4Meltdown } from './video_scenes/Scene4Meltdown';
import { Scene5Resolve } from './video_scenes/Scene5Resolve';

export const SCENE_DURATIONS = {
  boot: 4000,
  windowOpen: 6000,
  corruption: 5000,
  meltdown: 6000,
  resolve: 5000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  boot: Scene1Boot,
  windowOpen: Scene2Window,
  corruption: Scene3Corruption,
  meltdown: Scene4Meltdown,
  resolve: Scene5Resolve,
};

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENE_DURATIONS;
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-teal text-white">
      {/* Persistent CRT scanlines */}
      <div className="absolute inset-0 crt-overlay mix-blend-overlay"></div>

      {/* Persistent desktop background */}
      <div className="absolute inset-0 bg-teal z-[-1]"></div>

      <AnimatePresence mode="popLayout">
        {SceneComponent && <SceneComponent key={currentSceneKey} />}
      </AnimatePresence>
    </div>
  );
}
