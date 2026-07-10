"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, signUpAction, type AuthState } from "./actions";

const initialState: AuthState = { error: null };

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const action = mode === "signup" ? signUpAction : signInAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="auth-form">
      <h1>{mode === "signup" ? "Begin with today." : "Welcome back."}</h1>
      <p className="form-lede">
        {mode === "signup"
          ? "Create a private workspace for your family’s learning life."
          : "Return to your family’s learning workspace."}
      </p>

      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}

      {mode === "signup" ? (
        <div className="field">
          <label htmlFor="displayName">Your name</label>
          <input id="displayName" name="displayName" autoComplete="name" required />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={8}
          required
        />
      </div>

      <button className="form-button" disabled={pending}>
        {pending ? "One moment…" : mode === "signup" ? "Create workspace" : "Sign in"}
      </button>

      <p className="auth-switch">
        {mode === "signup" ? "Already have a workspace? " : "New to Klio? "}
        <Link href={mode === "signup" ? "/login" : "/login?mode=signup"}>
          {mode === "signup" ? "Sign in" : "Create one"}
        </Link>
      </p>
    </form>
  );
}
