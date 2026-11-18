// Animación suave al aparecer elementos en pantalla
(function () {
  const els = document.querySelectorAll('.card, .steps li, .cta, .flow-step');
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  els.forEach((el) => io.observe(el));
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();
