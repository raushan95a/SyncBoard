const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

export function Avatar({ user, size = 32 }) {
  return (
    <span
      className="avatar"
      title={user?.name}
      aria-label={user?.name}
      style={{ background: user?.avatarColor ?? '#6366f1', width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(user?.name)}
    </span>
  );
}
