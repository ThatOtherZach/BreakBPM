import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene3Corruption() {
  const [phase, setPhase] = useState(0);
  const [bpm, setBpm] = useState(4.1);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000), // starts spiking
      setTimeout(() => setPhase(2), 2500), // RGB split
      setTimeout(() => setPhase(3), 3500), // first error dialog
    ];

    let interval: any;
    if (phase >= 1) {
      interval = setInterval(() => {
        setBpm(prev => prev * 1.8 + Math.random() * 10);
      }, 100);
    }

    return () => {
      timers.forEach(t => clearTimeout(t));
      if (interval) clearInterval(interval);
    };
  }, [phase]);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
    >
      <motion.div 
        className="win98-window w-[60vw] max-w-2xl h-[70vh] flex flex-col shadow-[4px_4px_0_rgba(0,0,0,0.5)] relative"
        animate={{ 
          x: phase >= 2 ? [0, -5, 5, -2, 2, 0] : 0,
          y: phase >= 2 ? [0, 2, -2, 4, -4, 0] : 0,
        }}
        transition={{ duration: 0.2, repeat: phase >= 2 ? Infinity : 0, repeatType: 'mirror' }}
      >
        <div className="win98-titlebar h-8 text-lg px-2">
          <div className="flex items-center gap-2">
            <span className="text-white text-sm">●</span>
            <span className={phase >= 2 ? 'glitch-text' : ''} data-text="BREAKBPM.COM">BREAKBPM.COM</span>
          </div>
          <div className="flex gap-1">
            <div className="win98-btn w-6 h-6 text-sm">_</div>
            <div className="win98-btn w-6 h-6 text-sm">▢</div>
            <div className="win98-btn w-6 h-6 text-sm">✕</div>
          </div>
        </div>

        <div className="flex gap-4 px-2 py-1 text-black text-sm border-b border-darker bg-silver">
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
          <span>Help</span>
        </div>

        <div className="flex-1 p-4 flex flex-col gap-4 bg-silver relative overflow-hidden">
          
          <div className="felt-panel flex-1 rounded-sm p-6 flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-start z-10">
              <div className="text-white">
                <div className="font-display text-3xl text-green mb-1 text-shadow-sm shadow-black">PACE</div>
                <div className={`font-display text-8xl leading-none text-white tracking-tighter text-shadow shadow-black drop-shadow-lg ${phase >= 2 ? 'text-red-500' : ''}`}>
                  {bpm > 9999 ? 'OVERFLOW' : bpm.toFixed(1)}
                  <span className="text-4xl text-silver ml-2">BPM</span>
                </div>
              </div>
            </div>

            {/* Cue ball multiplying */}
            <div className="absolute inset-0 z-0 overflow-hidden">
              {Array.from({ length: phase >= 1 ? 15 : 0 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="w-12 h-12 rounded-full absolute shadow-xl border-2 border-black"
                  style={{ 
                    background: 'radial-gradient(circle at 30% 30%, #ffffff 0%, #c0c0c0 80%)',
                    top: `${Math.random() * 80 + 10}%`,
                    left: `${Math.random() * 80 + 10}%`,
                  }}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: Math.random() * 1.5, type: 'spring' }}
                />
              ))}
            </div>
          </div>

          {/* First Error Dialog */}
          <AnimatePresence>
            {phase >= 3 && (
              <motion.div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 win98-window w-80 shadow-[4px_4px_0_rgba(0,0,0,0.5)] z-50 flex flex-col"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              >
                <div className="win98-titlebar h-7 text-sm px-2 bg-navy">
                  <span>BreakBPM Error</span>
                  <div className="win98-btn w-5 h-5 text-xs">✕</div>
                </div>
                <div className="p-4 bg-silver text-black flex flex-col items-center gap-4">
                  <div className="flex items-center gap-4 w-full">
                    <div className="w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center font-bold text-xl border border-white">✕</div>
                    <div className="font-body text-base">Pace too fast to compute.</div>
                  </div>
                  <div className="win98-btn px-8 py-1 mt-2">OK</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}