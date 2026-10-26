document.querySelectorAll('.trial-cta').forEach((cta) => {
  const dismiss = (event) => {
    if (event.key === 'Escape') cta.setAttribute('data-dismissed', '');
  };
  document.addEventListener('keydown', dismiss);
  cta.addEventListener('mouseleave', () => cta.removeAttribute('data-dismissed'));
  cta.addEventListener('focusout', () => cta.removeAttribute('data-dismissed'));
});

// Keep the real link usable without JavaScript and preserve browser shortcuts.
(() => {
  const notice = document.createElement('div');
  notice.className = 'trial-navigation';
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  const card = document.createElement('div');
  card.className = 'trial-navigation-card';
  const mark = document.createElement('span');
  mark.className = 'trial-navigation-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '→';
  const text = document.createElement('span');
  card.append(mark, text);
  notice.append(card);
  document.body.append(notice);
  let activeLink = null;
  let resetTimer;
  let navigateTimer;
  let firstFrame;
  let secondFrame;
  const reset = () => {
    clearTimeout(resetTimer);
    clearTimeout(navigateTimer);
    cancelAnimationFrame(firstFrame);
    cancelAnimationFrame(secondFrame);
    if (activeLink) activeLink.removeAttribute('aria-busy');
    activeLink = null;
    notice.hidden = true;
    text.textContent = '';
  };
  window.addEventListener('pageshow', reset);
  document.querySelectorAll('.trial-cta > a').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
        || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      if (link.origin !== 'https://app.nodeaccess.com.br' || link.pathname !== '/trial') return;
      event.preventDefault();
      if (activeLink) return;
      activeLink = link;
      link.setAttribute('aria-busy', 'true');
      notice.hidden = false;
      text.textContent = 'Abrindo o cadastro de teste…';
      let navigating = false;
      const navigate = () => {
        if (navigating || activeLink !== link) return;
        navigating = true;
        clearTimeout(navigateTimer);
        cancelAnimationFrame(firstFrame);
        cancelAnimationFrame(secondFrame);
        try { window.location.assign(link.href); } catch { reset(); }
      };
      // Paint first; throttled/background frames must never swallow the link.
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(navigate);
      });
      navigateTimer = setTimeout(navigate, 350);
      resetTimer = setTimeout(reset, 8000);
    });
  });
})();
