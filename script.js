document.addEventListener('DOMContentLoaded', () => {
  // --- Theme Toggling ---
  const themeToggleBtn = document.getElementById('theme-toggle');
  const htmlElement = document.documentElement;
  const STORAGE_KEY = 'tutorial_site_theme';

  // Check for saved theme preference or system preference
  const savedTheme = localStorage.getItem(STORAGE_KEY);
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
    localStorage.setItem(STORAGE_KEY, newTheme);
  });

  // --- Mobile Menu ---
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mobileCloseBtn = document.getElementById('mobile-close-btn');
  const sidebar = document.querySelector('.sidebar');

  function toggleMenu() {
    sidebar.classList.toggle('open');
  }

  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', toggleMenu);
  if (mobileCloseBtn) mobileCloseBtn.addEventListener('click', toggleMenu);

  // Close menu when clicking a link on mobile
  const navLinks = document.querySelectorAll('.nav-links a');
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
      }
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
  const copyBtns = document.querySelectorAll('.copy-btn');

  copyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const codeBlock = btn.closest('.code-block');
      const code = codeBlock.querySelector('code').innerText;

      navigator.clipboard.writeText(code).then(() => {
        const originalText = btn.innerText;
        btn.innerText = 'Copied!';
        setTimeout(() => {
          btn.innerText = originalText;
        }, 2000);
      });
    });
  });
});
