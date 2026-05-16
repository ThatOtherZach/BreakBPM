import { SignInRoute, SignUpRoute } from "../lib/authClient";
import Navbar from "./Navbar";

function PageShell({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="app-window">
      <Navbar onBack={onBack} />
      <div className="app-body" style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 16 }}>
        {children}
      </div>
    </div>
  );
}

export function SignInPage({ onBack }: { onBack: () => void }) {
  return <PageShell onBack={onBack}><SignInRoute /></PageShell>;
}

export function SignUpPage({ onBack }: { onBack: () => void }) {
  return <PageShell onBack={onBack}><SignUpRoute /></PageShell>;
}
