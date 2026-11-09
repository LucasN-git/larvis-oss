import { useEffect, useRef, type TouchEvent as ReactTouchEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MoonStar, Sun } from 'lucide-react';
import { clsx } from 'clsx';
import { BOTTOM_NAV, MORE_ROUTES, NAV_ITEMS } from './nav';
import { useTheme } from '../theme/ThemeProvider';
import { IconButton } from '../components/ui';
import { ProfileWidget } from '../components/ProfileWidget';
import { Logo, LogoMark } from '../components/Logo';
import { useMediaQuery } from '../lib/useMediaQuery';
import { MQ } from '../theme/breakpoints';
import './layout.css';

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <IconButton size="sm" label="Theme wechseln" onClick={toggle}>
      {theme === 'dark' ? <Sun size={18} /> : <MoonStar size={18} />}
    </IconButton>
  );
}

// Swipe-Reihenfolge = Reihenfolge der Bottom-Bar.
const SWIPE_ORDER = BOTTOM_NAV.map((i) => i.to);

function tabIndexOf(pathname: string): number {
  return SWIPE_ORDER.findIndex((to) =>
    to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`),
  );
}

// „Mehr" leuchtet auch auf seinen Unterseiten (Notizen, Learnweb, Inbox, Archiv).
function isMoreActive(pathname: string): boolean {
  return MORE_ROUTES.some((to) => pathname === to || pathname.startsWith(`${to}/`));
}

// Horizontaler Swipe über den Inhalt wechselt den Tab (nur Touch, nur auf dem
// Handy, wo es die Bottom-Bar gibt). Gesten, die
// in eigenen Swipe-Zonen starten (ToDo-Rows, Monats-Grid, Inputs), sind tabu.
function useTabSwipe() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  const onTouchStart = (e: ReactTouchEvent) => {
    start.current = null;
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-noswipe], .swipe-wrap, input, textarea, select')) return;
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  };

  const onTouchEnd = (e: ReactTouchEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || Date.now() - s.t > 600) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
    const idx = tabIndexOf(pathname);
    if (idx === -1) return;
    const next = idx + (dx < 0 ? 1 : -1);
    if (next < 0 || next >= SWIPE_ORDER.length) return;
    navigate(SWIPE_ORDER[next]);
  };

  return { onTouchStart, onTouchEnd };
}

export function AppShell() {
  const swipe = useTabSwipe();
  const isPhone = useMediaQuery(MQ.phone);
  const { pathname } = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Der Scroller wird über Routen hinweg wiederverwendet — pro Seite oben starten.
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        {/* Beide Logoformen stehen im DOM; die Breite entscheidet per CSS (Rail: nur Marke). */}
        <div className="sidebar__brand">
          <span className="sidebar__logo-long"><Logo /></span>
          <span className="sidebar__logo-mark"><LogoMark size="1.4em" /></span>
        </div>
        <nav className="stack gap-xs">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} title={label} className={({ isActive }) => clsx('nav-link', isActive && 'active')}>
              <Icon size={19} />
              <span className="nav-link__label">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__spacer" />
        {/* Profile (→ Profil, where sign-out lives) replaces the old logout button. */}
        <div className="sidebar__footer">
          <ProfileWidget />
          <ThemeToggle />
        </div>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <Logo className="sidebar__brand" style={{ padding: 0 }} />
          <ProfileWidget size={40} />
        </header>

        {/* Einziger Scroll-Container der App; Header und Bottom-Bar bleiben statisch. */}
        <div
          className="app-scroll"
          ref={scrollRef}
          onTouchStart={isPhone ? swipe.onTouchStart : undefined}
          onTouchEnd={isPhone ? swipe.onTouchEnd : undefined}
        >
          {/* key=pathname spielt die Einblend-Animation bei jedem Tab-Wechsel. */}
          <div className="route-enter" key={pathname}>
            <Outlet />
          </div>
        </div>

        <nav className="bottom-nav">
          <div className="bottom-nav__bar glass">
            {BOTTOM_NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  clsx('bottom-nav__link', (to === '/mehr' ? isMoreActive(pathname) : isActive) && 'active')
                }
              >
                <Icon size={21} />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
