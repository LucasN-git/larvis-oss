import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';
import { useAuth } from '../lib/auth';
import { PROFILE_IMAGE_SRC } from '../lib/avatar';

// Round avatar that opens "Profil" (which holds settings + sign out).
// Shows /profilbild.png when present, otherwise the email initial.
export function ProfileWidget({ size = 44 }: { size?: number }) {
  const { user } = useAuth();
  const initial = (user?.email?.[0] ?? 'L').toUpperCase();
  const [failed, setFailed] = useState(false);
  const showImg = !failed;
  return (
    <NavLink
      to="/profil"
      aria-label="Profil · Einstellungen"
      title="Profil"
      className={({ isActive }) => clsx('profile-widget', showImg && 'profile-widget--img', isActive && 'active')}
      style={{ width: size, height: size }}
    >
      {showImg ? (
        <img src={PROFILE_IMAGE_SRC} alt="" className="profile-widget__img" onError={() => setFailed(true)} />
      ) : (
        initial
      )}
    </NavLink>
  );
}
