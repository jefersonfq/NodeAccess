document.querySelectorAll('.trial-cta').forEach((cta) => {
  const dismiss = (event) => {
    if (event.key === 'Escape') cta.setAttribute('data-dismissed', '');
  };
  document.addEventListener('keydown', dismiss);
  cta.addEventListener('mouseleave', () => cta.removeAttribute('data-dismissed'));
  cta.addEventListener('focusout', () => cta.removeAttribute('data-dismissed'));
});

// Match the app's page leave; the trial screen owns its arrival animation.
(() => {
  const notice = document.createElement('div');
  notice.className = 'trial-navigation-status';
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  document.body.append(notice);
  let activeLink = null;
  let activePage = null;
  let resetTimer;
  let navigateTimer;
  let onAnimationEnd;
  const reset = () => {
    clearTimeout(resetTimer);
    clearTimeout(navigateTimer);
    if (activePage) {
      activePage.removeEventListener('animationend', onAnimationEnd);
      activePage.classList.remove('trial-page-leaving');
    }
    if (activeLink) activeLink.removeAttribute('aria-busy');
    activeLink = null;
    activePage = null;
    notice.hidden = true;
    notice.textContent = '';
  };
  window.addEventListener('pageshow', reset);
  document.querySelectorAll('.trial-cta > a').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
        || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      if (link.origin !== 'https://app.nodeaccess.com.br' || link.pathname !== '/trial') return;
      const page = link.closest('main');
      // Reduced motion uses the native link, with no animation or added wait.
      if (!page || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      event.preventDefault();
      if (activeLink) return;
      activeLink = link;
      activePage = page;
      link.setAttribute('aria-busy', 'true');
      notice.hidden = false;
      notice.textContent = 'Abrindo o cadastro de teste…';
      let navigating = false;
      const navigate = () => {
        if (navigating || activeLink !== link) return;
        navigating = true;
        clearTimeout(navigateTimer);
        page.removeEventListener('animationend', onAnimationEnd);
        try { window.location.assign(link.href); } catch { reset(); }
      };
      onAnimationEnd = (animation) => {
        if (animation.target === page && animation.animationName === 'trial-page-leave') navigate();
      };
      page.addEventListener('animationend', onAnimationEnd);
      page.classList.add('trial-page-leaving');
      // CSS missing, canceled animation or background tab must not swallow the click.
      navigateTimer = setTimeout(navigate, 180);
      resetTimer = setTimeout(reset, 2000);
    });
  });
})();
