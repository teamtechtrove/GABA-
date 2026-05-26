/* ============================================================
   Hormulse / GABA Landing Page — Interactions
   ============================================================ */

// ===== NAV: scroll shadow + mobile toggle =====
const lnav = document.getElementById('lnav');
window.addEventListener('scroll', () => {
  lnav.classList.toggle('scrolled', window.scrollY > 30);
}, { passive: true });

function toggleMobileNav() {
  const menu = document.getElementById('lnavMobile');
  menu.classList.toggle('open');
}
// Close mobile nav on outside click
document.addEventListener('click', e => {
  const menu = document.getElementById('lnavMobile');
  const ham  = document.getElementById('lnavHam');
  if (menu.classList.contains('open') && !menu.contains(e.target) && !ham.contains(e.target)) {
    menu.classList.remove('open');
  }
});

// ===== SMOOTH SCROLL for anchor links =====
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const navH = lnav.offsetHeight || 64;
      const top  = target.getBoundingClientRect().top + window.pageYOffset - navH - 16;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

// ===== INTERSECTION OBSERVER: fade-up / fade-right / fade-left =====
const animOpts = { threshold: 0.12, rootMargin: '0px 0px -40px 0px' };
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, animOpts);

document.querySelectorAll('.fade-up, .fade-right, .fade-left').forEach(el => observer.observe(el));

// ===== TIMELINE: line draw + node reveal =====
const timelineObs = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const line = document.getElementById('timelineLine');
    if (line) line.classList.add('visible');
    // Stagger node appearances
    document.querySelectorAll('.timeline-node').forEach((node, i) => {
      setTimeout(() => node.classList.add('visible'), 200 + i * 300);
    });
    timelineObs.unobserve(entry.target);
  });
}, { threshold: 0.1 });

const timeline = document.querySelector('.timeline');
if (timeline) timelineObs.observe(timeline);

// ===== COUNT-UP for community stats =====
function countUp(el, target, duration) {
  if (typeof target !== 'number') return; // skip "∞" and "Global"
  const start = 0;
  const step  = (timestamp, startTime) => {
    const progress  = Math.min((timestamp - startTime) / duration, 1);
    const eased     = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current   = Math.round(start + (target - start) * eased);
    el.textContent  = current.toLocaleString();
    if (progress < 1) requestAnimationFrame(ts => step(ts, startTime));
  };
  requestAnimationFrame(ts => step(ts, ts));
}

const statsObs = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.querySelectorAll('.stat-number').forEach(numEl => {
      const raw = numEl.dataset.target;
      const num = parseInt(raw, 10);
      if (!isNaN(num)) {
        countUp(numEl, num, 1400);
      }
      // ∞ and Global are already set as text in HTML — no animation needed
    });
    statsObs.unobserve(entry.target);
  });
}, { threshold: 0.3 });

const statsSection = document.querySelector('.community-stats');
if (statsSection) statsObs.observe(statsSection);

// ===== Trait badges: pop-in stagger after founder section visible =====
const founderObs = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.querySelectorAll('.trait-badge').forEach((badge, i) => {
      badge.style.transitionDelay = `${0.35 + i * 0.08}s`;
      badge.style.opacity = '0';
      badge.style.transform = 'scale(.85) translateY(8px)';
      badge.style.transition = 'opacity .4s cubic-bezier(.22,1,.36,1), transform .4s cubic-bezier(.22,1,.36,1)';
      requestAnimationFrame(() => {
        setTimeout(() => {
          badge.style.opacity  = '1';
          badge.style.transform = 'scale(1) translateY(0)';
        }, 350 + i * 80);
      });
    });
    founderObs.unobserve(entry.target);
  });
}, { threshold: 0.2 });

const founderSection = document.querySelector('.founder-section');
if (founderSection) founderObs.observe(founderSection);

// ===== Hero: trigger initial visible classes immediately =====
document.querySelectorAll('.hero .fade-up').forEach(el => {
  // Hero elements are above the fold — mark visible after tiny delay for CSS transition
  const delay = parseFloat(el.style.transitionDelay || '0') * 1000;
  // Use the delay-* class to derive actual stagger
  const d = Array.from(el.classList).find(c => c.startsWith('delay-'));
  const ms = d ? parseInt(d.replace('delay-', ''), 10) * 120 : 0;
  setTimeout(() => el.classList.add('visible'), 80 + ms);
});
