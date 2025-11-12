import { useState, useCallback, useEffect } from 'react';

// Global state for auth expiration modal
let authExpiredHandlers = [];

export const subscribeToAuthExpired = (handler) => {
  authExpiredHandlers.push(handler);
  return () => {
    authExpiredHandlers = authExpiredHandlers.filter(h => h !== handler);
  };
};

export const showAuthExpiredModal = () => {
  authExpiredHandlers.forEach(handler => handler(true));
};

export const hideAuthExpiredModal = () => {
  authExpiredHandlers.forEach(handler => handler(false));
};

export const useAuthExpired = () => {
  const [isOpen, setIsOpen] = useState(false);

  const show = useCallback(() => {
    setIsOpen(true);
  }, []);

  const hide = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Subscribe to global events
  useEffect(() => {
    const unsubscribe = subscribeToAuthExpired(setIsOpen);
    return unsubscribe;
  }, []);

  return { isOpen, show, hide };
};

