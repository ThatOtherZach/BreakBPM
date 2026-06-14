# Data Policy

_Last updated: June 14, 2026_

This Data Policy explains what information BreakBPM ("the Service"), operated by
**Saym Services Inc.** ("we", "us", "our"), collects, how we use it, who we
share it with, and the choices you have. It is a general boilerplate document
and **does not constitute legal advice**. It describes how the Service actually
works today; if that changes, we will update the "last updated" date above.

## 1. Information we collect

**Account identity.** When you sign in, our authentication provider (Clerk)
provides us with your **email address** and a provider user ID. We store these
along with a **screen name** (auto-generated on first sign-in and editable by
you) and an account-creation/onboarding timestamp. We assign an internal random
ID to your account so your activity is not tied directly to the auth provider's
identifier.

**Game and shot data.** When you play, we store details about your games: game
type, pace (BPM), accuracy, duration, number of balls sunk, outcome, and start
and end times. We also store a **shot-by-shot log**, which includes player
names, balls pocketed, fouls, and undo actions. Each game records the
participants in it, linked either to a signed-in account or to an anonymous
guest token for guests.

**Payment information.** When you buy a pass:

- **By card:** payment is processed by **Stripe**. Stripe collects your card
  details directly — **we never see or store your full card number**. We store
  references such as a Stripe customer, subscription, or payment identifier so we
  can match your payment to your account and prevent duplicate grants.
- **By cryptocurrency** (where offered): we store on-chain order and transaction
  references needed to confirm your payment.

**Information stored on your device.** The Service keeps some data locally in
your browser (localStorage), not on our servers: your **in-progress game** (so a
refresh doesn't lose it), a **guest token** (so you can rejoin or leave games on
that device), and **pending crypto-checkout** details while a purchase is in
progress. You can clear this at any time by clearing your browser storage.

## 2. How we use your information

We use your information to:

- Provide and operate the Service — run games, calculate statistics, and save
  history.
- Maintain your account and authenticate you.
- Process and reconcile payments and grant the access you purchased.
- Power social features such as joining, spectating, public profiles, and Find
  Players.
- Maintain the security and integrity of the Service and prevent abuse.

We do **not** use marketing trackers such as Google Analytics or advertising
pixels, and we do not sell your personal information.

## 3. Information that is visible to others

Some information is public or shared with other users by design:

- **Spectating and share codes:** your screen name and live game (scoreboard and
  shot log) can be viewed by anyone with your share code or who watches you by
  name, including through a chrome-free streaming/OBS overlay.
- **Public profile:** your cumulative statistics and recent game history are
  viewable by others.
- **Find Players:** if you create a post, your screen name, your scheduled time,
  and your location are shown to other signed-in users on a map and list. **Exact
  coordinates** are shown only to you (the post's owner) and to users who hold a
  paid pass; **all other signed-in users see only an approximate, city-level
  label** (for example, "Los Angeles, United States"), not your precise
  coordinates.
- **Global statistics:** we show aggregated, anonymized statistics across all
  players (for example, a global average BPM).

## 4. Third parties we share data with

We share limited data with service providers who help us operate the Service:

- **Clerk** — authentication and account/session management (including session
  cookies).
- **Stripe** — card payment processing and fraud prevention.
- **Nominatim / OpenStreetMap** — to convert Find Players coordinates into a
  city/country label (performed server-side).

These providers process your data on our behalf or under their own terms. We may
also disclose information if required by law or to protect our rights, users, or
the public.

## 5. Cookies

The Service uses functional cookies that are necessary for it to work, primarily
for authentication and keeping you signed in. We do not use advertising or
cross-site tracking cookies.

## 6. Data retention

We keep your account and game data for as long as your account exists or as
needed to provide the Service, comply with legal obligations, resolve disputes,
and enforce our agreements. Payment references are retained as needed for
accounting and fraud-prevention purposes.

## 7. Your choices and rights

**In-app deletion.** You can delete your game data from within the app. When you
do, a game is **fully deleted** if you are the only registered player in it; if
other registered players were in the game, your information is **anonymized**
(your name is replaced with a placeholder such as "Mr. X") so the remaining
players keep their record. This in-app action does **not** delete your account
record, email, screen name, or pass/subscription history.

**Fuller deletion and other requests.** To request deletion of your account and
remaining personal information, or to ask what data we hold about you, contact us
at **Contact@saymservices.com**. Depending on where you live, you may have rights
to access, correct, or delete your personal information; we will honor these
rights as required by applicable law.

## 8. Children

The Service is intended for adults **18 and over**. We do not knowingly collect
personal information from anyone under 18. If you believe a minor has provided us
information, contact us and we will take appropriate steps to remove it.

## 9. Changes to this policy

We may update this Data Policy from time to time. Material changes will be
reflected by the "last updated" date above and, where appropriate, surfaced in
the app.

## 10. Contact

For privacy questions or data requests, contact Saym Services Inc. at
**Contact@saymservices.com**. These Terms and this policy are governed by the
laws of British Columbia, Canada.
