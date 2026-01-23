import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/clerk-react";
import Dashboard from "./components/Dashboard";

export default function App() {
  return (
    <div className="page">
      <header className="header">
        <div className="container header-inner">
          <div className="brand">
            <div className="brand-title">webhost.systems</div>
            <div className="brand-subtitle">v1 dashboard (Slice B)</div>
          </div>

          <div className="row">
            <SignedOut>
              <SignInButton />
              <SignUpButton />
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="container">
          <SignedOut>
            <div className="panel">
              <div className="panel-header">
                <strong>Sign in to continue</strong>
              </div>
              <div className="panel-body">
                <div className="muted">
                  Use the Sign in / Sign up buttons in the header to
                  authenticate.
                </div>
              </div>
            </div>
          </SignedOut>

          <SignedIn>
            <Dashboard />
          </SignedIn>
        </div>
      </main>
    </div>
  );
}
