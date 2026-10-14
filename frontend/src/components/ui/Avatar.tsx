import { avatarsApi } from '../../api/auth';

interface AvatarProps {
  user: { id: string; avatar_path: string | null; username: string; display_name: string | null; updated_at: string } | null;
  size?: number;
  className?: string;
}

/** Profile picture, or the user's initials on an accent tint when there is none. */
const Avatar = ({ user, size = 32, className = '' }: AvatarProps) => {
  if (!user?.avatar_path) {
    const name = user?.display_name || user?.username || '?';
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
    return (
      <div
        aria-hidden="true"
        className={`flex shrink-0 select-none items-center justify-center rounded-full bg-[var(--accent-100)] font-semibold text-[var(--accent-700)] dark:bg-[var(--accent-500)]/20 dark:text-[var(--accent-200)] ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.38 }}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      // Cache-busted with updated_at, since a re-upload keeps the same URL.
      src={`${avatarsApi.url(user.id)}?v=${encodeURIComponent(user.updated_at)}`}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
};

export default Avatar;
