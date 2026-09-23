// The free, instant excuse engine. Shared with the API so both sides agree on what's valid.

export const JUNCTIONS = [
  { id: 'silk', name: 'Silk Board Junction', sign: 'SILK BOARD JN', jam: 1.0,
    lore: 'where Hosur Road, the Outer Ring Road and a half-built metro meet to discuss your life choices' },
  { id: 'orr', name: 'ORR, Bellandur', sign: 'ORR BELLANDUR', jam: 0.9,
    lore: 'the ring road where every IT park empties out at exactly the same minute' },
  { id: 'hebbal', name: 'Hebbal Flyover', sign: 'HEBBAL FLYOVER', jam: 0.85,
    lore: 'the airport road’s favourite parking lot, now with extra loops' },
  { id: 'krpuram', name: 'KR Puram', sign: 'K R PURAM', jam: 0.8,
    lore: 'the cable-stayed bridge where the cables are the only thing moving' },
  { id: 'marathahalli', name: 'Marathahalli Bridge', sign: 'MARATHAHALLI', jam: 0.85,
    lore: 'where every cab to Whitefield takes a long meditation break' },
  { id: 'tin', name: 'Tin Factory', sign: 'TIN FACTORY', jam: 0.75,
    lore: 'a factory that now only manufactures delays' },
  { id: 'ecity', name: 'Electronic City Flyover', sign: 'ELECTRONIC CITY', jam: 0.7,
    lore: 'the elevated expressway where the toll is paid in time' },
  { id: 'iblur', name: 'Iblur Junction', sign: 'IBLUR JN', jam: 0.8,
    lore: 'the junction that swallowed Sarjapur Road whole' },
];

export const AUDIENCES = [
  { id: 'manager', label: 'Manager', hi: 'Hi', you: 'you' },
  { id: 'founder', label: 'Founder', hi: 'Hey', you: 'you' },
  { id: 'client', label: 'Client', hi: 'Dear Sir/Madam', you: 'you' },
  { id: 'mom', label: 'Amma', hi: 'Amma', you: 'you' },
  { id: 'date', label: 'Date', hi: 'Hey you', you: 'you' },
  { id: 'prof', label: 'Professor', hi: 'Respected Sir/Ma’am', you: 'you' },
  { id: 'hr', label: 'HR', hi: 'Dear HR', you: 'the panel' },
];

export const TONES = [
  { id: 'corporate', label: 'Corporate' },
  { id: 'desperate', label: 'Desperate' },
  { id: 'poetic', label: 'Poetic' },
  { id: 'legal', label: 'Legal notice' },
  { id: 'kannada', label: 'Swalpa Kannada' },
];

export function lateness(m) {
  if (m < 15) return 'Fashionably';
  if (m < 40) return 'Noticeably';
  if (m < 90) return 'Awkwardly';
  if (m < 150) return 'Legendarily';
  return 'Permanently';
}

const T = {
  corporate: [
    '{hi}, quick flag: I’m blocked by an upstream dependency at {J}, {lore}. Current ETA slip is ~{m} min. Please proceed without me and I’ll sync async.',
    '{hi}, heads-up that {J} has escalated to a P0 with no fix date. Expect me ~{m} min late. Happy to take the action items.',
    '{hi}, circling back: I remain at {J}. Traffic hasn’t shipped a single release in {m} minutes. Let’s take this offline, which is where I currently am.',
  ],
  desperate: [
    '{HI} I LEFT ON TIME I SWEAR. I’ve been at {J} for {m} minutes. A man has sold me a phone charger, a car sunshade and a small bonsai. Please don’t start without me.',
    '{hi}, update: still at {J}. The auto driver next to me and I have shared snacks, life stories and a Wi-Fi hotspot. ~{m} min late. Send help. Or filter coffee.',
    '{hi}, I can SEE the office. I have been able to see it for {m} minutes. {J} will not let me go.',
  ],
  poetic: [
    '{hi},\nthe road to {you} runs through {J},\nwhere brake lights bloom like gulmohar\nand time forgets to move.\nI will arrive in {m} minutes,\nor in the next life, whichever is sooner.',
    '{hi},\nat {J}, {lore}.\nI wait, as the city waits,\nfor a green that never comes.\n{m} minutes, give or take a monsoon.',
  ],
  legal: [
    'NOTICE OF DELAY. {hi}: the undersigned hereby informs {you} that, owing to circumstances beyond reasonable control, namely {J}, arrival shall be delayed by approximately {m} minutes. This notice is issued without prejudice to future delays at the same location.',
    'WHEREAS the undersigned departed in good faith, AND WHEREAS {J} is {lore}, the undersigned’s arrival is deferred by {m} minutes. All rights to blame the traffic are expressly reserved.',
  ],
  kannada: [
    '{hi}, swalpa adjust maadi! {J} alli full jam, guru. Ondu {m} nimisha late aagatte. Bega bartini, promise.',
    'Namaskara {hi}! Naanu {J} alli stuck. {m} minutes late, full traffic. Swalpa adjust maadi, please. Coffee nanna kade.',
    '{hi}, sorry sorry! {J} alli yaaru move aagtilla. {m} nimisha late. Tension bedi, bartini.',
  ],
};

