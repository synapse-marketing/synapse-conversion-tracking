// Front-end WooCommerce dataLayer script - functional tests over the REAL
// assets/js/javascript.js.
//
// This file is the one piece of the plugin that was inherited from Stape and
// never had a test. Every defect found in the 2026-09-20 review lived here, and
// the two reviews that found them had to read the code by hand to do it. The
// assertions below are written against the shipped file, loaded unmodified into
// a VM, so a regression fails here instead of in a customer's GA4 property.
//
// Usage:  node dev-tools/javascript-test.mjs [--plugin "<folder>"]
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const argIdx = process.argv.indexOf('--plugin');
const PLUGIN_DIR = argIdx !== -1 && process.argv[argIdx + 1]
  ? process.argv[argIdx + 1]
  : 'synapse-conversion-tracking v2.0.1';
const SCRIPT = path.join(dir, '..', PLUGIN_DIR, 'synapse-conversion-tracking', 'assets', 'js', 'javascript.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  OK  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
};

// ---------------------------------------------------------------------------
// A jQuery stand-in covering exactly the operations the script uses. Kept small
// on purpose: anything it fakes that the browser does differently is a place a
// test could pass while the real page breaks, so each method mirrors jQuery's
// documented behaviour for the shapes the script actually passes.
// ---------------------------------------------------------------------------
function makeEnv({ withJQuery = true, config = {}, ajax = null } = {}) {
  const handlers = [];          // { events, selector, fn }
  const readyFns = [];
  const timers = [];

  function El(spec) {
    // spec: { tag, classes:[], dataset:{}, value, text, children:[], parent }
    Object.assign(this, { classes: [], dataset: {}, children: [], ...spec });
    this.children.forEach(c => { c.parent = this; });
  }
  El.prototype.matches = function (sel) {
    return sel.split(',').map(s => s.trim()).some(s => {
      if (s.startsWith('.')) return this.classes.includes(s.slice(1));
      if (s.startsWith('[data-') ) {
        const key = s.slice(6, s.indexOf(']')).replace(/-/g, '_');
        return this.dataset[key] !== undefined;
      }
      return this.tag === s;
    });
  };
  El.prototype.closest = function (sel) {
    let n = this;
    while (n) { if (n.matches(sel)) return n; n = n.parent; }
    return null;
  };
  El.prototype.querySelector = function (sel) {
    const want = sel.replace(/^\./, '');
    const walk = n => {
      for (const c of n.children) {
        if (c.classes.includes(want)) return c;
        const r = walk(c); if (r) return r;
      }
      return null;
    };
    return walk(this);
  };
  // Minimal descendant-selector support, enough for the one compound selector
  // the script uses: ".product-quantity input.qty". Each space-separated part
  // is a tag name and/or a list of classes.
  const compound = (part) => {
    const m = part.match(/^([A-Za-z]*)((?:\.[\w-]+)*)$/);
    if (!m) return null;
    return { tag: m[1] || null, classes: m[2] ? m[2].slice(1).split('.') : [] };
  };
  El.prototype.matchesCompound = function (part) {
    const c = compound(part);
    if (!c) return false;
    if (c.tag && this.tag !== c.tag) return false;
    return c.classes.every(k => this.classes.includes(k));
  };
  El.prototype.querySelectorAll = function (sel) {
    const parts = sel.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    const out = [];
    const walk = n => n.children.forEach(c => {
      if (c.matchesCompound(last)) {
        const need = parts.slice(0, -1);
        let p = c.parent;
        while (p && need.length) {
          if (p.matchesCompound(need[need.length - 1])) need.pop();
          p = p.parent;
        }
        if (!need.length) out.push(c);
      }
      walk(c);
    });
    walk(this);
    return out;
  };

  function wrap(nodes) {
    const arr = Array.isArray(nodes) ? nodes : (nodes ? [nodes] : []);
    const q = {
      length: arr.length,
      nodes: arr,
      each(fn) { arr.forEach((n, i) => fn.call(jq(n), i, n)); return q; },
      val() { return arr.length ? arr[0].value : undefined; },
      text() { return arr.length ? (arr[0].text || '') : ''; },
      attr(name) { return arr.length ? (arr[0][name] ?? arr[0].dataset[name]) : undefined; },
      hasClass(c) { return arr.length ? arr[0].classes.includes(c) : false; },
      closest(sel) { return wrap(arr.length ? [arr[0].closest(sel)].filter(Boolean) : []); },
      find(sel) {
        const out = [];
        const nameMatch = sel.match(/^\[name\^?=(.+)\]$/);
        const walk = n => n.children.forEach(c => {
          if (nameMatch) {
            const raw = nameMatch[1].replace(/\\\[/g, '[');
            const prefix = sel.includes('^=') ? raw : null;
            if (prefix ? String(c.name || '').startsWith(prefix) : c.name === raw) out.push(c);
          } else if (sel.startsWith('.') && c.classes.includes(sel.slice(1))) out.push(c);
          walk(c);
        });
        arr.forEach(walk);
        return wrap(out);
      },
      // jQuery .data() coerces numeric-looking strings to Numbers. Reproducing
      // that is the whole point of the id-normalisation assertion below.
      data(key) {
        if (!arr.length) return key === undefined ? {} : undefined;
        const raw = arr[0].dataset;
        const conv = v => (typeof v === 'string' && v !== '' && String(Number(v)) === v) ? Number(v) : v;
        if (key === undefined) {
          const out = {};
          for (const k in raw) out[k] = conv(raw[k]);
          return out;
        }
        return conv(raw[key]);
      },
      on(...args) { jq.on(...args); return q; },
      off() { return q; },
    };
    return q;
  }

  const documentNode = new El({ tag: 'document' });

  function jq(target) {
    if (target === documentNode || target === 'document') {
      return {
        ready(fn) { readyFns.push(fn); return this; },
        on(events, selector, fn) {
          if (typeof selector === 'function') { handlers.push({ events, selector: null, fn: selector }); }
          else { handlers.push({ events, selector, fn }); }
          return this;
        },
        off() { return this; },
      };
    }
    if (target instanceof El) return wrap([target]);
    if (Array.isArray(target)) return wrap(target);
    if (target && target.nodes) return target;
    return wrap([]);
  }
  jq.ajax = ajax || (() => ({ done() { return this; }, fail() { return this; } }));
  jq.post = () => ({});
  jq.on = () => {};

  const winListeners = {};
  const docListeners = {};
  const pixels = [];
  const window = {
    dataLayer: undefined,
    __synSig: undefined,
    location: { origin: 'https://shop.test', href: 'https://shop.test/cart' },
    Image: function () { const img = {}; pixels.push(img); return img; },
    addEventListener(ev, fn) { (winListeners[ev] = winListeners[ev] || []).push(fn); },
  };
  documentNode.addEventListener = (ev, fn) => { (docListeners[ev] = docListeners[ev] || []).push(fn); };
  documentNode.visibilityState = 'visible';
  const sandbox = {
    window,
    document: documentNode,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    Object, Array, String, Number, parseInt, parseFloat, isNaN, JSON, Math, console,
  };
  sandbox.globalThis = sandbox;
  if (withJQuery) sandbox.jQuery = jq;
  if (config !== null) sandbox.varGtmServerSide = config;

  const ctx = vm.createContext(sandbox);
  const code = fs.readFileSync(SCRIPT, 'utf8');
  let threw = null;
  try { vm.runInContext(code, ctx, { filename: 'javascript.js' }); } catch (e) { threw = e; }

  const fireReady = () => readyFns.forEach(f => f());
  const runTimers = () => { const t = timers.splice(0); t.forEach(x => x.fn()); };
  const handlerFor = (sub) => handlers.find(h => (h.selector && h.selector.includes(sub)) || h.events === sub);

  // In a browser a top-level `var x` IS window.x. The VM keeps the two apart,
  // so resolve from either - which also lets this suite run unchanged against
  // an older release that never assigned to window explicitly.
  const plugin = window.pluginGtmServerSide || sandbox.pluginGtmServerSide;
  if (plugin && !window.pluginGtmServerSide) window.pluginGtmServerSide = plugin;

  const firePageHide = () => (winListeners.pagehide || []).forEach(f => f());
  const fireHidden = () => {
    documentNode.visibilityState = 'hidden';
    (docListeners.visibilitychange || []).forEach(f => f());
  };

  return { sandbox, window, jq, El, documentNode, fireReady, runTimers, handlers, handlerFor, threw, timers, plugin, firePageHide, fireHidden, pixels };
}

const CFG = {
  ajax: 'https://shop.test/wp-admin/admin-ajax.php',
  security: 'abc123',
  currency: 'EUR',
  is_custom_event_name: '',
  DATA_LAYER_CUSTOM_EVENT_NAME: '_synapse',
};
const ecom = dlArr => dlArr.filter(e => e.event).map(e => e.ecommerce);
const events = dlArr => dlArr.filter(e => e.event).map(e => e.event);

console.log(`\njavascript.js functional tests  (${PLUGIN_DIR})\n`);

// --- J1..J5  the grouped-product defect -----------------------------------
{
  try {
  const { sandbox, window } = makeEnv({ config: CFG });
  const p = window.pluginGtmServerSide || {};
  if (!p.pushAddToCart) { ok('J1 grouped array pushes ONE event with every ordered item', false, 'plugin object missing'); }
  else p.pushAddToCart([{ item_id: '11', price: '10.00', quantity: '2' }, { item_id: '12', price: '5.00', quantity: '1' }]);
  const e = ecom(window.dataLayer)[0];
  ok('J1 grouped array pushes ONE event with every ordered item', !!e && e.items.length === 2, JSON.stringify(e));
  ok('J2 grouped value is the sum', !!e && e.value === '25.00', e && e.value);
  ok('J3 grouped items are indexed from 1', !!e && e.items[0].index === 1 && e.items[1].index === 2);
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const { window } = makeEnv({ config: CFG });
  (window.pluginGtmServerSide||{_:0}).pushAddToCart([{ item_id: '11', price: '10.00', quantity: '0' }, { item_id: '12', price: '5.00', quantity: '0' }]);
  ok('J4 grouped with nothing ordered pushes NOTHING', (window.dataLayer || []).length === 0, JSON.stringify(window.dataLayer));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const { window } = makeEnv({ config: CFG });
  (window.pluginGtmServerSide||{_:0}).pushAddToCart([{ item_id: '11', price: '10.00', quantity: '0' }, { item_id: '12', price: '5.00', quantity: '3' }]);
  const e = ecom(window.dataLayer)[0];
  ok('J5 only the ordered rows are reported', !!e && e.items.length === 1 && e.items[0].item_id === '12', JSON.stringify(e && e.items));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const { window } = makeEnv({ config: CFG });
  (window.pluginGtmServerSide||{_:0}).pushAddToCart([]);
  ok('J6 empty list pushes nothing', (window.dataLayer || []).length === 0);
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

// --- J7..J9  single item shapes -------------------------------------------
{
  try {
  const { window, sandbox } = makeEnv({ config: CFG });
  (window.pluginGtmServerSide||{_:0}).pushAddToCart({ price: '7.00' });            // no item_id at all
  const e = ecom(window.dataLayer)[0];
  ok('J7 single item without item_id does not throw and still pushes', !!e && e.items.length === 1);
  ok('J8 missing quantity defaults to 1', !!e && e.items[0].quantity === 1, e && e.items[0].quantity);
  ok('J9 no implicit global `item` leaks', sandbox.item === undefined && window.item === undefined);
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

// --- J10  payload shape ----------------------------------------------------
{
  try {
  const { window } = makeEnv({ config: CFG });
  (window.pluginGtmServerSide||{_:0}).pushAddToCart({ item_id: '5', price: '3.00', quantity: '2' });
  const ev = window.dataLayer.filter(e => e.event)[0];
  ok('J10 ecomm_pagetype stays at the top level, not inside ecommerce',
    ev.ecomm_pagetype === 'product' && ev.ecommerce.ecomm_pagetype === undefined, JSON.stringify(ev));
  ok('J11 clears the previous ecommerce object first',
    window.dataLayer[0] && window.dataLayer[0].ecommerce === null);
  ok('J12 price stays a fixed-2 string, matching the PHP side', ev.ecommerce.items[0].price === '3.00');
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

// --- J13  remove_from_cart goes through the shared path --------------------
{
  try {
  const { window } = makeEnv({ config: CFG });
  (window.pluginGtmServerSide||{_:0}).removeFromCart({ item_id: 99, price: '7.5', quantity: 2 });
  const ev = window.dataLayer.filter(e => e.event)[0];
  ok('J13 remove_from_cart carries ecommerce.value', ev && ev.ecommerce.value === '15.00', ev && ev.ecommerce.value);
  ok('J14 remove_from_cart price is formatted', ev && ev.ecommerce.items[0].price === '7.50');
  ok('J15 remove_from_cart has an index', ev && ev.ecommerce.items[0].index === 1);
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

// --- J16  id type normalisation -------------------------------------------
{
  try {
  const { window, El, jq } = makeEnv({ config: CFG });
  const node = new El({ tag: 'a', classes: ['remove'], dataset: { gtm_item_id: '123', gtm_item_sku: '0012' } });
  const viaData = (window.pluginGtmServerSide||{_:0}).getGtmItemData(jq(node).data());
  const viaDataset = (window.pluginGtmServerSide||{_:0}).getGtmItemData(node.dataset);
  ok('J16 item_id is a string on the jQuery .data() path', viaData.item_id === '123', typeof viaData.item_id);
  ok('J17 both accessor paths agree on item_id', viaData.item_id === viaDataset.item_id);
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

// --- J18..J21  cart state AJAX --------------------------------------------
function ajaxEnv(outcome) {
  let doneCb = null, failCb = null;
  const ajax = () => {
    const d = {
      done(fn) { doneCb = fn; return d; },
      fail(fn) { failCb = fn; return d; },
    };
    return d;
  };
  const env = makeEnv({ config: { ...CFG, is_custom_event_name: 'yes' }, ajax });
  env.settle = () => {
    if (outcome.type === 'done') doneCb && doneCb(outcome.response);
    if (outcome.type === 'fail') failCb && failCb({ status: outcome.status }, outcome.textStatus);
  };
  return env;
}
{
  try {
  const env = ajaxEnv({ type: 'fail', status: 403, textStatus: 'error' });
  (env.window.pluginGtmServerSide||{_:0}).pushAddToCart({ item_id: '1', price: '2.00', quantity: '1' });
  env.runTimers();               // the 1500 ms fallback fires the request
  env.settle();                  // ...and it fails with 403
  const evs = events(env.window.dataLayer || []);
  ok('J18 a 403 on cart-state still pushes add_to_cart', evs.length === 1 && evs[0] === 'add_to_cart_synapse', JSON.stringify(evs));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const env = ajaxEnv({ type: 'done', response: { success: true, data: { cart_quantity: 3 } } });
  (env.window.pluginGtmServerSide||{_:0}).pushAddToCart({ item_id: '1', price: '2.00', quantity: '1' });
  env.runTimers();
  env.settle();
  const ev = (env.window.dataLayer || []).filter(e => e.event)[0];
  ok('J19 a successful cart-state is attached', ev && ev.cart_state && ev.cart_state.cart_quantity === 3);
  ok('J20 exactly one event is pushed', events(env.window.dataLayer).length === 1);
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const env = ajaxEnv({ type: 'done', response: { success: false } });
  (env.window.pluginGtmServerSide||{_:0}).pushAddToCart({ item_id: '1', price: '2.00', quantity: '1' });
  env.runTimers();
  env.settle();
  const ev = (env.window.dataLayer || []).filter(e => e.event)[0];
  ok('J21 an application-level error still pushes, without cart_state', !!ev && ev.cart_state === undefined);
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  // The failure must be reported through the tail's signal channel when present.
  const env = ajaxEnv({ type: 'fail', status: 500, textStatus: 'error' });
  const seen = [];
  env.window.__synSig = (k, n) => seen.push([k, n]);
  (env.window.pluginGtmServerSide||{_:0}).pushAddToCart({ item_id: '1', price: '2.00', quantity: '1' });
  env.runTimers();
  env.settle();
  ok('J22 a cart-state failure raises a _sg signal', seen.length === 1 && seen[0][0] === 'cart_state', JSON.stringify(seen));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

// --- J23..J25  hostile environments ---------------------------------------
{
  try {
  const env = makeEnv({ withJQuery: false, config: CFG });
  ok('J23 no jQuery is a silent no-op, not a thrown page', env.threw === null && env.window.pluginGtmServerSide === undefined);
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const { window } = makeEnv({ config: null });   // varGtmServerSide never defined
  let threw = null;
  try { (window.pluginGtmServerSide||{_:0}).pushAddToCart({ item_id: '1', price: '2.00', quantity: '1' }); } catch (e) { threw = e; }
  const ev = (window.dataLayer || []).filter(e => e.event)[0];
  ok('J24 a missing config still pushes the event', threw === null && !!ev, threw && threw.message);
  ok('J25 a missing config degrades to an empty currency', ev && ev.ecommerce.currency === '');
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const { window } = makeEnv({ config: CFG });
  ok('J26 dataLayer is created when the loader never ran', window.dataLayer === undefined);
  (window.pluginGtmServerSide||{_:0}).pushAddToCart({ item_id: '1', price: '2.00', quantity: '1' });
  ok('J27 ...and the push lands in it', Array.isArray(window.dataLayer) && window.dataLayer.length === 2);
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

// --- J28  select_item never carries undefined keys -------------------------
{
  try {
  const { window } = makeEnv({ config: CFG });
  (window.pluginGtmServerSide||{_:0}).pushSelectItem({ item_id: '1', price: '2.00', quantity: '1' }, { pagetype: 'category' });
  const ev = (window.dataLayer || []).filter(e => e.event)[0];
  ok('J28 select_item omits absent custom keys',
    ev && !('collection_id' in ev.ecommerce) && !('item_list_name' in ev.ecommerce), JSON.stringify(ev && ev.ecommerce));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const { window } = makeEnv({ config: CFG });
  (window.pluginGtmServerSide||{_:0}).pushSelectItem({ item_id: '1' }, {});
  ok('J29 select_item without a pagetype pushes nothing', (window.dataLayer || []).length === 0);
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

// --- J30  removed_from_cart with a short argument list ---------------------
{
  try {
  const env = makeEnv({ config: CFG });
  env.fireReady();
  const h = env.handlerFor('removed_from_cart');
  let threw = null;
  try { h && h.fn({}, {}, 'hash', undefined); } catch (e) { threw = e; }
  ok('J30 removed_from_cart survives a missing button argument', !!h && threw === null, threw && threw.message);
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

// --- J31  the archive handler reads currentTarget --------------------------
{
  try {
  const env = makeEnv({ config: CFG });
  env.fireReady();
  const h = env.handlerFor('.add_to_cart_button');
  const button = new env.El({ tag: 'a', classes: ['add_to_cart_button'], dataset: { gtm_item_id: '77', gtm_price: '4.00' } });
  const icon = new env.El({ tag: 'span', classes: ['icon'] });
  icon.parent = button;
  let threw = null;
  try { h && h.fn({ target: icon, currentTarget: button }); } catch (e) { threw = e; }
  const ev = (env.window.dataLayer || []).filter(e => e.event)[0];
  ok('J31 a click on an icon inside the button still tracks',
    !!h && threw === null && !!ev && ev.ecommerce.items[0].item_id === '77', threw ? threw.message : JSON.stringify(ev));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

// --- J32  one handler, not two, for the block grid -------------------------
{
  try {
  const env = makeEnv({ config: CFG });
  env.fireReady();
  const matching = env.handlers.filter(h => h.selector && h.selector.indexOf('.add_to_cart_button') !== -1);
  ok('J32 only one archive/block add-to-cart handler is bound', matching.length === 1, `${matching.length} handlers`);
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

/* --- J33..J37  the cart quantity field ------------------------------------
 *
 * 1.7.4 only ever reported an increase, so a decrease produced nothing. 1.7.5
 * added the missing remove_from_cart and, in doing so, inherited the old
 * keypress trigger: keypress runs BEFORE the browser inserts the character, so
 * replacing 10 with 12 passes through "1" and reported nine items removed that
 * the shopper never removed. These pin the trigger and the baseline.
 * ------------------------------------------------------------------------ */

function cartRow(env, original, current, id) {
  const remove = new env.El({ tag: 'a', classes: ['remove'], dataset: { gtm_item_id: id || '55', gtm_price: '3.00' } });
  const qty    = new env.El({ tag: 'input', classes: ['qty'], defaultValue: String(original), value: String(current) });
  const tdRem  = new env.El({ tag: 'td', classes: ['product-remove'], children: [ remove ] });
  const tdQty  = new env.El({ tag: 'td', classes: ['product-quantity'], children: [ qty ] });
  const row    = new env.El({ tag: 'tr', classes: ['cart_item'], children: [ tdRem, tdQty ] });
  row.parent = env.documentNode;
  env.documentNode.children.push(row);
  return qty;
}
const typed = { which: 50, keyCode: 50, key: '2' };
const enter = { which: 13, keyCode: 13, key: 'Enter' };

{
  try {
  const env = makeEnv({ config: CFG });
  env.fireReady();
  const qty = cartRow(env, 10, 1);           // mid-typing: 10 replaced, "1" so far
  const h = env.handlerFor('input[type=number]');
  h && h.fn.call(qty, typed);
  ok('J33 a half-typed quantity reports nothing', (env.window.dataLayer || []).length === 0,
    JSON.stringify(events(env.window.dataLayer || [])));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const env = makeEnv({ config: CFG });
  env.fireReady();
  const qty = cartRow(env, 10, 5);           // Enter submits the cart form
  const h = env.handlerFor('input[type=number]');
  h && h.fn.call(qty, enter);
  const ev = (env.window.dataLayer || []).filter(e => e.event);
  ok('J34 Enter on the quantity field reports the decrease once',
    ev.length === 1 && ev[0].event === 'remove_from_cart' && ev[0].ecommerce.items[0].quantity === 5,
    JSON.stringify(ev.map(e => [e.event, e.ecommerce.items[0].quantity])));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const env = makeEnv({ config: CFG });
  env.fireReady();
  cartRow(env, 10, 12);
  const h = env.handlerFor('[name=update_cart]');
  h && h.fn({});
  const ev = (env.window.dataLayer || []).filter(e => e.event);
  ok('J35 Update cart reports the increase as the delta',
    ev.length === 1 && ev[0].event === 'add_to_cart' && ev[0].ecommerce.items[0].quantity === 2,
    JSON.stringify(ev.map(e => [e.event, e.ecommerce.items[0].quantity])));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const env = makeEnv({ config: CFG });
  env.fireReady();
  const qty = cartRow(env, 10, 12);
  const hk = env.handlerFor('input[type=number]');
  hk && hk.fn.call(qty, enter);              // reported +2
  qty.value = '15';
  const hc = env.handlerFor('[name=update_cart]');
  hc && hc.fn({});                           // must be +3, not +5
  const ev = (env.window.dataLayer || []).filter(e => e.event);
  ok('J36 a second edit is measured from what was already reported',
    ev.length === 2 && ev[1].ecommerce.items[0].quantity === 3,
    JSON.stringify(ev.map(e => [e.event, e.ecommerce.items[0].quantity])));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const env = makeEnv({ config: CFG });
  env.fireReady();
  cartRow(env, 10, '');                      // field cleared, nothing confirmed
  const h = env.handlerFor('[name=update_cart]');
  h && h.fn({});
  ok('J37 an empty quantity field reports nothing', (env.window.dataLayer || []).length === 0,
    JSON.stringify(env.window.dataLayer));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

/* --- J38..J42  a deferred cart event must survive the page leaving --------
 *
 * With "Decorate dataLayer event name" on, add_to_cart and remove_from_cart
 * wait for an admin-ajax cart-state call. A cart form that submits and
 * navigates takes the listener and the 1500 ms timer with it, so the event was
 * never pushed - not degraded, not late, simply absent.
 * ------------------------------------------------------------------------ */

const SUFFIX = Object.assign({}, CFG, { is_custom_event_name: 'yes' });
const fired = w => (w.dataLayer || []).filter(e => e.event);

{
  try {
  const env = makeEnv({ config: SUFFIX });
  const p = env.window.pluginGtmServerSide || {};
  p.pushAddToCart && p.pushAddToCart({ item_id: '9', price: '2.00', quantity: '1' });
  ok('J38 a deferred cart event waits, as designed', fired(env.window).length === 0,
    JSON.stringify(events(env.window.dataLayer || [])));
  env.firePageHide();
  const ev = fired(env.window);
  ok('J39 leaving the page pushes it exactly once, without cart state',
    ev.length === 1 && ev[0].event === 'add_to_cart_synapse' && ev[0].cart_state === undefined,
    JSON.stringify(ev.map(e => e.event)));
  env.runTimers();
  ok('J40 ...and the 1500 ms timer does not push it a second time',
    fired(env.window).length === 1, JSON.stringify(fired(env.window).map(e => e.event)));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const env = makeEnv({ config: SUFFIX });
  const p = env.window.pluginGtmServerSide || {};
  p.pushAddToCart && p.pushAddToCart({ item_id: '9', price: '2.00', quantity: '1' });
  env.runTimers();                       // hands over to the cart-state request
  ok('J41 nothing is pushed while the cart-state request is in flight', fired(env.window).length === 0);
  env.firePageHide();
  ok('J41b a request that never answered still ends in one pushed event',
    fired(env.window).length === 1, JSON.stringify(fired(env.window).map(e => e.event)));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const env = makeEnv({ config: SUFFIX });
  const p = env.window.pluginGtmServerSide || {};
  p.pushAddToCart && p.pushAddToCart({ item_id: '9', price: '2.00', quantity: '1' });
  env.fireHidden();                      // a mobile tab backgrounded, never unloaded
  ok('J42 a tab going hidden flushes it too', fired(env.window).length === 1,
    JSON.stringify(fired(env.window).map(e => e.event)));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

/* --- J43..J45  a signal must reach the worker in inline mode too ----------
 *
 * __synSig is published by the tail, and the tail only loads on sites running
 * the edge-served sender. Every other installation raised signals into a
 * function that was not there, so the observability added in 1.7.5 covered a
 * minority of sites and the rest failed silently.
 * ------------------------------------------------------------------------ */

const SIGNALLING = Object.assign({}, SUFFIX, { signal_path: '/lmr' });
const sg = env => env.pixels.map(p => String(p.src || '')).filter(u => u.indexOf('_syng=1') !== -1);

{
  try {
  const env = makeEnv({ config: SIGNALLING });
  const p = env.window.pluginGtmServerSide || {};
  p.pushAddToCart && p.pushAddToCart({ item_id: '9', price: '2.00', quantity: '1' });
  env.firePageHide();
  const px = sg(env);
  ok('J43 without the tail the pixel is sent directly',
    px.length === 1 && px[0].indexOf('https://shop.test/lmr/_sg?k=cart_state&n=unload') === 0, JSON.stringify(px));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const env = makeEnv({ config: SIGNALLING });
  const seen = [];
  env.window.__synSig = (k, n) => seen.push([k, n]);
  const p = env.window.pluginGtmServerSide || {};
  p.pushAddToCart && p.pushAddToCart({ item_id: '9', price: '2.00', quantity: '1' });
  env.firePageHide();
  ok('J44 with the tail present the tail sends it and nothing is duplicated',
    seen.length === 1 && sg(env).length === 0, JSON.stringify({ seen, px: sg(env) }));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}
{
  try {
  const env = makeEnv({ config: SUFFIX });        // no identifier, so no worker
  const p = env.window.pluginGtmServerSide || {};
  p.pushAddToCart && p.pushAddToCart({ item_id: '9', price: '2.00', quantity: '1' });
  env.firePageHide();
  ok('J45 with no worker configured nothing is sent, and the event still is',
    sg(env).length === 0 && fired(env.window).length === 1, JSON.stringify(sg(env)));
  } catch (e) { fail++; console.log(`  FAIL (threw) ${e.message}`); }
}

console.log(`\n${pass}/${pass + fail} passed\n`);
process.exit(fail ? 1 : 0);
