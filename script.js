document.addEventListener('DOMContentLoaded', () => {
  // --- Theme Toggling ---
  const themeToggleBtn = document.getElementById('theme-toggle');
  const htmlElement = document.documentElement;
  const STORAGE_KEY = 'tutorial_site_theme';

  // Check for saved theme preference or system preference
  let savedTheme;
  try { savedTheme = localStorage.getItem(STORAGE_KEY); } catch (_) { /* Storage can be disabled in private browsing. */ }
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (savedTheme) {
    htmlElement.setAttribute('data-theme', savedTheme);
  } else if (!systemPrefersDark) {
    htmlElement.setAttribute('data-theme', 'light');
  }

  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = htmlElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    htmlElement.setAttribute('data-theme', newTheme);
    try { localStorage.setItem(STORAGE_KEY, newTheme); } catch (_) { /* The current page still keeps the chosen theme. */ }
  });

  // --- Mobile Menu ---
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mobileCloseBtn = document.getElementById('mobile-close-btn');
  const sidebar = document.querySelector('.sidebar');

  const phoneLayout = matchMedia('(max-width: 900px)');
  const main = document.querySelector('.main-content');
  const backdrop = document.createElement('button');
  backdrop.className = 'navigation-backdrop';
  backdrop.type = 'button';
  backdrop.setAttribute('aria-label', 'Close navigation');
  backdrop.tabIndex = -1;
  backdrop.hidden = true;
  document.body.append(backdrop);
  sidebar.id ||= 'tutorial-navigation';
  mobileMenuBtn?.setAttribute('aria-controls', sidebar.id);
  let previousOverflow = null;

  function setMenu(open, returnFocus = false) {
    sidebar.classList.toggle('open', open);
    backdrop.hidden = !open;
    main.inert = open;
    sidebar.inert = phoneLayout.matches && !open;
    mobileMenuBtn?.setAttribute('aria-expanded', String(open));
    if (open) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      mobileCloseBtn?.focus({preventScroll: true});
    } else {
      if (previousOverflow !== null) document.body.style.overflow = previousOverflow;
      previousOverflow = null;
      if (returnFocus) mobileMenuBtn?.focus({preventScroll: true});
    }
  }
  function syncNavigation() {
    setMenu(false);
    if (!phoneLayout.matches) {
      sidebar.inert = document.body.classList.contains('sidebar-hidden');
      mobileMenuBtn?.setAttribute('aria-expanded', String(!sidebar.inert));
    }
  }
  mobileMenuBtn?.addEventListener('click', () => {
    if (phoneLayout.matches) setMenu(!sidebar.classList.contains('open'));
    else {
      document.body.classList.toggle('sidebar-hidden');
      syncNavigation();
    }
  });
  mobileCloseBtn?.addEventListener('click', () => setMenu(false, true));
  backdrop.addEventListener('click', () => setMenu(false, true));
  phoneLayout.addEventListener('change', syncNavigation);
  document.addEventListener('keydown', event => {
    if (!phoneLayout.matches || !sidebar.classList.contains('open')) return;
    if (event.key === 'Escape') { event.preventDefault(); setMenu(false, true); }
    if (event.key === 'Tab') {
      const items = [...sidebar.querySelectorAll('a[href], button')].filter(el => el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  syncNavigation();

  // Close menu when clicking a link on mobile
  const navLinks = document.querySelectorAll('.nav-links a');
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (phoneLayout.matches) setMenu(false);
    });
  });

  // --- Active Link Highlighting on Scroll ---
  const sections = document.querySelectorAll('section[id]');

  function highlightNavigation() {
    const scrollY = window.pageYOffset;

    sections.forEach(current => {
      const sectionHeight = current.offsetHeight;
      const sectionTop = current.offsetTop - 100; // Offset for fixed header
      const sectionId = current.getAttribute('id');
      const navLink = document.querySelector(`.nav-links a[href="#${sectionId}"]`);

      if (navLink) {
        if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
          document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
          navLink.classList.add('active');
        }
      }
    });
  }

  window.addEventListener('scroll', highlightNavigation);

  // --- Copy Code to Clipboard ---
  // (Removed as per new content requirements)
});