const TAILS = [
  [90, ' (At this point I’m not late, I’m a resident.)'],
  [150, ' Please forward my post to {J}.'],
];

export function fill(tpl, { junction, audience, minutes }) {
  const j = JUNCTIONS.find((x) => x.id === junction) || JUNCTIONS[0];
  const a = AUDIENCES.find((x) => x.id === audience) || AUDIENCES[0];
  return tpl
    .replaceAll('{HI}', a.hi.toUpperCase()).replaceAll('{hi}', a.hi)
    .replaceAll('{you}', a.you).replaceAll('{J}', j.name).replaceAll('{lore}', j.lore)
    .replaceAll('{m}', String(minutes));
}

// Picks a template the user hasn't just seen.
let lastIdx = -1;
export function makeExcuse(opts) {
  const list = T[opts.tone] || T.corporate;
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === lastIdx) i = (i + 1) % list.length;
  lastIdx = i;
  let text = fill(list[i], opts);
  if (opts.tone !== 'poetic') {
    if (opts.rain) text += ' Also, it’s raining, so the road is now a river with signals.';
    if (opts.cow) text += ' There is also a cow. The cow has right of way.';
    for (const [min, tail] of TAILS) if (opts.minutes >= min) text += fill(tail, opts);
  }
  return text;
}

// What the other person says back, by who they are and how late you are (short / medium / long).
export const REPLIES = {
  manager: ['np, see you soon 👍', 'Ok. Join the call from the cab please.', 'Let’s discuss this in our 1:1.'],
  founder: ['Take the call from the car. Pitch the auto driver while you’re there.', 'We’ll start. Bias for action.', 'Great, you’re now Head of Traffic.'],
  client: ['Noted.', 'Our timelines are also stuck at Silk Board.', 'Kindly revert with a revised ETA.'],
  mom: ['Did you eat something?', 'That’s why I said leave early.', 'Come home. I’ll make dosa.'],
  date: ['haha ok, ordering you a drink', '…is Silk Board your ex?', 'I’ve made friends with the waiter. Take your time.'],
  prof: ['Noted.', 'Attendance: present in spirit.', 'Submit this as your assignment. It’s better.'],
  hr: ['Thanks for letting us know.', 'We’ll reschedule. Again.', 'We’ll add this to your file. Good luck.'],
};
export const replyFor = (aud, minutes) => {
  const r = REPLIES[aud] || REPLIES.manager;
  return r[minutes < 30 ? 0 : minutes < 100 ? 1 : 2];
};

export const REASONS = [
  'Stationary vehicle syndrome, acute',
  'Signal cycle exceeded human lifespan',
  'Metro construction, phase “eventually”',
  'Lane discipline not found (404)',
  'Flyover used as parking, as intended',
  'Honking reached critical mass',
  'Autorickshaw negotiation overran',
  'Google Maps went quiet in shame',
];
export const randomReason = () => REASONS[Math.floor(Math.random() * REASONS.length)];
