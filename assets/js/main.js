/* ============================================================
   IPCON srl – Main JS
   ============================================================ */

(function () {
  'use strict';

  /* ---------- Header scroll ---------- */
  const header    = document.getElementById('header');
  const backToTop = document.getElementById('backToTop');
  const sections  = document.querySelectorAll('section[id]');
  const handleScroll = () => {
    if (window.scrollY > 60) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
    updateActiveNav();
    toggleBackToTop();
  };
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  /* ---------- Mobile nav ---------- */
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav');

  burger.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    burger.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open);
    document.body.style.overflow = open ? 'hidden' : '';
  });

  // Close on link click
  nav.querySelectorAll('.nav__link').forEach(link => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      burger.classList.remove('open');
      document.body.style.overflow = '';
    });
  });

  /* ---------- Active nav link on scroll ---------- */
  function updateActiveNav() {
    const scrollPos = window.scrollY + 100;
    let current = '';

    sections.forEach(section => {
      if (section.offsetTop <= scrollPos) {
        current = section.getAttribute('id');
      }
    });

    document.querySelectorAll('.nav__link').forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.add('active');
      }
    });
  }

  /* ---------- Smooth scroll for anchor links ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (!href || href.length < 2) return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      const offset = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--header-h')) || 72;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  /* ---------- Back to top ---------- */
  function toggleBackToTop() {
    backToTop.classList.toggle('visible', window.scrollY > 400);
  }

  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ---------- AOS (Animate on Scroll) – lightweight version ---------- */
  const aosElements = document.querySelectorAll('[data-aos]');

  // Mark body so CSS can hide elements — only when JS is running
  document.body.classList.add('js-ready');

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const delay = parseInt(el.dataset.aosDelay || 0);
          setTimeout(() => el.classList.add('aos-animate'), delay);
          observer.unobserve(el);
        }
      });
    }, { rootMargin: '0px 0px -40px 0px', threshold: 0.05 });

    aosElements.forEach(el => observer.observe(el));

    // Trigger any elements already in view on load
    setTimeout(() => {
      aosElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight) {
          el.classList.add('aos-animate');
          observer.unobserve(el);
        }
      });
    }, 100);
  } else {
    aosElements.forEach(el => el.classList.add('aos-animate'));
  }

  /* ---------- FAQ Accordion ---------- */
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item   = btn.closest('.faq-item');
      const answer = item.querySelector('.faq-answer');
      const isOpen = item.classList.contains('open');

      // Chiudi tutti
      document.querySelectorAll('.faq-item.open').forEach(el => {
        el.classList.remove('open');
        el.querySelector('.faq-answer').style.maxHeight = '0';
        el.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
      });

      // Apri quello cliccato (se era chiuso)
      if (!isOpen) {
        item.classList.add('open');
        answer.style.maxHeight = answer.scrollHeight + 'px';
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ---------- Form richieste (completo + compatto "Ti richiamiamo") ---------- */
  const ENDPOINT = 'https://formsubmit.co/ajax/info@ipcon.it';

  function initLeadForm(form) {
    // Captcha matematico solo nei form che lo contengono
    const capQ   = form.querySelector('#captchaQuestion');
    const capIn  = form.querySelector('#captchaInput');
    const capErr = form.querySelector('#captchaError');
    let captchaAnswer = 0;

    function generateCaptcha() {
      if (!capQ) return;
      const a = Math.floor(Math.random() * 9) + 1;
      const b = Math.floor(Math.random() * 9) + 1;
      captchaAnswer = a + b;
      capQ.textContent = `${a} + ${b}`;
      if (capIn) { capIn.value = ''; capIn.style.borderColor = ''; }
      if (capErr) capErr.style.display = 'none';
    }
    generateCaptcha();

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      let valid = true;
      let firstBad = null;
      const bad = (el) => { el.style.borderColor = '#ef4444'; valid = false; if (!firstBad) firstBad = el; };

      form.querySelectorAll('[required]').forEach(field => {
        if (!field.value.trim()) bad(field); else field.style.borderColor = '';
      });

      const emailField = form.querySelector('input[type="email"]');
      if (emailField && emailField.required && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailField.value.trim())) bad(emailField);

      const telField = form.querySelector('input[type="tel"]');
      if (telField && telField.required && telField.value.replace(/\D/g, '').length < 6) bad(telField);

      if (capIn) {
        if (parseInt(capIn.value, 10) !== captchaAnswer) {
          bad(capIn);
          if (capErr) capErr.style.display = 'block';
        } else if (capErr) capErr.style.display = 'none';
      }

      if (!valid) { if (firstBad) firstBad.focus(); return; }

      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn.textContent;
      btn.textContent = 'Invio in corso…';
      btn.disabled = true;

      try {
        const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Accept': 'application/json' }, body: new FormData(form) });
        const json = await res.json();
        if (json.success === 'true' || json.success === true) {
          const card = form.closest('.lead-card');
          if (card) {
            card.classList.add('is-sent');           // compatto: sostituisce il form col messaggio di conferma
          } else {
            btn.textContent = '✓ Richiesta inviata!';
            btn.style.background = '#16a34a';
            form.querySelectorAll('input:not([type=hidden]), select, textarea').forEach(f => f.value = '');
            generateCaptcha();
            setTimeout(() => { btn.textContent = originalText; btn.style.background = ''; btn.disabled = false; }, 5000);
          }
        } else {
          throw new Error('FormSubmit error');
        }
      } catch {
        btn.textContent = '✗ Errore — riprova o chiama il 075 9729695';
        btn.style.background = '#ef4444';
        btn.disabled = false;
        setTimeout(() => { btn.textContent = originalText; btn.style.background = ''; }, 5000);
      }
    });

    form.querySelectorAll('input, textarea').forEach(field => {
      field.addEventListener('input', () => { field.style.borderColor = ''; });
    });
  }

  document.querySelectorAll('form[data-lead], #quoteForm').forEach(initLeadForm);

  /* ---------- Barra contatti mobile: si nasconde quando il form è in vista ---------- */
  const mbar = document.getElementById('mbar');
  const formTarget = document.getElementById('preventivo') || document.getElementById('contatti');
  if (mbar && formTarget && 'IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      mbar.classList.toggle('mbar--hidden', entry.isIntersecting);
    }, { threshold: 0.2 }).observe(formTarget);
  }

  /* ---------- Parola animata nell'hero ---------- */
  const heroTitle = document.querySelector('.hero__title .gradient-text');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (heroTitle && !reduceMotion) {
    // La frase è "per casa o per ___": le parole devono funzionare dopo "per"
    const words = ['lavoro', 'ufficio', 'negozio', 'azienda'];
    let i = 0;
    let charIndex = words[0].length;   // parte dalla parola già scritta nell'HTML ("lavoro") e la cancella
    let isDeleting = true;
    const speed = { type: 90, delete: 50, pause: 2200 };

    function type() {
      const word = words[i];
      if (isDeleting) {
        heroTitle.textContent = word.substring(0, charIndex - 1);
        charIndex--;
      } else {
        heroTitle.textContent = word.substring(0, charIndex + 1);
        charIndex++;
      }

      let delay = isDeleting ? speed.delete : speed.type;

      if (!isDeleting && charIndex === word.length) {
        delay = speed.pause;
        isDeleting = true;
      } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        i = (i + 1) % words.length;
        delay = 400;
      }

      setTimeout(type, delay);
    }

    setTimeout(type, 1800);
  }
})();
