// 零依赖逻辑测试：node tests/logic.test.js
// 在 Node 里用最小 DOM 桩执行 index.html 的脚本，然后在同一作用域里断言筛选和匹配逻辑。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

const stub = () => new Proxy(function () {}, {
  get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'length' ? 0 : (k in t ? t[k] : stub()),
  apply: () => stub(),
  set: () => true,
  has: () => true
});
const doc = stub();
doc.querySelectorAll = () => [];
const ctx = {
  document: doc, assert, console, Math, JSON, Set, Map, RegExp, setTimeout, clearTimeout, setInterval, clearInterval,
  window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
  localStorage: { getItem: () => null, setItem() {} }
};

const tests = `
const results = [];
const test = (name, fn) => { try { fn(); results.push([name, null]); } catch (e) { results.push([name, e]); } };
const ids = list => list.map(d => d.id).join(',');
const resetPrefs = () => { prefs.avoid.clear(); prefs.tools.clear(); prefs.maxTime = null; };

test('菜谱 id 唯一，且每道菜都有图', () => {
  assert.strictEqual(new Set(DISHES.map(d => d.id)).size, DISHES.length);
  assert(DISHES.every(d => d.img));
});

test('无需开火的菜在任何锅具选择下都保留', () => {
  const paigu = dishById('paigu');
  assert(dishPasses(paigu, { tools: new Set(['炒锅']) }));
  assert(dishPasses(paigu, { tools: new Set(['汤锅', '平底锅']) }));
});

test('豆制品忌口只排除豆腐类，不排除酱油', () => {
  const left = DISHES.filter(d => dishPasses(d, { avoid: ['豆制品'] }));
  assert.strictEqual(ids(DISHES.filter(d => !left.includes(d))), 'doufu,xiaren');
});

test('大豆忌口仍排除酱油类菜', () => {
  assert(!dishPasses(dishById('huanggua'), { avoid: ['大豆'] }));
});

test('食材按钮都能在某道菜的 needs 里找到，且每个 needs 都有按钮', () => {
  const chips = new Set(CHIP_GROUPS.flatMap(g => g.items).map(canonicalName));
  const needs = new Set(DISHES.flatMap(d => d.needs));
  for (const name of chips) assert(needs.has(name), '死按钮：' + name);
  for (const name of needs) assert(chips.has(name), '缺按钮：' + name);
});

test('鸡蛋+米饭：完整匹配之后还有近似方案可换', () => {
  resetPrefs(); selected.clear(); selected.add('鸡蛋'); selected.add('米饭');
  runGenerate();
  assert(rankedMatches.length > 1, '只有 ' + rankedMatches.length + ' 个方案');
  assert.strictEqual(rankedMatches[0].missing.length, 0);
  const missing = rankedMatches.map(m => m.missing.length);
  assert.deepStrictEqual(missing, [...missing].sort((a, b) => a - b));
  selected.clear();
});

test('盲盒、聊天、一周计划都遵守同一组条件', () => {
  const avoidKeys = AVOID_OPTIONS.map(o => o.key);
  const toolSets = [[], ['炒锅'], ['炒锅', '汤锅'], ['无需开火'], ['平底锅', '烤箱', '空气炸锅']];
  const inputs = ['随便推荐一个', '冰箱里有鸡蛋和米饭', '一周不重样', '想吃清爽的', '冰箱只剩泡面', '深夜十一点', '想吃辣的', '不吃牛肉'];
  for (let mask = 0; mask < (1 << avoidKeys.length); mask++) {
    for (const tools of toolSets) {
      for (const maxTime of [null, 10, 20]) {
        resetPrefs();
        avoidKeys.forEach((k, i) => { if (mask >> i & 1) prefs.avoid.add(k); });
        tools.forEach(k => prefs.tools.add(k));
        prefs.maxTime = maxTime;
        const label = JSON.stringify({ avoid: [...prefs.avoid], tools, maxTime });
        for (const dish of currentBlindPool()) assert(dishPasses(dish, prefs), '盲盒违反条件 ' + dish.id + ' ' + label);
        for (const text of inputs) {
          const reply = getResponse(text);
          if (reply.dish) assert(dishPasses(reply.dish, prefs), '聊天违反条件 ' + text + ' → ' + reply.dish.id + ' ' + label);
          if (Array.isArray(reply.plan)) for (const id of reply.plan) assert(dishPasses(dishById(id), prefs), '周计划违反条件 ' + id + ' ' + label);
        }
      }
    }
  }
  resetPrefs();
});

test('旧版本地存储：保留收藏和最近，丢弃计数和无效 id', () => {
  const s = normalizeStore({ ing: 3, up: 1, favs: ['fanqie', 'nope', 'fanqie'], recent: ['doufu', 'bogus'] });
  assert.deepStrictEqual(Object.keys(s).sort(), ['favs', 'recent']);
  assert.deepStrictEqual(s.favs, ['fanqie']);
  assert.deepStrictEqual(s.recent, ['doufu']);
});

test('使用统计代码已移除', () => {
  assert(!/bump\\(|renderStats|data-action="(up|down)"/.test(document_source));
});

results;
`;
ctx.document_source = js;
const results = vm.runInNewContext(js + '\n' + tests, ctx);
let failed = 0;
for (const [name, err] of results) {
  console.log(`${err ? 'FAIL' : 'ok  '} ${name}${err ? '\n     ' + String(err.message).split('\n')[0] : ''}`);
  if (err) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
