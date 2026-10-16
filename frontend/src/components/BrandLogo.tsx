/** The StudyHawk logo, drawn inline so the black parts follow the theme (currentColor). */

export const BRAND_CYAN = '#22d3ee';

/** The S and the H of the mark (viewBox -20 -715 1125 1245). The S is drawn with scale(1,-1), the H with translate(386,516) scale(1,-1). */
export const BRAND_S_PATH = 'M318.1 439.2 339.6 515.9H703.5L566.4 697.6H17.5L152.1 519.2L78.5 258H436.3L414.6 181.3H56.2L5 -0H551.5L676.6 439.2Z';
export const BRAND_H_PATH = 'M563.1 703.2 463.9 353.3H294.6L392.2 697.6H18.5L152.9 519.5L104.9 349.9L6 0H194.4L243.3 172H412.7L364.1 0H552.5L700.3 521.5Z';

interface Props {
  className?: string;
  /** Text for screen readers; empty when a visible name sits next to it. */
  label?: string;
}

const a11y = (label?: string) => (label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const });

/** The S+H mark: the S takes the text color (black on light, white on dark), the H is always cyan. */
export const BrandIcon = ({ className = '', label }: Props) => (
  <svg viewBox="-20 -715 1125 1245" className={`text-slate-950 dark:text-white ${className}`} {...a11y(label)}>
    <g fill="#000" stroke="#000" strokeWidth={12} strokeLinejoin="round">
      <path transform="scale(1,-1)" d={BRAND_S_PATH} />
      <path
        transform="translate(386,516) scale(1,-1)"
        d={BRAND_H_PATH}
      />
    </g>
    <path
      fill="currentColor"
      transform="scale(1,-1)"
      d={BRAND_S_PATH}
    />
    <path
      fill={BRAND_CYAN}
      transform="translate(386,516) scale(1,-1)"
      d={BRAND_H_PATH}
    />
  </svg>
);

/** The "STUDYHAWK" letters (the logo's typeface, as paths): STUDY in cyan, HAWK in the text color. */
const Wordmark = ({ mono }: { mono: boolean }) => (
  <g transform="translate(210,206.2) scale(0.85)">
    <g fill={mono ? 'currentColor' : BRAND_CYAN}>
      <path
        transform="translate(1400.0,0) scale(1,-1)"
        d="M318.0 439.2 339.5 515.8H703.5L566.3 697.5H17.4L152.0 519.2L78.4 257.9H436.3L414.5 181.3H56.2L4.9 -1.5e-05H551.4L676.6 439.2Z"
      />
      <path
        transform="translate(2022.0,0) scale(1,-1)"
        d="M573.7 697.5H24.8L159.4 519.2L158.5 515.8H162.0L166.2 510.2L167.8 515.8H272.3L225.0 349.8L126.2 -1.5e-05H314.5L460.7 515.8H710.8Z"
      />
      <path
        transform="translate(2631.0,0) scale(1,-1)"
        d="M415.4 181.3H245.9L392.1 697.5H18.4L152.9 519.5L104.8 349.8L5.9 0.0H552.5L700.2 521.5L563.1 703.1Z"
      />
      <path
        transform="translate(3253.0,0) scale(1,-1)"
        d="M698.7 519.2 699.3 521.5 566.4 697.5H17.6L152.1 519.4L5.1 0.0H372.5V0.0C478.5 1.4 572.4 73.1 601.5 175.3ZM245.1 181.3 339.6 515.8H509.0L414.1 181.3Z"
      />
      <path
        transform="translate(3871.0,0) scale(1,-1)"
        d="M563.1 703.1 511.5 521.8 488.4 439.2H319.0L392.1 697.5H18.4L153.0 519.2L79.4 257.9H437.5L415.7 181.3H57.2L5.9 0.0H552.4L700.2 521.5Z"
      />
    </g>
    <g fill="currentColor">
      <path
        transform="translate(4493.0,0) scale(1,-1)"
        d="M563.1 703.1 463.9 353.2H294.5L392.1 697.5H18.4L152.9 519.4L104.8 349.8L5.9 0.0H194.3L243.3 171.9H412.6L364.0 0.0H552.4L700.2 521.5Z"
      />
      <path
        transform="translate(5115.0,0) scale(1,-1)"
        d="M566.3 697.5H17.4L151.9 519.4L4.9 0.0H193.4L242.3 171.9H411.7L363.1 0.0H551.5L699.2 521.4ZM508.9 515.8 462.9 353.2H293.5L339.5 515.8Z"
      />
      <path
        transform="translate(5736.0,0) scale(1,-1)"
        d="M834.7 703.1 749.8 403.9 694.3 697.5H508.4L357.8 367.6L348.1 520.0L398.5 697.5H24.8L160.1 518.3L192.8 0.0H379.2L562.0 400.2L636.9 3.8L638.0 0.0H824.1L971.8 521.5Z"
      />
      <path
        transform="translate(6629.0,0) scale(1,-1)"
        d="M623.4 515.8H704.5L565.1 700.5L299.1 369.4L392.1 697.5H18.4L152.9 519.5L104.8 349.8L5.9 0.0H194.4L241.7 166.3L367.9 0.0H558.0L390.0 233.3Z"
      />
    </g>
  </g>
);

/** Mark + "STUDYHAWK". `mono` draws it all in the text color (for colored backgrounds). */
export const BrandLogo = ({ className = '', label = 'StudyHawk', mono = false }: Props & { mono?: boolean }) => (
  <svg viewBox="-20 -715 6480 1245" className={`${mono ? '' : 'text-slate-950 dark:text-white'} ${className}`} {...a11y(label)}>
    <g fill={mono ? 'none' : '#000'} stroke={mono ? 'none' : '#000'} strokeWidth={12} strokeLinejoin="round">
      <path transform="scale(1,-1)" d={BRAND_S_PATH} />
      <path
        transform="translate(386,516) scale(1,-1)"
        d={BRAND_H_PATH}
      />
    </g>
    <path
      fill="currentColor"
      transform="scale(1,-1)"
      d={BRAND_S_PATH}
    />
    <path
      fill={mono ? 'currentColor' : BRAND_CYAN}
      transform="translate(386,516) scale(1,-1)"
      d={BRAND_H_PATH}
    />
    <Wordmark mono={mono} />
  </svg>
);

/** "STUDYHAWK" alone, in the logo's letters; no font file to download. */
export const BrandWordmark = ({ className = '', label = 'StudyHawk', mono = false }: Props & { mono?: boolean }) => (
  <svg viewBox="1390 -400 5065 615" className={`${mono ? '' : 'text-slate-950 dark:text-white'} ${className}`} {...a11y(label)}>
    <Wordmark mono={mono} />
  </svg>
);
