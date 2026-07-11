import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2Window() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),  // balls start rolling in
      setTimeout(() => setPhase(2), 2000), // bpm ticks up
      setTimeout(() => setPhase(3), 3500), // more balls
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      <div className="win98-window w-[60vw] max-w-2xl h-[70vh] flex flex-col shadow-[4px_4px_0_rgba(0,0,0,0.5)]">
        {/* Title Bar */}
        <div className="win98-titlebar h-8 text-lg px-2">
          <div className="flex items-center gap-2">
            <span className="text-white text-sm">●</span>
            <span>BREAKBPM.COM</span>
          </div>
          <div className="flex gap-1">
            <div className="win98-btn w-6 h-6 text-sm">_</div>
            <div className="win98-btn w-6 h-6 text-sm">▢</div>
            <div className="win98-btn w-6 h-6 text-sm">✕</div>
          </div>
        </div>

        {/* Menu Bar */}
        <div className="flex gap-4 px-2 py-1 text-black text-sm border-b border-darker bg-silver">
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
          <span>Help</span>
        </div>

        {/* Content Body */}
        <div className="flex-1 p-4 flex flex-col gap-4 bg-silver">
          
          <div className="felt-panel flex-1 rounded-sm p-6 flex flex-col relative overflow-hidden">
            {/* Header / BPM counter */}
            <div className="flex justify-between items-start z-10">
              <div className="text-white">
                <div className="font-display text-3xl text-green mb-1 text-shadow-sm shadow-black">PACE</div>
                <div className="font-display text-8xl leading-none text-white tracking-tighter text-shadow shadow-black drop-shadow-lg">
                  {phase < 2 ? '0.0' : (phase < 3 ? '2.4' : '4.1')}
                  <span className="text-4xl text-silver ml-2">BPM</span>
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-3xl text-amber text-shadow shadow-black">RACK 1</div>
                <div className="font-display text-xl text-white/80">00:14</div>
              </div>
            </div>

            {/* Balls rolling across */}
            <div className="absolute bottom-10 left-0 right-0 h-24 flex items-center px-8 z-10">
              {/* Ball 1 */}
              <motion.div
                className="w-16 h-16 rounded-full absolute shadow-xl border-2 border-black flex items-center justify-center"
                style={{ background: 'radial-gradient(circle at 30% 30%, #FDD307 0%, #a88a00 80%)' }}
                initial={{ x: '-20vw', rotate: -180 }}
                animate={{ x: phase >= 1 ? '10vw' : '-20vw', rotate: phase >= 1 ? 0 : -180 }}
                transition={{ duration: 1.5, ease: 'easeOut' }}
              >
                <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
                  <span className="font-body font-bold text-black text-xl">1</span>
                </div>
              </motion.div>

              {/* Ball 2 */}
              <motion.div
                className="w-16 h-16 rounded-full absolute shadow-xl border-2 border-black flex items-center justify-center"
                style={{ background: 'radial-gradient(circle at 30% 30%, #1F4E9E 0%, #102a5e 80%)' }}
                initial={{ x: '-20vw', rotate: -180 }}
                animate={{ x: phase >= 2 ? '25vw' : '-20vw', rotate: phase >= 2 ? 0 : -180 }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              >
                <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
                  <span className="font-body font-bold text-black text-xl">2</span>
                </div>
              </motion.div>

              {/* Ball 3 */}
              <motion.div
                className="w-16 h-16 rounded-full absolute shadow-xl border-2 border-black flex items-center justify-center"
                style={{ background: 'radial-gradient(circle at 30% 30%, #C3342B 0%, #7a1d17 80%)' }}
                initial={{ x: '-20vw', rotate: -180 }}
                animate={{ x: phase >= 3 ? '40vw' : '-20vw', rotate: phase >= 3 ? 0 : -180 }}
                transition={{ duration: 1, ease: 'easeOut' }}
              >
                <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
                  <span className="font-body font-bold text-black text-xl">3</span>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}