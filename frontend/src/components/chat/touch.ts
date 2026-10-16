import { useMediaQuery } from '../useMediaQuery';

/**
 * A phone or tablet (touch, no hover): Enter adds a line there and the send
 * button sends, like WhatsApp or ChatGPT on a phone. Keyboards send with Enter.
 */
export const useEnterAddsLine = () => useMediaQuery('(hover: none) and (pointer: coarse)');
