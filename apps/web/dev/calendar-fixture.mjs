// Kalender-Testdaten für den Dev-Login-Bypass. Der echte Kalender läuft über die
// Google-API hinter /api/calendar; ohne Google-Tokens liefert das Dev-Plugin diese
// Termine, relativ zum Aufrufzeitpunkt, damit Tafel, Agenda und Monat etwas zeigen.
const LARVIS = { calendar: 'larvis', calendar_id: 'larvis', calendar_name: 'Larvis', editable: true, html_link: null, description: null, location: null, tags: [], todo_id: null, event_type: 'default', recurring_event_id: null, place_id: null };
const PRIMARY = { ...LARVIS, calendar: 'primary', calendar_id: 'primary', calendar_name: 'Max Mustermann', editable: true };
// Ein Kalender-Abo (read-only ICS), wie es api/calendar/events.ts liefert.
const SUB_ID = '22222222-2222-2222-2222-222222222201';
const OUTLOOK = { ...LARVIS, calendar: 'subscription', calendar_id: `sub:${SUB_ID}`, calendar_name: 'Outlook', editable: false, color: '#0078d4', event_type: null };

function at(dayOffset, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
function day(dayOffset) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

export function calendarFixture() {
  const h = new Date().getHours();
  return [
    { ...PRIMARY, id: 'ev-1', summary: 'Team-Standup', start: at(0, h - 1, 30), end: at(0, h, 15), all_day: false, color: '#039be5', project_id: null },
    { ...LARVIS, id: 'ev-2', summary: 'Urlaubsfotos sortieren', start: at(0, h, 45), end: at(0, h + 2), all_day: false, color: '#2F6FED', project_id: '11111111-1111-1111-1111-111111111102', location: 'Arbeitszimmer' },
    { ...PRIMARY, id: 'ev-3', summary: 'Zahnarzt', start: at(0, h + 3), end: at(0, h + 3, 45), all_day: false, color: '#e67c73', project_id: null, location: 'Praxis Dr. Berg' },
    { ...LARVIS, id: 'ev-4', summary: 'Larvis Design-Review', start: at(0, h + 5), end: at(0, h + 6), all_day: false, color: '#F05A28', project_id: '11111111-1111-1111-1111-111111111101' },
    { ...PRIMARY, id: 'ev-5', summary: 'Wäsche abholen', start: day(0), end: day(1), all_day: true, color: '#616161', project_id: null },
    { ...PRIMARY, id: 'ev-6', summary: 'Chorprobe', start: at(1, 18), end: at(1, 19, 30), all_day: false, color: '#8e24aa', project_id: null, location: 'Musterstraße 1' },
    { ...LARVIS, id: 'ev-7', summary: 'Steuer-Termin', start: at(2, 10), end: at(2, 11), all_day: false, color: '#1F8F5A', project_id: '11111111-1111-1111-1111-111111111103' },
    { ...PRIMARY, id: 'ev-8', summary: 'Anna Beispiel', start: day(3), end: day(4), all_day: true, color: '#f6bf26', project_id: null, event_type: 'birthday' },
    { ...PRIMARY, id: 'ev-9', summary: 'Grillen am See', start: at(5, 16), end: at(5, 19), all_day: false, color: '#33b679', project_id: null },
    { ...PRIMARY, id: 'ev-10', summary: 'Retro Sprint 12', start: at(-1, 14), end: at(-1, 15), all_day: false, color: '#039be5', project_id: null },
    { ...OUTLOOK, id: `sub:${SUB_ID}:a1`, summary: 'Abteilungs-Meeting', start: at(0, h + 1), end: at(0, h + 1, 45), all_day: false, project_id: null, location: 'Teams', recurring_event_id: `sub:${SUB_ID}:s1` },
    { ...OUTLOOK, id: `sub:${SUB_ID}:a2`, summary: 'Messe', start: day(2), end: day(3), all_day: true, project_id: null },
  ];
}

/** Abo-Liste für den Dev-Server (in-memory, ohne Abruf des Links). */
export const subscriptionFixture = [
  { id: SUB_ID, name: 'Outlook', color: '#0078d4', project_id: null, enabled: true, url_hint: 'outlook.office365.com/…/calendar.ics', last_synced_at: new Date().toISOString(), last_error: null, created_at: new Date().toISOString() },
  { id: '22222222-2222-2222-2222-222222222202', name: 'Arbeit', color: '#1f8f5a', project_id: null, enabled: true, url_hint: 'calendar.google.com/…/basic.ics', last_synced_at: null, last_error: 'Der Link gilt nicht (mehr) — vermutlich zurückgezogen oder falsch kopiert (HTTP 404).', created_at: new Date().toISOString() },
];
