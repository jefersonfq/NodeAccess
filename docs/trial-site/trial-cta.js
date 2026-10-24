document.querySelectorAll('.trial-cta').forEach((cta) => {
  const dismiss = (event) => {
    if (event.key === 'Escape') cta.setAttribute('data-dismissed', '');
  };
  document.addEventListener('keydown', dismiss);
  cta.addEventListener('mouseleave', () => cta.removeAttribute('data-dismissed'));
  cta.addEventListener('focusout', () => cta.removeAttribute('data-dismissed'));
});
