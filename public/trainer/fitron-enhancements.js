/* fitron-a11y and the three preview refinement loops. */
(() => {
  const cardKinds = [
    ['workout', /Today's Workout/i],
    ['nutrition', /Today's Nutrition/i],
    ['plan', /Today's Plan/i],
    ['coach', /AI Coach/i],
    ['weekly', /Weekly Progress/i],
    ['upcoming', /Upcoming/i],
  ];

  const enhance = () => {
    const root = document.documentElement;
    root.dataset.fitronRefinement = 'on';

    if (!document.querySelector('.skip-link')) {
      const skip = document.createElement('a');
      skip.className = 'skip-link';
      // the page has <base href="/trainer/">, so a bare #hash would load /trainer/ again
      skip.href = location.pathname + location.search + '#fitron-main-content';
      skip.textContent = 'Skip to main content';
      document.body.prepend(skip);
    }

    const main = document.querySelector('main') || document.querySelector('[class*="app"], [class*="shell"], [class*="page"]');
    if (main) {
      if (!main.id) main.id = 'fitron-main-content';
      if (!main.getAttribute('role')) main.setAttribute('role', 'main');
    }

    document.querySelectorAll('input, select, textarea').forEach((field) => {
      if (!field.getAttribute('aria-label') && !field.getAttribute('aria-labelledby')) {
        const label = field.getAttribute('placeholder') || field.getAttribute('name');
        if (label) field.setAttribute('aria-label', label);
      }
    });

    document.querySelectorAll('button').forEach((button) => {
      if (!button.getAttribute('type')) button.setAttribute('type', 'button');
      if (!button.getAttribute('aria-label') && !button.textContent.trim()) {
        const title = button.getAttribute('title');
        if (title) button.setAttribute('aria-label', title);
      }
    });

    document.querySelectorAll('img').forEach((image) => {
      if (!image.hasAttribute('alt')) image.setAttribute('alt', 'Fitron illustration');
    });

    document.querySelectorAll('.ph-nav').forEach((nav) => {
      if (!nav.getAttribute('aria-label')) nav.setAttribute('aria-label', 'Primary navigation');
    });

    document.querySelectorAll('.ob').forEach((onboarding) => {
      onboarding.classList.add('fitron-onboarding');
      const step = onboarding.querySelector('.ob-step');
      if (step && !step.getAttribute('aria-label')) step.setAttribute('aria-label', 'Onboarding progress');
      onboarding.querySelectorAll('.ob-foot').forEach((footer) => {
        if (!footer.getAttribute('aria-label')) footer.setAttribute('aria-label', 'Onboarding actions');
      });
    });

    document.querySelectorAll('main.scr.appbg').forEach((appMain) => {
      const cards = [...appMain.querySelectorAll('.card')]
        .filter((card) => card.closest('main') === appMain);
      const workout = cards.find((card) => /Today's Workout/i.test(card.textContent || ''));
      const weekly = cards.find((card) => /Weekly Progress/i.test(card.textContent || ''));
      if (!workout || !weekly) return;

      appMain.classList.add('fitron-home-dashboard');
      const grid = workout.parentElement;
      if (grid) {
        grid.classList.add('fitron-home-grid');
        if (grid.parentElement) grid.parentElement.classList.add('fitron-home-content');
      }

      cards.forEach((card) => {
        const kind = cardKinds.find(([, pattern]) => pattern.test(card.textContent || ''));
        if (kind) card.classList.add('fitron-card-' + kind[0]);
      });
    });
  };

  enhance();
  const observer = new MutationObserver(enhance);
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 10000);
})();
