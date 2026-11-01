import type { SVGProps } from 'react';

type IconName =
  | 'location'
  | 'observe'
  | 'menu'
  | 'close'
  | 'arrow'
  | 'chevron'
  | 'chat'
  | 'mic'
  | 'keyboard'
  | 'send'
  | 'stop'
  | 'spark'
  | 'book'
  | 'refresh'
  | 'settings';
export function StoryIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {name === 'location' && (
        <>
          <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
          <circle cx="12" cy="10" r="2.3" />
        </>
      )}
      {name === 'observe' && (
        <>
          <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
      {name === 'menu' && (
        <>
          <path d="M5 7h14M5 12h14M5 17h14" />
        </>
      )}
      {name === 'close' && <path d="m6 6 12 12M18 6 6 18" />}
      {name === 'arrow' && <path d="M4 12h15m-6-6 6 6-6 6" />}
      {name === 'chevron' && <path d="m8 10 4 4 4-4" />}
      {name === 'chat' && (
        <>
          <path d="M4 5h16v12H8l-4 3Z" />
          <path d="M8 9h8M8 13h5" />
        </>
      )}
      {name === 'mic' && (
        <>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5.5 10.5V12a6.5 6.5 0 0 0 13 0v-1.5M12 18.5V22M8.5 22h7" />
        </>
      )}
      {name === 'keyboard' && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M7 9h1M12 9h1M17 9h1M7 13h1M12 13h1M17 13h1M8 16h8" />
        </>
      )}
      {name === 'send' && <path d="M12 20V4m-6 6 6-6 6 6" />}
      {name === 'stop' && (
        <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
      )}
      {name === 'spark' && <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />}
      {name === 'book' && (
        <>
          <path d="M12 5v15M12 5C8 2 3 4 3 4v14s5-2 9 2c4-4 9-2 9-2V4s-5-2-9 1Z" />
        </>
      )}
      {name === 'refresh' && (
        <>
          <path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6" />
        </>
      )}
      {name === 'settings' && (
        <>
          <path d="M5 5v14M12 5v14M19 5v14" />
          <circle cx="5" cy="9" r="2" />
          <circle cx="12" cy="15" r="2" />
          <circle cx="19" cy="9" r="2" />
        </>
      )}
    </svg>
  );
}
