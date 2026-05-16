import { SignIn, SignUp } from "@clerk/react";
import Navbar from "./Navbar";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SignInPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="app-window">
      <Navbar onBack={onBack} />
      <div className="app-body" style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 16 }}>
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up`}
          forceRedirectUrl={basePath || "/"}
        />
      </div>
    </div>
  );
}

export function SignUpPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="app-window">
      <Navbar onBack={onBack} />
      <div className="app-body" style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 16 }}>
        <SignUp
          routing="path"
          path={`${basePath}/sign-up`}
          signInUrl={`${basePath}/sign-in`}
          forceRedirectUrl={basePath || "/"}
        />
      </div>
    </div>
  );
}
