/* Shared behaviour for Bojidar Vasilev subpages: theme, gradient field, dock, scroll animations (GSAP + ScrollTrigger). */
(() => {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;

  /* home link works both published (index.html) and opened from disk */
  if (location.protocol === 'file:') document.querySelectorAll('[data-home]').forEach(a => a.href = '2026-11-13_bojidar-portfolio-prototype.html');

  /* ---------- gradient field ---------- */
  const cv = document.getElementById('field');
  if (cv) {
    const cx = cv.getContext('2d');
    const blobs = [
      {c:[244,191,232], x:.18, y:.22, r:.48},
      {c:[42,195,255],  x:.78, y:.25, r:.42},
      {c:[242,255,8],   x:.62, y:.72, r:.40},
      {c:[241,6,143],   x:.25, y:.80, r:.38},
      {c:[255,8,247],   x:.50, y:.45, r:.30},
    ];
    let W, H, mx = .5, my = .4, tmx = .5, tmy = .4, sy = 0;
    const size = () => { W = cv.width = Math.ceil(innerWidth / 6); H = cv.height = Math.ceil(innerHeight / 6); };
    size(); addEventListener('resize', size);
    addEventListener('pointermove', e => { tmx = e.clientX / innerWidth; tmy = e.clientY / innerHeight; }, {passive:true});
    const draw = t => {
      mx += (tmx - mx) * .04; my += (tmy - my) * .04;
      sy += ((scrollY / Math.max(1, document.body.scrollHeight - innerHeight)) - sy) * .05;
      const black = document.body.dataset.field === 'black';
      const dark = black || isDark();
      cx.globalCompositeOperation = 'source-over';
      cx.fillStyle = black ? '#050507' : dark ? '#130A2C' : '#F1ECF6'; cx.fillRect(0, 0, W, H);
      cx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      blobs.forEach((b, i) => {
        const k = t * .00012 + sy * 3;
        const x = (b.x + Math.sin(k * (1 + i * .3)) * .12 + (mx - .5) * .08 * (i % 2 ? 1 : -1)) * W;
        const y = (b.y + Math.cos(k * (1 + i * .2)) * .10 + (my - .5) * .06) * H;
        const r = b.r * Math.max(W, H);
        const g = cx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${b.c},${black ? .09 : dark ? (i === 0 ? .25 : .55) : .85})`);
        g.addColorStop(1, `rgba(${b.c},0)`);
        cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill();
      });
      if (!reduce) requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  /* ---------- theme toggle ---------- */
  const tb = document.getElementById('theme');
  if (tb) tb.addEventListener('click', e => {
    const next = isDark() ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('bv-theme', next); } catch (err) {}
    if (!reduce) {
      const r = document.createElement('span'); r.className = 'ripple';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 900);
    }
  });

  /* ---------- split text helpers ---------- */
  document.querySelectorAll('[data-split] .line').forEach(line => {
    const walk = node => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          [...n.textContent].forEach(ch => {
            if (ch === ' ') { frag.appendChild(document.createTextNode(' ')); return; }
            const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch; frag.appendChild(s);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.classList.contains('hl')) {
          n.classList.add('ch'); /* gradient words animate as one piece so background-clip:text keeps painting */
        } else if (n.nodeType === 1) walk(n);
      });
    };
    walk(line);
    line.setAttribute('aria-label', line.textContent);
  });
  document.querySelectorAll('[data-words]').forEach(p => {
    p.innerHTML = p.textContent.trim().split(/\s+/).map(w => `<span class="w">${w}</span>`).join('');
  });

  /* ---------- scroll animations ---------- */
  const g = window.gsap, ST = window.ScrollTrigger;
  if (!g || !ST || reduce) {
    document.querySelectorAll('.hs').forEach(h => h.classList.add('no-pin'));
    return;
  }
  g.registerPlugin(ST);

  /* progress bar */
  const bar = document.querySelector('.progress');
  if (bar) g.to(bar, {scaleX: 1, ease: 'none', scrollTrigger: {start: 0, end: 'max', scrub: .3}});

  /* hero letters: rise in on load */
  document.querySelectorAll('[data-split]').forEach(h => {
    g.from(h.querySelectorAll('.ch'), {yPercent: 110, rotate: 10, duration: 1, ease: 'expo.out', stagger: .025, delay: .1});
  });

  /* image frames: un-crop and settle as they enter */
  document.querySelectorAll('[data-reveal]').forEach(el => {
    g.fromTo(el, {clipPath: 'inset(10% 6% 10% 6% round 26px)'}, {clipPath: 'inset(0% 0% 0% 0% round 26px)', ease: 'none',
      scrollTrigger: {trigger: el, start: 'top 95%', end: 'top 45%', scrub: true}});
    const m = el.querySelector('img,video');
    if (m) g.fromTo(m, {scale: 1.22}, {scale: 1, ease: 'none', scrollTrigger: {trigger: el, start: 'top bottom', end: 'bottom top', scrub: true}});
  });

  /* parallax depth */
  document.querySelectorAll('[data-speed]').forEach(el => {
    const s = parseFloat(el.dataset.speed);
    g.fromTo(el, {y: () => 90 * s}, {y: () => -90 * s, ease: 'none',
      scrollTrigger: {trigger: el, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true}});
  });

  /* rotate with scroll */
  document.querySelectorAll('[data-spin]').forEach(el => {
    g.fromTo(el, {rotate: -parseFloat(el.dataset.spin)}, {rotate: parseFloat(el.dataset.spin), ease: 'none',
      scrollTrigger: {trigger: el, start: 'top bottom', end: 'bottom top', scrub: true}});
  });

  /* pop in from below (transform only, stays visible) */
  document.querySelectorAll('[data-pop]').forEach(group => {
    g.from(group.children, {y: 60, rotate: (i) => (i % 2 ? 4 : -4), scale: .92, duration: .9, ease: 'expo.out', stagger: .08,
      scrollTrigger: {trigger: group, start: 'top 85%'}});
  });

  /* marquee lines slide with scroll */
  document.querySelectorAll('[data-marquee]').forEach(el => {
    const dir = el.dataset.marquee === 'right' ? 1 : -1;
    g.fromTo(el, {xPercent: dir > 0 ? -25 : 0}, {xPercent: dir > 0 ? 0 : -25, ease: 'none',
      scrollTrigger: {trigger: el, start: 'top bottom', end: 'bottom top', scrub: true}});
  });

  /* reading: words light up as you scroll */
  document.querySelectorAll('[data-words]').forEach(p => {
    g.fromTo(p.querySelectorAll('.w'), {opacity: .25}, {opacity: 1, stagger: .1, ease: 'none',
      scrollTrigger: {trigger: p, start: 'top 80%', end: 'bottom 45%', scrub: true}});
  });

  /* fan: stacked cards spread out */
  document.querySelectorAll('[data-fan]').forEach(stack => {
    const cards = [...stack.children];
    const n = cards.length;
    const tl = g.timeline({scrollTrigger: {trigger: stack, start: 'top 75%', end: 'bottom 30%', scrub: .6}});
    cards.forEach((c, i) => {
      const off = i - (n - 1) / 2;
      tl.fromTo(c, {xPercent: 0, rotate: off * 3, y: 0}, {xPercent: off * (innerWidth < 700 ? 30 : 46), rotate: off * 7, y: Math.abs(off) * 24, ease: 'power2.out'}, 0);
    });
  });

  /* pinned horizontal galleries */
  document.querySelectorAll('.hs').forEach(h => {
    const vp = h.querySelector('.hs-viewport'), tr = h.querySelector('.hs-track'), ct = h.querySelector('.hs-count');
    const dist = () => Math.max(0, tr.scrollWidth - vp.clientWidth);
    if (dist() < 40) return;
    const items = tr.children.length;
    g.to(tr, {x: () => -dist(), ease: 'none', scrollTrigger: {trigger: h, start: 'center center', end: () => '+=' + dist(), pin: true, scrub: .8, invalidateOnRefresh: true,
      onUpdate: self => { if (ct) ct.textContent = String(Math.min(items, 1 + Math.floor(self.progress * items))).padStart(2, '0') + ' / ' + String(items).padStart(2, '0'); }}});
  });

  /* card tilt */
  document.querySelectorAll('[data-tilt]').forEach(c => {
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
      g.to(c, {rotateY: px * 10, rotateX: -py * 10, transformPerspective: 900, duration: .4});
    });
    c.addEventListener('pointerleave', () => g.to(c, {rotateY: 0, rotateX: 0, duration: .6}));
  });

  addEventListener('load', () => ST.refresh());
})();
