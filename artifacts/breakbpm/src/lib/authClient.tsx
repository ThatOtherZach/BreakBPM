/**
 * Single auth-provider seam for the client.
 *
 * All `@clerk/react` imports live in this file. The rest of the app uses
 * `useAuth()` (returns the agreed `{ user, isLoading, isAuthenticated,
 * login, logout }` contract), `<SignedIn>`, `<SignedOut>`, and the route
 * components below. To swap providers, reimplement this file against the
 * new SDK; nothing else needs to change.
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
import { useGetMe } from "@workspace/api-client-react";

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

/** Wraps the app with the auth provider + wouter routing glue. */
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

export interface AuthUser {
  id: string;
  screenName: string;
  email: string | null | undefined;
}

export interface AuthState {
  /** Local user (null if anonymous OR before /auth/me has resolved). */
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Navigate to the sign-in flow. */
  login: () => void;
  /** Sign out via the underlying provider. Resolves once complete. */
  logout: () => Promise<void>;
}

/**
 * Single hook the rest of the app uses. Wraps the underlying provider
 * and merges in the local /auth/me account so callers don't have to
 * juggle two sources of truth.
 */
export function useAuth(): AuthState {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const clerk = useClerk();
  const [, setLocation] = useLocation();
  const me = useGetMe();

  const isLoading = !isLoaded || (!!isSignedIn && me.isLoading);
  const account = me.data?.account;
  const user: AuthUser | null = account
    ? { id: account.id, screenName: account.screenName, email: account.email ?? null }
    : null;

  return {
    user,
    isLoading,
    isAuthenticated: !!isSignedIn,
    login: () => setLocation("/sign-in"),
    logout: async () => {
      await clerk.signOut();
    },
  };
}

export function SignedIn({ children }: { children: ReactNode }) {
  return <Show when="signed-in">{children}</Show>;
}

export function SignedOut({ children }: { children: ReactNode }) {
  return <Show when="signed-out">{children}</Show>;
}

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
