import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene1Boot() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // Icon appears
      setTimeout(() => setPhase(2), 1500), // Cursor moves to icon
      setTimeout(() => setPhase(3), 2500), // Cursor double clicks
      setTimeout(() => setPhase(4), 3000), // Hourglass/loading
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0"
      initial={{ filter: 'brightness(0) contrast(1.5)', scale: 0.95 }}
      animate={{ filter: 'brightness(1) contrast(1)', scale: 1 }}
      exit={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {/* Desktop Icon */}
      <motion.div
        className="absolute top-[10vh] left-[5vw] flex flex-col items-center gap-2 w-24"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 1 ? 1 : 0 }}
        transition={{ duration: 0.1 }}
      >
        <div className="w-16 h-16 bg-silver border-2 border-white/50 border-r-dark border-b-dark shadow-sm flex items-center justify-center rounded-sm">
          <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center border-2 border-white">
            <span className="text-white font-display text-2xl">8</span>
          </div>
        </div>
        <div className={`px-1 text-center leading-tight ${phase >= 2 ? 'bg-navy text-white dotted-border' : 'text-white'}`}>
          BreakBPM.exe
        </div>
      </motion.div>

      {/* Mouse Cursor */}
      <motion.div
        className="absolute z-20 w-8 h-8"
        initial={{ top: '60vh', left: '50vw' }}
        animate={{
          top: phase >= 2 ? '14vh' : '60vh',
          left: phase >= 2 ? '8vw' : '50vw',
          scale: phase === 3 ? [1, 0.8, 1, 0.8, 1] : 1
        }}
        transition={{
          duration: phase >= 2 && phase < 3 ? 0.8 : 0.2,
          ease: 'easeInOut'
        }}
      >
        {/* Simple cursor SVG */}
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 4L12 28L16 18L24 24L28 20L19 14L28 10L4 4Z" fill="white" stroke="black" strokeWidth="2" strokeLinejoin="round"/>
        </svg>
      </motion.div>
    </motion.div>
  );
}