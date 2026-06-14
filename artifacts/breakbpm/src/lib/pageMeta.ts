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
  about: {
    title: 'About BreakBPM — Billiards Score Tracker & Shot Stats App',
    description: 'Learn about BreakBPM — the free live pool scorekeeper that calculates per-player Balls Per Minute for 8-ball, 9-ball, and solo Shark mode. Built for serious players.',
    canonical: 'https://breakbpm.com/about',
    ogTitle: 'About BreakBPM — Billiards Score Tracker & Shot Stats',
    ogDescription: 'BreakBPM tracks every shot and every ball pocketed, calculating live Balls Per Minute per player. Learn how it works and who made it.',
  },
  legal: {
    title: 'Legal — BreakBPM Terms of Service, Privacy & Data Policy',
    description: 'BreakBPM terms of service, privacy policy, and data handling details. Read how we collect, store, and protect your game data.',
    canonical: 'https://breakbpm.com/legal',
    ogTitle: 'Legal — BreakBPM Terms & Privacy Policy',
    ogDescription: 'BreakBPM terms of service, privacy policy, and data handling details.',
  },
  passes: {
    title: 'BreakBPM Passes & Pricing — Day Pass, Monthly, Lifetime Access',
    description: 'Unlock full stats history, live spectating, and all BreakBPM features. Choose a Day Pass ($1.99), Monthly ($2.99/mo), Yearly ($12.99/yr), or Lifetime ($24.99) pass.',
    canonical: 'https://breakbpm.com/passes',
    ogTitle: 'BreakBPM Passes & Pricing — Unlock Full Stats & Spectating',
    ogDescription: 'Choose a Day Pass ($1.99), Monthly sub ($2.99/mo), or Lifetime pass ($24.99) to unlock full stats history, live spectating, and all paid BreakBPM features.',
  },
} satisfies Record<string, PageMetaConfig>;
