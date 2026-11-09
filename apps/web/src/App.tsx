import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeProvider';
import { ToastProvider } from './lib/toast';
import { AuthProvider } from './lib/auth';
import { ProtectedRoute } from './layouts/ProtectedRoute';
import { AppShell } from './layouts/AppShell';
import { Login } from './routes/Login';
import { OAuthConsent } from './routes/OAuthConsent';
import { Today } from './routes/Today';
import { Todos } from './routes/Todos';
import { Projects } from './routes/Projects';
import { ProjectDetail } from './routes/ProjectDetail';
import { Personal } from './routes/Personal';
import { Learnings } from './routes/Learnings';
import { Inbox } from './routes/Inbox';
import { Learnweb } from './routes/Learnweb';
import { LearnwebCourse } from './routes/LearnwebCourse';
import { LearnwebVideo } from './routes/LearnwebVideo';
import { Calendar } from './routes/Calendar';
import { Contacts } from './routes/Contacts';
import { Places } from './routes/Places';
import { Archive } from './routes/Archive';
import { More } from './routes/More';
import { Dashboard } from './routes/Dashboard';
import { MODULES } from './lib/modules';

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/oauth/consent" element={<OAuthConsent />} />
              <Route element={<ProtectedRoute />}>
                {/* Kiosk dashboard: protected but no app chrome */}
                <Route path="/dashboard" element={<Dashboard />} />
                <Route element={<AppShell />}>
                  <Route index element={<Today />} />
                  <Route path="todos" element={<Todos />} />
                  <Route path="projects" element={<Projects />} />
                  <Route path="projects/:id" element={<ProjectDetail />} />
                  <Route path="profil" element={<Personal />} />
                  {/* /notes leitet auf die Projektliste. */}
                  <Route path="notes" element={<Navigate to="/projects" replace />} />
                  {/* Wiki: Übersicht und Seite sind eine Route (Slug optional), damit der
                      offene Editor beim Sprung zur neuen Seite nicht verloren geht. */}
                  <Route path="learnings/:slug?" element={<Learnings />} />
                  {/* Optionales Modul Learnweb: ohne VITE_LEARNWEB_ENABLED gibt es die Routen nicht. */}
                  {MODULES.learnweb && (
                    <>
                      <Route path="learnweb" element={<Learnweb />} />
                      <Route path="learnweb/:id" element={<LearnwebCourse />} />
                      <Route path="learnweb/:id/video/:videoId" element={<LearnwebVideo />} />
                    </>
                  )}
                  <Route path="inbox" element={<Inbox />} />
                  <Route path="calendar" element={<Calendar />} />
                  <Route path="contacts" element={<Contacts />} />
                  <Route path="orte" element={<Places />} />
                  <Route path="archiv" element={<Archive />} />
                  <Route path="mehr" element={<More />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
