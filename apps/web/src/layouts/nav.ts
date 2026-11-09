import { Archive, CalendarDays, FolderTree, GraduationCap, House, Inbox, Lightbulb, ListChecks, MapPin, MoreHorizontal, Users } from 'lucide-react';
import type { ComponentType } from 'react';
import { MODULES } from '../lib/modules';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  end?: boolean;
}

const HEUTE: NavItem = { to: '/', label: 'Heute', icon: House, end: true };
const TODOS: NavItem = { to: '/todos', label: 'ToDos', icon: ListChecks };
const PROJEKTE: NavItem = { to: '/projects', label: 'Projekte', icon: FolderTree };
// Das kuratierte Wiki (Tabelle learnings): frei vergebene Bereiche, Seiten mit Grafiken.
const LEARNINGS: NavItem = { to: '/learnings', label: 'Learnings', icon: Lightbulb };
// Optionales Modul (Moodle der Uni Münster): nur mit VITE_LEARNWEB_ENABLED in der Navigation.
const LEARNWEB: NavItem = { to: '/learnweb', label: 'Learnweb', icon: GraduationCap };
const OPTIONAL = (item: NavItem, on: boolean): NavItem[] => (on ? [item] : []);
const KALENDER: NavItem = { to: '/calendar', label: 'Kalender', icon: CalendarDays };
const KONTAKTE: NavItem = { to: '/contacts', label: 'Kontakte', icon: Users };
// Stammdaten für Termin-Orte (Fahrzeit ab dem Heimatort, Aliase); der Termin-Editor schlägt sie vor.
const ORTE: NavItem = { to: '/orte', label: 'Orte', icon: MapPin };
// Die sortierte Sammlung (Tabelle entries, alle Bereiche in einem Tab mit Filtern).
// Der rohe Eingangsstapel heißt in der UI „Dump“ und lebt als Karte auf der Heute-Seite.
const INBOX: NavItem = { to: '/inbox', label: 'Inbox', icon: Inbox };
const ARCHIV: NavItem = { to: '/archiv', label: 'Archiv', icon: Archive };
const MEHR: NavItem = { to: '/mehr', label: 'Mehr', icon: MoreHorizontal };

// Desktop sidebar order. Notizen haben keinen eigenen Eintrag: sie liegen in
// ihrem Projekt, Notizen ohne Projekt im Projekt „Persönlich“.
export const NAV_ITEMS: NavItem[] = [
  HEUTE,
  TODOS,
  PROJEKTE,
  LEARNINGS,
  ...OPTIONAL(LEARNWEB, MODULES.learnweb),
  INBOX,
  KALENDER,
  KONTAKTE,
  ORTE,
  ARCHIV,
];

// Mobile bottom bar — fünf Tabs.
export const BOTTOM_NAV: NavItem[] = [TODOS, PROJEKTE, HEUTE, KALENDER, MEHR];

// Ziele, die es nicht in die Bottom-Bar geschafft haben — die „Mehr"-Seite
// zeigt aber alle NAV_ITEMS. Bei diesen Routen leuchtet der Mehr-Tab.
export const MORE_ROUTES: string[] = [MEHR.to, LEARNINGS.to, LEARNWEB.to, INBOX.to, KONTAKTE.to, ORTE.to, ARCHIV.to];
