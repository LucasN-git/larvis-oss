import { NavLink } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { NAV_ITEMS, type NavItem } from '../layouts/nav';

// Mobile-Übersicht hinter dem „Mehr"-Tab: alle Nav-Ziele untereinander,
// auch die, die schon in der Bottom-Bar stecken.
export function More() {
  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Mehr</h1>
      </div>
      <nav className="more-menu">
        {NAV_ITEMS.map((item) => (
          <MoreLink key={item.to} item={item} />
        ))}
      </nav>
    </div>
  );
}

function MoreLink({ item: { to, label, icon: Icon, end } }: { item: NavItem }) {
  return (
    <NavLink to={to} end={end} className="more-menu__link">
      <span className="icon-tile icon-tile--sm more-menu__icon">
        <Icon size={18} />
      </span>
      <span className="more-menu__label">{label}</span>
      <ChevronRight size={18} className="more-menu__chevron" />
    </NavLink>
  );
}
