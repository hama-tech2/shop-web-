/**
 * The admin screen's only script: a confirm step before anything
 * destructive. The page works without it — the form still submits, it
 * just does not ask first.
 */
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-confirm]');
  if (!button) return;
  if (!window.confirm(button.dataset.confirm)) event.preventDefault();
});
