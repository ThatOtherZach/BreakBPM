import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene5Resolve() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),   // Wordmark reveals
      setTimeout(() => setPhase(2), 1500),  // Tagline reveals
      setTimeout(() => setPhase(3), 3500),  // Fade out
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-black z-[100]"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* CRT Turn-off effect transition from previous scene */}
      <motion.div 
        className="absolute inset-0 bg-white"
        initial={{ opacity: 1, scaleY: 0.01 }}
        animate={{ opacity: 0, scaleY: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      />

      <div className="flex flex-col items-center relative z-10">
        <motion.div 
          className="font-display text-8xl text-white tracking-widest"
          initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: 0.5, duration: 1, ease: 'easeOut' }}
        >
          BREAKBPM
        </motion.div>
        
        <motion.div 
          className="font-body text-2xl text-green mt-4 tracking-widest uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 0.8 }}
        >
          Track your pace.
        </motion.div>
      </div>
    </motion.div>
  );
}