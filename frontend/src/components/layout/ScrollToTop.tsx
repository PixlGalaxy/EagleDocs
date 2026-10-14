import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * React Router keeps the window scroll position across navigations, so a new
 * page would open wherever the previous one was scrolled to. Reset it on every
 * path change, or jump to the #anchor when the link has one (pages may load
 * lazily, so the anchor is retried briefly).
 */
const ScrollToTop = () => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      return;
    }
    let tries = 0;
    const timer = setInterval(() => {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (target || ++tries > 20) {
        clearInterval(timer);
        target?.scrollIntoView({ block: 'start' });
      }
    }, 50);
    return () => clearInterval(timer);
  }, [pathname, hash]);

  return null;
};

export default ScrollToTop;
