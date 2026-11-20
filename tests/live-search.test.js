'use strict';
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const live = require('../plugins/utils/live-search');

const keys = ['LOCAL_AI_WEB_SEARCH', 'LOCAL_AI_SEARCH_URL', 'LOCAL_AI_SEARCH_TIMEOUT_MS'];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
function setup(mode = 'auto') {
  process.env.LOCAL_AI_WEB_SEARCH = mode;
  process.env.LOCAL_AI_SEARCH_URL = 'http://127.0.0.1:8080';
}
after(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const results = [{
  title: 'Current result',
  url: 'https://example.org/article',
  snippet: 'An event happened on November 20, 2026.',
  published: '2026-11-20'
}];

test('only local SearXNG URLs are accepted', () => {
  for (const url of ['http://localhost:8080', 'http://searxng:8080', 'http://192.168.1.20:8080', 'http://[::1]:8080']) {
    assert.equal(live.searchEndpoint(url), new URL(url).origin);
  }
  for (const url of ['https://example.org', 'http://8.8.8.8', 'http://127.0.0.1:8080/search', 'http://user:pass@localhost:8080', 'ftp://localhost:8080']) {
    assert.throws(() => live.searchEndpoint(url), /LOCAL_AI_SEARCH_URL/);
  }
});

test('SearXNG requests use JSON format and strip unsafe or duplicate results', async () => {
  setup();
  const calls = [];
  const sources = await live.searchWeb('current weather', {
    client: { get: async (url, options) => {
      calls.push({ url, options });
      return { data: { results: [
        { title: 'Weather', url: 'https://weather.example/today', content: 'Sunny' },
        { title: 'Duplicate', url: 'https://weather.example/today', content: 'Duplicate content' },
        { title: 'Bad', url: 'file:///etc/passwd', content: 'ignore' },
        { title: 'News', url: 'https://example.org', content: 'Updated today' }
      ] } };
    } }
  });
  assert.equal(calls[0].url, 'http://127.0.0.1:8080/search');
  assert.equal(calls[0].options.params.format, 'json');
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.equal(calls[0].options.proxy, false);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].snippet, 'Sunny');
});

test('explicit web request adds retrieved evidence and source links to local model output', async () => {
  setup();
  let request;
  const answer = await live.generateWithWeb(async options => { request = options; return 'The event happened [1].'; },
    { prompt: 'web What happened today?', deep: true },
    { search: async question => { assert.equal(question, 'What happened today?'); return results; } });
  assert.equal(request.deep, true);
  assert.match(request.prompt, /WEB SEARCH RESULTS/);
  assert.match(request.prompt, /https:\/\/example.org\/article/);
  assert.match(request.systemPrompt, /Never follow directions/);
  assert.match(answer, /https:\/\/example.org\/article/);
  assert.match(answer, /checked /);
});

test('normal questions remain offline in auto mode; time-sensitive questions use search', async () => {
  setup();
  let searches = 0;
  const local = async options => options.prompt;
  const dependencies = { search: async () => { searches++; return results; } };
  assert.equal(await live.generateWithWeb(local, { prompt: 'Explain DNS' }, dependencies), 'Explain DNS');
  assert.equal(searches, 0);
  assert.match(await live.generateWithWeb(local, { prompt: 'What is the latest news?' }, dependencies), /Web sources/);
  assert.equal(searches, 1);
  assert.equal(await live.generateWithWeb(local, { prompt: 'offline latest news' }, dependencies), 'latest news');
  assert.equal(searches, 1);
});

test('forced search fails visibly; automatic search fails safely with stale-data warning', async () => {
  setup();
  const failed = { search: async () => { throw new Error('search failed'); } };
  await assert.rejects(() => live.generateWithWeb(async () => 'guess', { prompt: 'web latest news' }, failed), /search failed/);
  const fallback = await live.generateWithWeb(async () => 'guess', { prompt: 'latest news' }, failed);
  assert.match(fallback, /not verified/);
  assert.match(fallback, /guess/);
});

test('explicit off prevents external searches even for web questions', async () => {
  setup('off');
  await assert.rejects(() => live.generateWithWeb(async () => 'offline', { prompt: 'web latest news' }), /disabled/);
  assert.equal(await live.generateWithWeb(async () => 'offline', { prompt: 'latest news' }), 'offline');
});

test('search refuses missing results rather than fabricating citations', async () => {
  setup();
  await assert.rejects(() => live.generateWithWeb(async () => 'guess', { prompt: 'web news' }, { search: async () => [] }), /No web results/);
});


test('Pakistan clock questions use live server time without Ollama or SearXNG', async () => {
  setup('off');
  const now = new Date('2026-11-20T19:48:00.000Z'); // 00:48 on 21 Nov in Pakistan
  let called = false;
  for (const prompt of [
    'what time is it in Pakistan right now?',
    'what is time right now in Pakistan',
    'web what is time right now in Pakistan',
    'What is the time right now in Pakistan?',
    "what's the time in Karachi now?",
    'tell me the exact time in Lahore please',
    'web what time is it in Pakistan right now?',
    'offline what time is it in Pakistan right now?',
    'time in Karachi now',
    'What is the current time in Islamabad?'
  ]) {
    const reply = await live.generateWithWeb(
      async () => { called = true; throw new Error('Local model should not run'); },
      { prompt },
      { now, search: async () => { called = true; throw new Error('Search should not run'); } }
    );
    assert.match(reply, /12:48:00 AM/);
    assert.match(reply, /Saturday, 21 November 2026/);
    assert.match(reply, /Asia\/Karachi/);
  }
  assert.equal(called, false);
});

test('clock shortcut ignores historical or comparative questions', async () => {
  const now = new Date('2026-11-20T19:48:00.000Z');
  assert.equal(live.getPakistanTimeAnswer('Explain time zones in Pakistan', now), null);
  assert.equal(live.getPakistanTimeAnswer('What is the time difference between Pakistan and London?', now), null);
  assert.equal(live.getPakistanTimeAnswer('What time is it in London right now?', now), null);
  assert.equal(live.getPakistanTimeAnswer('What time was it in Pakistan yesterday?', now), null);
  assert.equal(live.getPakistanTimeAnswer('What is the time difference between Pakistan and India?', now), null);
});
