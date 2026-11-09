// True when Larvis runs as an installed home-screen app (iOS standalone or the
// standard display-mode), rather than inside a normal browser tab.
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  const displayStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  return iosStandalone || displayStandalone;
}
