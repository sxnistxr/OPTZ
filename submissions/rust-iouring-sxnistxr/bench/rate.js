// Open-loop load at a fixed request rate with the load.js mix (no think time), to measure
// server CPU per request when the CPU is NOT saturated, the regime the scoring hold runs in.
//   k6 run -e BASE_URL=... -e RATE=20000 -e VUS=2000 -e DURATION=30s -e TOKENS=... bench/rate.js
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const tokens = new SharedArray('tokens', () => JSON.parse(open(__ENV.TOKENS)));

export const options = {
  scenarios: {
    rate: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 10000),
      timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      preAllocatedVUs: Number(__ENV.VUS || 2000),
      maxVUs: Number(__ENV.VUS || 2000),
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const r = Math.random();
  let res;
  if (r < 0.461) {
    res = http.get(`${BASE_URL}/feed`);
  } else if (r < 0.922) {
    res = http.get(`${BASE_URL}/posts/${495000 + Math.floor(Math.random() * 5000)}`);
  } else {
    const t = tokens[Math.floor(Math.random() * tokens.length)];
    const auth = { headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' } };
    if (r < 0.991) res = http.post(`${BASE_URL}/posts/${1 + Math.floor(Math.random() * 500000)}/like`, null, auth);
    else res = http.post(`${BASE_URL}/posts`, JSON.stringify({ body: `rate test ${Date.now()}` }), auth);
  }
  check(res, { ok: (x) => x.status === 200 || x.status === 201 });
}
