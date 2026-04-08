import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Shared layout for login / register / forgot-password with smooth route transitions.
 */
export default function AuthLayout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="min-h-screen"
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
