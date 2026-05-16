/**
 * Single auth-provider seam for the client.
 *
 * All `@clerk/react` imports live in this file. The rest of the app calls
 * `useAuth()`, `<SignedIn>`, `<SignedOut>`, and renders the page components
 * exported here. To swap providers:
 *
 *   1. Reimplement this file against the new SDK.
 *   2. The router/wouter glue in App.tsx stays the same.
 */
import {
  ClerkProvider,
  SignIn,
  SignUp,
  Show,
  useClerk,
  useAuth as useClerkAuth,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import type { ReactNode } from "react";
import { useLocation } from "wouter";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const themeAppearance = {
  variables: {
    colorPrimary: "#000080",
    colorBackground: "#c0c0c0",
    colorInput: "#ffffff",
    colorInputForeground: "#000",
    colorForeground: "#000",
    colorMutedForeground: "#444",
    colorNeutral: "#808080",
    colorDanger: "#c00",
    fontFamily: "MS Sans Serif, Tahoma, Geneva, Arial, sans-serif",
    borderRadius: "0",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#c0c0c0]",
  },
};

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

/**
 * Wraps the app with the auth provider. Wires the SDK's router into wouter
 * so its built-in redirects update our location.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={themeAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      {children}
    </ClerkProvider>
  );
}

export interface AuthState {
  isLoading: boolean;
  isSignedIn: boolean;
}

export function useAuth(): AuthState {
  const { isLoaded, isSignedIn } = useClerkAuth();
  return { isLoading: !isLoaded, isSignedIn: !!isSignedIn };
}

/**
 * Provider-agnostic sign-out hook. Returns a callback the caller can `await`.
 */
export function useSignOut(): () => Promise<void> {
  const { signOut } = useClerk();
  return async () => {
    await signOut();
  };
}

export function SignedIn({ children }: { children: ReactNode }) {
  return <Show when="signed-in">{children}</Show>;
}

export function SignedOut({ children }: { children: ReactNode }) {
  return <Show when="signed-out">{children}</Show>;
}

/** Path the app uses to navigate to the sign-in flow. */
export function signInPath(): string {
  return `${basePath}/sign-in`;
}
export function signUpPath(): string {
  return `${basePath}/sign-up`;
}

export function SignInRoute() {
  return (
    <SignIn
      routing="path"
      path={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      forceRedirectUrl={basePath || "/"}
    />
  );
}

export function SignUpRoute() {
  return (
    <SignUp
      routing="path"
      path={`${basePath}/sign-up`}
      signInUrl={`${basePath}/sign-in`}
      forceRedirectUrl={basePath || "/"}
    />
  );
}
