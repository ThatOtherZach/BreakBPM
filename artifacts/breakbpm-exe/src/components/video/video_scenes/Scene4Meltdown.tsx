import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene4Meltdown() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // Cascading dialogs
      setTimeout(() => setPhase(2), 2000), // Heavy glitch / 8-ball crack
      setTimeout(() => setPhase(3), 3500), // BSOD
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div className="absolute inset-0 z-50">
      {phase < 3 && (
        <div className="absolute inset-0 flex items-center justify-center bg-teal overflow-hidden">
          {/* Base Corrupted Window behind dialogs */}
          <motion.div 
            className="win98-window w-[60vw] h-[70vh] absolute"
            animate={{ 
              x: [-10, 10, -5, 8, -2, 5],
              y: [5, -5, 10, -10, 4, -4],
              filter: ['hue-rotate(0deg)', 'hue-rotate(90deg)', 'hue-rotate(180deg)', 'hue-rotate(270deg)']
            }}
            transition={{ duration: 0.1, repeat: Infinity }}
          />

          {/* Cascading Dialogs */}
          {phase >= 1 && Array.from({ length: 20 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute win98-window w-72 shadow-[4px_4px_0_rgba(0,0,0,0.5)] z-50"
              style={{
                top: `${20 + (i * 2)}%`,
                left: `${20 + (i * 2)}%`,
                zIndex: 50 + i,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.05 }}
            >
              <div className="win98-titlebar h-6 text-xs px-2 bg-navy">
                <span>Critical Error</span>
              </div>
              <div className="p-3 bg-silver text-black flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center font-bold border border-white text-xs">✕</div>
                <div className="font-body text-xs">Stack overflow in loop.</div>
              </div>
            </motion.div>
          ))}

          {/* The 8-ball cracking in foreground */}
          {phase >= 2 && (
            <motion.div 
              className="absolute z-[100] w-64 h-64 bg-black rounded-full shadow-2xl flex items-center justify-center border-4 border-white overflow-hidden"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 10 }}
            >
              <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center">
                <span className="font-body font-bold text-black text-6xl">8</span>
              </div>
              
              {/* Crack overlay */}
              <motion.svg 
                className="absolute inset-0 w-full h-full text-white" 
                viewBox="0 0 100 100"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
              >
                <path d="M50 0 L45 20 L55 35 L40 50 L60 65 L45 80 L50 100" stroke="white" strokeWidth="2" fill="none" />
                <path d="M50 50 L70 40 L80 60 L100 55" stroke="white" strokeWidth="1.5" fill="none" />
                <path d="M40 50 L20 60 L10 40 L0 45" stroke="white" strokeWidth="1.5" fill="none" />
              </motion.svg>
            </motion.div>
          )}
        </div>
      )}

      {/* BSOD */}
      {phase >= 3 && (
        <motion.div 
          className="absolute inset-0 bg-[#0000AA] text-[#AAAAAA] p-8 font-display text-2xl flex flex-col justify-start"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.1 }}
        >
          <div className="mb-8 bg-[#AAAAAA] text-[#0000AA] inline-block px-4 py-1 self-start">Windows</div>
          
          <p className="mb-6">A fatal exception 0E has occurred at 0028:C0011E36 in VxD VMM(01) + 00010E36. The current application will be terminated.</p>
          
          <ul className="list-disc pl-8 mb-6 space-y-2">
            <li>Press any key to terminate the current application.</li>
            <li>Press CTRL+ALT+DEL again to restart your computer. You will lose any unsaved information in all applications.</li>
          </ul>
          
          <p className="mb-8">Error: FATAL_EXCEPTION: BPM_OVERFLOW</p>
          
          <p className="text-center mt-12 animate-pulse">Press any key to continue _</p>
        </motion.div>
      )}
    </motion.div>
  );
}