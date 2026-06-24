import { useEffect } from 'react';

export interface PageMetaConfig {
  title: string;
  description: string;
  canonical: string;
  ogTitle?: string;
  ogDescription?: string;
}

function setMetaAttr(selector: string, attr: string, value: string): void {
  const el = document.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

export function usePageMeta(meta: PageMetaConfig): void {
  const { title, description, canonical, ogTitle, ogDescription } = meta;
  useEffect(() => {
    document.title = title;
    setMetaAttr('meta[name="description"]', 'content', description);
    setMetaAttr('link[rel="canonical"]', 'href', canonical);
    const ogT = ogTitle ?? title;
    const ogD = ogDescription ?? description;
    setMetaAttr('meta[property="og:title"]', 'content', ogT);
    setMetaAttr('meta[property="og:description"]', 'content', ogD);
    setMetaAttr('meta[property="og:url"]', 'content', canonical);
    setMetaAttr('meta[name="twitter:title"]', 'content', ogT);
    setMetaAttr('meta[name="twitter:description"]', 'content', ogD);
  }, [title, description, canonical, ogTitle, ogDescription]);
}

export const PAGE_META = {
  home: {
    title: 'BreakBPM — Live Balls-Per-Minute Pool Score Tracker for 8-Ball, 9-Ball & Practice',
    description: 'BreakBPM is a free live billiards score tracker that calculates per-player Balls Per Minute for 8-ball, 9-ball, practice, and solo Shark mode.',
    canonical: 'https://breakbpm.com/',
    ogTitle: 'BreakBPM — Live Pool Score Tracker with Balls-Per-Minute',
    ogDescription: 'Track every shot, every ball, and your live Balls Per Minute across 8-ball, 9-ball, practice, and solo Shark mode. Free to play, no install required.',
  },
  manual: {
    title: 'BreakBPM Manual — How to Track Balls Per Minute & Use Every Feature',
    description: 'The BreakBPM manual: how to score 8-ball, 9-ball, practice, and solo Shark mode, read per-player Balls Per Minute, spectate, link players with @mention, and use passes.',
    canonical: 'https://breakbpm.com/about',
    ogTitle: 'BreakBPM Manual — How Everything Works',
    ogDescription: 'How to use BreakBPM: scoring modes, live Balls Per Minute, spectating, share codes, @mention linking, and passes.',
  },
  legal: {
    title: 'Legal — BreakBPM Terms of Service, Privacy & Data Policy',
    description: 'BreakBPM terms of service, privacy policy, and data handling details. Read how we collect, store, and protect your game data.',
    canonical: 'https://breakbpm.com/legal',
    ogTitle: 'Legal — BreakBPM Terms & Privacy Policy',
    ogDescription: 'BreakBPM terms of service, privacy policy, and data handling details.',
  },
  passes: {
    title: 'BreakBPM Passes & Pricing — Flexible Day Passes & Lifetime Access',
    description: 'Unlock full stats history, live spectating, and all BreakBPM features. Buy any 1–365 days of access with crypto (from $1.99 — longer passes cost less per day), go Lifetime ($24.99), or redeem a code. Prefer card? A 14 Day Pass ($5.99) is available by card via our store.',
    canonical: 'https://breakbpm.com/passes',
    ogTitle: 'BreakBPM Passes & Pricing — Unlock Full Stats & Spectating',
    ogDescription: 'Buy any 1–365 days of access with crypto (from $1.99 — longer passes cost less per day) or go Lifetime ($24.99) to unlock full stats history, live spectating, and all paid BreakBPM features. Pay with crypto or redeem a code, or grab a 14 Day Pass ($5.99) by card on our store.',
  },
  poolStatsApp: {
    title: 'Pool Stats App — Track Balls Per Minute for 8-Ball & 9-Ball | BreakBPM',
    description: 'BreakBPM is a free pool stats app and live billiards score tracker. Log every shot and see per-player Balls Per Minute (BPM) for 8-ball, 9-ball, practice, and Shark mode. Claim a free pass.',
    canonical: 'https://breakbpm.com/pool-stats-app',
    ogTitle: 'BreakBPM — The Pool Stats App with Balls Per Minute',
    ogDescription: 'Free pool stats app & billiards score tracker. Track accuracy and live Balls Per Minute across 8-ball, 9-ball, practice, and solo Shark mode.',
  },
} satisfies Record<string, PageMetaConfig>;
