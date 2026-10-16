/**
 * Hawk, the agent's mascot, next to its messages. Shown at 28 px and grown to
 * about 72 px on hover as a little preview, so the files are picked for 72 px:
 * 128 px on 1x screens, 256 px on 2x and 3x. The 512 and 1024 px versions are
 * for larger spots (an empty-chat welcome, the About page).
 */
const HawkAvatar = ({ className = '' }: { className?: string }) => (
  <img
    src="/brand/studyhawk-mascot-128.webp"
    srcSet="/brand/studyhawk-mascot-64.webp 64w, /brand/studyhawk-mascot-128.webp 128w, /brand/studyhawk-mascot-256.webp 256w"
    sizes="72px"
    width={28}
    height={28}
    alt=""
    decoding="async"
    draggable={false}
    // After a second of hover it grows with a small springy overshoot and tilt; leaving shrinks it right away. It grows
    // from its left edge, level with where it sits, so the chat list beside it never cuts it off.
    className={`relative h-7 w-7 shrink-0 origin-left rounded-full object-cover ring-1 ring-slate-200 transition-[scale,rotate,box-shadow] duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] hover:z-30 hover:delay-1000 hover:-rotate-6 hover:scale-[2.4] hover:shadow-xl hover:ring-2 hover:ring-[var(--accent-400)] motion-reduce:transition-none dark:ring-slate-700 ${className}`}
  />
);

export default HawkAvatar;
